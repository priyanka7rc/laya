-- ============================================
-- media_uploads: store uploads for task-from-media (OCR)
-- ============================================
-- Used by: POST /api/media/upload, /api/media/:id/ocr, /api/tasks/import/preview
-- ============================================

CREATE TABLE IF NOT EXISTS public.media_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_user_id UUID,
  storage_path TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'pdf')),
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'ocr_done', 'failed')),
  ocr_text TEXT,
  ocr_meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_uploads_user_id ON public.media_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_media_uploads_created_at ON public.media_uploads(created_at DESC);

-- RLS: users can only access their own rows
ALTER TABLE public.media_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own media_uploads"
  ON public.media_uploads
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Storage bucket for task media (create if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-media',
  'task-media',
  false,
  10 * 1024 * 1024,
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Policy: users can upload/read/delete their own files under their user_id path
CREATE POLICY "Users can manage own task-media"
  ON storage.objects
  FOR ALL
  USING (
    bucket_id = 'task-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'task-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
