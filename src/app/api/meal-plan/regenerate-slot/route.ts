import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateWeeklyMealPlan } from '@/lib/mealPlanGenerator';
import { compileDish } from '@/lib/dishCompiler';
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
// Helper Functions: Smart Single-Slot Recipe Selection
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
  
  if (error || !data) return [];
  
  const dishIds = new Set<string>();
  data.forEach((plan: any) => {
    plan.meal_plan_items?.forEach((item: any) => {
      item.meal_plates?.meal_plate_components?.forEach((comp: any) => {
        if (comp.dish_id) dishIds.add(comp.dish_id);
      });
    });
  });
  
  return Array.from(dishIds);
}

/**
 * Try to select dishes from database for a single slot
 * OPTIMIZED: Batch query - only 1 DB call instead of 2
 * Returns dishes if found, or null if AI is needed
 */
async function tryGetDishesFromDatabase(
  slot: string,
  recentDishIds: string[],
  timestamp: string
): Promise<Array<{ id: string; canonical_name: string }> | null> {
  // Calculate how many dishes this slot needs
  let dishCount = 1;
  if (slot === 'breakfast') dishCount = 2;
  if (slot === 'lunch' || slot === 'dinner') dishCount = 3;
  
  console.log(`[${timestamp}] 🔍 Looking for ${dishCount} dishes for ${slot}`);
  
  // Get ALL suitable dishes in ONE query
  const { data: allDishes } = await supabase
    .from('dishes')
    .select('id, canonical_name, usage_count, meal_type')
    .eq('has_ingredients', true)
    .order('usage_count', { ascending: false });
  
  if (!allDishes || allDishes.length === 0) {
    console.log(`[${timestamp}] 🤖 No dishes in database, will use AI`);
    return null;
  }
  
  // Filter for this meal type (in memory, fast!)
  const suitableDishes = allDishes.filter(d => 
    d.meal_type && Array.isArray(d.meal_type) && d.meal_type.includes(slot.toLowerCase())
  );
  
  if (suitableDishes.length === 0) {
    console.log(`[${timestamp}] 🤖 No dishes for ${slot} in database, will use AI`);
    return null;
  }
  
  // Separate into recent and new (in memory)
  const newDishes = suitableDishes.filter(d => !recentDishIds.includes(d.id));
  const recentDishesForSlot = suitableDishes.filter(d => recentDishIds.includes(d.id));
  
  // Calculate 25% overlap
  const allowedRecentCount = Math.floor(dishCount * 0.25);
  const newDishesNeeded = dishCount - allowedRecentCount;
  
  // Shuffle and select (in memory, instant!)
  const selectedNew = shuffle(newDishes).slice(0, newDishesNeeded);
  const selectedRecent = shuffle(recentDishesForSlot).slice(0, allowedRecentCount);
  const selected = [...selectedNew, ...selectedRecent];
  
  // Only return if we have enough dishes
  if (selected.length >= dishCount) {
    console.log(`[${timestamp}] ✅ Found ${selected.length} dishes from database for ${slot} (${selectedNew.length} new + ${selectedRecent.length} recent)`);
    return selected.slice(0, dishCount);
  }
  
  console.log(`[${timestamp}] 🤖 Only found ${selected.length}/${dishCount} dishes, will use AI`);
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const timestamp = getISTTimestamp();
    const { userId, mealPlanId, dayOfWeek, slot, excludeDishes = [] } = await request.json();

    if (!userId || !mealPlanId || dayOfWeek === undefined || !slot) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log(`[${timestamp}] 🔄 Regenerating slot: Day ${dayOfWeek}, ${slot}, excluding:`, excludeDishes);

    // ============================================================================
    // HYBRID STRATEGY: Try database first, fallback to AI
    // ============================================================================
    
    // Step 1: Get recently used dishes
    const recentDishIds = await getRecentlyUsedDishes(userId);
    console.log(`[${timestamp}] 📊 Found ${recentDishIds.length} dishes used in last 2 weeks`);
    
    // Step 2: Try to get dishes from database
    const dbDishes = await tryGetDishesFromDatabase(slot, recentDishIds, timestamp);
    
    let targetMeal: any;
    
    if (dbDishes) {
      // Success! Use database dishes
      console.log(`[${timestamp}] ✅ Using ${dbDishes.length} dishes from database (no AI needed)`);
      
      // Map component types based on slot
      const componentTypeMap: Record<string, ComponentType> = {
        'breakfast': ComponentType.CARB,
        'morning_snack': ComponentType.SNACK,
        'lunch': ComponentType.PROTEIN,
        'evening_snack': ComponentType.FRUIT,
        'dinner': ComponentType.PROTEIN,
      };
      
      targetMeal = {
        day: dayOfWeek,
        slot,
        components: dbDishes.map((dish, idx) => ({
          dish_name: dish.canonical_name,
          component_type: idx === 0 ? componentTypeMap[slot] : ComponentType.OTHER,
          is_optional: false
        }))
      };
    } else {
      // Step 3: Fallback to AI
      console.log(`[${timestamp}] 🤖 Calling AI to generate meal for ${slot}...`);
      
      const generatedPlan = await generateWeeklyMealPlan(userId, excludeDishes);

      // Find the meal for this specific day/slot
      targetMeal = generatedPlan.meals.find(
        (m: any) => m.day === dayOfWeek && m.slot === slot
      );

      if (!targetMeal || !targetMeal.components || targetMeal.components.length === 0) {
        return NextResponse.json({ error: 'Failed to generate meal' }, { status: 500 });
      }
      
      console.log(`[${timestamp}] ✅ AI generated ${targetMeal.components.length} components for ${slot}`);
    }

    console.log(`[${timestamp}] ✅ Selected ${targetMeal.components.length} components for ${slot}`);

    // Get all dishes from database for matching
    const { data: allDishes } = await supabase
      .from('dishes')
      .select('id, canonical_name, aliases');

    const dishNameMap = new Map<string, string>();
    allDishes?.forEach(dish => {
      dishNameMap.set(dish.canonical_name.toLowerCase(), dish.id);
      dish.aliases?.forEach((alias: string) => {
        dishNameMap.set(alias.toLowerCase(), dish.id);
      });
    });

    // Find the existing meal_plan_item for this slot
    const { data: existingItem } = await supabase
      .from('meal_plan_items')
      .select('id, meal_plates(id)')
      .eq('meal_plan_id', mealPlanId)
      .eq('day_of_week', dayOfWeek)
      .eq('meal_slot', slot)
      .maybeSingle();

    let meal_plate_id: string;

    if (existingItem) {
      // Delete existing components
      const plateId = (existingItem.meal_plates as any)?.id;
      if (plateId) {
        await supabase
          .from('meal_plate_components')
          .delete()
          .eq('meal_plate_id', plateId);
        meal_plate_id = plateId;
      } else {
        // Create new plate if somehow missing
        const { data: newPlate, error: plateError } = await supabase
          .from('meal_plates')
          .insert({})
          .select('id')
          .single();
        
        if (plateError) throw plateError;
        meal_plate_id = newPlate.id;

        // Update meal_plan_item with the plate
        await supabase
          .from('meal_plan_items')
          .update({ meal_plate_id })
          .eq('id', existingItem.id);
      }
    } else {
      // Create new meal_plan_item and plate
      const { data: newPlate, error: plateError } = await supabase
        .from('meal_plates')
        .insert({})
        .select('id')
        .single();
      
      if (plateError) throw plateError;
      meal_plate_id = newPlate.id;

      await supabase
        .from('meal_plan_items')
        .insert({
          meal_plan_id: mealPlanId,
          day_of_week: dayOfWeek,
          meal_slot: slot,
          meal_plate_id,
          is_skipped: false,
        });
    }

    // Process and insert new components
    const componentsToInsert = [];
    let sortOrder = 0;

    for (const component of targetMeal.components) {
      const dishName = component.dish_name.toLowerCase().trim();
      let dish_id = dishNameMap.get(dishName);

      // If dish doesn't exist, compile it
      if (!dish_id) {
        console.log(`[${timestamp}] 🔨 Compiling new dish: ${component.dish_name}`);
        
        // Create dish first
        const { data: newDish, error: dishError } = await supabase
          .from('dishes')
          .insert({
            canonical_name: component.dish_name,
            cuisine_tags: ['indian'], // Default
          })
          .select('id')
          .single();
        
        if (!dishError && newDish) {
          dish_id = newDish.id;
          dishNameMap.set(dishName, dish_id);
          
          // Compile the dish
          try {
            await compileDish(newDish.id, component.dish_name, userId, true);
          } catch (compileError) {
            console.error(`[${timestamp}] Failed to compile ${component.dish_name}:`, compileError);
          }
        }
      }
      
      // Increment usage for dish
      if (dish_id) {
        await supabase.rpc('increment_dish_usage', { dish_id });
      }

      // Normalize component type to prevent enum errors
      const validatedType = normalizeComponentType(component.component_type, timestamp);

      try {
        componentsToInsert.push({
          meal_plate_id,
          component_type: validatedType,
          dish_name: component.dish_name,
          dish_id: dish_id || null,
          sort_order: sortOrder++,
          is_optional: component.is_optional || false,
          servings: 4,
        });
      } catch (typeError) {
        console.error(`[${timestamp}] ❌ Failed to add component "${component.dish_name}" with type "${component.component_type}":`, typeError);
        continue;
      }
    }

    if (componentsToInsert.length > 0) {
      const { error: compError } = await supabase
        .from('meal_plate_components')
        .insert(componentsToInsert);

      if (compError) {
        // Check if it's an enum error
        if (compError.message?.includes('invalid input value for enum')) {
          console.error(`[${timestamp}] ❌ ENUM ERROR:`, compError.message);
          console.error(`[${timestamp}] Components that failed:`, componentsToInsert);
          
          // Log each unique component type to help debug
          const uniqueTypes = [...new Set(componentsToInsert.map(c => c.component_type))];
          console.error(`[${timestamp}] Component types used:`, uniqueTypes);
        } else {
          console.error(`[${timestamp}] Error inserting components:`, compError);
        }
        throw compError;
      }
    }

    console.log(`[${timestamp}] ✅ Regenerated ${slot} on day ${dayOfWeek} with ${componentsToInsert.length} components`);

    return NextResponse.json({
      success: true,
      componentsAdded: componentsToInsert.length,
    });

  } catch (error: any) {
    console.error('Error in regenerate-slot:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
