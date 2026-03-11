-- Feature #20: Extend wa_pending_actions for OCR import sessions.

ALTER TABLE public.wa_pending_actions
  ADD COLUMN IF NOT EXISTS payload JSONB;

ALTER TABLE public.wa_pending_actions
  DROP CONSTRAINT IF EXISTS wa_pending_actions_action_type_check;

ALTER TABLE public.wa_pending_actions
  ADD CONSTRAINT wa_pending_actions_action_type_check
  CHECK (action_type IN ('edit', 'ocr_import_list_name', 'ocr_import_confirm_tasks'));

