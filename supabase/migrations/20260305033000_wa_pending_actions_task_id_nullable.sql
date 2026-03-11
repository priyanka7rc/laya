-- Feature #20: make wa_pending_actions.task_id nullable for non-edit actions.

ALTER TABLE public.wa_pending_actions
  ALTER COLUMN task_id DROP NOT NULL;

