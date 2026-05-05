-- Durable per-user WhatsApp conversation state.
-- Replaces the in-memory userFocusStore (Map<userId, { taskId, setAt }>).
-- One row per auth user, upserted on every meaningful turn.
-- Fields:
--   active_task_id  — last task created or edited (follow-up target for "make it Friday")
--   active_list_id  — last list created or modified (follow-up target for "add curd too")
--   last_task_title — human-readable hint for confirmation messages and pronoun resolution
--   last_list_name  — same for lists
--   last_entity_text — last meaningful noun phrase (enables "add it to shopping")
--   expires_at      — 2-hour TTL; treated as null after expiry

CREATE TABLE IF NOT EXISTS public.wa_conversation_state (
  auth_user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_task_id    UUID,
  active_list_id    UUID,
  last_task_title   TEXT,
  last_list_name    TEXT,
  last_entity_text  TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ
);

-- Fast lookup by auth_user_id (PK index already covers this, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_wa_conversation_state_expires
  ON public.wa_conversation_state (expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE public.wa_conversation_state IS
  'Short-term conversational context per WhatsApp user. '
  'Survives server restarts. Expires after 2 h of inactivity. '
  'Replaces in-memory userFocusStore.';
