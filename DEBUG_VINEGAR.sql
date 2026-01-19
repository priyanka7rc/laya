-- ============================================================================
-- DEBUG VINEGAR ISSUE
-- ============================================================================
-- User reported "vinegar 1.2L" in grocery list, which seems excessive.
-- This query helps find which recipes have vinegar and how much.
-- ============================================================================

-- Query 1: Find all recipes with vinegar
SELECT 
  d.id,
  d.name as recipe_name,
  d.servings_default,
  d.ingredients_json
FROM dishes d
WHERE d.ingredients_json::text ILIKE '%vinegar%';

-- Query 2: Extract vinegar quantities from recipes (PostgreSQL JSON processing)
WITH vinegar_ingredients AS (
  SELECT 
    d.id,
    d.name as recipe_name,
    d.servings_default,
    jsonb_array_elements(d.ingredients_json) as ingredient
  FROM dishes d
  WHERE d.ingredients_json::text ILIKE '%vinegar%'
)
SELECT 
  recipe_name,
  servings_default,
  ingredient->>'name' as ingredient_name,
  ingredient->>'qty' as quantity,
  ingredient->>'unit' as unit
FROM vinegar_ingredients
WHERE ingredient->>'name' ILIKE '%vinegar%';

-- Query 3: Check current week's meal plan for vinegar dishes
SELECT 
  mi.day_of_week,
  mi.meal_slot,
  d.name as recipe_name,
  mpc.servings,
  d.servings_default,
  (mpc.servings::float / NULLIF(d.servings_default, 0)) as multiplier,
  d.ingredients_json
FROM meal_plans mp
JOIN meal_plan_items mi ON mi.meal_plan_id = mp.id
JOIN meal_plates mpl ON mpl.meal_plan_item_id = mi.id
JOIN meal_plate_components mpc ON mpc.meal_plate_id = mpl.id
JOIN dishes d ON d.id = mpc.dish_id
WHERE mp.week_start_date = date_trunc('week', CURRENT_DATE)::DATE
  AND mp.user_id = auth.uid()
  AND d.ingredients_json::text ILIKE '%vinegar%'
ORDER BY mi.day_of_week, mi.meal_slot;

-- ============================================================================
-- WHAT TO LOOK FOR:
-- ============================================================================
-- 1. Are there multiple recipes with vinegar?
-- 2. What are the vinegar quantities in each recipe?
-- 3. Are the units correct? (tbsp, tsp, cup, ml?)
-- 4. Is the serving multiplier being applied correctly?
-- 5. Is vinegar appearing in recipes where it shouldn't (e.g., due to AI generation)?
--
-- Common issues:
-- - "vinegar" listed in "mixed vegetables" or generic ingredients
-- - AI-generated recipes with incorrect quantities
-- - Unit conversion errors (1 cup vinegar = 240ml, not 1200ml)
-- ============================================================================

