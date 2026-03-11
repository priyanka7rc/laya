-- Pending action store for WhatsApp edit flow (reply-anchored selection).
-- No UI; server-only state. Used to remember which task is being edited until
-- the user sends the actual edit (e.g. "tomorrow 5pm" / "rename to …").
CREATE TABLE IF NOT EXISTS public.wa_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL,
  app_user_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('edit')),
  task_id uuid NOT NULL,
  source_provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_inbound_provider_message_id text
);

CREATE INDEX IF NOT EXISTS wa_pending_actions_auth_user_idx
  ON public.wa_pending_actions (auth_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wa_pending_actions_task_idx
  ON public.wa_pending_actions (task_id);

CREATE INDEX IF NOT EXISTS wa_pending_actions_expires_idx
  ON public.wa_pending_actions (expires_at);

COMMENT ON TABLE public.wa_pending_actions IS 'WhatsApp pending edit context; expires after 2h. Idempotency via last_inbound_provider_message_id.';
