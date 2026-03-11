-- ============================================
-- Add inferred_date and inferred_time to tasks
-- ============================================
-- Purpose: Support UI "confirm schedule" badge for rule-inferred date/time
-- Both NOT NULL, default false; existing rows get false.
-- ============================================

-- inferred_date: true when date was inferred from title (not user-selected)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'inferred_date'
  ) THEN
    ALTER TABLE public.tasks
      ADD COLUMN inferred_date BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- inferred_time: true when time was inferred from title (not user-selected)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'inferred_time'
  ) THEN
    ALTER TABLE public.tasks
      ADD COLUMN inferred_time BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- Existing rows: already have default false from ADD COLUMN ... DEFAULT false
