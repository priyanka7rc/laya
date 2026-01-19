# Relish Setup Guide

## Environment Variables

Add these to your `.env.local` file:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini

# AI Usage Tracking & Limits
AI_USAGE_TRACKING_ENABLED=true
TOKEN_LIMIT_PER_USER=100000
```

## Cost Safeguards

Relish includes multiple layers of cost protection:

### 1. Rate Limiting
- **Limit**: 10 AI calls per hour per user
- **Scope**: Meal plan generation + dish compilation
- **Error**: Returns 429 with user-friendly message
- **Reset**: Hourly (automatic)

### 2. Token Limits
- **Limit**: 100,000 tokens per month per user (configurable via `TOKEN_LIMIT_PER_USER`)
- **Tracking**: Counts both input + output tokens
- **Warning**: Logs warning at 80% usage
- **Error**: Returns 429 when exceeded

### 3. AI Usage Logging
All AI calls are logged to `ai_usage_logs` table with:
- User ID
- Feature (plan_generation, dish_compilation, etc.)
- Model used
- Tokens in/out
- Latency
- Cache hit status

### 4. Smart Caching
- **Recipe Variants**: Compiled dishes are saved globally by default
- **Benefit**: Once a dish is compiled, it's reused for all users
- **Result**: AI only called once per unique dish

## Database Setup

1. Run migrations in order:
```bash
# Main Relish schema
supabase/migrations/20250116000000_relish_mvp.sql

# Plate model (multi-dish meals)
supabase/migrations/20250116100000_meal_plates.sql
```

2. Load seed data:
```bash
supabase/seed/relish_seed.sql
```

This seeds:
- 25 dishes (North Indian classics)
- 132 ingredient_master entries with synonyms
- Essential enums

## Features Implemented (Day 1 Morning)

✅ **Dish Compiler** (`src/lib/dishCompiler.ts`)
   - Check cache first (recipe_variants)
   - AI compile if not found
   - Normalize ingredients deterministically
   - Save to recipe_variants (global by default)

✅ **Ingredient Normalizer** (`src/lib/ingredientNormalizer.ts`)
   - Deterministic mapping using ingredient_master
   - UK/US/Indian synonym support
   - No fuzzy matching (exact lookups only)

✅ **Rate Limiter** (`src/lib/rateLimiter.ts`)
   - 10 calls/hour per user
   - In-memory tracking
   - User-friendly error messages

✅ **Token Limits** (`src/lib/tokenLimits.ts`)
   - Monthly token tracking
   - Automatic usage logging
   - 80% warning threshold

✅ **Updated Meal Plan Generation API**
   - Checks rate limits before AI call
   - Checks token limits before AI call
   - Auto-compiles dishes without recipe_variants
   - Only fills empty slots (preserves user choices)

✅ **Frontend Error Handling**
   - Special UI for rate limit errors (429)
   - User-friendly messages
   - Graceful degradation

## Testing Checklist

### Rate Limiting Test
1. Generate meal plan 10 times rapidly
2. On 11th try, should see: "Rate limit exceeded. Try again in X minutes."
3. Wait 1 hour (or reset via admin)
4. Should work again

### Token Limit Test
1. Set `TOKEN_LIMIT_PER_USER=1000` (low for testing)
2. Generate a few meal plans
3. Should see: "Monthly token limit exceeded"
4. Check `ai_usage_logs` table to verify tracking

### Dish Compilation Test
1. Generate meal plan with empty week
2. Check console logs: "Compiling X dishes without recipes..."
3. Verify dishes appear in `recipe_variants` table
4. Generate plan again - should be instant (cache hit)

### Ingredient Normalization Test
1. Check compiled recipes in `recipe_variants`
2. Ingredients should use canonical names from `ingredient_master`
3. Example: "haldi" → "turmeric powder"
4. Verify `ingredient_id` is populated for matched ingredients

## Next Steps (Day 1 Afternoon)

- [ ] Dish details page (show ingredients + steps)
- [ ] Grocery list testing (verify all ingredients aggregate correctly)
- [ ] Polish error states
- [ ] Add loading skeletons

## Architecture Decisions

### Why Global Recipe Variants?
Compiled dishes are saved as global by default (scope_user_id = null) so:
- One user's AI cost benefits all users
- 25 dishes × ~$0.002/dish = $0.05 total (one-time)
- Future compilations are instant (cache hits)

### Why No Fuzzy Matching?
Fuzzy matching is:
- Non-deterministic (same input → different outputs)
- Hard to debug
- Prone to false positives

Instead:
- Use exact synonym mapping (deterministic)
- Log unmatched ingredients for review
- Expand ingredient_master based on real data

### Why In-Memory Rate Limiting?
For MVP simplicity. Production upgrade:
- Move to Redis for multi-instance support
- Add more granular limits (per-feature)
- Admin override capabilities

