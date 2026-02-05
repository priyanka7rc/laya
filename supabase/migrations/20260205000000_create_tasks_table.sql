-- ============================================
-- MIGRATE TASKS TABLE TO NEW SCHEMA
-- ============================================
-- Purpose: Add source, due_at, updated_at to existing tasks table
-- Safe for existing data: uses ALTER TABLE + data migration
-- Created: 2026-02-05
-- ============================================

-- ============================================
-- STEP 1: Ensure table exists with base columns
-- ============================================

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  category TEXT,
  due_date TEXT,
  due_time TEXT,
  is_done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- STEP 2: Add new columns if missing
-- ============================================

-- Add source column (web | whatsapp)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'source'
  ) THEN
    ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'whatsapp'));
  END IF;
END $$;

-- Add source_message_id column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'source_message_id'
  ) THEN
    ALTER TABLE tasks ADD COLUMN source_message_id UUID;
  END IF;
END $$;

-- Add due_at column (new unified timestamp)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'due_at'
  ) THEN
    ALTER TABLE tasks ADD COLUMN due_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add updated_at column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE tasks ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;
END $$;

-- ============================================
-- STEP 3: Migrate existing data
-- ============================================

-- Migrate due_date + due_time → due_at
UPDATE tasks
SET due_at = (
  CASE
    WHEN due_date IS NOT NULL AND due_time IS NOT NULL THEN
      (due_date || ' ' || due_time)::TIMESTAMPTZ
    WHEN due_date IS NOT NULL THEN
      (due_date || ' 00:00:00')::TIMESTAMPTZ
    ELSE NULL
  END
)
WHERE due_at IS NULL AND due_date IS NOT NULL;

-- Fix category nulls (make NOT NULL with default)
UPDATE tasks SET category = 'Tasks' WHERE category IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'category' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE tasks ALTER COLUMN category SET DEFAULT 'Tasks';
    ALTER TABLE tasks ALTER COLUMN category SET NOT NULL;
  END IF;
END $$;

-- ============================================
-- STEP 4: Create indexes
-- ============================================

-- User's tasks ordered by creation
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);

-- User's incomplete tasks
CREATE INDEX IF NOT EXISTS idx_tasks_user_done ON tasks(user_id, is_done);

-- Reminders + daily digest: open tasks with due dates for a user
CREATE INDEX IF NOT EXISTS idx_tasks_user_due_at_open ON tasks(user_id, due_at)
  WHERE is_done = false AND due_at IS NOT NULL;

-- WhatsApp message linkage
CREATE INDEX IF NOT EXISTS idx_tasks_source_message ON tasks(source_message_id)
  WHERE source_message_id IS NOT NULL;

-- ============================================
-- STEP 5: Row Level Security
-- ============================================

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "tasks_select_own" ON tasks;
DROP POLICY IF EXISTS "tasks_insert_own" ON tasks;
DROP POLICY IF EXISTS "tasks_update_own" ON tasks;
DROP POLICY IF EXISTS "tasks_delete_own" ON tasks;

-- Users can view their own tasks
CREATE POLICY "tasks_select_own"
  ON tasks FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own tasks
CREATE POLICY "tasks_insert_own"
  ON tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own tasks
CREATE POLICY "tasks_update_own"
  ON tasks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own tasks
CREATE POLICY "tasks_delete_own"
  ON tasks FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- STEP 6: Auto-update trigger
-- ============================================

-- Create trigger function (idempotent)
CREATE OR REPLACE FUNCTION tasks_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger
DROP TRIGGER IF EXISTS tasks_updated_at_trigger ON tasks;

CREATE TRIGGER tasks_updated_at_trigger
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION tasks_set_updated_at();

-- ============================================
-- VERIFICATION
-- ============================================
-- Test: SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks' ORDER BY ordinal_position;
-- Should show: id, user_id, title, notes, category, due_date, due_time, is_done, created_at, source, source_message_id, due_at, updated_at
