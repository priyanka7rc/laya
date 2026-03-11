-- ============================================
-- APP USERS + USER IDENTITIES (mobile-first auth)
-- ============================================
-- Purpose: Central app user model for phone OTP + WhatsApp
-- Created: 2026-02-19
-- ============================================

-- ENUM: identity_provider
DO $$ BEGIN
  CREATE TYPE identity_provider AS ENUM ('whatsapp', 'app_phone', 'app_email');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- TABLE: public.app_users
CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  phone_e164 TEXT UNIQUE,
  email TEXT UNIQUE,
  onboarding_state TEXT NOT NULL DEFAULT 'whatsapp_started'
    CHECK (onboarding_state IN (
      'whatsapp_started',
      'app_verified',
      'onboarding_complete',
      'first_task_done'
    )),
  has_app_account BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_auth_user_id
  ON public.app_users(auth_user_id);

CREATE INDEX IF NOT EXISTS idx_app_users_phone_e164
  ON public.app_users(phone_e164);

CREATE INDEX IF NOT EXISTS idx_app_users_onboarding_state
  ON public.app_users(onboarding_state);

-- TABLE: public.user_identities
CREATE TABLE IF NOT EXISTS public.user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider identity_provider NOT NULL,
  app_user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, identifier),
  UNIQUE (app_user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_app_user
  ON public.user_identities(app_user_id);

CREATE INDEX IF NOT EXISTS idx_user_identities_provider_identifier
  ON public.user_identities(provider, identifier);

-- RLS: app_users
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_users_select_own" ON public.app_users;
CREATE POLICY "app_users_select_own"
  ON public.app_users FOR SELECT
  USING (auth.uid() = auth_user_id);

DROP POLICY IF EXISTS "app_users_update_own" ON public.app_users;
CREATE POLICY "app_users_update_own"
  ON public.app_users FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);

-- RLS: user_identities (read via owning app_user)
ALTER TABLE public.user_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_identities_select_own" ON public.user_identities;
CREATE POLICY "user_identities_select_own"
  ON public.user_identities FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = app_user_id AND u.auth_user_id = auth.uid()
    )
  );

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.app_users_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_users_updated_at_trigger ON public.app_users;
CREATE TRIGGER app_users_updated_at_trigger
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW
  EXECUTE FUNCTION public.app_users_set_updated_at();

