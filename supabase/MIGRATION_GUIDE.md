# Relish Database Migration Guide

## Overview

This guide walks you through migrating your Laya database to support the Relish meal planning feature. The migration creates a new schema optimized for:

- ✅ AI-assisted meal planning
- ✅ Deterministic grocery list generation
- ✅ Learned user preferences
- ✅ Efficient caching and cost tracking
- ✅ Future extensibility (calories, budgets, pantry)

## 📋 Pre-Migration Checklist

- [ ] Backup your database (Supabase Dashboard → Database → Backups)
- [ ] Review current recipes/meal data (if any exist)
- [ ] Decide migration strategy: **Clean Slate** vs **Data Migration**
- [ ] Test locally first (if using Supabase CLI)
- [ ] Schedule during low-traffic period

## 🎯 Migration Options

### Option A: Clean Slate (Recommended for MVP)

**Best for:**
- Early development stage
- No production users yet
- Current schema doesn't align with Relish principles

**Steps:**
1. Run `cleanup_old_schema.sql` to remove old tables
2. Run `20250116000000_relish_mvp.sql` to create new schema
3. Run `relish_seed.sql` to populate with initial data

### Option B: Data Migration (For Production)

**Best for:**
- Existing users with meal/recipe data
- Need to preserve historical information

**Steps:**
1. Export existing data (see Data Export section)
2. Run `20250116000000_relish_mvp.sql` (creates new schema alongside old)
3. Run custom migration queries to transform data
4. Verify data integrity
5. Run `cleanup_old_schema.sql` to remove old tables

## 🚀 Migration Steps (Clean Slate)

### Step 1: Backup Database

```bash
# Via Supabase Dashboard:
# 1. Go to Database → Backups
# 2. Click "Create Backup"
# 3. Wait for confirmation
```

### Step 2: Cleanup Old Schema

```sql
-- Run in Supabase SQL Editor
-- File: supabase/migrations/cleanup_old_schema.sql

-- WARNING: This deletes all existing meal/recipe data
-- Make sure you have a backup!

DROP TABLE IF EXISTS instructions CASCADE;
DROP TABLE IF EXISTS ingredients CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;
DROP TABLE IF EXISTS mealplanslots CASCADE;
DROP TABLE IF EXISTS grocerylistitems CASCADE;

-- Verify cleanup
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('recipes', 'ingredients', 'instructions', 'mealplanslots', 'grocerylistitems');
-- Should return 0 rows
```

### Step 3: Run Main Migration

```sql
-- Run in Supabase SQL Editor
-- File: supabase/migrations/20250116000000_relish_mvp.sql

-- Copy and paste entire file contents
-- This creates:
-- - 11 new tables
-- - All enums, indexes, triggers
-- - RLS policies
-- - Helper functions

-- Execution time: ~30-60 seconds
```

### Step 4: Run Seed Data

```sql
-- Run in Supabase SQL Editor
-- File: supabase/seed/relish_seed.sql

-- This inserts:
-- - 40 common ingredients (with synonyms)
-- - 25 Indian dishes (with ontology tokens)
-- - 5 sample canonical recipes

-- Execution time: ~10 seconds
```

### Step 5: Verify Migration

```sql
-- Check table counts
SELECT 
  (SELECT COUNT(*) FROM dishes) as dishes,
  (SELECT COUNT(*) FROM ingredient_master) as ingredients,
  (SELECT COUNT(*) FROM recipe_variants) as recipes;

-- Expected: dishes=25, ingredients=40, recipes=5

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('dishes', 'meal_plans', 'grocery_lists')
ORDER BY tablename;

-- Expected: All should have rowsecurity = true

-- Test query (should work for authenticated users)
SELECT canonical_name, cuisine_tags 
FROM dishes 
WHERE 'indian' = ANY(cuisine_tags)
LIMIT 5;
```

### Step 6: Generate TypeScript Types

```bash
# Option 1: Using Supabase CLI (recommended)
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts

# Option 2: Use pre-generated types
# src/types/relish.ts is already created with manual types
```

### Step 7: Update Environment Variables

```bash
# Add to .env.local (if not already present)

# Relish Feature Flags
NEXT_PUBLIC_RELISH_ENABLED=true

# AI Configuration
OPENAI_MODEL=gpt-4o-mini
OPENAI_API_KEY=your-key-here

# Cost Tracking
AI_USAGE_TRACKING_ENABLED=true
```

## 🔄 Data Migration (Option B)

### Step 1: Export Existing Data

```sql
-- Export recipes to JSON
COPY (
  SELECT 
    r.id,
    r.title,
    r.user_id,
    r.duration_min,
    r.servings,
    r.tags,
    jsonb_agg(DISTINCT jsonb_build_object(
      'name', i.name,
      'qty', i.qty,
      'unit', i.unit
    )) as ingredients,
    (SELECT jsonb_agg(jsonb_build_object(
      'step_no', ins.step_no,
      'body', ins.body
    ) ORDER BY ins.step_no)
    FROM instructions ins
    WHERE ins.recipe_id = r.id) as steps
  FROM recipes r
  LEFT JOIN ingredients i ON i.recipe_id = r.id
  GROUP BY r.id
) TO '/tmp/recipes_export.json';
```

### Step 2: Transform and Import

```sql
-- Run main migration first (creates new tables)
\i supabase/migrations/20250116000000_relish_mvp.sql

-- Transform recipes → recipe_variants
-- Note: This requires manual review per recipe
DO $$
DECLARE
  old_recipe RECORD;
  dish_id_var UUID;
  variant_id_var UUID;
BEGIN
  FOR old_recipe IN 
    SELECT * FROM old_recipes_backup
  LOOP
    -- Create or get dish
    dish_id_var := get_or_create_dish(
      old_recipe.title,
      ARRAY['user_created']::TEXT[],
      ARRAY[]::TEXT[]
    );
    
    -- Create recipe variant
    INSERT INTO recipe_variants (
      dish_id,
      scope_user_id,
      servings_default,
      ingredients_json,
      steps_json,
      source_type,
      prep_time_min
    ) VALUES (
      dish_id_var,
      old_recipe.user_id,
      old_recipe.servings,
      old_recipe.ingredients_json,
      old_recipe.steps_json,
      'user_choice',
      old_recipe.duration_min
    );
  END LOOP;
END $$;
```

### Step 3: Verify Data Integrity

```sql
-- Compare counts
SELECT 
  (SELECT COUNT(*) FROM old_recipes_backup) as old_recipes,
  (SELECT COUNT(*) FROM recipe_variants WHERE scope_user_id IS NOT NULL) as new_user_recipes;

-- Should match

-- Spot check a few recipes
SELECT 
  d.canonical_name,
  rv.servings_default,
  rv.ingredients_json,
  rv.scope_user_id
FROM recipe_variants rv
JOIN dishes d ON d.id = rv.dish_id
WHERE rv.scope_user_id IS NOT NULL
LIMIT 5;
```

## 🧪 Testing

### Test RLS Policies

```sql
-- As authenticated user (simulate client query)
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims.sub TO 'YOUR_TEST_USER_ID';

-- Should succeed: Reading global dishes
SELECT * FROM dishes LIMIT 5;

-- Should succeed: Creating own meal plan
INSERT INTO meal_plans (user_id, week_start_date, week_name)
VALUES ('YOUR_TEST_USER_ID', '2025-01-20', 'Week of Jan 20')
RETURNING *;

-- Should fail: Creating meal plan for different user
INSERT INTO meal_plans (user_id, week_start_date, week_name)
VALUES ('DIFFERENT_USER_ID', '2025-01-20', 'Week of Jan 20')
RETURNING *;

-- Reset role
RESET ROLE;
```

### Test Ingredient Lookup

```sql
-- Test synonym matching
SELECT canonical_name, synonyms 
FROM ingredient_master
WHERE 'palak' = ANY(synonyms);
-- Should return: spinach

-- Test ontology tokens
SELECT canonical_name, ontology_tokens
FROM dishes
WHERE 'spinach:critical' = ANY(ontology_tokens);
-- Should return: palak paneer
```

### Test Cascade Deletes

```sql
-- Create test data
INSERT INTO meal_plans (user_id, week_start_date, week_name)
VALUES ('test-user', '2025-01-20', 'Test Week')
RETURNING id;
-- Note the returned ID

INSERT INTO meal_plan_items (meal_plan_id, day_of_week, meal_slot, dish_name)
VALUES ('MEAL_PLAN_ID_FROM_ABOVE', 0, 'lunch', 'Test Dish');

-- Delete meal plan
DELETE FROM meal_plans WHERE week_name = 'Test Week';

-- Verify cascading worked
SELECT COUNT(*) FROM meal_plan_items WHERE meal_plan_id = 'MEAL_PLAN_ID_FROM_ABOVE';
-- Should return 0
```

## 🔍 Troubleshooting

### Migration Fails with "relation already exists"

**Cause:** Tables from old schema still exist

**Solution:**
```sql
-- Check existing tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Drop conflicting tables (adjust as needed)
DROP TABLE IF EXISTS [conflicting_table] CASCADE;
```

### RLS Policy Errors

**Cause:** Policies are too restrictive or user context not set

**Solution:**
```sql
-- Check current policies
SELECT tablename, policyname, cmd 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Temporarily disable RLS for debugging (DON'T DO IN PRODUCTION)
ALTER TABLE [table_name] DISABLE ROW LEVEL SECURITY;
```

### Seed Data Fails

**Cause:** Constraint violations or missing dependencies

**Solution:**
```sql
-- Check which step failed
-- Run seed data in chunks

-- Just ingredients
INSERT INTO ingredient_master (...) VALUES (...);

-- Then dishes
INSERT INTO dishes (...) VALUES (...);

-- Then recipe variants (references dishes)
INSERT INTO recipe_variants (...) VALUES (...);
```

### Performance Issues After Migration

**Cause:** Missing indexes or statistics not updated

**Solution:**
```sql
-- Analyze tables
ANALYZE dishes;
ANALYZE ingredient_master;
ANALYZE recipe_variants;
ANALYZE meal_plans;
ANALYZE grocery_lists;

-- Check index usage
SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan;
```

## 📊 Post-Migration Checklist

- [ ] All tables created successfully
- [ ] RLS policies working correctly
- [ ] Seed data populated (40 ingredients, 25 dishes)
- [ ] TypeScript types generated
- [ ] Test user can create meal plan
- [ ] Test user can view dishes
- [ ] Test user cannot access other users' data
- [ ] Indexes are in place (check query performance)
- [ ] Updated application code to use new schema
- [ ] Environment variables configured

## 🔗 Next Steps

After successful migration:

1. **Update Application Code**
   - Replace old `recipes` queries with `dishes` + `recipe_variants`
   - Update `mealplanslots` → `meal_plan_items`
   - Update `grocerylistitems` → `grocery_list_items`

2. **Build Core Features**
   - Day 2: Ingredient normalization engine
   - Day 4: AI meal plan generation
   - Day 5: Dish compilation with caching
   - Day 7: Grocery list aggregation

3. **Monitor Performance**
   - Track AI cache hit rates
   - Monitor token usage per user
   - Check query performance (use `EXPLAIN ANALYZE`)

## 📞 Support

If you encounter issues:

1. Check Supabase logs: Dashboard → Logs → Postgres Logs
2. Verify RLS policies: `SELECT * FROM pg_policies WHERE schemaname = 'public'`
3. Review this guide's Troubleshooting section
4. Check seed data verification queries

## 🔒 Security Notes

- **Never disable RLS in production**
- **Service role key** should only be used server-side
- **Client SDK** automatically enforces RLS
- **Test with real user contexts** before deploying

## 📝 Schema Version

- **Migration Version:** 20250116000000
- **Schema Name:** relish_mvp
- **Supabase Version:** Compatible with Postgres 15+
- **Dependencies:** auth.users table (Supabase Auth)

---

**Migration created:** 2025-01-16  
**Last updated:** 2025-01-16  
**Status:** Ready for production

