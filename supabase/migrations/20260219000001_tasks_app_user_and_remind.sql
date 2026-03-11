-- ============================================
-- TASKS: app_user_id, status, remind_at, parse_confidence
-- ============================================
-- Purpose: extend tasks for app-centric model and reminders
-- Keeps legacy user_id for backward compatibility.
-- Created: 2026-02-19
-- ============================================

-- status column (task lifecycle)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'status'
  ) THEN
    ALTER TABLE public.tasks
      ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'needs_clarification'));
  END IF;
END $$;

-- remind_at column (separate from due_at)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'remind_at'
  ) THEN
    ALTER TABLE public.tasks
      ADD COLUMN remind_at TIMESTAMPTZ;
  END IF;
END $$;

-- parse_confidence column (LLM parsing confidence)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'parse_confidence'
  ) THEN
    ALTER TABLE public.tasks
      ADD COLUMN parse_confidence NUMERIC;
  END IF;
END $$;

-- app_user_id column (new app-centric FK)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'app_user_id'
  ) THEN
    ALTER TABLE public.tasks
      ADD COLUMN app_user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Indexes for Today / Upcoming / Inbox queries
CREATE INDEX IF NOT EXISTS idx_tasks_app_user_due_at
  ON public.tasks(app_user_id, due_at)
  WHERE status = 'active' AND (due_at IS NOT NULL OR remind_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_tasks_app_user_remind_at
  ON public.tasks(app_user_id, remind_at)
  WHERE status = 'active' AND remind_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_app_user_status_created
  ON public.tasks(app_user_id, status, created_at DESC)
  WHERE status = 'needs_clarification';

-- ============================================
-- RLS: allow access via legacy user_id OR app_user_id mapping
-- ============================================

DROP POLICY IF EXISTS "tasks_select_own" ON public.tasks;
CREATE POLICY "tasks_select_own"
  ON public.tasks FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_insert_own" ON public.tasks;
CREATE POLICY "tasks_insert_own"
  ON public.tasks FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_update_own" ON public.tasks;
CREATE POLICY "tasks_update_own"
  ON public.tasks FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tasks_delete_own" ON public.tasks;
CREATE POLICY "tasks_delete_own"
  ON public.tasks FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.app_users u
      WHERE u.id = tasks.app_user_id
        AND u.auth_user_id = auth.uid()
    )
  );

