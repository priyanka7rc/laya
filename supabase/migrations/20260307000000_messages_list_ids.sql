-- Feature #19: list_ids on messages for reply-anchored add-to-list.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS list_ids JSONB;
