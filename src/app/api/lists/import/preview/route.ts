import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { buildOcrImportPreview } from '@/lib/ocr_import_preview';

const LOG = '[lists/import/preview]';

const MAX_OCR_CHARS = 15000;
const SAMPLE_SIZE = 5;

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const mediaId = body.mediaId;
    const userHint = (body.userHint ?? null) as string | null;
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

    let fullText = row.ocr_text;
    let truncated = false;
    if (fullText.length > MAX_OCR_CHARS) {
      fullText = fullText.slice(0, MAX_OCR_CHARS);
      truncated = true;
    }

    const previewData = buildOcrImportPreview(fullText, { userHint });
    const list = previewData.proposedList;

    const preview = {
      name_prefill: list.name_prefill,
      heading_confidence: list.name_prefill ? 'high' : 'none',
      suggested_names: list.suggested_names,
      candidates: list.candidates,
      candidatesCount: list.candidates.length,
      sample: list.candidates.slice(0, SAMPLE_SIZE).map((c) => c.text),
    };

    return NextResponse.json({ lists: [preview], truncated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Preview failed';
    console.error(LOG, e);
    if (message.includes('Too many items')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 });
  }
}

