-- ============================================
-- RPC: link_auth_user
-- ============================================
-- Purpose: Link Supabase auth user to app_users row by phone,
--          create row if needed, and upsert app_phone identity.
-- Created: 2026-02-19
-- ============================================

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
  -- Find existing app_user by phone
  SELECT id INTO v_app_user_id
  FROM public.app_users
  WHERE phone_e164 = p_phone
  LIMIT 1;

  IF v_app_user_id IS NULL THEN
    -- Create new app_user
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

    RAISE NOTICE '[link_auth_user] created app_user %, phone %, auth_user_id %',
      v_app_user_id, p_phone, p_auth_user_id;
  ELSE
    -- Update existing app_user
    UPDATE public.app_users
    SET
      auth_user_id = COALESCE(auth_user_id, p_auth_user_id),
      email = COALESCE(p_email, email),
      has_app_account = TRUE,
      onboarding_state = CASE
        WHEN onboarding_state = 'whatsapp_started' THEN 'app_verified'
        ELSE onboarding_state
      END,
      updated_at = now()
    WHERE id = v_app_user_id;

    RAISE NOTICE '[link_auth_user] updated app_user %, phone %, auth_user_id %',
      v_app_user_id, p_phone, p_auth_user_id;
  END IF;

  -- Upsert identity mapping for app_phone
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
  ON CONFLICT (provider, identifier) DO NOTHING;

  RETURN v_app_user_id;
END;
$$;

