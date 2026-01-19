-- Add skip functionality to meal_plan_items
-- Allows users to mark meals as skipped (eating out, traveling, etc.)

ALTER TABLE meal_plan_items 
ADD COLUMN IF NOT EXISTS is_skipped BOOLEAN DEFAULT false;

-- Add index for performance (querying skipped vs active meals)
CREATE INDEX IF NOT EXISTS idx_meal_plan_items_is_skipped 
ON meal_plan_items(is_skipped);

-- Comment for clarity
COMMENT ON COLUMN meal_plan_items.is_skipped IS 
'Indicates if this meal slot is skipped (eating out, traveling, etc.). Skipped meals are excluded from grocery lists.';

