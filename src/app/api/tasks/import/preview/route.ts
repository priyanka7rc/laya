import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUserFromRequest } from '../../../auth-helpers';
import { ocrTextToProposedTasks } from '@/lib/ocrCandidates';

const LOG = '[tasks/import/preview]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const mediaId = body.mediaId;
    if (!mediaId || typeof mediaId !== 'string') {
      return NextResponse.json({ error: 'mediaId required' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: row, error } = await supabase
      .from('media_uploads')
      .select('id, ocr_text, status')
      .eq('id', mediaId)
      .eq('user_id', user.id)
      .single();

    if (error || !row) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    if (row.status !== 'ocr_done' || !row.ocr_text) {
      return NextResponse.json(
        { error: 'Run OCR first (POST /api/media/:mediaId/ocr)' },
        { status: 400 }
      );
    }

    const MAX_OCR_CHARS = 15000;
    let fullText = row.ocr_text;
    let truncated = false;
    if (fullText.length > MAX_OCR_CHARS) {
      fullText = fullText.slice(0, MAX_OCR_CHARS);
      truncated = true;
    }

    const { tasks, truncated: candidateTruncated } = ocrTextToProposedTasks(fullText);
    return NextResponse.json({ tasks, truncated: truncated || candidateTruncated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Preview failed';
    console.error(LOG, e);
    if (message.includes('Too many items')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 });
  }
}
