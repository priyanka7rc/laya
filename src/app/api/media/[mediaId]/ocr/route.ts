import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUserFromRequest } from '../../../auth-helpers';
import { getOcrClient } from '@/server/ocr';

const LOG = '[media/ocr]';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const { mediaId } = await params;
    if (!mediaId) {
      return NextResponse.json({ error: 'mediaId required' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: row, error: fetchError } = await supabase
      .from('media_uploads')
      .select('id, storage_path, media_type, status')
      .eq('id', mediaId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !row) {
      return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
    }

    if (row.status !== 'uploaded') {
      return NextResponse.json(
        { error: 'OCR already run or upload failed. Use a new upload for OCR.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from('task-media')
      .download(row.storage_path);

    if (downloadError || !fileData) {
      console.error(LOG, 'download failed', mediaId, downloadError);
      await supabase
        .from('media_uploads')
        .update({ status: 'failed', ocr_meta: { error: 'download_failed' } })
        .eq('id', mediaId);
      return NextResponse.json({ error: 'File not found in storage' }, { status: 500 });
    }

    const bytes = Buffer.from(await fileData.arrayBuffer());
    const mimeType = row.media_type === 'pdf' ? 'application/pdf' : 'image/png';
    const filename = row.storage_path.split('/').pop() || 'file';

    const ocrClient = getOcrClient();
    const result = await ocrClient.extract({
      bytes,
      mimeType,
      filename,
      maxPages: 5, // Limit pages to prevent runaway OCR cost and latency.
    });

    const ocrMeta = {
      provider: result.meta?.provider,
      model: result.meta?.model,
      ms: result.meta?.ms,
      pagesCount: result.pages?.length ?? 0,
    };

    const { error: updateError } = await supabase
      .from('media_uploads')
      .update({
        status: 'ocr_done',
        ocr_text: result.fullText,
        ocr_meta: ocrMeta,
      })
      .eq('id', mediaId);

    if (updateError) {
      console.error(LOG, 'update failed', mediaId, updateError);
      return NextResponse.json({ error: 'Failed to save OCR result' }, { status: 500 });
    }

    return NextResponse.json({
      fullText: result.fullText,
      pages: result.pages,
      meta: ocrMeta,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'OCR failed';
    console.error(LOG, e);
    if (message.includes('Unsupported') || message.includes('not supported')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'OCR failed' }, { status: 500 });
  }
}
