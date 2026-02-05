-- ============================================
-- LINK WHATSAPP USERS TO AUTH.USERS
-- ============================================
-- Purpose: Map phone numbers → auth.users for unified ownership
-- Created: 2026-02-05
-- ============================================

-- Add auth_user_id to whatsapp_users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_users' AND column_name = 'auth_user_id'
  ) THEN
    ALTER TABLE whatsapp_users 
      ADD COLUMN auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Ensure phone_number is unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_users_phone_unique 
  ON whatsapp_users(phone_number);

-- Ensure auth_user_id is unique (one auth user = one WhatsApp number)
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_users_auth_user_id 
  ON whatsapp_users(auth_user_id);

-- Fast lookup: phone → auth_user_id
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_phone_auth 
  ON whatsapp_users(phone_number, auth_user_id);

-- ============================================
-- VERIFICATION
-- ============================================
-- Test query: SELECT phone_number, auth_user_id FROM whatsapp_users LIMIT 1;
