import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateWeeklyMealPlan } from '@/lib/mealPlanGenerator';
import { compileDish } from '@/lib/dishCompiler';
import { ComponentType, MealSlot, MealAnchor, DishEffortLevel, Dish, MealPolicyLogInsert } from '@/types/relish';
import { getISTTimestamp } from '@/lib/utils/dateUtils';
import { composeMealFromDatabase } from '@/lib/mealComposer';
import {
  applyPolicyToMealComponents,
  buildMealSignature,
  buildWeeklyAnchorPlan,
  createMealPolicyState,
  isOverlapCandidate,
  type MealHistory,
  type MealPlanGenerationConfigShape,
  type MealPolicyState,
} from '@/lib/mealPlanPolicy';
import crypto from 'crypto';
import { MEAL_COMPOSITION_RULES } from '@/config/meal-composition';

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

const DEFAULT_GENERATION_CONFIG: MealPlanGenerationConfigShape = {
  rice_plate_ratio: 0.5,
  roti_plate_ratio: 0.5,
  familiarity_mode: 'balanced',
  effort_ceiling: DishEffortLevel.MEDIUM,
  exploration_budget: 1,
};

function hashWeeklySignature(signature: string): string {
  return crypto.createHash('sha256').update(signature).digest('hex');
}

function getMinComponentsForAnchor(slot: MealSlot, anchor: MealAnchor): number {
  if ((slot === MealSlot.LUNCH || slot === MealSlot.DINNER) && anchor === MealAnchor.COMPLETE_ONE_BOWL) {
    return 1;
  }
  const rule = MEAL_COMPOSITION_RULES[slot];
  return rule?.minComponents ?? 1;
}

async function getMealPlanGenerationConfig(mealPlanId: string): Promise<MealPlanGenerationConfigShape> {
  const { data, error } = await supabase
    .from('meal_plan_generation_config')
    .select('*')
    .eq('meal_plan_id', mealPlanId)
    .maybeSingle();

  if (error || !data) {
    const { data: created } = await supabase
      .from('meal_plan_generation_config')
      .insert({
        meal_plan_id: mealPlanId,
        rice_plate_ratio: DEFAULT_GENERATION_CONFIG.rice_plate_ratio,
        roti_plate_ratio: DEFAULT_GENERATION_CONFIG.roti_plate_ratio,
        familiarity_mode: DEFAULT_GENERATION_CONFIG.familiarity_mode,
        effort_ceiling: DEFAULT_GENERATION_CONFIG.effort_ceiling,
        exploration_budget: DEFAULT_GENERATION_CONFIG.exploration_budget,
      })
      .select()
      .single();

    return created
      ? {
          rice_plate_ratio: created.rice_plate_ratio ?? DEFAULT_GENERATION_CONFIG.rice_plate_ratio,
          roti_plate_ratio: created.roti_plate_ratio ?? DEFAULT_GENERATION_CONFIG.roti_plate_ratio,
          familiarity_mode: created.familiarity_mode ?? DEFAULT_GENERATION_CONFIG.familiarity_mode,
          effort_ceiling: created.effort_ceiling ?? DEFAULT_GENERATION_CONFIG.effort_ceiling,
          exploration_budget: created.exploration_budget ?? DEFAULT_GENERATION_CONFIG.exploration_budget,
        }
      : DEFAULT_GENERATION_CONFIG;
  }

  return {
    rice_plate_ratio: data.rice_plate_ratio ?? DEFAULT_GENERATION_CONFIG.rice_plate_ratio,
    roti_plate_ratio: data.roti_plate_ratio ?? DEFAULT_GENERATION_CONFIG.roti_plate_ratio,
    familiarity_mode: data.familiarity_mode ?? DEFAULT_GENERATION_CONFIG.familiarity_mode,
    effort_ceiling: data.effort_ceiling ?? DEFAULT_GENERATION_CONFIG.effort_ceiling,
    exploration_budget: data.exploration_budget ?? DEFAULT_GENERATION_CONFIG.exploration_budget,
  };
}

async function getRecentMealHistory(userId: string): Promise<MealHistory> {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const sinceDate = twoWeeksAgo.toISOString().split('T')[0];

  const { data: plans } = await supabase
    .from('meal_plans')
    .select(`
      id,
      week_start_date,
      meal_plan_items (
        day_of_week,
        meal_slot,
        meal_anchor,
        meal_plates (
          meal_plate_components (dish_id)
        )
      )
    `)
    .eq('user_id', userId)
    .gte('week_start_date', sinceDate);

  const recentDishIds = new Set<string>();
  const recentSlotDishIds = new Map<string, Set<string>>();
  const recentDishAnchorPairs = new Set<string>();
  const recentPlanSignatures = new Set<string>();

  (plans || []).forEach((plan: any) => {
    const mealsForSignature: Array<{
      day: number;
      slot: string;
      meal_anchor: MealAnchor;
      components: Array<{ dish_id?: string | null }>;
    }> = [];

    plan.meal_plan_items?.forEach((item: any) => {
      const slotKey = `${item.day_of_week}-${item.meal_slot}`;
      const anchor = item.meal_anchor || MealAnchor.RICE_PLATE;
      const dishIds = (item.meal_plates?.meal_plate_components || [])
        .map((comp: any) => comp.dish_id)
        .filter(Boolean);

      dishIds.forEach((dishId: string) => {
        recentDishIds.add(dishId);
        recentDishAnchorPairs.add(`${dishId}:${anchor}`);
        if (!recentSlotDishIds.has(slotKey)) {
          recentSlotDishIds.set(slotKey, new Set());
        }
        recentSlotDishIds.get(slotKey)!.add(dishId);
      });

      mealsForSignature.push({
        day: item.day_of_week,
        slot: item.meal_slot,
        meal_anchor: anchor,
        components: dishIds.map((dishId: string) => ({ dish_id: dishId })),
      });
    });

    if (mealsForSignature.length > 0) {
      const signature = mealsForSignature
        .map(meal => `${meal.day}-${meal.slot}:${meal.meal_anchor}:${meal.components.map(c => c.dish_id).sort().join('|')}`)
        .sort()
        .join('::');
      recentPlanSignatures.add(hashWeeklySignature(signature));
    }
  });

  const { data: explorationEvents } = await supabase
    .from('meal_exploration_events')
    .select('dish_id, meal_anchor')
    .eq('user_id', userId)
    .gte('created_at', `${sinceDate}T00:00:00`);

  const recentExploredPairs = new Set<string>();
  (explorationEvents || []).forEach((event: any) => {
    if (event.dish_id && event.meal_anchor) {
      recentExploredPairs.add(`${event.dish_id}:${event.meal_anchor}`);
    }
  });

  return {
    recentDishIds,
    recentSlotDishIds,
    recentDishAnchorPairs,
    recentPlanSignatures,
    recentExploredPairs,
  };
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
  console.time(`[${timestamp}] ⏱️  TOTAL: tryGetDishesFromDatabase`);
  
  // Calculate how many dishes this slot needs
  let dishCount = 1;
  if (slot === 'breakfast') dishCount = 2;
  if (slot === 'lunch' || slot === 'dinner') dishCount = 3;
  
  console.log(`[${timestamp}] 🔍 Looking for ${dishCount} dishes for ${slot}`);
  
  // Get ALL suitable dishes in ONE query
  console.time(`[${timestamp}] ⏱️  Query: Get all dishes`);
  const { data: allDishes } = await supabase
    .from('dishes')
    .select('id, canonical_name, usage_count, typical_meal_slots')
    .order('usage_count', { ascending: false });
  console.timeEnd(`[${timestamp}] ⏱️  Query: Get all dishes`);
  
  if (!allDishes || allDishes.length === 0) {
    console.log(`[${timestamp}] 🤖 No dishes in database, will use AI`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: tryGetDishesFromDatabase`);
    return null;
  }
  
  console.log(`[${timestamp}] 📚 Loaded ${allDishes.length} dishes`);
  
  // Filter for this meal type (in memory, fast!)
  console.time(`[${timestamp}] ⏱️  Process: Filter & select in-memory`);
  const suitableDishes = allDishes.filter(d => 
    d.typical_meal_slots && Array.isArray(d.typical_meal_slots) && d.typical_meal_slots.includes(slot.toLowerCase())
  );
  
  if (suitableDishes.length === 0) {
    console.timeEnd(`[${timestamp}] ⏱️  Process: Filter & select in-memory`);
    console.log(`[${timestamp}] 🤖 No dishes for ${slot} in database, will use AI`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: tryGetDishesFromDatabase`);
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
  
  console.timeEnd(`[${timestamp}] ⏱️  Process: Filter & select in-memory`);
  
  // Only return if we have enough dishes
  if (selected.length >= dishCount) {
    console.log(`[${timestamp}] ✅ Found ${selected.length} dishes from database for ${slot} (${selectedNew.length} new + ${selectedRecent.length} recent)`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: tryGetDishesFromDatabase`);
    return selected.slice(0, dishCount);
  }
  
  console.log(`[${timestamp}] 🤖 Only found ${selected.length}/${dishCount} dishes, will use AI`);
  console.timeEnd(`[${timestamp}] ⏱️  TOTAL: tryGetDishesFromDatabase`);
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const timestamp = getISTTimestamp();
    const { userId, mealPlanId, dayOfWeek, slot, excludeDishes = [] } = await request.json();

    if (!userId || !mealPlanId || dayOfWeek === undefined || !slot) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] 🔄 REGENERATING SINGLE SLOT`);
    console.log(`${'='.repeat(80)}`);
    console.log(`[${timestamp}] Target: Day ${dayOfWeek}, ${slot}`);
    console.log(`[${timestamp}] Excluding: ${excludeDishes.length > 0 ? excludeDishes.join(', ') : 'none'}\n`);
    console.time(`[${timestamp}] ⏱️  TOTAL: Single slot regeneration`);

    // ============================================================================
    // UNIFIED COMPOSITION: Try database first, fallback to AI
    // ============================================================================
    
    // Step 1: Get recently used dishes
    console.log(`[${timestamp}] 📋 Step 1: Fetching recently used dishes...`);
    const recentDishIds = await getRecentlyUsedDishes(userId);
    console.log(`[${timestamp}] ✅ Found ${recentDishIds.length} dishes used in last 2 weeks\n`);
    
    const recentDishSet = new Set(recentDishIds);
    
    // Step 2: Try to compose meal from database using component-based logic
    console.log(`[${timestamp}] 📋 Step 2: Trying to compose meal from database...`);
    const excludeDishIds = new Set<string>();
    
    const { data: planItems } = await supabase
      .from('meal_plan_items')
      .select('day_of_week, meal_slot, meal_anchor, meal_plates(meal_plate_components(dish_id))')
      .eq('meal_plan_id', mealPlanId);
    
    planItems?.forEach((item: any) => {
      const isCurrentSlot = item.day_of_week === dayOfWeek && item.meal_slot === slot;
      if (isCurrentSlot) return;
      
      item.meal_plates?.meal_plate_components?.forEach((comp: any) => {
        if (comp.dish_id) excludeDishIds.add(comp.dish_id);
      });
    });
    
    if (slot === 'evening_snack') {
      planItems?.forEach((item: any) => {
        if (item.day_of_week === dayOfWeek && item.meal_slot === 'morning_snack') {
          item.meal_plates?.meal_plate_components?.forEach((comp: any) => {
            if (comp.dish_id) excludeDishIds.add(comp.dish_id);
          });
        }
      });
    }

    const planConfig = await getMealPlanGenerationConfig(mealPlanId);
    const history = await getRecentMealHistory(userId);

    const slotsList: Array<{ slot: MealSlot; dayOfWeek: number }> = [];
    for (let day = 0; day < 7; day++) {
      for (const slotName of ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner'] as MealSlot[]) {
        slotsList.push({ slot: slotName, dayOfWeek: day });
      }
    }

    const anchorPlan = buildWeeklyAnchorPlan({
      slots: slotsList,
      ricePlateRatio: planConfig.rice_plate_ratio,
      rotiPlateRatio: planConfig.roti_plate_ratio,
    });

    const policy = createMealPolicyState({
      overlapRatio: 0.25,
      explorationBudget: planConfig.exploration_budget ?? 1,
    });
    const policyLogs: MealPolicyLogInsert[] = [];
    const logCandidate = (entry: {
      decision: 'accepted' | 'rejected';
      reason?: string;
      dish: Dish;
      anchor: MealAnchor;
      slot: MealSlot;
      dayOfWeek: number;
      role: string;
      overlapStatus: string;
      explorationUsed: boolean;
      componentType: ComponentType;
    }) => {
      policyLogs.push({
        user_id: userId,
        meal_plan_id: mealPlanId,
        meal_plan_item_id: null,
        dish_variant_id: entry.dish.id,
        dish_universe_id: entry.dish.dish_universe_id ?? null,
        meal_anchor: entry.anchor,
        day_of_week: entry.dayOfWeek,
        meal_slot: entry.slot,
        decision: entry.decision,
        reason: entry.reason ?? null,
        dish_role: entry.role ?? null,
        overlap_status: entry.overlapStatus ?? null,
        exploration_flag: entry.explorationUsed ?? false,
        metadata: {
          component_type: entry.componentType,
          dish_name: entry.dish.canonical_name,
        },
      });
    };

    const currentSlotAnchor = planItems?.find((item: any) =>
      item.day_of_week === dayOfWeek && item.meal_slot === slot
    )?.meal_anchor;

    const anchor = currentSlotAnchor || anchorPlan.get(`${dayOfWeek}-${slot}`) || MealAnchor.RICE_PLATE;

    // Get all dishes from database for matching and policy seeding
    const { data: allDishes } = await supabase
      .from('dishes')
      .select('id, canonical_name, aliases, primary_component_type, effort_level, serving_context_weight, usage_count, dish_universe_id');

    const dishNameMap = new Map<string, string>();
    const dishLookup = new Map<string, Dish>();
    allDishes?.forEach(dish => {
      dishLookup.set(dish.id, dish as Dish);
      dishNameMap.set(dish.canonical_name.toLowerCase(), dish.id);
      dish.aliases?.forEach((alias: string) => {
        dishNameMap.set(alias.toLowerCase(), dish.id);
      });
    });

    // Seed policy with existing plan items (excluding current slot)
    planItems?.forEach((item: any) => {
      const isCurrentSlot = item.day_of_week === dayOfWeek && item.meal_slot === slot;
      if (isCurrentSlot) return;

      const dishIds = (item.meal_plates?.meal_plate_components || [])
        .map((comp: any) => comp.dish_id)
        .filter(Boolean);
      const mealAnchor = item.meal_anchor || MealAnchor.RICE_PLATE;
      const mealSignature = buildMealSignature(item.meal_slot as MealSlot, mealAnchor, dishIds);
      policy.usedMealSignatures.add(mealSignature);

      dishIds.forEach((dishId: string) => {
        policy.usedUniqueDishIds.add(dishId);
        const dish = dishLookup.get(dishId);
        if (dish && isOverlapCandidate(dish, history)) {
          policy.overlapDishIds.add(dishId);
        }
      });
    });
    
    const composedDishes = await composeMealFromDatabase(
      userId,
      slot as MealSlot,
      dayOfWeek,
      recentDishSet,
      excludeDishIds,
      {
        anchor,
        history,
        policy,
        effortCeiling: planConfig.effort_ceiling ?? DishEffortLevel.MEDIUM,
        logCandidate,
      }
    );
    console.log('');
    
    let targetMeal: any;
    const sourceIsDatabase = !!(composedDishes && composedDishes.length > 0);
    
    let aiExcludeDishes = [...excludeDishes];
    if (excludeDishIds.size > 0) {
      const { data: excludeDishesData } = await supabase
        .from('dishes')
        .select('canonical_name')
        .in('id', Array.from(excludeDishIds));
      
      if (excludeDishesData && excludeDishesData.length > 0) {
        aiExcludeDishes = [
          ...new Set([
            ...aiExcludeDishes,
            ...excludeDishesData.map(d => d.canonical_name)
          ])
        ];
      }
    }
    
    if (sourceIsDatabase) {
      // Success! Use composed meal from database
      console.log(`[${timestamp}] ✅ Composed ${composedDishes.length} dishes from database (no AI needed)`);
      
      targetMeal = {
        day: dayOfWeek,
        slot,
        meal_anchor: anchor,
        components: composedDishes.map((entry: any, idx: number) => ({
          dish_id: entry.dish.id,
          dish_name: entry.dish.canonical_name,
          component_type: entry.componentType || entry.dish.primary_component_type || ComponentType.OTHER,
          is_optional: idx >= 2,
          exploration: entry.exploration || false,
          role: entry.role,
          weight_band: entry.weightBand,
          overlap_status: entry.overlapStatus,
        }))
      };
    } else {
      // Step 3: Fallback to AI
      console.log(`[${timestamp}] 📋 Step 3: Calling AI to generate meal...`);
      console.time(`[${timestamp}] ⏱️  AI: generateWeeklyMealPlan`);
      
      const generatedPlan = await generateWeeklyMealPlan(userId, aiExcludeDishes);
      
      console.timeEnd(`[${timestamp}] ⏱️  AI: generateWeeklyMealPlan`);

      // Find the meal for this specific day/slot
      targetMeal = generatedPlan.meals.find(
        (m: any) => m.day === dayOfWeek && m.slot === slot
      );

      if (!targetMeal || !targetMeal.components || targetMeal.components.length === 0) {
        return NextResponse.json({ error: 'Failed to generate meal' }, { status: 500 });
      }
      
      console.log(`[${timestamp}] ✅ AI generated ${targetMeal.components.length} components for ${slot}\n`);
    }

    console.log(`[${timestamp}] 📋 Step 4: Saving to database...`);
    console.time(`[${timestamp}] ⏱️  Database: Insert components`);

    if (!sourceIsDatabase) {
      targetMeal.meal_anchor = anchor;
      const evaluated = applyPolicyToMealComponents({
        components: targetMeal.components || [],
        day: dayOfWeek,
        slot: slot as MealSlot,
        anchor,
        dishNameMap,
        dishLookup,
        history,
        policy,
        effortCeiling: planConfig.effort_ceiling ?? DishEffortLevel.MEDIUM,
      });
      if (evaluated.logs.length > 0) {
        evaluated.logs.forEach(log => {
          policyLogs.push({
            user_id: userId,
            meal_plan_id: mealPlanId,
            meal_plan_item_id: null,
            dish_variant_id: log.dish_id ?? null,
            dish_universe_id: log.dish_universe_id ?? null,
            meal_anchor: log.meal_anchor,
            day_of_week: log.day_of_week,
            meal_slot: log.meal_slot,
            decision: log.decision,
            reason: log.reason ?? null,
            dish_role: log.dish_role ?? null,
            overlap_status: log.overlap_status ?? null,
            exploration_flag: log.exploration ?? false,
            metadata: log.metadata ?? null,
          });
        });
      }

      const minComponents = getMinComponentsForAnchor(slot as MealSlot, anchor);
      if (evaluated.components.length < minComponents) {
        return NextResponse.json({ error: 'Failed to generate valid meal' }, { status: 500 });
      }

      const mealSignature = buildMealSignature(slot as MealSlot, anchor, evaluated.components.map((comp: any) => comp.dish_id).filter(Boolean));
      if (policy.usedMealSignatures.has(mealSignature)) {
        return NextResponse.json({ error: 'Duplicate meal detected' }, { status: 409 });
      }
      policy.usedMealSignatures.add(mealSignature);

      targetMeal.components = evaluated.components;
    }

    // Find the existing meal_plan_item for this slot
    const { data: existingItem } = await supabase
      .from('meal_plan_items')
      .select('id, meal_plates(id)')
      .eq('meal_plan_id', mealPlanId)
      .eq('day_of_week', dayOfWeek)
      .eq('meal_slot', slot)
      .maybeSingle();

    let meal_plate_id: string;
    let mealPlanItemId: string | null = existingItem?.id || null;

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

      await supabase
        .from('meal_plan_items')
        .update({
          meal_anchor: anchor,
          dish_name: targetMeal.components[0]?.dish_name || 'Multi-dish meal',
        })
        .eq('id', existingItem.id);
    } else {
      // Create new meal_plan_item and plate
      const { data: newPlate, error: plateError } = await supabase
        .from('meal_plates')
        .insert({})
        .select('id')
        .single();
      
      if (plateError) throw plateError;
      meal_plate_id = newPlate.id;

      const { data: insertedItem } = await supabase
        .from('meal_plan_items')
        .insert({
          meal_plan_id: mealPlanId,
          day_of_week: dayOfWeek,
          meal_slot: slot,
          meal_anchor: anchor,
          meal_plate_id,
          is_skipped: false,
          dish_name: targetMeal.components[0]?.dish_name || 'Multi-dish meal',
        })
        .select('id')
        .single();

      mealPlanItemId = insertedItem?.id || null;
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
          exploration: component.exploration || false,
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
      } else {
        const explorationPayload = (targetMeal.components || [])
          .filter((comp: any) => comp.exploration && comp.dish_id)
          .map((comp: any) => ({
            user_id: userId,
            meal_plan_id: mealPlanId,
            meal_plan_item_id: mealPlanItemId,
            dish_id: comp.dish_id,
            meal_anchor: anchor,
            day_of_week: dayOfWeek,
            meal_slot: slot,
            weight_band: comp.weight_band || 'unknown',
            role: comp.role || 'unknown',
            metadata: {
              component_type: comp.component_type,
              dish_name: comp.dish_name,
            },
          }));
        if (explorationPayload.length > 0) {
          const { error: explorationError } = await supabase
            .from('meal_exploration_events')
            .insert(explorationPayload);
          if (explorationError) {
            console.error(`[${timestamp}] ❌ Failed to log exploration events:`, explorationError);
          }
        }
      }
    }

    if (policyLogs.length > 0) {
      const { error: policyLogError } = await supabase
        .from('meal_policy_logs')
        .insert(policyLogs);
      if (policyLogError) {
        console.error(`[${timestamp}] ❌ Failed to log policy decisions:`, policyLogError);
      }
    }

    console.timeEnd(`[${timestamp}] ⏱️  Database: Insert components`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: Single slot regeneration`);
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] ✅ SLOT REGENERATION COMPLETE`);
    console.log(`${'='.repeat(80)}`);
    console.log(`[${timestamp}] 📊 Summary:`);
    console.log(`[${timestamp}]    • Slot: Day ${dayOfWeek}, ${slot}`);
    console.log(`[${timestamp}]    • Components added: ${componentsToInsert.length}`);
    console.log(`[${timestamp}]    • Source: ${sourceIsDatabase ? 'Database' : 'AI'}`);
    console.log(`${'='.repeat(80)}\n`);

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
