-- Add optional timezone column to app_users for per-user local time semantics

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'app_users'
      AND column_name = 'timezone'
  ) THEN
    ALTER TABLE public.app_users
      ADD COLUMN timezone TEXT;
  END IF;
END $$;

