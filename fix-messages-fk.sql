-- Fix foreign key constraint on messages table
-- Issue: messages.user_id was pointing to auth.users instead of whatsapp_users

-- Step 1: Drop ALL existing user_id foreign keys on messages
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_user_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_whatsapp_user_id_fkey;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS fk_messages_user;

-- Step 2: Add correct constraint to whatsapp_users
ALTER TABLE messages 
  ADD CONSTRAINT messages_whatsapp_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES whatsapp_users(id) ON DELETE CASCADE;

-- Verify the fix
SELECT 
  conname AS constraint_name,
  conrelid::regclass AS table_name,
  confrelid::regclass AS foreign_table
FROM pg_constraint 
WHERE conname LIKE '%messages%user%';

