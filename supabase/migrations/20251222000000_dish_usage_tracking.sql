-- Migration: Dish Usage Tracking & User-Added Dishes
-- Purpose: Track dish usage frequency and support user-added custom dishes

-- 1. Add created_by_user_id to dishes table (for user-added dishes)
ALTER TABLE dishes
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Create dish_usage_log table
CREATE TABLE IF NOT EXISTS dish_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dish_id UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  used_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, dish_id)
);

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_dish_usage_log_user_id ON dish_usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_dish_usage_log_dish_id ON dish_usage_log(dish_id);
CREATE INDEX IF NOT EXISTS idx_dish_usage_log_user_dish ON dish_usage_log(user_id, dish_id);
CREATE INDEX IF NOT EXISTS idx_dish_usage_log_used_count ON dish_usage_log(user_id, used_count DESC);
CREATE INDEX IF NOT EXISTS idx_dishes_created_by ON dishes(created_by_user_id) WHERE created_by_user_id IS NOT NULL;

-- 4. Enable RLS on dish_usage_log
ALTER TABLE dish_usage_log ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for dish_usage_log
-- Users can only see their own usage logs
CREATE POLICY "Users can view own dish usage"
  ON dish_usage_log FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own usage logs
CREATE POLICY "Users can insert own dish usage"
  ON dish_usage_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own usage logs
CREATE POLICY "Users can update own dish usage"
  ON dish_usage_log FOR UPDATE
  USING (auth.uid() = user_id);

-- 6. RLS Policies for dishes table (user-added dishes)
-- Everyone can see global dishes (created_by_user_id IS NULL)
-- Users can only see their own custom dishes
CREATE POLICY "Users can view global and own dishes"
  ON dishes FOR SELECT
  USING (
    created_by_user_id IS NULL  -- Global dishes
    OR created_by_user_id = auth.uid()  -- Own dishes
  );

-- Users can insert their own custom dishes
CREATE POLICY "Users can insert own dishes"
  ON dishes FOR INSERT
  WITH CHECK (
    created_by_user_id = auth.uid()
    OR created_by_user_id IS NULL  -- Service role can create global dishes
  );

-- Users can update their own custom dishes
CREATE POLICY "Users can update own dishes"
  ON dishes FOR UPDATE
  USING (created_by_user_id = auth.uid());

-- Users can delete their own custom dishes
CREATE POLICY "Users can delete own dishes"
  ON dishes FOR DELETE
  USING (created_by_user_id = auth.uid());

-- 7. RLS Policies for recipe_variants (user vs global recipes)
-- Already has scope_user_id, just need to ensure policies exist

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view global and own recipes" ON recipe_variants;
DROP POLICY IF EXISTS "Users can insert own recipes" ON recipe_variants;

-- Users can see global recipes (scope_user_id IS NULL) or their own
CREATE POLICY "Users can view global and own recipes"
  ON recipe_variants FOR SELECT
  USING (
    scope_user_id IS NULL  -- Global recipes
    OR scope_user_id = auth.uid()  -- Own recipes
  );

-- Users can insert their own recipes (or service role can create global)
CREATE POLICY "Users can insert own recipes"
  ON recipe_variants FOR INSERT
  WITH CHECK (
    scope_user_id = auth.uid()
    OR scope_user_id IS NULL  -- Service role for global recipes
  );

-- 8. Helper function to increment dish usage
CREATE OR REPLACE FUNCTION increment_dish_usage(
  p_user_id UUID,
  p_dish_id UUID
) RETURNS void AS $$
BEGIN
  INSERT INTO dish_usage_log (user_id, dish_id, used_count, last_used_at)
  VALUES (p_user_id, p_dish_id, 1, NOW())
  ON CONFLICT (user_id, dish_id) 
  DO UPDATE SET 
    used_count = dish_usage_log.used_count + 1,
    last_used_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Grant execute permission on helper function
GRANT EXECUTE ON FUNCTION increment_dish_usage(UUID, UUID) TO authenticated;

-- 10. Comments for documentation
COMMENT ON TABLE dish_usage_log IS 'Tracks how often users use each dish in their meal plans';
COMMENT ON COLUMN dishes.created_by_user_id IS 'NULL for global dishes, user_id for user-created dishes';
COMMENT ON FUNCTION increment_dish_usage IS 'Safely increments dish usage count for a user';

