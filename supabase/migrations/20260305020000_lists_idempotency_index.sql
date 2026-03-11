-- Adjust lists idempotency index to align with soft delete semantics.
-- We only want the UNIQUE constraint to apply to active (non-deleted) rows,
-- so that a soft-deleted list with a given (app_user_id, source, source_message_id)
-- does not block creation of a new list with the same tuple.

DROP INDEX IF EXISTS idx_lists_app_user_source_source_message_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_app_user_source_source_message_id
  ON public.lists (app_user_id, source, source_message_id)
  WHERE source_message_id IS NOT NULL AND deleted_at IS NULL;

