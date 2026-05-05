-- Add 'clarification_pending' action_type to wa_pending_actions.
-- Used to replace the brittle content-string clarification detection
-- (which matched the literal string "Which task do you want to update?"
-- in the last outbound WhatsApp message).
--
-- Payload shape for clarification_pending rows:
--   {
--     questionType: 'which_task' | 'which_list' | 'unresolved_pronoun',
--     candidates: [{ id: string, title: string }],
--     pendingAction?: { type: 'add_item', listName: string, item: string }
--   }
--
-- The pending action field is optional; when present it describes what to
-- execute after the user selects a candidate (e.g. add an item to the
-- chosen list). When absent the clarification just resolves a reference
-- and the user is prompted again for the actual instruction.

ALTER TABLE public.wa_pending_actions
  DROP CONSTRAINT IF EXISTS wa_pending_actions_action_type_check;

ALTER TABLE public.wa_pending_actions
  ADD CONSTRAINT wa_pending_actions_action_type_check
  CHECK (action_type IN (
    'edit',
    'ocr_import_list_name',
    'ocr_import_confirm_tasks',
    'add_to_list_choose',
    'quick_add',
    'clarification_pending'
  ));
