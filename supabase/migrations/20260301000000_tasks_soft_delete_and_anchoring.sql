-- [D1] Soft delete columns on tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deleted_source TEXT;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deleted_by_auth_user_id UUID;

-- Index: active tasks (not deleted) per user, ordered by created_at
CREATE INDEX IF NOT EXISTS idx_tasks_app_user_active
  ON public.tasks (app_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Partial index optimised for "active + not done" queries
CREATE INDEX IF NOT EXISTS idx_tasks_app_user_active_not_done
  ON public.tasks (app_user_id, due_at)
  WHERE deleted_at IS NULL AND is_done = FALSE;

-- [D1] messages: task_ids anchoring for reply-based WA delete, + kind
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS task_ids JSONB;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS kind TEXT;

-- [D1] whatsapp_users: undo tracking (last deleted IDs + timestamp)
ALTER TABLE public.whatsapp_users
  ADD COLUMN IF NOT EXISTS last_deleted_task_ids JSONB;

ALTER TABLE public.whatsapp_users
  ADD COLUMN IF NOT EXISTS last_deleted_at TIMESTAMPTZ;
