-- ============================================
-- ADD OPTED_OUT TO WHATSAPP_USERS
-- ============================================
-- Purpose: Track user opt-out status for WhatsApp messaging
-- Created: 2026-02-06
-- ============================================

-- Add opted_out column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_users' AND column_name = 'opted_out'
  ) THEN
    ALTER TABLE whatsapp_users 
      ADD COLUMN opted_out BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add index for filtering opted-out users
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_opted_out 
  ON whatsapp_users(opted_out) 
  WHERE opted_out = true;

-- ============================================
-- VERIFICATION
-- ============================================
-- Test query: SELECT phone_number, opted_out FROM whatsapp_users LIMIT 5;
