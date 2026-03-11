-- [R1] Ensure remind_at column and add indexes for reminder selection

-- Column already exists in earlier migrations, but this is safe and idempotent.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS remind_at timestamptz;

-- Composite index on (app_user_id, remind_at) for per-user reminder selection.
CREATE INDEX IF NOT EXISTS tasks_app_user_remind_at_idx
  ON public.tasks (app_user_id, remind_at);

-- Global index on remind_at to support any future cross-user scans.
CREATE INDEX IF NOT EXISTS tasks_remind_at_idx
  ON public.tasks (remind_at);

-- Optional partial index optimized for the active reminder query:
-- app_user_id + remind_at for tasks that are not done and not yet reminded.
CREATE INDEX IF NOT EXISTS tasks_remind_at_partial_idx
  ON public.tasks (app_user_id, remind_at)
  WHERE remind_at IS NOT NULL
    AND reminder_sent = FALSE
    AND is_done = FALSE;

