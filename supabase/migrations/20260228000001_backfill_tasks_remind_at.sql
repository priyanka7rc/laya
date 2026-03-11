-- [R2] Backfill remind_at for existing tasks from due_at

UPDATE public.tasks
SET remind_at = due_at - INTERVAL '15 minutes'
WHERE due_at IS NOT NULL
  AND remind_at IS NULL;

