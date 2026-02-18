# 🔄 Restoring Meal Plan & Grocery Features

**Date Disabled:** February 16, 2026  
**Reason:** Task-only MVP deployment to bypass build errors in meal/grocery code  
**Status:** All code preserved, just renamed to disable

---

## 📁 What Was Disabled

The following directories were renamed with `_disabled_` prefix to exclude them from the Next.js build:

### API Routes:
- `src/app/api/_disabled_meal-plan/` (was `meal-plan`)
- `src/app/api/_disabled_grocery-list/` (was `grocery-list`)

### Pages:
- `src/app/_disabled_mealplan/` (was `mealplan`)
- `src/app/_disabled_grocery/` (was `grocery`)
- `src/app/_disabled_dish/` (was `dish`)
- `src/app/(tabs)/_disabled_meals/` (was `meals`)

### Library Files (excluded in tsconfig.json):
- `src/lib/groceryListGenerator.ts`
- `src/lib/mealPlanGenerator.ts`
- `src/lib/mealComposer.ts`
- `src/lib/dishCompiler.ts`
- `src/lib/ingredientNormalizer.ts`
- `src/lib/mealPlanPolicy.ts`
- `src/lib/mealPlanAiContract.ts`
- `src/config/meal-composition.ts`

### UI Components (commented out):
- Meal plan widget in `src/app/(tabs)/home/page.tsx`
- Meals navigation tab in `src/components/BottomNavigation.tsx` (already commented)

---

## ✅ How to Restore (Step-by-Step)

### Option 1: Restore Everything (Full Feature Set)

Run these commands from the project root:

```bash
# 1. Restore API routes
mv src/app/api/_disabled_meal-plan src/app/api/meal-plan
mv src/app/api/_disabled_grocery-list src/app/api/grocery-list

# 2. Restore pages
mv src/app/_disabled_mealplan src/app/mealplan
mv src/app/_disabled_grocery src/app/grocery
mv src/app/_disabled_dish src/app/dish
mv src/app/\(tabs\)/_disabled_meals src/app/\(tabs\)/meals

# 3. Update tsconfig.json - remove the lib excludes from "exclude" array:
#    Remove these lines from tsconfig.json:
#    - "src/lib/groceryListGenerator.ts"
#    - "src/lib/mealPlanGenerator.ts"
#    - "src/lib/mealComposer.ts"
#    - "src/lib/dishCompiler.ts"
#    - "src/lib/ingredientNormalizer.ts"
#    - "src/lib/mealPlanPolicy.ts"
#    - "src/lib/mealPlanAiContract.ts"
#    - "src/config/meal-composition.ts"

# 4. Uncomment meal plan widget in src/app/(tabs)/home/page.tsx
#    Look for "DISABLED FOR TASK-ONLY MVP" comments

# 5. Uncomment Meals tab in src/components/BottomNavigation.tsx
#    Look for the commented out Meals nav item

# 6. Test the build
npm run build
```

### Option 2: Restore Gradually (One Feature at a Time)

**Just Meal Plans:**
```bash
mv src/app/api/_disabled_meal-plan src/app/api/meal-plan
mv src/app/_disabled_mealplan src/app/mealplan
# Then remove meal plan libs from tsconfig exclude
```

**Just Recipes:**
```bash
mv src/app/_disabled_dish src/app/dish
mv src/app/\(tabs\)/_disabled_meals src/app/\(tabs\)/meals
```

**Just Grocery Lists:**
```bash
mv src/app/api/_disabled_grocery-list src/app/api/grocery-list
mv src/app/_disabled_grocery src/app/grocery
# Then remove grocery libs from tsconfig exclude
```

---

## 🐛 Known Issues to Fix Before Re-enabling

When restoring, you'll need to fix these TypeScript errors:

1. **Special Characters in Strings:**
   - Em dashes (—) and curly quotes (') cause Turbopack parsing errors
   - All instances in user-facing strings have been fixed
   - Run: `grep -r "—\|didn't" src/` to verify

2. **Type Errors in meal-plan/generate/route.ts:**
   - Line 427: `excludeDishes` type inference
   - Line 599: Missing Dish type fields
   - Line 1013: `weight_band` property access

3. **Type Error in meals/page.tsx:**
   - Line 172: `IngredientJSON` expects non-null qty
   - Filter out ingredients without quantities

4. **Test Script Issues:**
   - `scripts/test-grocery-aggregation.ts` has type errors
   - Already excluded in tsconfig.json

---

## 📊 What Still Works (Task-Only MVP)

✅ Task management (full CRUD)  
✅ Brain dump with AI parsing  
✅ WhatsApp integration  
✅ Activity feed  
✅ Home dashboard (tasks only)  
✅ Dark/light theme  
✅ Authentication  

---

## 🚀 Testing After Restoration

```bash
# 1. Clear build cache
rm -rf .next

# 2. Run build
npm run build

# 3. Test locally
npm run dev

# 4. Deploy to Vercel
git add .
git commit -m "feat: Re-enable meal plan and grocery features"
git push origin main
```

---

## 💾 Git History Reference

To see what was changed for the task-only MVP:
```bash
git log --oneline --grep="Task-only MVP"
```

To see the exact changes:
```bash
git show [commit-hash]
```

---

## 📞 Support

If you encounter issues restoring:
1. Check this document was followed step-by-step
2. Run `npm run build` to see specific TypeScript errors
3. Refer to the "Known Issues" section above
4. All code is preserved - nothing was deleted!

---

**Remember:** This is a reversible change. All your meal plan and grocery code is safe! 🎉
