-- ============================================================================
-- DISH TRACKING FIELDS
-- ============================================================================
-- Purpose: Track dish usage, meal types, and recipe status
-- Enables: Preferring stored recipes over generating new ones
-- ============================================================================

-- Add tracking fields to dishes table
ALTER TABLE dishes
ADD COLUMN IF NOT EXISTS usage_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS meal_type TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS has_ingredients BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'ai' CHECK (source IN ('ai', 'user', 'imported', 'curated'));

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_dishes_usage ON dishes(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_dishes_meal_type ON dishes USING GIN(meal_type);
CREATE INDEX IF NOT EXISTS idx_dishes_has_ingredients ON dishes(has_ingredients) WHERE has_ingredients = true;
CREATE INDEX IF NOT EXISTS idx_dishes_last_used ON dishes(last_used_at DESC NULLS LAST);

-- Update existing dishes to mark those with recipe variants
UPDATE dishes 
SET has_ingredients = true 
WHERE id IN (
  SELECT DISTINCT dish_id 
  FROM recipe_variants 
  WHERE ingredients_json IS NOT NULL 
    AND jsonb_array_length(ingredients_json) > 0
);

-- ============================================================================
-- HELPER FUNCTION: Auto-update dish has_ingredients when recipe variant changes
-- ============================================================================

CREATE OR REPLACE FUNCTION update_dish_has_ingredients()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the parent dish's has_ingredients flag
  UPDATE dishes
  SET has_ingredients = EXISTS (
    SELECT 1 
    FROM recipe_variants 
    WHERE dish_id = COALESCE(NEW.dish_id, OLD.dish_id)
      AND ingredients_json IS NOT NULL 
      AND jsonb_array_length(ingredients_json) > 0
  )
  WHERE id = COALESCE(NEW.dish_id, OLD.dish_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger on recipe_variants to auto-update dish has_ingredients
DROP TRIGGER IF EXISTS trigger_update_dish_has_ingredients ON recipe_variants;
CREATE TRIGGER trigger_update_dish_has_ingredients
  AFTER INSERT OR UPDATE OF ingredients_json OR DELETE
  ON recipe_variants
  FOR EACH ROW
  EXECUTE FUNCTION update_dish_has_ingredients();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN dishes.usage_count IS 
  'Number of times this dish has been used in meal plans. Higher = more popular.';

COMMENT ON COLUMN dishes.last_used_at IS 
  'Timestamp of last usage in a meal plan. For recency sorting.';

COMMENT ON COLUMN dishes.meal_type IS 
  'Array of meal types this dish is suitable for: breakfast, lunch, dinner, snack';

COMMENT ON COLUMN dishes.has_ingredients IS 
  'Whether this dish has a complete recipe with ingredients. Auto-updated via trigger.';

COMMENT ON COLUMN dishes.source IS 
  'Where this dish came from: ai (generated), user (created), imported (bulk), curated (hand-picked)';

