-- Add display_name column to app_users table
-- This allows storing the user's preferred first name captured during onboarding

alter table app_users
  add column if not exists display_name text;
