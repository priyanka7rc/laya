-- Quick Add Mode: add quick_add to wa_pending_actions action_type.
ALTER TABLE public.wa_pending_actions
  DROP CONSTRAINT IF EXISTS wa_pending_actions_action_type_check;

ALTER TABLE public.wa_pending_actions
  ADD CONSTRAINT wa_pending_actions_action_type_check
  CHECK (action_type IN ('edit', 'ocr_import_list_name', 'ocr_import_confirm_tasks', 'add_to_list_choose', 'quick_add'));
