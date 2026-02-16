-- ============================================
-- ADD DAILY DIGEST TRACKING TO WHATSAPP_USERS
-- ============================================
-- Purpose: Track daily digest preferences and send history
-- Created: 2026-02-06
-- ============================================

-- Add daily_digest_enabled column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_users' AND column_name = 'daily_digest_enabled'
  ) THEN
    ALTER TABLE whatsapp_users 
      ADD COLUMN daily_digest_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add last_digest_sent_at column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'whatsapp_users' AND column_name = 'last_digest_sent_at'
  ) THEN
    ALTER TABLE whatsapp_users 
      ADD COLUMN last_digest_sent_at DATE NULL;
  END IF;
END $$;

-- Add index for finding users who need daily digest
-- (enabled users who haven't received today's digest yet)
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_digest_pending 
  ON whatsapp_users(daily_digest_enabled, last_digest_sent_at)
  WHERE daily_digest_enabled = true;

-- ============================================
-- VERIFICATION
-- ============================================
-- Test query: 
-- SELECT phone_number, daily_digest_enabled, last_digest_sent_at 
-- FROM whatsapp_users 
-- LIMIT 5;
