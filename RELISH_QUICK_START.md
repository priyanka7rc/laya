# Relish Quick Start Guide

## 🚀 Run This Now (5 Minutes)

### Option 1: Supabase Dashboard (Easiest)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → Your Project → SQL Editor

2. **Run Cleanup** (if old schema exists):
   ```sql
   -- Copy contents of: supabase/migrations/cleanup_old_schema.sql
   -- Paste in SQL Editor → Run
   ```

3. **Run Migration**:
   ```sql
   -- Copy contents of: supabase/migrations/20250116000000_relish_mvp.sql
   -- Paste in SQL Editor → Run (takes ~45 seconds)
   ```

4. **Run Seed Data**:
   ```sql
   -- Copy contents of: supabase/seed/relish_seed.sql
   -- Paste in SQL Editor → Run
   ```

5. **Verify**:
   ```sql
   SELECT 
     (SELECT COUNT(*) FROM dishes) as dishes,
     (SELECT COUNT(*) FROM ingredient_master) as ingredients,
     (SELECT COUNT(*) FROM recipe_variants) as recipes;
   ```
   Expected: `dishes=25, ingredients=40, recipes=5`

### Option 2: Supabase CLI (Recommended for Dev)

```bash
# Install Supabase CLI (if not installed)
npm install -g supabase

# Link to your project
cd /Users/priyankavijayakumar/laya
supabase link --project-ref YOUR_PROJECT_REF

# Run migrations
supabase db push

# Or manually with psql
psql -h YOUR_DB_HOST -U postgres -d postgres \
  -f supabase/migrations/cleanup_old_schema.sql
psql -h YOUR_DB_HOST -U postgres -d postgres \
  -f supabase/migrations/20250116000000_relish_mvp.sql
psql -h YOUR_DB_HOST -U postgres -d postgres \
  -f supabase/seed/relish_seed.sql
```

## ✅ Quick Verification

```sql
-- 1. Check tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
-- Should see: dishes, ingredient_master, meal_plans, etc.

-- 2. Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
-- All should have rowsecurity = true

-- 3. Test a query
SELECT canonical_name, cuisine_tags 
FROM dishes 
WHERE 'indian' = ANY(cuisine_tags)
LIMIT 5;
-- Should return 5 Indian dishes

-- 4. Test synonym lookup
SELECT canonical_name, synonyms 
FROM ingredient_master 
WHERE 'palak' = ANY(synonyms);
-- Should return: spinach
```

## 📝 Generate TypeScript Types

```bash
# Option 1: Auto-generate from Supabase
npx supabase gen types typescript \
  --project-id YOUR_PROJECT_ID \
  > src/types/database.types.ts

# Option 2: Use pre-generated types (already created)
# Just import from: src/types/relish.ts
```

## 🔧 Update Your Code

### Before (Old Schema):
```typescript
// ❌ Old way
const { data } = await supabase
  .from('recipes')
  .select('*, ingredients(*), instructions(*)')
  .eq('user_id', user.id);
```

### After (New Schema):
```typescript
// ✅ New way
import { Dish, RecipeVariant } from '@/types/relish';

const { data: dishes } = await supabase
  .from('dishes')
  .select(`
    *,
    recipe_variants (*)
  `)
  .eq('recipe_variants.scope_user_id', user.id);
```

## 🎯 Key Changes to Update

### 1. Meal Plan Page
```typescript
// Old: mealplanslots
// New: meal_plan_items

const { data: mealPlan } = await supabase
  .from('meal_plan_items')
  .select(`
    *,
    dish:dishes(*)
  `)
  .eq('meal_plan_id', planId);
```

### 2. Grocery List
```typescript
// Old: grocerylistitems
// New: grocery_list_items

const { data: items } = await supabase
  .from('grocery_list_items')
  .select(`
    *,
    ingredient_master(canonical_name, typical_unit)
  `)
  .eq('grocery_list_id', listId);
```

### 3. Recipe Display
```typescript
// Old: recipes with separate ingredients table
// New: recipe_variants with ingredients_json

const { data: variant } = await supabase
  .from('recipe_variants')
  .select(`
    *,
    dish:dishes(*)
  `)
  .eq('id', variantId)
  .single();

// ingredients_json is already in the variant
console.log(variant.ingredients_json); // Array of ingredients
console.log(variant.steps_json); // Array of steps
```

## 🔐 Environment Variables

Add to `.env.local`:

```bash
# Relish Feature
NEXT_PUBLIC_RELISH_ENABLED=true

# OpenAI (for Day 4+)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# Cost Tracking
AI_USAGE_TRACKING_ENABLED=true
TOKEN_LIMIT_PER_USER=100000

# Supabase (should already exist)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 🧪 Test RLS

```typescript
// Should work: Read dishes
const { data: dishes } = await supabase
  .from('dishes')
  .select('*')
  .limit(5);
console.log(dishes); // ✅ Success

// Should work: Create own meal plan
const { data: plan } = await supabase
  .from('meal_plans')
  .insert({
    user_id: user.id, // Must match auth.uid()
    week_start_date: '2025-01-20',
    week_name: 'Week of Jan 20'
  })
  .select()
  .single();
console.log(plan); // ✅ Success

// Should fail: Create meal plan for someone else
const { error } = await supabase
  .from('meal_plans')
  .insert({
    user_id: 'different-user-id',
    week_start_date: '2025-01-20',
    week_name: 'Test'
  });
console.log(error); // ❌ RLS violation
```

## 📦 Files You Need to Update

1. `src/app/mealplan/page.tsx` - Update to use meal_plan_items
2. `src/app/meals/page.tsx` - Update to use dishes + recipe_variants
3. `src/app/grocery/page.tsx` - Update to use grocery_list_items
4. `src/lib/groceryListGenerator.ts` - Update logic for new schema
5. `src/components/RecipePicker.tsx` - Update to show dishes

## 🚨 Breaking Changes

| Old | New | Notes |
|-----|-----|-------|
| `recipes` | `dishes` + `recipe_variants` | Dishes are concepts, recipes are implementations |
| `ingredients` table | `ingredients_json` in `recipe_variants` | JSONB field, not separate table |
| `instructions` table | `steps_json` in `recipe_variants` | JSONB field, not separate table |
| `mealplanslots` | `meal_plan_items` | More descriptive name |
| `grocerylistitems` | `grocery_list_items` | More descriptive name |
| `recipe.title` | `dish.canonical_name` | Dishes have canonical names |
| `ingredient.name` | `ingredient_master.canonical_name` | Master ingredient list |

## 🎉 What Works Now

After migration, you have:

✅ **25 Indian dishes** ready to use  
✅ **40 ingredients** with synonym matching  
✅ **5 complete recipes** with steps  
✅ **Meal planning** infrastructure  
✅ **Grocery list** generation ready  
✅ **Pantry tracking** tables  
✅ **AI cost tracking** built-in  
✅ **RLS security** enforced  
✅ **TypeScript types** available  

## 🔗 Next: Day 2 - Ingredient Normalization

After migration is complete and verified:

1. Build `src/lib/ingredient-normalizer.ts`
2. Create unit conversion tables
3. Implement synonym matching logic
4. Write tests for normalization

See `RELISH_SETUP_COMPLETE.md` for full roadmap.

## 📖 Documentation

- **Quick Start** (this file) - 5-minute setup
- **supabase/README.md** - Quick reference
- **supabase/MIGRATION_GUIDE.md** - Detailed instructions
- **RELISH_SETUP_COMPLETE.md** - What was created
- **src/types/relish.ts** - Type definitions

## ❓ Troubleshooting

### "relation already exists"
→ Run `cleanup_old_schema.sql` first

### "permission denied"
→ Check RLS policies with `SELECT * FROM pg_policies`

### "null value in column violates not-null constraint"
→ Check seed data file for missing required fields

### Type errors in TypeScript
→ Regenerate types with `npx supabase gen types`

---

**Time to Complete:** ~5 minutes  
**Status:** Ready to run ✅  
**Last Updated:** 2025-01-16

