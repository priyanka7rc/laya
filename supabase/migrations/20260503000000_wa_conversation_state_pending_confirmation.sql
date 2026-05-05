-- Add pending_confirmation column to wa_conversation_state for destructive-action
-- confirmation (YES/NO) and list-disambiguation (ADD/NEW) flows.

ALTER TABLE public.wa_conversation_state
  ADD COLUMN IF NOT EXISTS pending_confirmation JSONB DEFAULT NULL;

COMMENT ON COLUMN public.wa_conversation_state.pending_confirmation IS
  'Serialised PendingConfirmation payload awaiting user YES/NO or ADD/NEW reply. '
  'Subtypes: task_delete, list_item_remove, list_disambig. '
  'Cleared on every confirmation response or when conversation expires.';

-- Index for fast lookup of users with pending confirmations
CREATE INDEX IF NOT EXISTS idx_wa_conversation_state_pending
  ON public.wa_conversation_state (auth_user_id)
  WHERE pending_confirmation IS NOT NULL;
