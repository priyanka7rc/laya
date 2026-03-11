-- Feature #19: add_to_list_choose for list disambiguation.
ALTER TABLE public.wa_pending_actions
  DROP CONSTRAINT IF EXISTS wa_pending_actions_action_type_check;

ALTER TABLE public.wa_pending_actions
  ADD CONSTRAINT wa_pending_actions_action_type_check
  CHECK (action_type IN ('edit', 'ocr_import_list_name', 'ocr_import_confirm_tasks', 'add_to_list_choose'));
