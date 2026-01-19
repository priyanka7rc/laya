# Grocery List Generator V2 - Major Refactor

## 🎯 Goals
1. **Speed**: 95% of ingredients normalized instantly with rules (< 1s)
2. **Accuracy**: Deterministic conversions, smart synonym mapping  
3. **Learning**: Permanent knowledge base that improves over time
4. **Visibility**: Comprehensive logging of what's happening

## 🏗️ Architecture

### **Three-Tier Normalization:**
```
Raw Ingredient
    ↓
[1] Rule-Based Normalizer (95% - instant)
    ↓ (if fails)
[2] Knowledge Base Lookup (learned patterns from AI)
    ↓ (if fails)
[3] AI Fallback (5% - ~3-5s for batch)
    ↓
Save to Knowledge Base
    ↓
Apply Synonym Mapping
    ↓
Aggregate & Add Smart Notes
    ↓
Final Grocery List
```

### **Two-Table Caching:**
- `normalized_recipe_ingredients` - Recipe-level cache (clearable)
- `ingredient_normalization_rules` - Ingredient-level knowledge base (permanent)

## 📊 Expected Performance

**First Run (empty caches):**
- Rules: 570/600 (95%)
- AI: 30/600 (5%)
- Time: ~5s

**Second Run (populated knowledge base):**
- Rules: 570/600 (95%)
- Knowledge base hits: 30/30 (100%)
- AI: 0/600 (0%)
- Time: < 1s

## 🔧 Implementation Status

- ✅ Database migrations created
- 🔄 Implementing hybrid normalizer...
- ⏳ Smart notes generator
- ⏳ Comprehensive logging
- ⏳ Meal plan improvements

## 📝 Files Modified

1. `supabase/migrations/20251229000001_ingredient_knowledge_base.sql`
2. `supabase/migrations/20251229000002_dish_tracking_fields.sql`
3. `src/lib/groceryListGenerator.ts` (major refactor)
4. `src/app/api/meal-plan/generate/route.ts` (prefer existing dishes)



