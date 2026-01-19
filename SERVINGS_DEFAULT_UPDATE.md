# Default Serving Size Configuration

## 📊 Overview

All meal plans now default to **4 servings** per dish, which automatically scales ingredient quantities in the grocery list.

---

## 🔧 Implementation

### 1. Meal Plan Generation
**File:** `src/app/api/meal-plan/generate/route.ts`

When creating meal plan components, the servings field is now explicitly set:

```typescript
components.push({
  meal_plate_id: plateId,
  component_type: comp.component_type || ComponentType.OTHER,
  dish_name: comp.dish_name,
  dish_id: matchedDishId || null,
  sort_order: idx,
  is_optional: comp.is_optional || false,
  servings: 4, // Default serving size for household
});
```

### 2. Grocery List Generator
**File:** `src/lib/groceryListGenerator.ts`

Fallback logic updated to default to 4 servings if component servings is NULL:

```typescript
// Calculate serving multiplier
const componentServings = comp.servings || recipe.servings_default || 4;
const recipeDefaultServings = recipe.servings_default || 2;
const multiplier = componentServings / recipeDefaultServings;
```

---

## 📈 Impact on Grocery Lists

### Before (servings = NULL, defaulted to 2):
```
Recipe: "Chicken Curry" (2 servings)
  - 200g chicken
  - 2 onions (200g)
  - 1 cup rice (200g)

Multiplier: 2 / 2 = 1.0 (no scaling)

Grocery List:
  - chicken: 200g
  - onion: 200g
  - rice: 200g
```

### After (servings = 4):
```
Recipe: "Chicken Curry" (2 servings)
  - 200g chicken
  - 2 onions (200g)
  - 1 cup rice (200g)

Multiplier: 4 / 2 = 2.0 (double)

Grocery List:
  - chicken: 400g ✅
  - onion: 400g ✅
  - rice: 400g ✅
```

---

## 🎯 Use Cases

### Standard Household (4 people)
- **1 meal per day:** 4 servings = 1 per person ✅
- **Meal prep:** 4 servings spread across lunch + dinner
- **Leftovers:** 4 servings for dinner + next day's lunch

### Different Household Sizes

#### 2 people:
- Set `servings: 2` when creating components
- Multiplier: 2/2 = 1.0 (recipe quantities)

#### 6 people:
- Set `servings: 6` when creating components
- Multiplier: 6/2 = 3.0 (triple recipe quantities)

---

## 🔄 Existing Meal Plans

**Important:** This change only affects **NEW** meal plans generated after this update.

### For Existing Meal Plans:
Existing components will have `servings = NULL`, which will:
1. Fall back to `recipe.servings_default` (usually 2)
2. Result in multiplier = 2/2 = 1.0 (no scaling)

### To Update Existing Meal Plans:
```sql
-- Set all existing NULL servings to 4
UPDATE meal_plate_components
SET servings = 4
WHERE servings IS NULL;
```

---

## 🚀 Future Enhancements

### Option A: User Profile Based
```typescript
// Fetch user's household size from profile
const { data: profile } = await supabase
  .from('profiles')
  .select('household_size')
  .eq('id', userId)
  .single();

// Use it when creating components
servings: profile?.household_size || 4,
```

### Option B: Per-Meal UI Controls
Add a servings selector in the meal plan UI:
```tsx
<select 
  value={component.servings} 
  onChange={(e) => updateServings(component.id, e.target.value)}
>
  <option value="1">1 serving</option>
  <option value="2">2 servings</option>
  <option value="4">4 servings</option>
  <option value="6">6 servings</option>
  <option value="8">8 servings</option>
</select>
```

### Option C: Meal Type Defaults
Different defaults based on meal type:
```typescript
const servingsByMealType = {
  breakfast: 2,  // Lighter meal, fewer servings
  lunch: 4,      // Standard meal
  dinner: 4,     // Standard meal
};

servings: servingsByMealType[mealSlot] || 4,
```

---

## 📊 Database Schema

### meal_plate_components table:
```sql
CREATE TABLE meal_plate_components (
  id UUID PRIMARY KEY,
  meal_plate_id UUID REFERENCES meal_plates(id),
  dish_id UUID REFERENCES dishes(id),
  dish_name TEXT NOT NULL,
  servings INT,  -- User-specified servings (now defaults to 4)
  -- ... other fields
);
```

### recipe_variants table:
```sql
CREATE TABLE recipe_variants (
  id UUID PRIMARY KEY,
  dish_id UUID REFERENCES dishes(id),
  servings_default INT DEFAULT 2,  -- Recipe's base serving size
  ingredients_json JSONB NOT NULL,
  -- ... other fields
);
```

---

## ✅ Testing Checklist

- [ ] Generate a NEW meal plan
- [ ] Verify `servings = 4` in database:
  ```sql
  SELECT dish_name, servings 
  FROM meal_plate_components 
  WHERE meal_plate_id IN (
    SELECT id FROM meal_plates 
    WHERE meal_plan_item_id IN (
      SELECT id FROM meal_plan_items 
      WHERE meal_plan_id = '<NEW_PLAN_ID>'
    )
  );
  ```
- [ ] Regenerate grocery list
- [ ] Verify quantities are doubled (4 servings / 2 default = 2x)
- [ ] Check a sample dish:
  - Look up recipe ingredients
  - Multiply by 2
  - Compare to grocery list quantities

---

## 🐛 Troubleshooting

### Grocery list quantities seem wrong:
1. Check `meal_plate_components.servings` → should be 4
2. Check `recipe_variants.servings_default` → usually 2
3. Calculate expected multiplier: 4/2 = 2.0
4. Verify grocery quantities = recipe_qty × 2

### Old meal plans have wrong quantities:
- Old plans have `servings = NULL`
- They fall back to recipe defaults (no scaling)
- Run the UPDATE query above to fix them

### Want different defaults:
- Change the hardcoded `4` in `route.ts`
- Or implement profile-based logic (see Future Enhancements)

---

**Last Updated:** December 23, 2024  
**Default Servings:** 4  
**Status:** ✅ Active

