-- ============================================================================
-- DISH USAGE TRACKING FUNCTION
-- ============================================================================
-- Purpose: Increment usage count and update last_used_at for a dish
-- ============================================================================

-- Drop existing function if it exists (handle previous attempts)
DROP FUNCTION IF EXISTS increment_dish_usage(UUID);
DROP FUNCTION IF EXISTS increment_dish_usage(TEXT);
DROP FUNCTION IF EXISTS increment_dish_usage;

-- Create the function
CREATE FUNCTION increment_dish_usage(p_dish_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE dishes
  SET 
    usage_count = COALESCE(usage_count, 0) + 1,
    last_used_at = NOW()
  WHERE id = p_dish_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION increment_dish_usage(p_dish_id UUID) TO service_role;
GRANT EXECUTE ON FUNCTION increment_dish_usage(p_dish_id UUID) TO authenticated;

COMMENT ON FUNCTION increment_dish_usage IS 
  'Increments usage_count and updates last_used_at for a dish when used in meal plan';

