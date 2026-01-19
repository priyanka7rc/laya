-- ============================================================================
-- CLEANUP OLD SCHEMA (Pre-Relish)
-- ============================================================================
-- Purpose: Remove old meal planning tables that don't align with Relish architecture
-- WARNING: This will delete all existing recipe, meal plan, and grocery data
-- 
-- ⚠️  MAKE SURE YOU HAVE A BACKUP BEFORE RUNNING THIS
-- 
-- When to run this:
-- - Option A (Clean Slate): Before running 20250116000000_relish_mvp.sql
-- - Option B (Data Migration): After exporting data and running main migration
-- ============================================================================

-- ============================================================================
-- SAFETY CHECK: Confirm backup exists
-- ============================================================================
-- Uncomment this block after confirming you have a backup
/*
DO $$
BEGIN
    RAISE NOTICE 'Starting cleanup of old schema...';
    RAISE NOTICE 'This will delete tables: recipes, ingredients, instructions, mealplanslots, grocerylistitems';
    RAISE NOTICE 'Make sure you have exported any data you want to keep!';
END $$;
*/

-- ============================================================================
-- BACKUP QUERIES (Run these BEFORE cleanup if needed)
-- ============================================================================

-- Count existing data (for verification)
-- SELECT 
--   (SELECT COUNT(*) FROM recipes) as recipes_count,
--   (SELECT COUNT(*) FROM ingredients) as ingredients_count,
--   (SELECT COUNT(*) FROM instructions) as instructions_count,
--   (SELECT COUNT(*) FROM mealplanslots) as mealplanslots_count,
--   (SELECT COUNT(*) FROM grocerylistitems) as grocerylistitems_count;

-- Export recipes to backup table (optional - keep for data migration)
-- CREATE TABLE IF NOT EXISTS old_recipes_backup AS
-- SELECT 
--   r.*,
--   (SELECT jsonb_agg(jsonb_build_object(
--     'name', i.name,
--     'qty', i.qty,
--     'unit', i.unit
--   ))
--   FROM ingredients i
--   WHERE i.recipe_id = r.id) as ingredients_json,
--   (SELECT jsonb_agg(jsonb_build_object(
--     'step_no', ins.step_no,
--     'body', ins.body
--   ) ORDER BY ins.step_no)
--   FROM instructions ins
--   WHERE ins.recipe_id = r.id) as steps_json
-- FROM recipes r;

-- ============================================================================
-- DROP OLD TABLES (CASCADE removes dependent objects)
-- ============================================================================

-- Drop in reverse dependency order
DROP TABLE IF EXISTS instructions CASCADE;
DROP TABLE IF EXISTS ingredients CASCADE;
DROP TABLE IF EXISTS grocerylistitems CASCADE;
DROP TABLE IF EXISTS mealplanslots CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check that tables are gone
DO $$
DECLARE
  remaining_tables TEXT[];
BEGIN
  SELECT ARRAY_AGG(tablename) INTO remaining_tables
  FROM pg_tables 
  WHERE schemaname = 'public' 
  AND tablename IN ('recipes', 'ingredients', 'instructions', 'mealplanslots', 'grocerylistitems');
  
  IF remaining_tables IS NOT NULL THEN
    RAISE WARNING 'Some tables still exist: %', remaining_tables;
  ELSE
    RAISE NOTICE '✅ All old tables successfully removed';
  END IF;
END $$;

-- List all remaining public tables
SELECT 
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- ============================================================================
-- NOTES
-- ============================================================================

-- What was removed:
-- 1. recipes - Old recipe storage (replaced by dishes + recipe_variants)
-- 2. ingredients - Old ingredient storage (replaced by ingredient_master + ingredients_json in recipe_variants)
-- 3. instructions - Old cooking steps (replaced by steps_json in recipe_variants)
-- 4. mealplanslots - Old meal planning (replaced by meal_plans + meal_plan_items)
-- 5. grocerylistitems - Old grocery lists (replaced by grocery_lists + grocery_list_items)

-- Why the new schema is better:
-- ✅ Separates dish concepts from recipe implementations
-- ✅ Supports multiple recipe variants per dish
-- ✅ Enables learned validation via ontology_tokens
-- ✅ Better support for AI-generated vs user-created content
-- ✅ Proper RLS for global vs user-scoped data
-- ✅ Includes pantry inference and preference tracking
-- ✅ Built-in AI cost tracking and caching
-- ✅ Future-proof for nutrition, budgets, and more

-- Next steps after cleanup:
-- 1. Run: 20250116000000_relish_mvp.sql (main migration)
-- 2. Run: relish_seed.sql (seed data)
-- 3. Generate TypeScript types
-- 4. Update application code to use new schema
-- 5. Test thoroughly before deploying

-- ============================================================================
-- END OF CLEANUP
-- ============================================================================

