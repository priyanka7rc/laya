-- ============================================
-- ADD REMINDER TRACKING TO TASKS
-- ============================================
-- Purpose: Track reminder send status for each task
-- Created: 2026-02-06
-- ============================================

-- Add reminder_sent column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'reminder_sent'
  ) THEN
    ALTER TABLE tasks 
      ADD COLUMN reminder_sent BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add reminder_sent_at column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tasks' AND column_name = 'reminder_sent_at'
  ) THEN
    ALTER TABLE tasks 
      ADD COLUMN reminder_sent_at TIMESTAMPTZ NULL;
  END IF;
END $$;

-- Add index for finding tasks that need reminders
-- (open tasks with due dates that haven't been reminded yet)
CREATE INDEX IF NOT EXISTS idx_tasks_reminder_pending 
  ON tasks(user_id, due_at, reminder_sent)
  WHERE is_done = false 
    AND due_at IS NOT NULL 
    AND reminder_sent = false;

-- ============================================
-- VERIFICATION
-- ============================================
-- Test query: 
-- SELECT column_name, data_type, is_nullable, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'tasks' 
--   AND column_name IN ('reminder_sent', 'reminder_sent_at');
