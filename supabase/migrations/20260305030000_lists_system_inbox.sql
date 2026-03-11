-- Feature #20: system lists (Inbox/Imported) support.

ALTER TABLE public.lists
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS system_key TEXT NULL;

-- Ensure a single active system list per (app_user_id, system_key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_app_user_system_key
  ON public.lists (app_user_id, system_key)
  WHERE system_key IS NOT NULL AND deleted_at IS NULL;

