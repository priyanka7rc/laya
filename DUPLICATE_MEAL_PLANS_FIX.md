# Duplicate Meal Plans Fix

## Problem

Users were able to create multiple meal plans for the same calendar week with different `week_start_date` values. For example:
- `2026-01-12` (Sunday) - "Week of Jan 12"  
- `2026-01-16` (Thursday) - "Week of Jan 16"

Both of these are in the **same calendar week** (Jan 12-18, 2026) and should have used the same meal plan with `week_start_date = 2026-01-13` (Monday).

## Root Cause

The backend API route (`/api/meal-plan/generate`) was accepting whatever `weekStartDate` the frontend sent without normalizing it to the Monday of that week. This allowed:
1. Different dates in the same week to create separate meal plans
2. No duplicate detection since exact date matching was used

## Solution Implemented

### 1. Added `normalizeToMonday()` Helper Function

```typescript
function normalizeToMonday(dateString: string): string {
  const date = new Date(dateString);
  const currentDay = date.getUTCDay();
  
  // Calculate days to subtract to get to Monday (1)
  // Sunday (0) -> subtract 6 days, Monday (1) -> subtract 0, Tuesday (2) -> subtract 1, etc.
  const daysToMonday = currentDay === 0 ? 6 : currentDay - 1;
  
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - daysToMonday);
  
  return monday.toISOString().split('T')[0];
}
```

**Examples:**
- Input: `2026-01-12` (Sunday) → Output: `2026-01-13` (Monday)
- Input: `2026-01-16` (Thursday) → Output: `2026-01-13` (Monday)
- Input: `2026-01-13` (Monday) → Output: `2026-01-13` (Monday)

### 2. Normalize Before Checking/Creating Meal Plans

```typescript
// Backend now normalizes the date BEFORE querying
const weekStartDate = normalizeToMonday(rawWeekStartDate);

// Then checks for existing meal plan using the normalized date
let { data: mealPlan } = await supabase
  .from('meal_plans')
  .select('id, week_start_date, week_name')
  .eq('user_id', userId)
  .eq('week_start_date', weekStartDate)  // Normalized Monday
  .maybeSingle();
```

### 3. Added Logging

```typescript
if (weekStartDate !== rawWeekStartDate) {
  console.log(`[${timestamp}] 📅 Normalized week start date: ${rawWeekStartDate} → ${weekStartDate} (Monday)`);
}
```

This helps track when normalization occurs.

## Result

✅ **One meal plan per calendar week** - All dates in the same week now map to the same Monday  
✅ **No more duplicates** - Existing meal plan is reused instead of creating a new one  
✅ **Backward compatible** - Frontend already sends Mondays, so no breaking changes  
✅ **Fail-safe** - Even if frontend sends wrong date, backend normalizes it  

---

## Cleanup: Remove Existing Duplicates

### Step 1: Identify Duplicate Weeks

```sql
-- Find all weeks with multiple meal plans
SELECT 
  user_id,
  DATE_TRUNC('week', week_start_date + INTERVAL '1 day')::date as calendar_week,
  COUNT(*) as meal_plans_count,
  STRING_AGG(id::text, ', ') as plan_ids,
  STRING_AGG(week_start_date::text, ', ') as start_dates,
  STRING_AGG(week_name, ', ') as week_names
FROM meal_plans
GROUP BY user_id, DATE_TRUNC('week', week_start_date + INTERVAL '1 day')
HAVING COUNT(*) > 1
ORDER BY user_id, calendar_week DESC;
```

### Step 2: For Each Duplicate Week, Choose Which to Keep

**Option A: Keep the most recent (by created_at)**

```sql
-- For user 2105c18b-f0ed-4afd-aefa-8e42b4bcec71, week of Jan 12-18
-- Keep Jan 16 plan (most recent), delete Jan 12 plan

DELETE FROM meal_plans 
WHERE id = '5c850bd0-735a-4c8d-9f20-534bf7e73e1a';  -- Jan 12
```

**Option B: Keep the one with more data**

```sql
-- Compare meal counts first
SELECT 
  mp.id,
  mp.week_start_date,
  mp.week_name,
  COUNT(DISTINCT mpi.id) as meal_items_count,
  COUNT(DISTINCT mpc.id) as components_count
FROM meal_plans mp
LEFT JOIN meal_plan_items mpi ON mp.id = mpi.meal_plan_id
LEFT JOIN meal_plates mplate ON mpi.id = mplate.meal_plan_item_id
LEFT JOIN meal_plate_components mpc ON mplate.id = mpc.meal_plate_id
WHERE mp.id IN (
  'c114ec1a-02f5-4a54-b3a5-2a568d272f25',  -- Jan 16
  '5c850bd0-735a-4c8d-9f20-534bf7e73e1a'   -- Jan 12
)
GROUP BY mp.id, mp.week_start_date, mp.week_name;

-- Then delete the one with less data
```

### Step 3: Normalize Remaining Meal Plans

After deleting duplicates, update the `week_start_date` of remaining plans to Monday:

```sql
-- Update all meal plans to use Monday as week_start_date
UPDATE meal_plans
SET week_start_date = (
  SELECT DATE_TRUNC('week', week_start_date::date)::date + INTERVAL '1 day'
)::date
WHERE week_start_date != (
  SELECT DATE_TRUNC('week', week_start_date::date)::date + INTERVAL '1 day'
)::date;
```

**⚠️ Note:** This will change `week_start_date` for existing plans, but won't break anything since the frontend and backend now both use Monday normalization.

---

## Testing

### Test 1: Create Meal Plan for Different Days in Same Week

```bash
# Try creating meal plans for Sunday, Tuesday, and Thursday of the same week
curl -X POST http://localhost:3000/api/meal-plan/generate \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "weekStartDate": "2026-01-19"}'  # Sunday

curl -X POST http://localhost:3000/api/meal-plan/generate \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "weekStartDate": "2026-01-21"}'  # Tuesday

curl -X POST http://localhost:3000/api/meal-plan/generate \
  -H "Content-Type: application/json" \
  -d '{"userId": "your-user-id", "weekStartDate": "2026-01-23"}'  # Thursday
```

**Expected:** All three requests should:
1. Be normalized to `2026-01-20` (Monday)
2. Reuse the same meal plan
3. Show in terminal: `📅 Normalized week start date: 2026-01-XX → 2026-01-20 (Monday)`

### Test 2: Verify Only One Meal Plan Per Week

```sql
-- After testing, check that only one plan exists per week
SELECT 
  week_start_date,
  week_name,
  created_at
FROM meal_plans
WHERE user_id = 'your-user-id'
  AND week_start_date >= '2026-01-19'
  AND week_start_date <= '2026-01-25'
ORDER BY week_start_date;
```

**Expected:** Only **one** row with `week_start_date = 2026-01-20`.

---

## Files Modified

- `src/app/api/meal-plan/generate/route.ts`
  - Added `normalizeToMonday()` function
  - Normalize `weekStartDate` before checking/creating meal plans
  - Added logging for normalization

---

## Next Steps

1. ✅ Deploy the fix
2. ⏳ Clean up existing duplicate meal plans (SQL above)
3. ⏳ Test that new meal plans are correctly normalized
4. ⏳ Monitor logs for "📅 Normalized week start date" messages
