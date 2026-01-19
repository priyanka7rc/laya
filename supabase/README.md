# Supabase Migrations & Seed Data

This directory contains database migrations and seed data for Laya's Relish meal planning feature.

## 📁 Directory Structure

```
supabase/
├── migrations/
│   ├── 20250116000000_relish_mvp.sql    # Main migration (creates all tables)
│   └── cleanup_old_schema.sql            # Removes old schema (run first if needed)
├── seed/
│   └── relish_seed.sql                   # Initial data (40 ingredients, 25 dishes)
├── MIGRATION_GUIDE.md                    # Detailed migration instructions
└── README.md                             # This file
```

## 🚀 Quick Start

### For Clean Slate (Recommended for MVP)

```sql
-- 1. Run cleanup (if old schema exists)
\i supabase/migrations/cleanup_old_schema.sql

-- 2. Run main migration
\i supabase/migrations/20250116000000_relish_mvp.sql

-- 3. Run seed data
\i supabase/seed/relish_seed.sql

-- 4. Verify
SELECT COUNT(*) FROM dishes;           -- Should be 25
SELECT COUNT(*) FROM ingredient_master; -- Should be 40
SELECT COUNT(*) FROM recipe_variants;   -- Should be 5
```

### Using Supabase Dashboard

1. Go to **SQL Editor** in your Supabase Dashboard
2. Click **New Query**
3. Copy contents of `cleanup_old_schema.sql` → Run
4. Copy contents of `20250116000000_relish_mvp.sql` → Run
5. Copy contents of `relish_seed.sql` → Run

## 📋 What Gets Created

### Tables (11 total)

**Global Tables** (server-managed, client read-only):
- `dishes` - Canonical dish concepts (e.g., "Palak Paneer")
- `ingredient_master` - Master ingredient list with synonyms
- `recipe_variants` - Different recipes for same dish

**User-Scoped Tables** (full CRUD for own data):
- `meal_plans` - Weekly meal planning container
- `meal_plan_items` - Individual meals in plan
- `pantry_items` - User's inferred pantry
- `grocery_lists` - Generated from meal plans
- `grocery_list_items` - Individual grocery items
- `user_recipe_links` - Explicit recipe choices
- `ai_usage_logs` - Cost tracking
- `ai_cache` - Reusable AI responses

### Enums (4)
- `meal_slot` - pre_breakfast, breakfast, morning_snack, lunch, evening_snack, dinner
- `unit_class` - weight, volume, count
- `grocery_status` - needed, pantry, removed
- `recipe_source_type` - ai, api, user_choice

### Indexes (20+)
All foreign keys indexed + GIN indexes for array searches

### RLS Policies (30+)
Proper separation: global data readable, user data isolated

## 🔍 Key Features

### 1. Ontology-Based Validation
```sql
SELECT canonical_name, ontology_tokens 
FROM dishes 
WHERE 'spinach:critical' = ANY(ontology_tokens);
-- Returns: palak paneer
```

### 2. Synonym Matching
```sql
SELECT canonical_name 
FROM ingredient_master 
WHERE 'palak' = ANY(synonyms);
-- Returns: spinach
```

### 3. AI Caching
```sql
SELECT payload_json 
FROM ai_cache 
WHERE cache_key = 'dish_compile:palak_paneer:4_servings';
-- Returns cached compilation if exists
```

### 4. Pantry Confidence
```sql
SELECT im.canonical_name, pi.confidence_score
FROM pantry_items pi
JOIN ingredient_master im ON im.id = pi.ingredient_id
WHERE pi.user_id = auth.uid()
ORDER BY pi.confidence_score DESC;
-- Higher confidence = more likely user has it
```

## 🔒 Security (RLS)

### Global Tables
- ✅ **Dishes** - Read by all authenticated users
- ✅ **Ingredient Master** - Read by all authenticated users
- ✅ **Recipe Variants** - Read global + own, write only own

### User Tables
- ✅ **Meal Plans** - Full CRUD on own data only
- ✅ **Grocery Lists** - Full CRUD on own data only
- ✅ **Pantry Items** - Full CRUD on own data only

### Testing RLS
```sql
-- As authenticated user
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims.sub TO 'test-user-id';

-- Should work
SELECT * FROM dishes LIMIT 5;

-- Should fail (different user_id)
INSERT INTO meal_plans (user_id, week_start_date)
VALUES ('different-user-id', '2025-01-20');
```

## 📊 Seed Data

### 40 Common Ingredients
- **Spices:** cumin, turmeric, coriander, garam masala, etc.
- **Vegetables:** onion, garlic, ginger, spinach, potato, etc.
- **Dairy:** paneer, yogurt, cream, ghee, butter
- **Proteins:** chicken, lentils, chickpeas, kidney beans
- **Staples:** rice, oil, salt, sugar

### 25 Indian Dishes
- **Paneer:** palak paneer, paneer butter masala, kadai paneer
- **Chicken:** butter chicken, chicken tikka masala, biryani
- **Dal:** dal tadka, dal makhani, chana masala, rajma
- **Vegetables:** aloo gobi, baingan bharta, bhindi masala
- **Breakfast:** poha, upma, masala dosa, idli
- **Rice:** jeera rice, vegetable biryani

### 5 Sample Recipes
Complete with ingredients, steps, nutrition estimates

## 🛠️ TypeScript Types

After migration, generate types:

```bash
# Option 1: Auto-generate from Supabase
npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.types.ts

# Option 2: Use pre-generated types
# Already available: src/types/relish.ts
```

Usage:
```typescript
import { Dish, RecipeVariant, MealPlan } from '@/types/relish';

// Type-safe queries
const dish: Dish = await supabase
  .from('dishes')
  .select('*')
  .eq('canonical_name', 'palak paneer')
  .single();
```

## 🔧 Troubleshooting

### Tables Already Exist
```sql
-- Check existing tables
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Run cleanup first
\i supabase/migrations/cleanup_old_schema.sql
```

### RLS Blocking Queries
```sql
-- Check policies
SELECT tablename, policyname, cmd FROM pg_policies 
WHERE schemaname = 'public' ORDER BY tablename;

-- Verify user context is set
SELECT auth.uid(); -- Should return user ID
```

### Seed Data Errors
```sql
-- Run in chunks
-- First ingredients, then dishes, then recipe_variants
-- Check error message for constraint violations
```

## 📖 Full Documentation

See **MIGRATION_GUIDE.md** for:
- Detailed step-by-step instructions
- Data migration strategies
- Testing procedures
- Post-migration checklist
- Troubleshooting guide

## 🎯 Next Steps After Migration

1. **Day 2:** Build ingredient normalization engine
2. **Day 4:** Implement AI meal plan generation
3. **Day 5:** Build dish compilation with caching
4. **Day 7:** Create grocery list aggregator
5. **Day 12:** Set up cost/performance monitoring

## 🔗 Related Files

- `src/types/relish.ts` - TypeScript type definitions
- `src/lib/ingredient-normalizer.ts` - (To be created) Day 2
- `src/lib/meal-planner.ts` - (To be created) Day 4
- `src/lib/dish-compiler.ts` - (To be created) Day 5
- `src/lib/grocery-generator.ts` - (To be updated) Day 7

## 📝 Schema Version

- **Version:** 20250116000000
- **Name:** relish_mvp
- **Compatibility:** Supabase Postgres 15+
- **Dependencies:** auth.users (Supabase Auth)

## 🤝 Contributing

When modifying schema:
1. Create new migration file with timestamp
2. Update MIGRATION_GUIDE.md
3. Update TypeScript types
4. Test RLS policies
5. Document breaking changes

---

**Created:** 2025-01-16  
**Status:** Production Ready ✅

