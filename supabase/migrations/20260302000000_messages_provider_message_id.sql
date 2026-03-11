-- Add provider_message_id to messages table.
-- Stores the external provider's message ID (e.g. Gupshup messageId) for outbound
-- messages so that inbound reply context IDs can be matched back to the stored row.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

-- Index for fast lookup by provider ID (used in reply-anchored delete).
CREATE INDEX IF NOT EXISTS idx_messages_provider_message_id
  ON public.messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
