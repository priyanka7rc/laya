# 🔤 SYNONYM MAPPING UPDATE - December 29, 2025

## 📋 Summary

Implemented **code-based synonym mapping** to handle ingredient variations deterministically, eliminating AI's inconsistency in merging similar ingredients.

---

## 🎯 What Changed

### 1. **New Synonym Map (80+ mappings)**

Added comprehensive `SYNONYM_MAP` covering:

- **Spices**: `cumin seeds/cumin powder → cumin`, `turmeric powder → turmeric`, `coriander seeds/powder → coriander`
- **Herbs**: `cilantro/fresh coriander → coriander leaves`, `curry leaf → curry leaves`
- **Flours**: `flour/maida → all-purpose flour`, `atta → whole wheat flour`, `besan → chickpea flour`
- **Vegetables**: `onions → onion`, `tomatoes → tomato`, `potatoes → potato`, `green chilies → green chili`
- **Dairy**: `curd/dahi → yogurt`, `fresh cream/heavy cream → cream`
- **Lentils**: `toovar dal/arhar dal → toor dal`, `mung dal → moong dal`, `rajma → kidney beans`, etc.
- **Rice**: `basmati rice`, `white rice/plain rice → rice`
- **Oils**: `cooking oil/vegetable oil → oil`, `mustard oil` (kept distinct), `ghee/clarified butter → ghee`
- **Peppers**: `capsicum/shimla mirch → bell pepper`
- **Common**: `ginger garlic paste → ginger-garlic paste`, `scallions/green onions → spring onion`

### 2. **New `applySynonymMapping()` Function**

```typescript
function applySynonymMapping(lines: NormalizedLine[]): NormalizedLine[]
```

- Runs **after AI normalization**, **before aggregation**
- Applies deterministic mapping to canonical names
- Logs unknown ingredients for potential future mapping
- Zero AI calls = instant execution

### 3. **Updated AI Prompt**

**BEFORE** (AI did synonym merging):
```
"cilantro" / "fresh coriander" / "coriander leaves" → "coriander leaves"
```

**AFTER** (AI only converts metric, keeps names as-is):
```
DO NOT merge synonyms (we handle that in code later)
Keep everything else as-is: "cumin seeds", "cumin powder" are different
```

### 4. **New Processing Pipeline**

```
Raw Ingredients
    ↓
🤖 AI Normalization (metric conversion only)
    ↓
🔤 Synonym Mapping (code-based, deterministic)
    ↓
🔢 Aggregation (group + sum)
    ↓
Final Grocery List
```

---

## ✅ Benefits

| Before | After |
|--------|-------|
| AI inconsistently merges synonyms | Deterministic code-based merging |
| "cumin" and "cumin seeds" separate | Merged to "cumin" |
| "turmeric" and "turmeric powder" separate | Merged to "turmeric" |
| "flour" ambiguous | Maps to "all-purpose flour" |
| "cilantro" sometimes different from "coriander leaves" | Always merged |
| AI must re-learn on cache clear | Synonym map persists |
| No visibility into merging logic | Logs unknown ingredients |

---

## 🧪 Testing Instructions

### Step 1: Clear the cache (REQUIRED)

Run in Supabase SQL Editor:
```sql
TRUNCATE TABLE normalized_recipe_ingredients;
```

Or use the helper script: `CLEAR_CACHE.sql`

### Step 2: Regenerate grocery list

1. Go to http://localhost:3000/grocery
2. Click "Regenerate"
3. Wait ~60 seconds (first time after cache clear)

### Step 3: Check the terminal logs

Look for:
```
🔤 SYNONYM MAPPING (Code-based)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Applying deterministic synonym map to 623 ingredients...

ℹ️  Ingredients not in synonym map (15):
   - "asafoetida"
   - "drumsticks"
   - "kadai masala"
   ... and 12 more
   💡 Consider adding these to SYNONYM_MAP if they need merging

   ✅ Synonym Mapping Complete in 0.0s
```

### Step 4: Verify output

Check that the grocery list:
- ✅ Has NO duplicates like "cumin" + "cumin seeds"
- ✅ Has NO duplicates like "turmeric" + "turmeric powder"
- ✅ Shows "all-purpose flour" instead of "flour"
- ✅ Shows "coriander leaves" (not "cilantro" separately)
- ✅ Shows merged quantities (e.g., 45g cumin, not 20g + 25g separately)

---

## 📊 Expected Performance

- **First regeneration** (after cache clear): ~60 seconds
- **Synonym mapping**: <0.1 seconds (instant)
- **Second regeneration** (cache hit): 2-3 seconds

---

## 🔍 Debugging New Ingredients

When you see unknown ingredients in logs:

```
ℹ️  Ingredients not in synonym map (3):
   - "kasuri methi"
   - "amchur"
   - "hing"
```

**Option 1: Leave as-is** (if they're distinct ingredients)

**Option 2: Add to synonym map** (if they need merging):

```typescript
// In SYNONYM_MAP:
'kasuri methi': 'fenugreek leaves',
'amchur': 'dried mango powder',
'hing': 'asafoetida',
```

**Option 3: Use AI for confirmation** (future enhancement):
- Send unknown ingredients to AI for synonym suggestions
- Add suggested mappings to the map
- Re-run normalization

---

## 🚨 Important Notes

1. **Cache must be cleared** after changing the synonym map
2. **Synonym map is permanent** (survives cache clears)
3. **Zero AI calls** for synonym mapping = instant + deterministic
4. **No fallback to AI** = consistent results every time
5. **Extensible** = easy to add new mappings as needed

---

## 📝 Files Modified

- ✅ `src/lib/groceryListGenerator.ts` - Added synonym map, `applySynonymMapping()`, updated prompt
- ✅ `CLEAR_CACHE.sql` - Helper script to clear cache
- ✅ `SYNONYM_MAPPING_UPDATE.md` - This document

---

## 🎯 Next Steps (Optional Future Enhancements)

1. **AI-assisted synonym discovery**:
   - Send unknown ingredients to AI: "Are these the same: 'kasuri methi' vs 'fenugreek leaves'?"
   - Auto-generate new synonym map entries
   - Save to database for reuse

2. **User-customizable synonym map**:
   - Let users define their own merging preferences
   - Store in user profile or settings table

3. **Smart ingredient suggestions**:
   - When AI finds a new ingredient, suggest similar known ingredients
   - Ask user: "Should we merge 'hing' with 'asafoetida'?"

---

## ✅ READY TO TEST!

Run the cache clear query, then test grocery list regeneration.

Expected result: **Accurate, deterministic, duplicate-free grocery lists**. 🎉

