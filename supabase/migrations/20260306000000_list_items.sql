-- Feature #17 / #19: list_items for List Items (Web + WhatsApp).
CREATE TABLE IF NOT EXISTS public.list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL REFERENCES public.app_users(id),
  list_id uuid NOT NULL REFERENCES public.lists(id),
  text text NOT NULL,
  normalized_text text NOT NULL,
  is_done boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('web', 'whatsapp', 'ocr')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_list_items_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_list_items_set_updated_at ON public.list_items;
CREATE TRIGGER trg_list_items_set_updated_at
BEFORE UPDATE ON public.list_items
FOR EACH ROW EXECUTE FUNCTION public.set_list_items_updated_at();

CREATE INDEX IF NOT EXISTS idx_list_items_list
  ON public.list_items (list_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_list_items_user
  ON public.list_items (app_user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_list_items_lookup
  ON public.list_items (list_id, normalized_text)
  WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "list_items_select_own" ON public.list_items;
CREATE POLICY "list_items_select_own"
  ON public.list_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = list_items.app_user_id AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "list_items_insert_own" ON public.list_items;
CREATE POLICY "list_items_insert_own"
  ON public.list_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = list_items.app_user_id AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "list_items_update_own" ON public.list_items;
CREATE POLICY "list_items_update_own"
  ON public.list_items FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = list_items.app_user_id AND u.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = list_items.app_user_id AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "list_items_delete_own" ON public.list_items;
CREATE POLICY "list_items_delete_own"
  ON public.list_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = list_items.app_user_id AND u.auth_user_id = auth.uid()
    )
  );
