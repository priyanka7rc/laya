-- ============================================
-- WhatsApp Integration Schema Migration
-- ============================================
-- This extends the existing Laya database to support WhatsApp as an input channel
-- while keeping voice chat functionality intact.

-- ============================================
-- 1. USER PHONE MAPPING
-- ============================================
-- Add phone_number to track WhatsApp users
-- We'll use Supabase's auth.users table and add metadata
-- Or create a separate phone mapping table for flexibility

CREATE TABLE IF NOT EXISTS user_phone_numbers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  phone_number TEXT NOT NULL UNIQUE,
  country_code TEXT,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_phone_numbers ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own phone numbers"
  ON user_phone_numbers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage phone numbers"
  ON user_phone_numbers FOR ALL
  USING (true);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_phone ON user_phone_numbers(phone_number);
CREATE INDEX IF NOT EXISTS idx_user_phone_numbers_user_id ON user_phone_numbers(user_id);

-- ============================================
-- 2. EXTEND MESSAGES TABLE FOR WHATSAPP
-- ============================================
-- Extend existing messages table to support WhatsApp messages
-- Add columns if they don't exist

DO $$ 
BEGIN
  -- Add channel column (voice | whatsapp)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'channel'
  ) THEN
    ALTER TABLE messages ADD COLUMN channel TEXT DEFAULT 'voice' CHECK (channel IN ('voice', 'whatsapp'));
  END IF;

  -- Add direction column (inbound | outbound)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'direction'
  ) THEN
    ALTER TABLE messages ADD COLUMN direction TEXT DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound'));
  END IF;

  -- Add message_type column (text | audio)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'message_type'
  ) THEN
    ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text' CHECK (message_type IN ('text', 'audio'));
  END IF;

  -- Add audio_url for WhatsApp audio messages
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'audio_url'
  ) THEN
    ALTER TABLE messages ADD COLUMN audio_url TEXT;
  END IF;

  -- Add raw_payload for debugging and compliance
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'raw_payload'
  ) THEN
    ALTER TABLE messages ADD COLUMN raw_payload JSONB;
  END IF;

  -- Add user_id for direct WhatsApp messages (not tied to conversation)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE messages ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Make conversation_id nullable for WhatsApp messages
ALTER TABLE messages ALTER COLUMN conversation_id DROP NOT NULL;

-- Add constraint: must have either conversation_id or user_id
ALTER TABLE messages ADD CONSTRAINT messages_context_check 
  CHECK (conversation_id IS NOT NULL OR user_id IS NOT NULL);

-- Update RLS policies for messages to handle direct user_id
DROP POLICY IF EXISTS "Users can view messages in their conversations" ON messages;
CREATE POLICY "Users can view their messages"
  ON messages FOR SELECT
  USING (
    -- Voice chat messages (via conversation)
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
    OR
    -- WhatsApp messages (direct user_id)
    auth.uid() = messages.user_id
  );

DROP POLICY IF EXISTS "Users can insert messages in their conversations" ON messages;
CREATE POLICY "Users can insert their messages"
  ON messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
    OR
    auth.uid() = messages.user_id
  );

-- Create indexes for WhatsApp queries
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- ============================================
-- 3. GROCERIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS groceries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity TEXT,
  needed_by DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'purchased')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE groceries ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own groceries"
  ON groceries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own groceries"
  ON groceries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own groceries"
  ON groceries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own groceries"
  ON groceries FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_groceries_user_id ON groceries(user_id);
CREATE INDEX IF NOT EXISTS idx_groceries_status ON groceries(status);
CREATE INDEX IF NOT EXISTS idx_groceries_needed_by ON groceries(needed_by);

-- ============================================
-- 4. MOODS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS moods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  tag TEXT NOT NULL, -- 'overwhelmed', 'calm', 'anxious', 'okay', 'stressed', etc.
  intensity INTEGER CHECK (intensity BETWEEN 1 AND 5), -- 1=mild, 5=intense
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE moods ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own moods"
  ON moods FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own moods"
  ON moods FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own moods"
  ON moods FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own moods"
  ON moods FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_moods_user_id ON moods(user_id);
CREATE INDEX IF NOT EXISTS idx_moods_tag ON moods(tag);
CREATE INDEX IF NOT EXISTS idx_moods_created_at ON moods(created_at DESC);

-- ============================================
-- 5. ADD SOURCE_MESSAGE_ID TO TASKS
-- ============================================
-- Link tasks to the message that created them
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tasks' AND column_name = 'source_message_id'
  ) THEN
    ALTER TABLE tasks ADD COLUMN source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_source_message_id ON tasks(source_message_id);

-- ============================================
-- 6. WHATSAPP USERS TABLE (Separate from auth.users)
-- ============================================
-- For MVP: Use separate identity for WhatsApp users
-- Later: Can migrate to unified auth.users if needed

CREATE TABLE IF NOT EXISTS whatsapp_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number TEXT NOT NULL UNIQUE,
  name TEXT,
  country_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_active TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE whatsapp_users ENABLE ROW LEVEL SECURITY;

-- RLS Policy (service role can manage all)
CREATE POLICY "Service role can manage whatsapp users"
  ON whatsapp_users FOR ALL
  USING (true);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_phone ON whatsapp_users(phone_number);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_last_active ON whatsapp_users(last_active DESC);

-- ============================================
-- 7. UPDATE FOREIGN KEYS TO USE WHATSAPP_USERS
-- ============================================
-- Remove user_phone_numbers table (no longer needed)
DROP TABLE IF EXISTS user_phone_numbers CASCADE;

-- Update messages table to reference whatsapp_users instead
DO $$ 
BEGIN
  -- Drop existing user_id constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'messages' AND constraint_name = 'messages_user_id_fkey'
  ) THEN
    ALTER TABLE messages DROP CONSTRAINT messages_user_id_fkey;
  END IF;
  
  -- Add new constraint to whatsapp_users
  ALTER TABLE messages ADD CONSTRAINT messages_whatsapp_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES whatsapp_users(id) ON DELETE CASCADE;
END $$;

-- Update tasks table
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'tasks' AND constraint_name = 'tasks_user_id_fkey'
  ) THEN
    ALTER TABLE tasks DROP CONSTRAINT tasks_user_id_fkey;
  END IF;
  
  ALTER TABLE tasks ADD CONSTRAINT tasks_whatsapp_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES whatsapp_users(id) ON DELETE CASCADE;
END $$;

-- Update groceries table
DO $$ 
BEGIN
  ALTER TABLE groceries ADD CONSTRAINT groceries_whatsapp_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES whatsapp_users(id) ON DELETE CASCADE;
END $$;

-- Update moods table
DO $$ 
BEGIN
  ALTER TABLE moods ADD CONSTRAINT moods_whatsapp_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES whatsapp_users(id) ON DELETE CASCADE;
END $$;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
-- Run this migration in Supabase SQL Editor
-- Then test with: SELECT * FROM user_phone_numbers LIMIT 1;

