-- ============================================================================
-- CLEAR NORMALIZED RECIPE CACHE
-- ============================================================================
-- Run this in Supabase SQL Editor after making changes to:
--   1. Synonym mapping logic
--   2. AI normalization prompt
--   3. Unit conversion rules
--
-- This forces all recipes to be re-normalized with the new logic.
-- ============================================================================

-- Option 1: Clear entire cache (forces fresh normalization for all recipes)
TRUNCATE TABLE normalized_recipe_ingredients;

-- Option 2: Clear cache for specific problematic recipes (if you know the dish names)
-- DELETE FROM normalized_recipe_ingredients
-- WHERE dish_id IN (
--   SELECT id FROM dishes WHERE name IN ('Recipe Name 1', 'Recipe Name 2')
-- );

-- Option 3: Check what's in the cache before clearing
-- SELECT 
--   d.name as dish_name,
--   COUNT(*) as ingredient_count,
--   MAX(nri.normalized_at) as last_normalized
-- FROM normalized_recipe_ingredients nri
-- JOIN dishes d ON d.id = nri.dish_id
-- GROUP BY d.name
-- ORDER BY last_normalized DESC;

