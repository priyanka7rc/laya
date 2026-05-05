-- ============================================
-- TASKS PHASE 2: SCALAR COLUMNS
-- ============================================
-- Purpose: Add infrastructure columns for all MVP field list items that are
--   simple attributes of a task. All columns are nullable with no DEFAULT and
--   no NOT NULL so zero impact on existing rows and no backfill required.
-- Business logic wiring deferred to post-MVP.
-- Created: 2026-04-03
-- ============================================

ALTER TABLE public.tasks
  -- Tags: free-text array, seeded from category at insert time, grows independently
  ADD COLUMN IF NOT EXISTS tags                   TEXT[],

  -- Priority: subjective importance of the task
  ADD COLUMN IF NOT EXISTS priority               TEXT
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

  -- Location: physical or virtual location associated with the task
  ADD COLUMN IF NOT EXISTS location               TEXT,

  -- Start at: optional earliest start datetime (distinct from due_at)
  ADD COLUMN IF NOT EXISTS start_at               TIMESTAMPTZ,

  -- Hard deadline: separate non-negotiable deadline (due_at is the soft target)
  ADD COLUMN IF NOT EXISTS hard_deadline_at       TIMESTAMPTZ,

  -- Deadline warning: hours before hard_deadline_at to surface a warning
  ADD COLUMN IF NOT EXISTS deadline_warning_hours INT,

  -- Duration: estimated effort in minutes
  ADD COLUMN IF NOT EXISTS duration_minutes       INT,

  -- Energy level: cognitive/physical cost of the task
  ADD COLUMN IF NOT EXISTS energy_level           TEXT
    CHECK (energy_level IN ('low', 'medium', 'high')),

  -- Focus level: depth of attention required
  ADD COLUMN IF NOT EXISTS focus_level            TEXT
    CHECK (focus_level IN ('shallow', 'deep')),

  -- Mood tag: emotional context at capture time (already parsed by laya-brain, now persisted)
  ADD COLUMN IF NOT EXISTS mood_tag               TEXT,

  -- Recurrence rule: RFC 5545 RRULE string (e.g. FREQ=WEEKLY;BYDAY=MO)
  ADD COLUMN IF NOT EXISTS recurrence_rule        TEXT,

  -- Recurrence parent: links a spawned instance back to the template task
  ADD COLUMN IF NOT EXISTS recurrence_parent_id   UUID
    REFERENCES public.tasks(id) ON DELETE SET NULL,

  -- List id: optional assignment to a named list (lists table already exists)
  ADD COLUMN IF NOT EXISTS list_id                UUID
    REFERENCES public.lists(id) ON DELETE SET NULL;

-- ============================================
-- EXPAND status CHECK to include 'archived'
-- ============================================
-- Drop the existing constraint (name varies by migration history; use DO block)
DO $$
DECLARE
  c TEXT;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS %I', c);
  END LOOP;
END $$;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('active', 'completed', 'needs_clarification', 'archived'));

-- ============================================
-- OPTIONAL: GIN index on tags for future array filtering
-- (partial: only rows that actually have tags)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_tasks_tags
  ON public.tasks USING GIN (tags)
  WHERE tags IS NOT NULL;
