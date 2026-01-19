# Quick Testing Guide - Day 1 Morning Features

## Prerequisites
1. ✅ Migrations run (`20250116000000_relish_mvp.sql` + `20250116100000_meal_plates.sql`)
2. ✅ Seed data loaded (`relish_seed.sql`)
3. ✅ Environment variables set (see `RELISH_SETUP.md`)
4. ✅ Dev server running: `npm run dev`

## Test Flow (5 Minutes)

### 1. Meal Plan Generation (2 min)
**URL**: `http://localhost:3000/mealplan`

**What to Test**:
- [ ] Page loads with loading skeleton
- [ ] Empty week auto-generates meals (if first time)
- [ ] Click "✨ Suggest Meals" button
- [ ] See multiple dishes per meal slot (carb, protein, veg, etc.)
- [ ] Each dish has an emoji icon for component type

**Expected Behavior**:
```
Monday Lunch:
  🌾 Jeera rice
  🍗 Chicken curry
  🥬 Palak paneer
  🥗 Cucumber salad
```

**What to Check**:
- Console log: "Compiling X dishes..." (first time only)
- Console log: "Created Y meals with Z components"
- Console log: Token usage and latency

---

### 2. Dish Details Page (1 min)
**Action**: Click any dish name in the meal plan

**What to Test**:
- [ ] Page loads with loading skeleton
- [ ] Dish name appears in header
- [ ] Description is shown
- [ ] Ingredients list is visible (with quantities)
- [ ] "Cooking Steps" section is collapsible
- [ ] Source shows "🤖 AI-generated"
- [ ] Back button works

**Expected Behavior**:
```
Jeera Rice
North Indian

A fragrant rice dish tempered with cumin seeds...

🥘 Ingredients
• basmati rice (1 cup)
• cumin seeds (1 teaspoon)
• ghee (1 tablespoon)
...

📝 Cooking Steps ▶
(click to expand)
```

---

### 3. Grocery List (1 min)
**URL**: `http://localhost:3000/grocery`

**What to Test**:
- [ ] Page loads with loading skeleton
- [ ] All ingredients from meal plan are listed
- [ ] No quantities shown (per user feedback)
- [ ] Checkboxes work (strike-through on check)
- [ ] Items persist checked state

**Expected Behavior**:
```
Grocery List
Week of January 20

☐ basmati rice
☐ cumin seeds
☐ chicken
☐ spinach
☐ paneer
...
```

---

### 4. Rate Limiting (1 min)
**Action**: Click "✨ Suggest Meals" button 11 times rapidly

**Expected Behavior**:
- First 10 times: Works normally
- 11th time: Alert popup:
  ```
  ⚠️ Rate limit exceeded. Try again in X minutes.
  
  This helps keep costs under control. Please try again later!
  ```

**Verification**:
- Check browser console for rate limit status
- Should see 429 status code on 11th request

---

### 5. Ingredient Normalization (Supabase Check)

**Action**: Open Supabase dashboard

**Tables to Check**:

#### `recipe_variants` table
```sql
SELECT 
  id,
  (SELECT canonical_name FROM dishes WHERE id = dish_id) as dish,
  ingredients_json
FROM recipe_variants
LIMIT 5;
```

**What to Verify**:
- [ ] `ingredients_json` has structured data
- [ ] Ingredient names are canonical (e.g., "turmeric powder" not "haldi")
- [ ] Each ingredient has `name`, `qty`, `unit`, `ingredient_id`

#### `ai_usage_logs` table
```sql
SELECT 
  feature,
  model,
  tokens_in + tokens_out as total_tokens,
  latency_ms,
  created_at
FROM ai_usage_logs
ORDER BY created_at DESC
LIMIT 10;
```

**What to Verify**:
- [ ] Rows exist for `plan_generation` and `dish_compilation`
- [ ] Token counts are reasonable (500-1500 per call)
- [ ] Latency is logged (1000-5000ms typical)

#### `grocery_list_items` table
```sql
SELECT 
  display_name,
  ingredient_id,
  (SELECT canonical_name FROM ingredient_master WHERE id = ingredient_id) as matched_name
FROM grocery_list_items
LIMIT 10;
```

**What to Verify**:
- [ ] Most items have `ingredient_id` (matched)
- [ ] Unmatched items show `null` for `ingredient_id`
- [ ] Display names are readable

---

## Advanced Testing

### Test Dish Compilation Caching
**Scenario**: Verify that compiled dishes are reused

**Steps**:
1. Delete all `meal_plan_items` for current week
2. Click "✨ Suggest Meals"
3. Note console log: "Compiling X dishes..."
4. Delete all `meal_plan_items` again
5. Click "✨ Suggest Meals" again
6. Note console log: Should NOT say "Compiling..." (cache hit)

**Expected**:
- First generation: Compiles dishes (~5-15 seconds)
- Second generation: Instant (~1-2 seconds)

---

### Test Token Limit
**Scenario**: Verify monthly token limit enforcement

**Steps**:
1. Edit `.env.local`: `TOKEN_LIMIT_PER_USER=1000`
2. Restart dev server
3. Generate meal plan 3-4 times
4. Should hit limit and see error:
   ```
   ⚠️ Monthly token limit (1,000) exceeded. 
   Used: 1,234. Resets next month.
   ```

**Cleanup**: Set `TOKEN_LIMIT_PER_USER=100000` and restart

---

### Test Empty States
**Scenario**: Verify UI handles no data gracefully

**Steps**:
1. Go to `/grocery` before generating meal plan
2. Should see:
   ```
   🛒
   No groceries yet!
   Plan meals for this week to generate a grocery list
   ```

---

## Common Issues & Fixes

### Issue: "No meal plate found or created"
**Cause**: RLS policy or old data
**Fix**: Delete old `meal_plan_items` in Supabase

### Issue: "Recipe variants not found"
**Cause**: Dishes not compiled yet
**Fix**: Normal - they compile on first generation

### Issue: Rate limit not working
**Cause**: Server restart clears in-memory cache
**Fix**: Expected behavior for MVP

### Issue: Ingredients show as "haldi" not "turmeric powder"
**Cause**: Seed data not loaded
**Fix**: Run `relish_seed.sql` again

### Issue: OpenAI errors (quota exceeded)
**Cause**: No API key or quota exceeded
**Fix**: Check `.env.local` has valid `OPENAI_API_KEY`

---

## Success Criteria ✅

After testing, you should see:

- ✅ Weekly meal plan generated with multiple dishes per meal
- ✅ Clickable dish names leading to details page
- ✅ Grocery list aggregated from all meals
- ✅ Rate limiting working after 10 calls
- ✅ Ingredients normalized in database
- ✅ AI usage logged in database
- ✅ Loading skeletons and empty states working
- ✅ No console errors (except intentional rate limit test)

---

## Quick Verification Queries

Run these in Supabase SQL Editor:

```sql
-- 1. Check compiled dishes
SELECT COUNT(*) as compiled_dishes FROM recipe_variants;
-- Should be: 10-25 after first generation

-- 2. Check AI usage
SELECT 
  COUNT(*) as total_calls,
  SUM(tokens_in + tokens_out) as total_tokens
FROM ai_usage_logs;
-- Should see: tokens increase with each generation

-- 3. Check meal plan
SELECT 
  COUNT(*) as meal_slots,
  COUNT(DISTINCT day_of_week) as days_filled
FROM meal_plan_items
WHERE meal_plan_id = (
  SELECT id FROM meal_plans 
  ORDER BY created_at DESC 
  LIMIT 1
);
-- Should see: ~15-21 meal slots across 7 days

-- 4. Check grocery items
SELECT COUNT(*) as grocery_items
FROM grocery_list_items
WHERE grocery_list_id = (
  SELECT id FROM grocery_lists
  ORDER BY created_at DESC
  LIMIT 1
);
-- Should see: 30-80 ingredients
```

---

## Next: Day 1 Afternoon (Optional)

If you have time and want to continue:
1. Run `npx ts-node scripts/test-grocery-aggregation.ts`
2. Add more polish (toasts instead of alerts)
3. Create admin dashboard at `/admin/ai-usage`
4. Add unit tests for normalizer

Otherwise, Day 1 Morning is **COMPLETE**! 🎉

Proceed to Day 2 (Mobile) when ready.
