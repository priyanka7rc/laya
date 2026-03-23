ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lists_app_user_starred
  ON public.lists (app_user_id, is_starred)
  WHERE deleted_at IS NULL;
