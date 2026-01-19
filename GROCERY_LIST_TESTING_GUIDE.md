# Grocery List Generator - Testing Guide

## 🎯 What Was Fixed

### Critical Architecture (Fixes 1-6)
- ✅ **Two-phase pipeline**: LLM normalization → deterministic aggregation
- ✅ **Fail-fast**: No silent data corruption
- ✅ **Chunk validation**: Strict index checking
- ✅ **Deterministic units**: Hardcoded liquid classification
- ✅ **Minimal synonyms**: Only essential mappings
- ✅ **Zod validation**: Strict schema enforcement

### Refinement Fixes (Fixes 7-9)
- ✅ **Meal slot ordering**: breakfast → lunch → dinner (deterministic)
- ✅ **Servings multiplier**: Respects user-specified servings
- ✅ **System fingerprint logging**: Debug non-determinism

---

## 🧪 Test Plan

### Test 1: Basic Correctness
**Goal:** Verify no duplicates, correct quantities, all items present

1. Clear this week's grocery list:
```sql
DELETE FROM grocery_list_items 
WHERE grocery_list_id IN (
  SELECT id FROM grocery_lists 
  WHERE meal_plan_id IN (
    SELECT id FROM meal_plans 
    WHERE user_id = '<YOUR_USER_ID>'
    AND week_start_date = '<THIS_MONDAY>'
  )
);

DELETE FROM grocery_lists 
WHERE meal_plan_id IN (
  SELECT id FROM meal_plans 
  WHERE user_id = '<YOUR_USER_ID>'
  AND week_start_date = '<THIS_MONDAY>'
);
```

2. Generate a full week's meal plan
3. Go to Grocery List page
4. Click "🔄 Regenerate"

**✅ Expected Results:**
- Each ingredient appears **once** (no "water" twice, "onion" twice, etc.)
- Quantities are **realistic** (not 1kg onions when you need 3kg)
- All dishes' ingredients are present (check a few dishes manually)

---

### Test 2: Determinism
**Goal:** Same meal plan → same grocery list every time

1. Note down the current grocery list (copy to clipboard or screenshot)
2. Click "🔄 Regenerate" again
3. Compare the new list to the old one

**✅ Expected Results:**
- **Identical output** (same items, same quantities, same order)
- No random variations between regenerations

---

### Test 3: Servings Multiplier
**Goal:** Verify quantities scale with servings

**Setup:**
1. Find a recipe with known quantities (e.g., "200g chicken, 2 onions")
2. Note its default servings (e.g., 2 servings)

**Test A: Default Servings**
1. Add dish to meal plan (uses default servings)
2. Regenerate grocery list
3. Check quantities match recipe defaults

**Test B: Double Servings**
1. Update the meal plan component to 4 servings (if UI supports it)
2. Regenerate grocery list
3. **✅ Expected:** Quantities should double (400g chicken, 4 onions)

**Test C: Half Servings**
1. Update to 1 serving
2. Regenerate
3. **✅ Expected:** Quantities should halve (100g chicken, 1 onion)

---

### Test 4: Debug Mode
**Goal:** Verify debug logging works

1. Set environment variable:
```bash
export DEBUG_GROCERY=1
```

2. Restart dev server:
```bash
npm run dev
```

3. Regenerate grocery list
4. Check terminal logs

**✅ Expected Logs:**
```
📊 Collected X raw lines (deterministic order)
🤖 Phase 1: Normalizing X lines...
  [Chunk 0] fingerprint: fp_xxxxx
  [Chunk 60] fingerprint: fp_xxxxx

=== DEBUG: Top 10 Ingredients by Line Count ===
  onion: 12 lines
  tomato: 10 lines
  ...
=============================================

✅ Normalized X lines
🔢 Phase 2: Aggregating...

=== DEBUG: Top 10 by Total Grams (before rounding) ===
  water: 4500ml
  onion: 1200g
  ...
====================================================

✅ Aggregated to Y items
✅ Grocery list: Y items
```

---

### Test 5: Large Meal Plan
**Goal:** Stress test with maximum complexity

1. Generate a **full week** (21 meals)
2. Use dishes with **many ingredients** (10+ each)
3. Include **variety** (breakfast, lunch, dinner all different)
4. Regenerate grocery list

**✅ Expected Results:**
- No crashes or timeouts
- No "Normalization failed" errors
- Reasonable quantities (not 50kg of anything)
- Under 2 minutes total time

---

## 🐛 Known Issues to Watch For

### ❌ If you see duplicates:
```
onion 1kg
onion 500g
```
**Diagnosis:** LLM normalized same ingredient to different names
**Check:** `DEBUG_GROCERY=1` logs → look at normalized canonical_names
**Fix:** Add synonym to prompt or `forceMetricUnit()` allowlist

### ❌ If quantities seem wrong:
```
onion 100g (but 7 dishes use onions!)
```
**Diagnosis:** 
- Check if servings multiplier is working (Test 3)
- Check if ingredients are being dropped (look for "CRITICAL" errors)
- Verify `DEBUG_GROCERY=1` shows correct line counts

### ❌ If output varies each time:
```
Run 1: onion 1.2kg
Run 2: onion 1.3kg
```
**Diagnosis:**
- Minor variations (±10%) are OK due to rounding
- Large variations indicate ordering problem
- Check `system_fingerprint` in debug logs (should be consistent)

### ❌ If LLM normalization fails:
```
❌ Normalization chunk failed (fail-fast)
```
**Diagnosis:** OpenAI API issue or malformed ingredients
**Fix:** Check error details, verify OpenAI API key, check raw ingredient data

---

## 📊 Success Metrics

After testing, you should see:

| Metric | Before Fixes | After Fixes |
|--------|-------------|-------------|
| Duplicates per list | 5-10 | 0 |
| Undercounting severity | 50-70% missing | 0% missing |
| Determinism | Random each time | 100% identical |
| Servings accuracy | Ignored | Correct scaling |
| Processing time | 30-60s | 20-40s |
| Crashes/errors | Frequent | None (fail-fast only) |

---

## 🚀 Production Readiness Checklist

- [ ] Test 1: Basic Correctness ✅
- [ ] Test 2: Determinism ✅
- [ ] Test 3: Servings Multiplier ✅
- [ ] Test 4: Debug Mode works ✅
- [ ] Test 5: Large Meal Plan (21 meals) ✅
- [ ] No duplicates observed
- [ ] No severe undercounting
- [ ] Regeneration is deterministic
- [ ] Debug logs show correct counts
- [ ] Ready for production deployment 🚢

---

## 💡 Tips

1. **Always use DEBUG_GROCERY=1** during initial testing
2. **Compare to manual calculations** for 1-2 dishes to verify quantities
3. **Test edge cases**: dishes with no recipe, very large servings (20+), tiny servings (0.5)
4. **Monitor OpenAI costs**: Each regeneration = ~1-3 API calls depending on meal plan size
5. **Keep an eye on `system_fingerprint`**: If it changes frequently, that's a red flag

---

**Questions?** Check `GROCERY_LIST_REFACTOR_FIXES.md` for detailed explanations of each fix.

