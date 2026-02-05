import OpenAI from 'openai';
import { supabase } from './supabaseClient';
import { logAIUsage } from './tokenLimits';
import type { WeeklyMealPlanAI, MealComponentAI } from '@/types/relish';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MEAL_PLAN_PROMPT = `GOAL:
Emit structured, homestyle Indian meal plans with complete metadata.
The API emits measurements and structure; the app enforces rules.

GLOBAL REQUIREMENTS:
- Output JSON only.
- No explanations.
- No questions.
- No free text.

EVERY dish MUST include:
- dish_canonical_name (lowercase, snake_case, stable)
- dish_display_name
- structural_universe
- confidence (0.0–1.0)

CANONICAL NAMING RULES:
- One concept = one canonical.
- Collapse variants.
Examples:
  "mix veg", "mixed veg", "mixed vegetables" → mixed_vegetables
  "vegetable lemon rice", "lemon rice" → lemon_rice

ALLOWED structural_universe VALUES:
- rice, roti, dal, dry_veg, gravy_veg, legume_curry,
  paneer_main, egg_main, breakfast_main,
  one_bowl_meal, snack, fruit, condiment, beverage, bread

REQUIRED METADATA PER DISH:
- ingredient_count (int)
- non_pantry_ingredient_count (int)
- fat_intensity: low | medium | high
- effort_level: easy | medium | high
- cooking_method: saute | boil | pressure_cook | shallow_fry | other
- base_masala_type: none | simple_tadka | simple_onion_tomato | complex_paste
- cream_based: true | false
- nut_paste_based: true | false
- frequency_class: daily | weekly | occasional
- blender_required: true | false

MEAL STRUCTURE RULES:

DINNER / LUNCH:
- Must include:
  - carb (rice OR roti OR one_bowl_meal)
  - protein (dal / legume / paneer / egg)
  - veg (dry_veg OR gravy_veg)
  - condiment

BREAKFAST (STRICT):
- Never a single dish.
- Must be main + accompaniment.

Required breakfast pairings:
- idli / dosa / vada → sambar OR coconut_chutney
- upma → coconut_chutney OR curd
- poha → lemon / peanuts / curd
- egg_omelette / egg_bhurji / paneer_bhurji → bread OR roti

SNACKS:
- Single item only.
- No deep fry in weekday mode.

WEEKEND RELAXATION:
- ingredient_count may be higher
- fat_intensity = medium allowed
- frequency_class = weekly/occasional allowed

Still disallowed:
- deep fry
- cream or nut-paste gravies

CONFIDENCE GUIDELINES:
- Obvious homestyle dishes ≥ 0.75
- Ambiguous 0.5–0.75
- Unclear < 0.5

Return ONLY valid JSON matching this exact structure:
{
  "meals": [
    {
      "day": 0,
      "slot": "breakfast",
      "components": [
        {
          "dish_canonical_name": "idli",
          "dish_display_name": "Idli",
          "structural_universe": "breakfast_main",
          "confidence": 0.9,
          "ingredient_count": 6,
          "non_pantry_ingredient_count": 2,
          "fat_intensity": "low",
          "effort_level": "easy",
          "cooking_method": "boil",
          "base_masala_type": "none",
          "cream_based": false,
          "nut_paste_based": false,
          "frequency_class": "daily",
          "blender_required": false
        },
        {
          "dish_canonical_name": "coconut_chutney",
          "dish_display_name": "Coconut chutney",
          "structural_universe": "condiment",
          "confidence": 0.85,
          "ingredient_count": 5,
          "non_pantry_ingredient_count": 2,
          "fat_intensity": "low",
          "effort_level": "easy",
          "cooking_method": "other",
          "base_masala_type": "none",
          "cream_based": false,
          "nut_paste_based": false,
          "frequency_class": "daily",
          "blender_required": true
        }
      ]
    }
  ]
}

Rules:
- day: 0=Monday through 6=Sunday
- slot: MUST be one of: "breakfast", "morning_snack", "lunch", "evening_snack", "dinner"
- Generate plan for all 7 days, 5 meals per day (35 total meals including snacks).`;

/**
 * Generates a weekly meal plan using OpenAI
 */
export async function generateWeeklyMealPlanAI(
  userId: string,
  excludeDishes: string[] = [],
  preferences?: {
    dietary_restrictions?: string[];
    household_size?: number;
    cuisine_preference?: string;
  }
): Promise<WeeklyMealPlanAI> {
  const startTime = Date.now();
  
  try {
    let userPrompt = 'Generate a weekly meal plan.';
    
    if (preferences?.dietary_restrictions) {
      userPrompt += ` Dietary restrictions: ${preferences.dietary_restrictions.join(', ')}.`;
    }
    
    if (excludeDishes && excludeDishes.length > 0) {
      userPrompt += ` IMPORTANT: Do NOT include these dish_canonical_name values: ${excludeDishes.join(', ')}.`;
    }

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: MEAL_PLAN_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7, // Moderate creativity for variety
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    const parsed = JSON.parse(content) as WeeklyMealPlanAI;
    
    // Basic validation
    if (!parsed.meals || !Array.isArray(parsed.meals)) {
      throw new Error('Invalid meal plan structure');
    }

    const allowedUniverses = new Set([
      'rice',
      'roti',
      'dal',
      'dry_veg',
      'gravy_veg',
      'legume_curry',
      'paneer_main',
      'egg_main',
      'breakfast_main',
      'one_bowl_meal',
      'snack',
      'fruit',
      'condiment',
      'beverage',
      'bread',
    ]);

    parsed.meals.forEach(meal => {
      if (!meal.components || !Array.isArray(meal.components)) {
        throw new Error(`Missing components for ${meal.slot} on day ${meal.day}`);
      }
      meal.components.forEach(component => {
        if (!component.dish_canonical_name || !component.dish_display_name) {
          throw new Error(`Missing dish names for ${meal.slot} on day ${meal.day}`);
        }
        if (!component.structural_universe || !allowedUniverses.has(component.structural_universe)) {
          throw new Error(`Invalid structural_universe for ${component.dish_canonical_name}`);
        }
        if (typeof component.confidence !== 'number') {
          throw new Error(`Missing confidence for ${component.dish_canonical_name}`);
        }
      });
    });

    const latencyMs = Date.now() - startTime;

    // Log usage
    const tokensUsed = response.usage?.total_tokens || 0;
    const cost = (tokensUsed * 0.00015 / 1000).toFixed(6);
    
    console.log('✅ Generated meal plan:', {
      meals: parsed.meals.length,
      tokens: tokensUsed,
      cost: `$${cost}`,
      latencyMs,
    });

    // Track AI usage with proper logging
    await logAIUsage({
      userId,
      feature: 'plan_generation',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      tokensIn: response.usage?.prompt_tokens || 0,
      tokensOut: response.usage?.completion_tokens || 0,
      latencyMs,
      cacheHit: false,
    });

    return parsed;
  } catch (error) {
    console.error('Error generating meal plan with AI:', error);
    throw error;
  }
}

/**
 * Fallback: Generate a simple rule-based meal plan
 */
export function generateWeeklyMealPlanRuleBased(): WeeklyMealPlanAI {
  const makeDish = (options: {
    canonical: string;
    display: string;
    universe: string;
    confidence?: number;
  }): MealComponentAI => ({
    dish_canonical_name: options.canonical,
    dish_display_name: options.display,
    structural_universe: options.universe,
    confidence: options.confidence ?? 0.85,
    ingredient_count: 6,
    non_pantry_ingredient_count: 2,
    fat_intensity: 'low',
    effort_level: 'easy',
    cooking_method: 'other',
    base_masala_type: 'none',
    cream_based: false,
    nut_paste_based: false,
    frequency_class: 'daily',
    blender_required: false,
  });

  const breakfastOptions = [
    [makeDish({ canonical: 'poha', display: 'Poha', universe: 'breakfast_main' }), makeDish({ canonical: 'curd', display: 'Curd', universe: 'condiment' })],
    [makeDish({ canonical: 'upma', display: 'Upma', universe: 'breakfast_main' }), makeDish({ canonical: 'coconut_chutney', display: 'Coconut chutney', universe: 'condiment' })],
    [makeDish({ canonical: 'idli', display: 'Idli', universe: 'breakfast_main' }), makeDish({ canonical: 'coconut_chutney', display: 'Coconut chutney', universe: 'condiment' })],
    [makeDish({ canonical: 'dosa', display: 'Dosa', universe: 'breakfast_main' }), makeDish({ canonical: 'sambar', display: 'Sambar', universe: 'condiment' })],
    [makeDish({ canonical: 'paratha', display: 'Paratha', universe: 'breakfast_main' }), makeDish({ canonical: 'curd', display: 'Curd', universe: 'condiment' })],
  ];

  const snackOptions = [
    [makeDish({ canonical: 'samosa', display: 'Samosa', universe: 'snack' })],
    [makeDish({ canonical: 'banana', display: 'Banana', universe: 'fruit' })],
    [makeDish({ canonical: 'chai', display: 'Chai', universe: 'beverage' })],
    [makeDish({ canonical: 'pakora', display: 'Pakora', universe: 'snack' })],
    [makeDish({ canonical: 'namkeen', display: 'Namkeen', universe: 'snack' })],
  ];

  const lunchDinnerOptions = [
    [
      makeDish({ canonical: 'dal_tadka', display: 'Dal tadka', universe: 'dal' }),
      makeDish({ canonical: 'jeera_rice', display: 'Jeera rice', universe: 'rice' }),
      makeDish({ canonical: 'aloo_gobi', display: 'Aloo gobi', universe: 'dry_veg' }),
      makeDish({ canonical: 'raita', display: 'Raita', universe: 'condiment' }),
    ],
    [
      makeDish({ canonical: 'chana_masala', display: 'Chana masala', universe: 'legume_curry' }),
      makeDish({ canonical: 'roti', display: 'Roti', universe: 'roti' }),
      makeDish({ canonical: 'bhindi_masala', display: 'Bhindi masala', universe: 'dry_veg' }),
      makeDish({ canonical: 'chutney', display: 'Chutney', universe: 'condiment' }),
    ],
    [
      makeDish({ canonical: 'rajma', display: 'Rajma', universe: 'legume_curry' }),
      makeDish({ canonical: 'steamed_rice', display: 'Steamed rice', universe: 'rice' }),
      makeDish({ canonical: 'salad', display: 'Salad', universe: 'condiment' }),
      makeDish({ canonical: 'pickle', display: 'Pickle', universe: 'condiment' }),
    ],
    [
      makeDish({ canonical: 'palak_paneer', display: 'Palak paneer', universe: 'paneer_main' }),
      makeDish({ canonical: 'naan', display: 'Naan', universe: 'roti' }),
      makeDish({ canonical: 'curd', display: 'Curd', universe: 'condiment' }),
      makeDish({ canonical: 'salad', display: 'Salad', universe: 'condiment' }),
    ],
  ];

  const meals: WeeklyMealPlanAI['meals'] = [];

  for (let day = 0; day < 7; day++) {
    // Breakfast
    meals.push({
      day,
      slot: 'breakfast',
      components: breakfastOptions[day % breakfastOptions.length],
    });

    meals.push({
      day,
      slot: 'morning_snack',
      components: snackOptions[day % snackOptions.length],
    });

    // Lunch
    meals.push({
      day,
      slot: 'lunch',
      components: lunchDinnerOptions[day % lunchDinnerOptions.length],
    });

    meals.push({
      day,
      slot: 'evening_snack',
      components: snackOptions[(day + 2) % snackOptions.length],
    });

    // Dinner
    meals.push({
      day,
      slot: 'dinner',
      components: lunchDinnerOptions[(day + 1) % lunchDinnerOptions.length],
    });
  }

  console.log('✅ Generated rule-based meal plan:', meals.length, 'meals');
  return { meals };
}

/**
 * Main function: Try AI, fallback to rules
 */
export async function generateWeeklyMealPlan(
  userId: string,
  excludeDishes: string[] = [],
  preferences?: {
    dietary_restrictions?: string[];
    household_size?: number;
    cuisine_preference?: string;
  }
): Promise<WeeklyMealPlanAI> {
  // Try AI first if API key is configured
  if (process.env.OPENAI_API_KEY && process.env.NEXT_PUBLIC_RELISH_ENABLED === 'true') {
    try {
      return await generateWeeklyMealPlanAI(userId, excludeDishes, preferences);
    } catch (error) {
      console.warn('AI generation failed, falling back to rules:', error);
    }
  }

  // Fallback to rule-based generation
  return generateWeeklyMealPlanRuleBased();
}

