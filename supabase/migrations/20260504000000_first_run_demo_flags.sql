-- First-run demo completion flags (per page)
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS seen_home_demo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seen_tasks_demo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seen_lists_demo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seen_unload_demo BOOLEAN NOT NULL DEFAULT false;
