import OpenAI from 'openai';
import { supabase } from './supabaseClient';
import { logAIUsage } from './tokenLimits';
import type { WeeklyMealPlanAI, MealComponentAI } from '@/types/relish';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MEAL_PLAN_PROMPT = `You are a meal planning assistant specializing in Indian home-style cuisine.

Generate a complete 7-day meal plan for a household of 2 people.

Requirements:
- Each day should have 5 meal slots: breakfast, morning_snack, lunch, evening_snack, dinner
- Main meals (breakfast, lunch, dinner) should have multiple components (like a traditional Indian thali)
- Snacks (morning_snack, evening_snack) should be lighter: 1-2 components only
- Include variety across the week
- Balance vegetarian and non-vegetarian options
- Focus on comfort food and home-style dishes
- Each lunch and dinner should have 3-5 components
- Each breakfast should have 2-3 components
- Each snack should have 1-2 components (keep it simple and light)

🚨 CRITICAL: component_type MUST be EXACTLY one of these 12 values (no other values will be accepted):
1. "carb" - rice, roti, paratha, naan, dosa, idli, upma, bread, pasta
2. "protein" - dal, rajma, chana, chicken, paneer, egg, fish, tofu
3. "veg" - any vegetable dish (aloo gobi, bhindi masala, palak, etc.)
4. "broth" - liquid curries, rasam, sambar, dal fry
5. "condiment" - chutney, pickle, raita, papad
6. "dairy" - yogurt, curd, buttermilk, lassi
7. "salad" - raw vegetables, kachumber, fresh greens
8. "crunch" - papad, chips, fryums, crispy sides
9. "snack" - samosa, pakora, namkeen, vada, bonda, mathri
10. "fruit" - banana, apple, seasonal fruits, fruit chaat
11. "beverage" - chai, coffee, juice, milkshakes
12. "other" - anything that doesn't fit above categories

⚠️ DO NOT USE these values (they are INVALID and will cause errors):
❌ "grain", "rice", "bread" → use "carb"
❌ "meat", "lentil", "dal" → use "protein"
❌ "vegetable", "veggie", "sabzi" → use "veg"
❌ "soup", "curry", "gravy" → use "broth"
❌ "drink", "tea", "coffee" → use "beverage"
❌ "namkeen", "chips" → use "snack"
❌ "light", "sweet" → use "snack" or "other"

IMPORTANT: 
- Slot values MUST be: "breakfast", "morning_snack", "lunch", "evening_snack", "dinner"
- Component types MUST be from the 12 valid values above

Return ONLY valid JSON matching this exact structure:
{
  "meals": [
    {
      "day": 0,
      "slot": "breakfast",
      "components": [
        {
          "component_type": "carb",
          "dish_name": "poha",
          "is_optional": false
        },
        {
          "component_type": "condiment",
          "dish_name": "coconut chutney",
          "is_optional": true
        }
      ]
    },
    {
      "day": 0,
      "slot": "morning_snack",
      "components": [
        {
          "component_type": "snack",
          "dish_name": "samosa",
          "is_optional": false
        },
        {
          "component_type": "beverage",
          "dish_name": "chai",
          "is_optional": true
        }
      ]
    },
    {
      "day": 0,
      "slot": "lunch",
      "components": [
        {
          "component_type": "protein",
          "dish_name": "dal tadka"
        },
        {
          "component_type": "carb",
          "dish_name": "jeera rice"
        },
        {
          "component_type": "veg",
          "dish_name": "aloo gobi"
        },
        {
          "component_type": "condiment",
          "dish_name": "raita",
          "is_optional": true
        }
      ]
    },
    {
      "day": 0,
      "slot": "evening_snack",
      "components": [
        {
          "component_type": "snack",
          "dish_name": "pakora",
          "is_optional": false
        },
        {
          "component_type": "beverage",
          "dish_name": "chai",
          "is_optional": true
        }
      ]
    },
    {
      "day": 0,
      "slot": "dinner",
      "components": [
        {
          "component_type": "carb",
          "dish_name": "roti",
          "is_optional": false
        },
        {
          "component_type": "protein",
          "dish_name": "rajma",
          "is_optional": false
        },
        {
          "component_type": "veg",
          "dish_name": "bhindi masala",
          "is_optional": false
        }
      ]
    }
  ]
}

Rules:
- day: 0=Monday through 6=Sunday
- slot: MUST be one of: "breakfast", "morning_snack", "lunch", "evening_snack", "dinner"
- Breakfast: 2-3 components (simpler meals)
- Morning Snack: 1-2 components (light snack)
- Lunch: 3-5 components (full thali-style meals)
- Evening Snack: 1-2 components (light snack)
- Dinner: 3-5 components (full thali-style meals)
- Include variety - don't repeat dishes too often
- Mark condiments/sides as is_optional: true
- Use common Indian dish names in lowercase

Generate plan for all 7 days, 5 meals per day (35 total meals including snacks).`;

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
      userPrompt += ` IMPORTANT: Do NOT include these dishes (user has already used them this week): ${excludeDishes.join(', ')}. Suggest different dishes for variety.`;
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
  const breakfastOptions = [
    [{ component_type: 'carb' as const, dish_name: 'poha' }],
    [{ component_type: 'carb' as const, dish_name: 'upma' }],
    [{ component_type: 'carb' as const, dish_name: 'idli' }, { component_type: 'condiment' as const, dish_name: 'coconut chutney', is_optional: true }],
    [{ component_type: 'carb' as const, dish_name: 'dosa' }, { component_type: 'condiment' as const, dish_name: 'sambar', is_optional: true }],
    [{ component_type: 'carb' as const, dish_name: 'paratha' }],
  ];

  const lunchDinnerOptions = [
    [
      { component_type: 'protein' as const, dish_name: 'dal tadka' },
      { component_type: 'carb' as const, dish_name: 'jeera rice' },
      { component_type: 'veg' as const, dish_name: 'aloo gobi' },
      { component_type: 'condiment' as const, dish_name: 'raita', is_optional: true },
    ],
    [
      { component_type: 'protein' as const, dish_name: 'chana masala' },
      { component_type: 'carb' as const, dish_name: 'roti' },
      { component_type: 'veg' as const, dish_name: 'bhindi masala' },
    ],
    [
      { component_type: 'protein' as const, dish_name: 'rajma' },
      { component_type: 'carb' as const, dish_name: 'steamed rice' },
      { component_type: 'salad' as const, dish_name: 'salad', is_optional: true },
    ],
    [
      { component_type: 'protein' as const, dish_name: 'palak paneer' },
      { component_type: 'carb' as const, dish_name: 'naan' },
      { component_type: 'dairy' as const, dish_name: 'curd', is_optional: true },
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

    // Lunch
    meals.push({
      day,
      slot: 'lunch',
      components: lunchDinnerOptions[day % lunchDinnerOptions.length],
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

