-- ============================================
-- PHONE OTP AUTH + 3-STEP ONBOARDING
-- ============================================
-- Purpose: support app phone auth linking and onboarding states:
--   app_verified -> profile_required_done -> preferences_done -> onboarding_complete
-- Created: 2026-03-26
-- ============================================

-- Ensure app_users profile + preference fields exist
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS household_mode TEXT,
  ADD COLUMN IF NOT EXISTS reminder_window_pref TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_assistant_enabled BOOLEAN NOT NULL DEFAULT true;

-- Ensure default country for new rows
ALTER TABLE public.app_users
  ALTER COLUMN country SET DEFAULT 'India';

-- Validate personalization enums
ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_household_mode_check;
ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_household_mode_check
  CHECK (
    household_mode IS NULL
    OR household_mode IN ('run_most', 'shared', 'support')
  );

ALTER TABLE public.app_users
  DROP CONSTRAINT IF EXISTS app_users_reminder_window_pref_check;
ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_reminder_window_pref_check
  CHECK (
    reminder_window_pref IS NULL
    OR reminder_window_pref IN ('morning', 'afternoon', 'evening')
  );

-- Migrate existing onboarding states to new state machine
UPDATE public.app_users
SET onboarding_state = CASE
  WHEN onboarding_state = 'whatsapp_started' THEN 'app_verified'
  WHEN onboarding_state = 'first_task_done' THEN 'onboarding_complete'
  ELSE onboarding_state
END
WHERE onboarding_state IN ('whatsapp_started', 'first_task_done');

-- Replace onboarding_state check constraint
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.app_users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%onboarding_state%'
  LOOP
    EXECUTE format('ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_onboarding_state_check
  CHECK (
    onboarding_state IN (
      'app_verified',
      'profile_required_done',
      'preferences_done',
      'onboarding_complete'
    )
  );

-- Tasks table: ensure minimal required app fields are present
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS app_user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS remind_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.tasks
  ALTER COLUMN status SET DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_tasks_app_user_id
  ON public.tasks(app_user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_app_user_status_created_at
  ON public.tasks(app_user_id, status, created_at DESC);

-- RLS for tasks: authenticated users can only access tasks under their own app_user
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_select_own" ON public.tasks;
CREATE POLICY "tasks_select_own"
  ON public.tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_insert_own" ON public.tasks;
CREATE POLICY "tasks_insert_own"
  ON public.tasks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_update_own" ON public.tasks;
CREATE POLICY "tasks_update_own"
  ON public.tasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_delete_own" ON public.tasks;
CREATE POLICY "tasks_delete_own"
  ON public.tasks FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

-- Harden and update account-linking RPC
CREATE OR REPLACE FUNCTION public.link_auth_user(
  p_auth_user_id UUID,
  p_phone TEXT,
  p_email TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_app_user_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthenticated';
  END IF;

  IF p_auth_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'auth_user_id must match authenticated user';
  END IF;

  SELECT id
  INTO v_app_user_id
  FROM public.app_users
  WHERE phone_e164 = p_phone
  LIMIT 1;

  IF v_app_user_id IS NULL THEN
    INSERT INTO public.app_users (
      auth_user_id,
      phone_e164,
      email,
      has_app_account,
      onboarding_state
    )
    VALUES (
      p_auth_user_id,
      p_phone,
      p_email,
      TRUE,
      'app_verified'
    )
    RETURNING id INTO v_app_user_id;
  ELSE
    UPDATE public.app_users
    SET
      auth_user_id = p_auth_user_id,
      phone_e164 = COALESCE(phone_e164, p_phone),
      email = COALESCE(email, p_email),
      has_app_account = TRUE,
      onboarding_state = CASE onboarding_state
        WHEN 'onboarding_complete' THEN 'onboarding_complete'
        WHEN 'preferences_done' THEN 'preferences_done'
        WHEN 'profile_required_done' THEN 'profile_required_done'
        ELSE 'app_verified'
      END,
      updated_at = now()
    WHERE id = v_app_user_id;
  END IF;

  DELETE FROM public.user_identities
  WHERE app_user_id = v_app_user_id
    AND provider = 'app_phone'
    AND identifier <> p_phone;

  INSERT INTO public.user_identities (
    provider,
    app_user_id,
    identifier,
    meta
  )
  VALUES (
    'app_phone',
    v_app_user_id,
    p_phone,
    '{}'::jsonb
  )
  ON CONFLICT (provider, identifier) DO UPDATE
    SET app_user_id = EXCLUDED.app_user_id;

  IF p_email IS NOT NULL AND length(trim(p_email)) > 0 THEN
    UPDATE public.app_users
    SET email = COALESCE(email, p_email),
        updated_at = now()
    WHERE id = v_app_user_id;

    DELETE FROM public.user_identities
    WHERE app_user_id = v_app_user_id
      AND provider = 'app_email'
      AND identifier <> p_email;

    INSERT INTO public.user_identities (
      provider,
      app_user_id,
      identifier,
      meta
    )
    VALUES (
      'app_email',
      v_app_user_id,
      p_email,
      '{}'::jsonb
    )
    ON CONFLICT (provider, identifier) DO UPDATE
      SET app_user_id = EXCLUDED.app_user_id;
  END IF;

  RETURN v_app_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.link_auth_user(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_auth_user(UUID, TEXT, TEXT) TO authenticated;
