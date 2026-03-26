-- ============================================
-- TASKS: enforce canonical ownership
-- ============================================
-- Purpose: now that tasks.app_user_id is fully backfilled, enforce NOT NULL
-- Created: 2026-03-26
-- ============================================

-- Defensive: refuse to apply if there are still nulls
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tasks WHERE app_user_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot set tasks.app_user_id NOT NULL: null rows still exist';
  END IF;
END $$;

ALTER TABLE public.tasks
  ALTER COLUMN app_user_id SET NOT NULL;
