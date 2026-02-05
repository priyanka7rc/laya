-- ============================================
-- TASKS SCHEMA VERIFICATION SCRIPT
-- ============================================
-- Run this after: supabase db push
-- Purpose: Verify the tasks schema fix was applied correctly
-- ============================================

-- 1. Verify tasks table exists with correct columns
SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'tasks'
ORDER BY ordinal_position;

-- Expected output (11 rows):
-- id          | uuid        | NO  | gen_random_uuid()
-- user_id     | uuid        | NO  | NULL
-- source      | text        | NO  | 'web'::text
-- source_message_id | uuid  | YES | NULL
-- title       | text        | NO  | NULL
-- notes       | text        | YES | NULL
-- category    | text        | NO  | 'Tasks'::text
-- due_at      | timestamptz | YES | NULL
-- is_done     | boolean     | NO  | false
-- created_at  | timestamptz | NO  | now()
-- updated_at  | timestamptz | NO  | now()

-- ============================================
-- 2. Verify indexes exist
SELECT 
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'tasks'
ORDER BY indexname;

-- Expected indexes:
-- idx_tasks_source_message
-- idx_tasks_user_created
-- idx_tasks_user_done
-- idx_tasks_user_due_at_open (partial index)
-- tasks_pkey

-- ============================================
-- 3. Verify RLS policies
SELECT 
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'tasks'
ORDER BY policyname;

-- Expected policies:
-- tasks_delete_own
-- tasks_insert_own
-- tasks_select_own
-- tasks_update_own

-- ============================================
-- 4. Verify whatsapp_users has auth_user_id
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'whatsapp_users' 
  AND column_name = 'auth_user_id';

-- Expected output (1 row):
-- auth_user_id | uuid | YES

-- ============================================
-- 5. Verify foreign keys
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('tasks', 'whatsapp_users')
ORDER BY tc.table_name, tc.constraint_name;

-- Expected foreign keys:
-- tasks -> auth.users (user_id)
-- whatsapp_users -> auth.users (auth_user_id)

-- ============================================
-- 6. Test INSERT (replace YOUR_USER_ID)
-- DO NOT RUN THIS IN PRODUCTION WITHOUT CHANGING THE USER_ID
-- 
-- INSERT INTO tasks (user_id, source, title)
-- VALUES ('YOUR_USER_ID', 'web', 'Test task from verification script')
-- RETURNING *;
--
-- If successful, you should see the inserted row with:
-- - Auto-generated id
-- - source = 'web'
-- - category = 'Tasks' (default)
-- - is_done = false (default)
-- - created_at = now()
-- - updated_at = now()

-- ============================================
-- 7. Verify trigger exists
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table = 'tasks'
  AND trigger_name = 'tasks_updated_at_trigger';

-- Expected output (1 row):
-- tasks_updated_at_trigger | UPDATE | tasks | EXECUTE FUNCTION tasks_set_updated_at()

-- ============================================
-- SUCCESS CRITERIA
-- ============================================
-- ✅ All queries return expected results
-- ✅ No errors during execution
-- ✅ Foreign keys reference auth.users
-- ✅ RLS policies exist for all CRUD operations
-- ✅ Indexes exist for common query patterns
-- ✅ Trigger auto-updates updated_at
