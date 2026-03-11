import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUserFromRequest } from '../../auth-helpers';

const LOG = '[media/upload]';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES: Record<string, 'image' | 'pdf'> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'application/pdf': 'pdf',
};

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const mimeType = file.type || '';
    const mediaType = ALLOWED_TYPES[mimeType];
    if (!mediaType) {
      return NextResponse.json(
        { error: 'Unsupported file type. Use image (JPEG, PNG, GIF, WebP) or PDF.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const mediaId = crypto.randomUUID();
    const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1] || 'png';
    const storagePath = `${user.id}/${mediaId}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('task-media')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error(LOG, 'storage upload failed', uploadError);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    const { error: insertError } = await supabase.from('media_uploads').insert({
      id: mediaId,
      user_id: user.id,
      app_user_id: null,
      storage_path: storagePath,
      media_type: mediaType,
      status: 'uploaded',
    });

    if (insertError) {
      console.error(LOG, 'media_uploads insert failed', insertError);
      await supabase.storage.from('task-media').remove([storagePath]);
      return NextResponse.json({ error: 'Failed to record upload' }, { status: 500 });
    }

    return NextResponse.json({ mediaId, storagePath });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
