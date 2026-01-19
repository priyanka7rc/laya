/**
 * Dish Compiler - On-Demand Recipe Compilation
 * 
 * When a dish appears in a meal plan:
 * 1. Check cache (recipe_variants)
 * 2. If not found → AI compile
 * 3. Normalize ingredients deterministically
 * 4. Save to recipe_variants + ai_cache
 * 5. Return structured ingredients_json
 */

import OpenAI from 'openai';
import { supabase, supabaseAdmin } from './supabaseClient';
import { normalizeIngredientName } from './ingredientNormalizer';
import { logAIUsage } from './tokenLimits';
import { RecipeSourceType, type IngredientJSON, type StepJSON } from '@/types/relish';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DISH_COMPILATION_PROMPT = `You are a recipe compilation assistant specializing in Indian home-style cuisine.

Given a dish name, generate a structured recipe with ingredients and optional steps.

Return ONLY valid JSON matching this structure:
{
  "ingredients": [
    { "name": "onion", "qty": 2, "unit": "medium" },
    { "name": "turmeric powder", "qty": 0.5, "unit": "teaspoon" }
  ],
  "steps": [
    { "step_no": 1, "body": "Heat oil in a pan" },
    { "step_no": 2, "body": "Add onions and sauté" }
  ],
  "servings": 4,
  "prep_time_min": 15,
  "cook_time_min": 20,
  "description": "A classic North Indian curry"
}

Requirements:
- Use common, canonical ingredient names (lowercase)
- Realistic quantities for home cooking (2-4 servings)
- Simple, clear steps (4-8 steps typical)
- Include prep and cook times
- Brief description (1 sentence)

Important:
- Ingredients must be practical (available in Indian markets)
- Quantities must be reasonable (not "0.001 tsp")
- Use standard units (cup, teaspoon, tablespoon, gram, piece, medium, small, large)
`;

interface CompilationResult {
  recipe_variant_id: string;
  ingredients_json: IngredientJSON[];
  steps_json: StepJSON[];
  cached: boolean;
}

/**
 * Check if dish already has a compiled recipe variant
 */
async function checkCache(dishId: string, scopeUserId?: string): Promise<CompilationResult | null> {
  try {
    // Try user-specific variant first, then global
    const { data, error } = await supabase
      .from('recipe_variants')
      .select('id, ingredients_json, steps_json')
      .eq('dish_id', dishId)
      .or(scopeUserId ? `scope_user_id.eq.${scopeUserId},scope_user_id.is.null` : 'scope_user_id.is.null')
      .order('scope_user_id', { ascending: false }) // User-specific first
      .limit(1)
      .single();

    if (error || !data) {
      return null;
    }

    console.log(`✅ Cache hit for dish ${dishId}`);
    
    return {
      recipe_variant_id: data.id,
      ingredients_json: data.ingredients_json as IngredientJSON[],
      steps_json: data.steps_json as StepJSON[],
      cached: true,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Compile a dish using AI
 */
async function compileWithAI(
  dishName: string,
  userId: string
): Promise<{
  ingredients_json: IngredientJSON[];
  steps_json: StepJSON[];
  servings: number;
  prep_time_min: number;
  cook_time_min: number;
  description: string;
}> {
  const startTime = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: DISH_COMPILATION_PROMPT },
        { role: 'user', content: `Compile recipe for: ${dishName}` }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3, // Low temperature for consistency
      max_tokens: 1500,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No content in AI response');
    }

    const parsed = JSON.parse(content);

    // Validate structure
    if (!parsed.ingredients || !Array.isArray(parsed.ingredients)) {
      throw new Error('Invalid ingredients structure');
    }

    // Normalize ingredient names
    const normalizedIngredients: IngredientJSON[] = await Promise.all(
      parsed.ingredients.map(async (ing: any) => {
        const normalized = await normalizeIngredientName(ing.name);
        return {
          name: normalized.canonical_name,
          qty: ing.qty || null,
          unit: ing.unit || null,
          ingredient_id: normalized.ingredient_id,
        };
      })
    );

    const latencyMs = Date.now() - startTime;

    // Log usage
    await logAIUsage({
      userId,
      feature: 'dish_compilation',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      tokensIn: response.usage?.prompt_tokens || 0,
      tokensOut: response.usage?.completion_tokens || 0,
      latencyMs,
      cacheHit: false,
    });

    console.log(`✅ Compiled dish "${dishName}": ${normalizedIngredients.length} ingredients, ${latencyMs}ms`);

    return {
      ingredients_json: normalizedIngredients,
      steps_json: parsed.steps || [],
      servings: parsed.servings || 4,
      prep_time_min: parsed.prep_time_min || null,
      cook_time_min: parsed.cook_time_min || null,
      description: parsed.description || '',
    };
  } catch (error) {
    console.error(`Error compiling dish "${dishName}":`, error);
    throw error;
  }
}

/**
 * Main function: Compile a dish (with caching)
 * 
 * @param dishId - UUID of the dish
 * @param dishName - Name of the dish (for AI compilation if needed)
 * @param userId - User requesting compilation
 * @param saveAsGlobal - If true, saves as global variant (benefits all users)
 */
export async function compileDish(
  dishId: string,
  dishName: string,
  userId: string,
  saveAsGlobal = true
): Promise<CompilationResult> {
  // 1. Check cache first
  const cached = await checkCache(dishId, userId);
  if (cached) {
    return cached;
  }

  console.log(`🔄 Compiling dish "${dishName}" for first time...`);

  // 2. Compile with AI
  const compiled = await compileWithAI(dishName, userId);

  // 3. Save to recipe_variants (cache for future)
  // Use admin client for global variants (bypasses RLS), regular client for user-specific
  const client = (saveAsGlobal && supabaseAdmin) ? supabaseAdmin : supabase;
  
  if (saveAsGlobal && !supabaseAdmin) {
    console.warn('⚠️  No service role key - saving as user-specific variant instead');
  }
  
  const { data: newVariant, error } = await client
    .from('recipe_variants')
    .insert({
      dish_id: dishId,
      scope_user_id: (saveAsGlobal && supabaseAdmin) ? null : userId, // null = global (benefits everyone)
      servings_default: compiled.servings,
      description: compiled.description,
      ingredients_json: compiled.ingredients_json,
      steps_json: compiled.steps_json,
      prep_time_min: compiled.prep_time_min,
      cook_time_min: compiled.cook_time_min,
      source_type: RecipeSourceType.AI,
      validator_score: 0.8, // AI-generated, assume decent quality
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error saving compiled recipe:', error);
    throw error;
  }

  const actualScope = (saveAsGlobal && supabaseAdmin) ? 'global' : 'user-specific';
  console.log(`✅ Saved compiled recipe for "${dishName}" (${actualScope})`);

  return {
    recipe_variant_id: newVariant.id,
    ingredients_json: compiled.ingredients_json,
    steps_json: compiled.steps_json,
    cached: false,
  };
}

/**
 * Compile multiple dishes in batch (with rate limiting awareness)
 */
export async function compileDishes(
  dishes: Array<{ id: string; name: string }>,
  userId: string,
  saveAsGlobal = true
): Promise<Map<string, CompilationResult>> {
  const results = new Map<string, CompilationResult>();

  for (const dish of dishes) {
    try {
      const result = await compileDish(dish.id, dish.name, userId, saveAsGlobal);
      results.set(dish.id, result);
      
      // Small delay between compilations to avoid rate limits
      if (!result.cached) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(`Failed to compile dish ${dish.name}:`, error);
      // Continue with other dishes
    }
  }

  return results;
}

