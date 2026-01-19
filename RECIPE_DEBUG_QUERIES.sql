-- ============================================================================
-- RECIPE DEBUG QUERIES - Find problematic ingredients
-- Run these in Supabase SQL Editor
-- ============================================================================

-- 1. Find recipes with "mixed vegetables"
-- ============================================================================
SELECT 
  id,
  name,
  cuisine_type,
  servings_default,
  jsonb_pretty(ingredients_json) as ingredients
FROM dishes
WHERE ingredients_json::text ILIKE '%mixed vegetable%';


-- 2. Find recipes with vinegar and their quantities
-- ============================================================================
SELECT 
  d.id,
  d.name,
  d.servings_default,
  ing->>'name' as ingredient_name,
  ing->>'qty' as qty,
  ing->>'unit' as unit
FROM dishes d,
jsonb_array_elements(d.ingredients_json) as ing
WHERE ing->>'name' ILIKE '%vinegar%';


-- 3. Find all vague/problematic ingredients
-- ============================================================================
SELECT 
  ing->>'name' as ingredient_name,
  COUNT(DISTINCT d.id) as recipe_count,
  array_agg(DISTINCT d.name) as recipes
FROM dishes d,
jsonb_array_elements(d.ingredients_json) as ing
WHERE 
  ing->>'name' ILIKE '%mixed%'
  OR ing->>'name' ILIKE '%to taste%'
  OR ing->>'name' ILIKE '%as needed%'
  OR ing->>'name' ILIKE '%spice mix%'
  OR ing->>'name' ILIKE '%garnish%'
  OR ing->>'name' ILIKE '%seasoning%'
GROUP BY ing->>'name'
ORDER BY recipe_count DESC;


-- 4. Find which recipes are in current week's meal plan
-- ============================================================================
SELECT DISTINCT
  d.id,
  d.name,
  jsonb_pretty(d.ingredients_json) as ingredients
FROM dishes d
JOIN meal_plate_components mpc ON mpc.dish_id = d.id
JOIN meal_plates mp ON mp.id = mpc.meal_plate_id
JOIN meal_plan_items mpi ON mpi.id = mp.meal_plan_item_id
JOIN meal_plans mpln ON mpln.id = mpi.meal_plan_id
WHERE mpln.week_start_date = date_trunc('week', CURRENT_DATE)::DATE
  AND mpln.user_id = auth.uid()
ORDER BY d.name;


-- 5. Count total ingredients in current meal plan
-- ============================================================================
SELECT 
  COUNT(*) as total_ingredient_lines,
  COUNT(DISTINCT d.id) as unique_recipes
FROM dishes d
JOIN meal_plate_components mpc ON mpc.dish_id = d.id
JOIN meal_plates mp ON mp.id = mpc.meal_plate_id
JOIN meal_plan_items mpi ON mpi.id = mp.meal_plan_item_id
JOIN meal_plans mpln ON mpln.id = mpi.meal_plan_id
WHERE mpln.week_start_date = date_trunc('week', CURRENT_DATE)::DATE
  AND mpln.user_id = auth.uid();

