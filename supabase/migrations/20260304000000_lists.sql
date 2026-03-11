-- Lists table for Feature #16 (MVP Lists tab).
CREATE TABLE IF NOT EXISTS public.lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'web',
  source_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  deleted_source text NULL,
  deleted_by_auth_user_id uuid NULL,
  import_candidates jsonb NULL
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_lists_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lists_set_updated_at ON public.lists;
CREATE TRIGGER trg_lists_set_updated_at
BEFORE UPDATE ON public.lists
FOR EACH ROW EXECUTE FUNCTION public.set_lists_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lists_app_user_deleted_updated
  ON public.lists (app_user_id, deleted_at, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lists_app_user_source_source_message_id
  ON public.lists (app_user_id, source, source_message_id)
  WHERE source_message_id IS NOT NULL;

-- RLS
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lists_select_own" ON public.lists;
CREATE POLICY "lists_select_own"
  ON public.lists FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = lists.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "lists_insert_own" ON public.lists;
CREATE POLICY "lists_insert_own"
  ON public.lists FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = lists.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "lists_update_own" ON public.lists;
CREATE POLICY "lists_update_own"
  ON public.lists FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = lists.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = lists.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "lists_delete_own" ON public.lists;
CREATE POLICY "lists_delete_own"
  ON public.lists FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = lists.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );
