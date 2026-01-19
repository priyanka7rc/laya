import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateWeeklyMealPlan } from '@/lib/mealPlanGenerator';
import { compileDish } from '@/lib/dishCompiler';
import { checkRateLimit } from '@/lib/rateLimiter';
import { checkTokenLimit } from '@/lib/tokenLimits';
import { ComponentType } from '@/types/relish';
import { getISTTimestamp } from '@/lib/utils/dateUtils';

// Create Supabase client with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ============================================================================
// Helper: Normalize and validate component types to prevent enum errors
// ============================================================================

const VALID_COMPONENT_TYPES = [
  'carb', 'protein', 'veg', 'broth', 'condiment', 
  'dairy', 'salad', 'crunch', 'snack', 'fruit', 
  'beverage', 'other'
] as const;

function normalizeComponentType(type: string | undefined, timestamp: string): string {
  if (!type) {
    console.warn(`[${timestamp}] ⚠️ Component type is undefined → defaulting to "other"`);
    return ComponentType.OTHER;
  }
  
  const normalized = type.toLowerCase().trim();
  
  // Direct match
  if (VALID_COMPONENT_TYPES.includes(normalized as any)) {
    return normalized;
  }
  
  // Common mappings for AI mistakes
  const mappings: Record<string, string> = {
    'grain': 'carb',
    'rice': 'carb',
    'bread': 'carb',
    'roti': 'carb',
    'meat': 'protein',
    'dal': 'protein',
    'lentil': 'protein',
    'vegetable': 'veg',
    'veggie': 'veg',
    'sabzi': 'veg',
    'soup': 'broth',
    'curry': 'broth',
    'gravy': 'broth',
    'chutney': 'condiment',
    'pickle': 'condiment',
    'sauce': 'condiment',
    'yogurt': 'dairy',
    'curd': 'dairy',
    'paneer': 'dairy',
    'cheese': 'dairy',
    'drink': 'beverage',
    'juice': 'beverage',
    'tea': 'beverage',
    'coffee': 'beverage',
    'namkeen': 'snack',
    'chips': 'snack',
    'pakora': 'snack',
  };
  
  const mapped = mappings[normalized];
  if (mapped) {
    console.log(`[${timestamp}] 🔄 Mapped invalid type "${type}" → "${mapped}"`);
    return mapped;
  }
  
  console.warn(`[${timestamp}] ⚠️ Unknown component type "${type}" → defaulting to "other"`);
  return ComponentType.OTHER;
}

// ============================================================================
// Helper Functions: Hybrid Recipe Selection (Database-first, then AI)
// ============================================================================

/**
 * Shuffle array in place (Fisher-Yates algorithm)
 */
function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Get dishes used in the last 2 weeks for the user
 * OPTIMIZED: Single query with joins
 */
async function getRecentlyUsedDishes(userId: string): Promise<string[]> {
  console.time('⏱️  Query: Get recently used dishes');
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  
  const { data, error } = await supabase
    .from('meal_plans')
    .select(`
      id,
      meal_plan_items!inner (
        meal_plates!inner (
          meal_plate_components!inner (
            dish_id
          )
        )
      )
    `)
    .eq('user_id', userId)
    .gte('week_start_date', twoWeeksAgo.toISOString().split('T')[0]);
  
  console.timeEnd('⏱️  Query: Get recently used dishes');
  
  if (error || !data) return [];
  
  console.time('⏱️  Process: Extract dish IDs');
  const dishIds = new Set<string>();
  data.forEach((plan: any) => {
    plan.meal_plan_items?.forEach((item: any) => {
      item.meal_plates?.meal_plate_components?.forEach((comp: any) => {
        if (comp.dish_id) dishIds.add(comp.dish_id);
      });
    });
  });
  console.timeEnd('⏱️  Process: Extract dish IDs');
  
  return Array.from(dishIds);
}

/**
 * Distribute dishes to meal slots for the week
 * OPTIMIZED: Batch queries - only 2 DB calls instead of 70+
 * Returns slots that need AI generation (couldn't fill from database)
 */
async function distributeDishesToSlots(
  userId: string,
  weekStartDate: string,
  timestamp: string
): Promise<{
  filledSlots: Map<string, Array<{ dish_name: string; component_type: string; is_optional: boolean }>>;
  emptySlots: Array<{ day: number; slot: string }>;
}> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[${timestamp}] 🚀 STARTING HYBRID RECIPE SELECTION`);
  console.log(`${'='.repeat(80)}\n`);
  console.time(`[${timestamp}] ⏱️  TOTAL: distributeDishesToSlots`);
  
  // Step 1: Get recently used dish IDs (1 query)
  console.log(`[${timestamp}] 📋 Step 1: Fetching recently used dishes...`);
  const recentDishIds = await getRecentlyUsedDishes(userId);
  console.log(`[${timestamp}] ✅ Found ${recentDishIds.length} dishes used in last 2 weeks\n`);
  
  // Step 2: Get ALL dishes with complete recipes in ONE query
  console.log(`[${timestamp}] 📋 Step 2: Fetching all available dishes...`);
  console.time(`[${timestamp}] ⏱️  Query: Get all dishes`);
  const { data: allDishes } = await supabase
    .from('dishes')
    .select('id, canonical_name, usage_count, meal_type')
    .eq('has_ingredients', true)
    .order('usage_count', { ascending: false });
  console.timeEnd(`[${timestamp}] ⏱️  Query: Get all dishes`);
  
  if (!allDishes || allDishes.length === 0) {
    console.log(`[${timestamp}] ⚠️  No dishes in database, will use AI for all slots`);
    const emptySlots = [];
    for (let day = 0; day < 7; day++) {
      for (const slot of ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner']) {
        emptySlots.push({ day, slot });
      }
    }
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: distributeDishesToSlots`);
    return { filledSlots: new Map(), emptySlots };
  }
  
  console.log(`[${timestamp}] ✅ Loaded ${allDishes.length} dishes from database\n`);
  
  // Step 3: Filter in memory for each slot (no more DB queries!)
  console.log(`[${timestamp}] 📋 Step 3: Distributing dishes to 35 slots (in-memory)...`);
  console.time(`[${timestamp}] ⏱️  Process: In-memory filtering & selection`);
  
  const filledSlots = new Map();
  const emptySlots = [];
  
  const slots = ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner'];
  
  for (let day = 0; day < 7; day++) {
    for (const slot of slots) {
      const slotKey = `${day}-${slot}`;
      
      // Determine how many dishes this slot needs
      let dishCount = 1; // Default for snacks
      if (slot === 'breakfast') dishCount = 2;
      if (slot === 'lunch' || slot === 'dinner') dishCount = 3;
      
      // Filter dishes suitable for this meal type (in memory, super fast!)
      const suitableDishes = allDishes.filter(d => 
        d.meal_type && Array.isArray(d.meal_type) && d.meal_type.includes(slot.toLowerCase())
      );
      
      if (suitableDishes.length === 0) {
        emptySlots.push({ day, slot });
        continue;
      }
      
      // Separate into recent and new
      const newDishes = suitableDishes.filter(d => !recentDishIds.includes(d.id));
      const recentDishesForSlot = suitableDishes.filter(d => recentDishIds.includes(d.id));
      
      // Calculate 25% overlap
      const allowedRecentCount = Math.floor(dishCount * 0.25);
      const newDishesNeeded = dishCount - allowedRecentCount;
      
      // Shuffle and select (in memory, instant!)
      const selectedNew = shuffle(newDishes).slice(0, newDishesNeeded);
      const selectedRecent = shuffle(recentDishesForSlot).slice(0, allowedRecentCount);
      const selected = [...selectedNew, ...selectedRecent];
      
      if (selected.length >= dishCount) {
        // Successfully filled from database!
        filledSlots.set(slotKey, selected.slice(0, dishCount).map(d => ({
          dish_name: d.canonical_name,
          component_type: 'other', // Will be inferred
          is_optional: false
        })));
      } else {
        // Not enough dishes in database, mark for AI generation
        emptySlots.push({ day, slot });
      }
    }
  }
  
  console.timeEnd(`[${timestamp}] ⏱️  Process: In-memory filtering & selection`);
  console.log(`[${timestamp}] ✅ Database filled ${filledSlots.size}/35 slots, ${emptySlots.length} need AI\n`);
  console.timeEnd(`[${timestamp}] ⏱️  TOTAL: distributeDishesToSlots`);
  
  return { filledSlots, emptySlots };
}

export async function POST(request: NextRequest) {
  try {
    const timestamp = getISTTimestamp();
    const { weekStartDate, userId, excludeDishes = [] } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // 1. Check rate limits (10 calls/hour)
    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      console.warn(`[${timestamp}] ⚠️ Rate limit exceeded for user ${userId}`);
      return NextResponse.json({ error: rateCheck.message }, { status: 429 });
    }

    // 2. Check token limits (100k/month)
    const tokenCheck = await checkTokenLimit(userId);
    if (!tokenCheck.allowed) {
      console.warn(`[${timestamp}] ⚠️ Token limit exceeded for user ${userId}: ${tokenCheck.tokensUsed} tokens`);
      return NextResponse.json({ error: tokenCheck.message }, { status: 429 });
    }

    console.log(`[${timestamp}] 🎲 Generating meal plan for week: ${weekStartDate} (${tokenCheck.tokensRemaining.toLocaleString()} tokens remaining)`);
    if (excludeDishes.length > 0) {
      console.log(`[${timestamp}] 📋 Excluding previously used dishes: ${excludeDishes.join(', ')}`);
    }

    // ============================================================================
    // HYBRID STRATEGY: Database-first (with 25% overlap), then AI for gaps
    // ============================================================================
    
    console.time(`[${timestamp}] ⏱️  TOTAL: Hybrid recipe selection`);
    
    // Step 1: Try to fill slots from database (prioritize existing recipes)
    const { filledSlots, emptySlots } = await distributeDishesToSlots(userId, weekStartDate, timestamp);
    
    let generatedPlan: any = { meals: [] };
    
    // Step 2: Only call AI if there are empty slots
    if (emptySlots.length > 0) {
      console.log(`[${timestamp}] 🤖 Calling AI to generate ${emptySlots.length} slots...`);
      console.time(`[${timestamp}] ⏱️  AI: generateWeeklyMealPlan`);
      generatedPlan = await generateWeeklyMealPlan(userId, excludeDishes);
      console.timeEnd(`[${timestamp}] ⏱️  AI: generateWeeklyMealPlan`);
      console.log(`[${timestamp}] ✅ OpenAI returned ${generatedPlan.meals.length} meals\n`);
    } else {
      console.log(`[${timestamp}] ✅ All slots filled from database! No AI needed.\n`);
    }
    
    // Step 3: Merge database-filled slots with AI-generated slots
    console.log(`[${timestamp}] 📋 Step 4: Merging database dishes with AI dishes...`);
    console.time(`[${timestamp}] ⏱️  Process: Merge DB & AI meals`);
    
    const allMeals = [];
    
    for (let day = 0; day < 7; day++) {
      for (const slot of ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner']) {
        const slotKey = `${day}-${slot}`;
        
        if (filledSlots.has(slotKey)) {
          // Use database dishes
          allMeals.push({
            day,
            slot,
            components: filledSlots.get(slotKey)
          });
        } else {
          // Use AI-generated meal (if available)
          const aiMeal = generatedPlan.meals.find((m: any) => m.day === day && m.slot === slot);
          if (aiMeal) {
            allMeals.push(aiMeal);
          }
        }
      }
    }
    
    console.timeEnd(`[${timestamp}] ⏱️  Process: Merge DB & AI meals`);
    console.log(`[${timestamp}] ✅ Final meal plan: ${allMeals.length} meals (${filledSlots.size} from DB, ${emptySlots.length} from AI)\n`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: Hybrid recipe selection`);
    
    // Use the merged meal plan instead of just AI-generated
    generatedPlan.meals = allMeals;

    // 2. Fetch all dishes from database for matching
    const { data: allDishes, error: dishesError } = await supabase
      .from('dishes')
      .select('id, canonical_name, aliases');

    if (dishesError) throw dishesError;

    // Create a map for fuzzy matching
    const dishNameMap = new Map<string, string>();
    allDishes?.forEach(dish => {
      dishNameMap.set(dish.canonical_name.toLowerCase(), dish.id);
      dish.aliases?.forEach((alias: string) => {
        dishNameMap.set(alias.toLowerCase(), dish.id);
      });
    });

    // 3. Get or create meal plan for this week
    let { data: mealPlan, error: planError } = await supabase
      .from('meal_plans')
      .select('id')
      .eq('user_id', userId)
      .eq('week_start_date', weekStartDate)
      .maybeSingle();

    if (!mealPlan) {
      const { data: newPlan, error: createError } = await supabase
        .from('meal_plans')
        .insert({
          user_id: userId,
          week_start_date: weekStartDate,
          week_name: `Week of ${new Date(weekStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        })
        .select('id')
        .single();

      if (createError) throw createError;
      mealPlan = newPlan;
    }

    // 4. Get existing meal plan items that have components (truly filled slots)
    const { data: existingItems } = await supabase
      .from('meal_plan_items')
      .select(`
        day_of_week,
        meal_slot,
        meal_plates!inner (
          meal_plate_components (id)
        )
      `)
      .eq('meal_plan_id', mealPlan.id);

    // Only preserve slots that have actual components (not empty containers)
    const filledSlots = new Set(
      existingItems
        ?.filter((item: any) => item.meal_plates?.meal_plate_components?.length > 0)
        .map((item: any) => `${item.day_of_week}-${item.meal_slot}`) || []
    );

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] 💾 SAVING TO DATABASE`);
    console.log(`${'='.repeat(80)}\n`);
    console.log(`[${timestamp}] 📝 Creating meal plan items for empty slots only...`);
    console.log(`[${timestamp}] Found ${filledSlots.size} filled slots to preserve (with components)`);
    console.time(`[${timestamp}] ⏱️  TOTAL: Database insertions`);

    let mealsCreated = 0;
    let componentsCreated = 0;

    // 5. Create meal_plan_items ONLY for empty slots (preserve existing!)
    for (const meal of generatedPlan.meals) {
      const slotKey = `${meal.day}-${meal.slot}`;
      
      // Skip if user already has a filled slot (with components)
      if (filledSlots.has(slotKey)) {
        console.log(`[${timestamp}] ⏭️  Skipping ${meal.slot} on day ${meal.day} - user has existing meal`);
        continue;
      }
      
      // Delete empty meal_plan_item containers (no components) before creating new ones
      await supabase
        .from('meal_plan_items')
        .delete()
        .eq('meal_plan_id', mealPlan.id)
        .eq('day_of_week', meal.day)
        .eq('meal_slot', meal.slot);
      // Create meal_plan_item
      const { data: mealItem, error: itemError } = await supabase
        .from('meal_plan_items')
        .insert({
          meal_plan_id: mealPlan.id,
          day_of_week: meal.day,
          meal_slot: meal.slot,
          dish_name: meal.components[0]?.dish_name || 'Multi-dish meal',
          dish_id: null, // Multi-dish meal doesn't have single dish_id
        })
        .select('id')
        .single();

      if (itemError) {
        console.error('Error creating meal item:', itemError);
        continue;
      }

      mealsCreated++;

      // Get the auto-created plate
      const { data: plate, error: plateError } = await supabase
        .from('meal_plates')
        .select('id')
        .eq('meal_plan_item_id', mealItem.id)
        .single();

      if (plateError || !plate) {
        // Fallback: create plate manually
        const { data: newPlate, error: createPlateError } = await supabase
          .from('meal_plates')
          .insert({ meal_plan_item_id: mealItem.id })
          .select('id')
          .single();

        if (createPlateError) {
          console.error('Error creating plate:', createPlateError);
          continue;
        }
      }

      const plateId = plate?.id || (await supabase
        .from('meal_plates')
        .select('id')
        .eq('meal_plan_item_id', mealItem.id)
        .single()).data?.id;

      if (!plateId) continue;

      // Create components for this plate, creating dishes if they don't exist
      const components = [];
      
      // DEBUG: Check if components exist
      if (!meal.components || meal.components.length === 0) {
        console.log(`[${timestamp}] ⚠️ Meal at day ${meal.day}, slot ${meal.slot} has NO components!`);
        continue;
      }

      for (let idx = 0; idx < meal.components.length; idx++) {
        const comp = meal.components[idx];
        
        // Normalize and validate component type to prevent enum errors
        const validatedType = normalizeComponentType(comp.component_type, timestamp);
        
        const dishNameLower = comp.dish_name.toLowerCase().trim();
        let matchedDishId = dishNameMap.get(dishNameLower);

        // If dish doesn't exist, CREATE it
        if (!matchedDishId) {
          console.log(`[${timestamp}] 📝 Creating new dish: "${comp.dish_name}"`);
          const { data: newDish, error: dishError } = await supabase
            .from('dishes')
            .insert({
              canonical_name: comp.dish_name,
              cuisine_tags: ['indian'], // Default
            })
            .select('id')
            .single();

          if (!dishError && newDish) {
            matchedDishId = newDish.id;
            dishNameMap.set(dishNameLower, newDish.id); // Add to map for future lookups
            console.log(`[${timestamp}] ✅ Created dish with ID: ${newDish.id}`);
          } else {
            console.error(`[${timestamp}] Failed to create dish "${comp.dish_name}":`, dishError);
          }
        }

        try {
        components.push({
          meal_plate_id: plateId,
            component_type: validatedType, // Use validated type
          dish_name: comp.dish_name,
          dish_id: matchedDishId || null,
          sort_order: idx,
          is_optional: comp.is_optional || false,
          servings: 4, // Default serving size for household
        });
        } catch (typeError) {
          console.error(`[${timestamp}] ❌ Failed to add component "${comp.dish_name}" with type "${comp.component_type}":`, typeError);
          // Skip this component and continue
          continue;
        }
      }

      // Insert components with better error handling
      try {
      const { error: componentsError } = await supabase
        .from('meal_plate_components')
        .insert(components);

      if (componentsError) {
          // Check if it's an enum error
          if (componentsError.message?.includes('invalid input value for enum')) {
            console.error(`[${timestamp}] ❌ ENUM ERROR:`, componentsError.message);
            console.error(`[${timestamp}] Components that failed:`, components);
            
            // Log each unique component type to help debug
            const uniqueTypes = [...new Set(components.map(c => c.component_type))];
            console.error(`[${timestamp}] Component types used:`, uniqueTypes);
          } else {
            console.error(`[${timestamp}] Error creating components:`, componentsError);
          }
      } else {
        componentsCreated += components.length;
        
        // Update usage tracking for used dishes
        const dishIds = components.filter(c => c.dish_id).map(c => c.dish_id);
        if (dishIds.length > 0) {
          for (const dishId of dishIds) {
            await supabase.rpc('increment_dish_usage', { dish_id: dishId });
          }
        }
        }
      } catch (insertError) {
        console.error(`[${timestamp}] ❌ Failed to insert components for ${meal.slot} on day ${meal.day}:`, insertError);
        // Continue with next meal instead of failing completely
      }
    }

    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: Database insertions`);
    console.log(`[${timestamp}] ✅ Created ${mealsCreated} meals with ${componentsCreated} components\n`);

    // 6. Compile any dishes that don't have recipe_variants yet
    console.log(`[${timestamp}] 🔄 Checking for dishes needing compilation...`);
    
    const dishesNeedingCompilation: Array<{ id: string; name: string }> = [];
    
    for (const meal of generatedPlan.meals) {
      for (const comp of meal.components) {
        const dishNameLower = comp.dish_name.toLowerCase().trim();
        const dishId = dishNameMap.get(dishNameLower);
        
        if (dishId && !dishesNeedingCompilation.find(d => d.id === dishId)) {
          // Check if this dish has a recipe_variant
          const { data: hasVariant } = await supabase
            .from('recipe_variants')
            .select('id')
            .eq('dish_id', dishId)
            .limit(1)
            .single();
          
          if (!hasVariant) {
            dishesNeedingCompilation.push({ id: dishId, name: comp.dish_name });
          }
        }
      }
    }

    let dishesCompiled = 0;
    if (dishesNeedingCompilation.length > 0) {
      console.log(`[${timestamp}] 📝 Compiling ${dishesNeedingCompilation.length} dishes without recipes...`);
      
      for (const dish of dishesNeedingCompilation) {
        try {
          await compileDish(dish.id, dish.name, userId, true); // Save as global
          dishesCompiled++;
        } catch (error) {
          console.error(`[${timestamp}] Failed to compile ${dish.name}:`, error);
          // Continue with other dishes
        }
      }
      
      console.log(`[${timestamp}] ✅ Compiled ${dishesCompiled} new dishes`);
    }

    // 7. Regenerate grocery list
    // (This will be triggered automatically by the frontend after generation)

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] ✅ MEAL PLAN GENERATION COMPLETE`);
    console.log(`${'='.repeat(80)}`);
    console.log(`[${timestamp}] 📊 Summary:`);
    console.log(`[${timestamp}]    • Meals created: ${mealsCreated}`);
    console.log(`[${timestamp}]    • Components created: ${componentsCreated}`);
    console.log(`[${timestamp}]    • Dishes compiled: ${dishesCompiled}`);
    console.log(`[${timestamp}]    • From database: ${filledSlots.size} slots`);
    console.log(`[${timestamp}]    • From AI: ${emptySlots.length} slots`);
    console.log(`${'='.repeat(80)}\n`);

    return NextResponse.json({
      success: true,
      mealsGenerated: mealsCreated,
      componentsGenerated: componentsCreated,
      dishesCompiled: dishesCompiled,
      message: `Generated ${mealsCreated} meals with ${componentsCreated} dishes! ${dishesCompiled > 0 ? `Compiled ${dishesCompiled} new recipes.` : ''}`,
    });

  } catch (error: any) {
    console.error('Error generating meal plan:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate meal plan' },
      { status: 500 }
    );
  }
}

