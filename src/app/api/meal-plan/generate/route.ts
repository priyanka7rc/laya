import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateWeeklyMealPlan } from '@/lib/mealPlanGenerator';
import { compileDish } from '@/lib/dishCompiler';
import { checkRateLimit } from '@/lib/rateLimiter';
import { checkTokenLimit } from '@/lib/tokenLimits';
import { ComponentType, MealSlot, Dish, MealAnchor, DishEffortLevel, MealPolicyLogInsert } from '@/types/relish';
import { getISTTimestamp } from '@/lib/utils/dateUtils';
import { batchComposeMeals } from '@/lib/mealComposer';
import { MEAL_COMPOSITION_RULES } from '@/config/meal-composition';
import {
  buildCandidatesByComponentType,
  normalizeCanonicalName,
  normalizeMealSlot,
} from '@/lib/mealPlanAiContract';
import {
  buildMealSignature,
  buildWeeklyAnchorPlan,
  createMealPolicyState,
  applyPolicyToMealComponents,
  type MealHistory,
  type MealPolicyState,
  type MealPlanGenerationConfigShape,
} from '@/lib/mealPlanPolicy';
import crypto from 'crypto';

// Create Supabase client with service role for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ============================================================================
// Helper: Normalize date to Monday of the week
// ============================================================================

function normalizeToMonday(dateString: string): string {
  const date = new Date(dateString);
  const currentDay = date.getUTCDay();
  
  // Calculate days to subtract to get to Monday (1)
  // Sunday (0) -> subtract 6 days, Monday (1) -> subtract 0, Tuesday (2) -> subtract 1, etc.
  const daysToMonday = currentDay === 0 ? 6 : currentDay - 1;
  
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - daysToMonday);
  
  return monday.toISOString().split('T')[0];
}

const DEFAULT_GENERATION_CONFIG: MealPlanGenerationConfigShape = {
  rice_plate_ratio: 0.5,
  roti_plate_ratio: 0.5,
  familiarity_mode: 'balanced',
  effort_ceiling: DishEffortLevel.MEDIUM,
  exploration_budget: 1,
};

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

function hashWeeklySignature(signature: string): string {
  return crypto.createHash('sha256').update(signature).digest('hex');
}

function buildWeeklySignature(meals: Array<{
  day: number;
  slot: string;
  meal_anchor: MealAnchor;
  components: Array<{ dish_id?: string | null }>;
}>): string {
  const normalized = meals
    .map(meal => {
      const dishIds = (meal.components || [])
        .map(component => component.dish_id)
        .filter(Boolean)
        .sort()
        .join('|');
      return `${meal.day}-${meal.slot}:${meal.meal_anchor}:${dishIds}`;
    })
    .sort()
    .join('::');
  return normalized;
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
      const signature = buildWeeklySignature(mealsForSignature);
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
 * Compose meals for the week using unified database-first approach
 * Uses intelligent component-based composition for ALL meal types
 * Returns slots that need AI generation (couldn't compose from database)
 * 
 * IMPORTANT: Only generates meals from TODAY forward if this is the current week
 */
async function composeMealsForWeek(
  userId: string,
  weekStartDate: string,
  timestamp: string,
  config: MealPlanGenerationConfigShape,
  history: MealHistory,
  policy: MealPolicyState,
  anchorPlan: Map<string, MealAnchor>,
  logCandidate?: (entry: {
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
  }) => void
): Promise<{
  filledSlots: Map<string, any[]>;
  emptySlots: Array<{ day: number; slot: string }>;
}> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[${timestamp}] 🚀 STARTING UNIFIED MEAL COMPOSITION`);
  console.log(`${'='.repeat(80)}\n`);
  console.time(`[${timestamp}] ⏱️  TOTAL: composeMealsForWeek`);
  
  // Step 1: Check if this is the current week and calculate start day
  const today = new Date();
  const todayString = today.toISOString().split('T')[0];
  const currentMonday = normalizeToMonday(todayString);
  const isCurrentWeek = weekStartDate === currentMonday;
  
  // Calculate which day of week today is (0=Mon, 1=Tue, ..., 6=Sun)
  let startDay = 0;
  if (isCurrentWeek) {
    const weekStart = new Date(weekStartDate);
    const daysSinceMonday = Math.floor((today.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));
    startDay = Math.max(0, Math.min(6, daysSinceMonday)); // Clamp between 0-6
    
    if (startDay > 0) {
      console.log(`[${timestamp}] 📅 Current week - generating only from day ${startDay} (${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][startDay]}) to Sunday`);
    }
  } else if (weekStartDate < currentMonday) {
    // Past week - don't generate anything
    console.log(`[${timestamp}] ⏭️  Past week detected - skipping generation (past weeks require manual user input)`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: composeMealsForWeek`);
    return { filledSlots: new Map(), emptySlots: [] };
  }
  
  // Step 2: Use recently used dishes from history
  console.log(`[${timestamp}] 📋 Step 1: Using recently used dishes from history...`);
  const recentDishSet = history.recentDishIds;
  console.log(`[${timestamp}] ✅ Found ${recentDishSet.size} dishes used in last 2 weeks\n`);
  
  // Step 3: Generate slots only from today forward
  const slots = ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner'] as MealSlot[];
  const allSlots: Array<{ slot: MealSlot; dayOfWeek: number }> = [];
  
  for (let day = startDay; day < 7; day++) {
    for (const slot of slots) {
      allSlots.push({ slot, dayOfWeek: day });
    }
  }
  
  if (allSlots.length === 0) {
    console.log(`[${timestamp}] ℹ️  No slots to generate (all days are in the past)`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: composeMealsForWeek`);
    return { filledSlots: new Map(), emptySlots: [] };
  }
  
  console.log(`[${timestamp}] 📋 Step 2: Composing ${allSlots.length} meals using component-based logic...`);
  // Step 4: Use batch meal composer (fetches all dishes once, composes all meals)
  const composedMeals = await batchComposeMeals(userId, allSlots, recentDishSet, {
    anchorPlan,
    history,
    policy,
    effortCeiling: config.effort_ceiling ?? DishEffortLevel.MEDIUM,
    logCandidate,
  });
  
  // Step 5: Convert composed meals to expected format
  const filledSlots = new Map<string, any[]>();
  const emptySlots: Array<{ day: number; slot: string }> = [];
  
  for (const { slot, dayOfWeek } of allSlots) {
    const slotKey = `${dayOfWeek}-${slot}`;
    const dishes = composedMeals.get(slotKey);
    
    if (dishes && dishes.length > 0) {
      // Successfully composed meal from database
      filledSlots.set(slotKey, dishes.map((entry: any, idx: number) => ({
        dish_id: entry.dish.id,
        dish_name: entry.dish.canonical_name,
        component_type: entry.componentType || entry.dish.primary_component_type || 'other',
        is_optional: idx >= 2,
        exploration: entry.exploration || false,
        role: entry.role,
        weight_band: entry.weightBand,
        overlap_status: entry.overlapStatus,
        meal_anchor: anchorPlan.get(slotKey),
      })));
    } else {
      // Couldn't compose, need AI
      emptySlots.push({ day: dayOfWeek, slot });
    }
  }
  
  console.timeEnd(`[${timestamp}] ⏱️  TOTAL: composeMealsForWeek`);
  console.log(`[${timestamp}] ✅ Composed ${filledSlots.size}/${allSlots.length} meals from database`);
  console.log(`[${timestamp}] 🤖 ${emptySlots.length} slots need AI generation\n`);
  
  return { filledSlots, emptySlots };
}

export async function POST(request: NextRequest) {
  try {
    const timestamp = getISTTimestamp();
    const { weekStartDate: rawWeekStartDate, userId, excludeDishes = [] } = await request.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // ============================================================================
    // CRITICAL: Normalize weekStartDate to Monday to prevent duplicate meal plans
    // ============================================================================
    const weekStartDate = normalizeToMonday(rawWeekStartDate);
    if (weekStartDate !== rawWeekStartDate) {
      console.log(`[${timestamp}] 📅 Normalized week start date: ${rawWeekStartDate} → ${weekStartDate} (Monday)`);
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

    // 3. Get or create meal plan early (needed for config)
    let { data: mealPlan, error: planError } = await supabase
      .from('meal_plans')
      .select('id, week_start_date, week_name')
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
        .select('id, week_start_date, week_name')
        .single();

      if (createError) throw createError;
      mealPlan = newPlan;
      console.log(`[${timestamp}] ✅ Created meal plan: ${mealPlan.week_name} (ID: ${mealPlan.id})`);
    } else {
      console.log(`[${timestamp}] ✅ Found existing meal plan: ${mealPlan.week_name} (ID: ${mealPlan.id})`);
    }

    const planConfig = await getMealPlanGenerationConfig(mealPlan.id);
    const history = await getRecentMealHistory(userId);

    // Build anchor plan and policy state
    const today = new Date();
    const todayString = today.toISOString().split('T')[0];
    const currentMonday = normalizeToMonday(todayString);
    const isCurrentWeek = weekStartDate === currentMonday;
    let startDay = 0;
    if (isCurrentWeek) {
      const weekStart = new Date(weekStartDate);
      const daysSinceMonday = Math.floor((today.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24));
      startDay = Math.max(0, Math.min(6, daysSinceMonday));
    }

    const slotsList: Array<{ slot: MealSlot; dayOfWeek: number }> = [];
    for (let day = startDay; day < 7; day++) {
      for (const slot of ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner'] as MealSlot[]) {
        slotsList.push({ slot, dayOfWeek: day });
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
        meal_plan_id: mealPlan.id,
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

    // ============================================================================
    // UNIFIED COMPOSITION: Database-first with intelligent component matching
    // ============================================================================
    
    console.time(`[${timestamp}] ⏱️  TOTAL: Unified meal composition`);
    
    // Step 1: Compose meals from database using component-based logic
    const { filledSlots, emptySlots } = await composeMealsForWeek(
      userId,
      weekStartDate,
      timestamp,
      planConfig,
      history,
      policy,
      anchorPlan,
      logCandidate
    );
    
    let generatedPlan: any = { meals: [] };
    
    // Step 2: Only call AI if there are empty slots
    if (emptySlots.length > 0) {
      console.log(`[${timestamp}] 🤖 Calling AI to generate ${emptySlots.length} slots...`);
      console.time(`[${timestamp}] ⏱️  AI: generateWeeklyMealPlan`);
      const aiExcludeDishes = [...new Set(excludeDishes)];
      generatedPlan = await generateWeeklyMealPlan(userId, aiExcludeDishes);
      console.timeEnd(`[${timestamp}] ⏱️  AI: generateWeeklyMealPlan`);
      console.log(`[${timestamp}] ✅ OpenAI returned ${generatedPlan.meals.length} meals\n`);
    } else {
      console.log(`[${timestamp}] ✅ All slots filled from database! No AI needed.\n`);
    }

    // Fetch dishes for matching and policy evaluation
    const { data: allDishes, error: dishesError } = await supabase
      .from('dishes')
      .select('id, canonical_name, aliases, primary_component_type, effort_level, serving_context_weight, usage_count, dish_universe_id');

    if (dishesError) throw dishesError;

    const dishNameMap = new Map<string, string>();
    const dishLookup = new Map<string, Dish>();
    allDishes?.forEach(dish => {
      dishLookup.set(dish.id, dish as Dish);
      dishNameMap.set(dish.canonical_name.toLowerCase(), dish.id);
    });
    const candidatesByComponentType = buildCandidatesByComponentType(allDishes || []);

    // Step 3: Merge database-filled slots with AI-generated slots using policy
    console.log(`[${timestamp}] 📋 Step 4: Merging database dishes with AI dishes...`);
    console.time(`[${timestamp}] ⏱️  Process: Merge DB & AI meals`);

    const allMeals: any[] = [];
    const retrySlots: Array<{ day: number; slot: MealSlot }> = [];
    const retrySlotKeys = new Set<string>();
    const usedCanonicals = new Set<string>();

    for (let day = 0; day < 7; day++) {
      for (const slot of ['breakfast', 'morning_snack', 'lunch', 'evening_snack', 'dinner'] as MealSlot[]) {
        const slotKey = `${day}-${slot}`;
        const anchor = anchorPlan.get(slotKey) || MealAnchor.RICE_PLATE;

        if (filledSlots.has(slotKey)) {
          const components = (filledSlots.get(slotKey) || []).map(component => {
            if (component.dish_id) {
              const dish = dishLookup.get(component.dish_id);
              if (dish?.canonical_name) {
                const canonical = normalizeCanonicalName(dish.canonical_name);
                usedCanonicals.add(canonical);
                return { ...component, dish_canonical_name: canonical };
              }
            }
            return component;
          });
          const mealSignature = buildMealSignature(slot, anchor, components.map(component => component.dish_id).filter(Boolean));
          if (!policy.usedMealSignatures.has(mealSignature)) {
            policy.usedMealSignatures.add(mealSignature);
          }

          const meal = {
            day,
            slot,
            meal_anchor: anchor,
            components,
            source: 'db',
          };
          allMeals.push(meal);

          continue;
        }

        const aiMeal = generatedPlan.meals.find((m: any) => m.day === day && m.slot === slot);
        if (!aiMeal) continue;

        const normalized = normalizeMealSlot({
          day,
          slot,
          components: aiMeal.components || [],
          usedCanonicals,
          candidatesByComponentType,
        });
        aiMeal.components = normalized.components;
        if (normalized.needsRetry && !retrySlotKeys.has(slotKey)) {
          retrySlots.push({ day, slot });
          retrySlotKeys.add(slotKey);
        }
        if (aiMeal.components.length === 0) {
          if (!retrySlotKeys.has(slotKey)) {
            retrySlots.push({ day, slot });
            retrySlotKeys.add(slotKey);
          }
          continue;
        }

        const evaluated = applyPolicyToMealComponents({
          components: aiMeal.components || [],
          day,
          slot,
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
              meal_plan_id: mealPlan.id,
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

        const minComponents = getMinComponentsForAnchor(slot, anchor);
        if (evaluated.components.length < minComponents) {
          console.log(`[${timestamp}] ⚠️ AI meal incomplete for ${slotKey} - preserving best effort`);
        }

        const mealSignature = buildMealSignature(slot, anchor, evaluated.components.map(component => component.dish_id).filter(Boolean));
        if (policy.usedMealSignatures.has(mealSignature)) {
          console.log(`[${timestamp}] ❌ Duplicate meal signature for ${slotKey}`);
          retrySlots.push({ day, slot });
          continue;
        }
        policy.usedMealSignatures.add(mealSignature);

        const meal = {
          day,
          slot,
          meal_anchor: anchor,
          components: evaluated.components,
          source: 'ai',
        };
        allMeals.push(meal);
      }
    }

    if (retrySlots.length > 0) {
      console.log(`[${timestamp}] 🔁 Re-trying ${retrySlots.length} slots due to policy constraints...`);
      const retryExclude = [...new Set([...excludeDishes])];
      const retryPlan = await generateWeeklyMealPlan(userId, retryExclude);

      for (const { day, slot } of retrySlots) {
        const slotKey = `${day}-${slot}`;
        const anchor = anchorPlan.get(slotKey) || MealAnchor.RICE_PLATE;
        const retryMeal = retryPlan.meals.find((m: any) => m.day === day && m.slot === slot);
        if (!retryMeal) continue;

        const normalizedRetry = normalizeMealSlot({
          day,
          slot,
          components: retryMeal.components || [],
          usedCanonicals,
          candidatesByComponentType,
        });
        retryMeal.components = normalizedRetry.components;
        if (retryMeal.components.length === 0) {
          console.warn(`[${timestamp}] ⚠️ Retry failed for ${slotKey} - empty components`);
          continue;
        }

        const evaluated = applyPolicyToMealComponents({
          components: retryMeal.components || [],
          day,
          slot,
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
              meal_plan_id: mealPlan.id,
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

        const minComponents = getMinComponentsForAnchor(slot, anchor);
        if (evaluated.components.length < minComponents) {
          console.warn(`[${timestamp}] ⚠️ Retry incomplete for ${slotKey} - preserving best effort`);
        }

        const mealSignature = buildMealSignature(slot, anchor, evaluated.components.map(component => component.dish_id).filter(Boolean));
        if (policy.usedMealSignatures.has(mealSignature)) {
          console.warn(`[${timestamp}] ⚠️ Retry failed for ${slotKey} - duplicate signature`);
          continue;
        }

        policy.usedMealSignatures.add(mealSignature);
        const meal = {
          day,
          slot,
          meal_anchor: anchor,
          components: evaluated.components,
          source: 'ai',
        };

        const existingIndex = allMeals.findIndex((m: any) => m.day === day && m.slot === slot);
        if (existingIndex >= 0) {
          allMeals[existingIndex] = meal;
        } else {
          allMeals.push(meal);
        }
      }
    }

    console.timeEnd(`[${timestamp}] ⏱️  Process: Merge DB & AI meals`);
    console.log(`[${timestamp}] ✅ Final meal plan: ${allMeals.length} meals (${filledSlots.size} from DB, ${emptySlots.length} from AI)\n`);
    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: Unified meal composition`);

    generatedPlan.meals = allMeals;

    const weeklySignature = hashWeeklySignature(buildWeeklySignature(allMeals));
    if (history.recentPlanSignatures.has(weeklySignature)) {
      console.warn(`[${timestamp}] ❌ Identical weekly plan detected - rejecting generation`);
      return NextResponse.json({ error: 'Identical weekly plan detected' }, { status: 409 });
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
    const preservedSlots = new Set(
      existingItems
        ?.filter((item: any) => item.meal_plates?.meal_plate_components?.length > 0)
        .map((item: any) => `${item.day_of_week}-${item.meal_slot}`) || []
    );

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${timestamp}] 💾 SAVING TO DATABASE`);
    console.log(`${'='.repeat(80)}\n`);
    console.log(`[${timestamp}] 📝 Creating meal plan items for empty slots only...`);
    console.log(`[${timestamp}] Found ${preservedSlots.size} filled slots to preserve (with components)`);
    console.time(`[${timestamp}] ⏱️  TOTAL: Database insertions`);

    let mealsCreated = 0;
    let componentsCreated = 0;

    // 5. Create meal_plan_items ONLY for empty slots (preserve existing!)
    for (const meal of generatedPlan.meals) {
      const slotKey = `${meal.day}-${meal.slot}`;
      
      // Skip if user already has a filled slot (with components)
      if (preservedSlots.has(slotKey)) {
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
          meal_anchor: meal.meal_anchor,
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
        
        const canonicalName = normalizeCanonicalName(comp.dish_canonical_name || comp.dish_name);
        const displayName = comp.dish_display_name || comp.dish_name || canonicalName.replace(/_/g, ' ');
        let matchedDishId = dishNameMap.get(canonicalName);

        // If dish doesn't exist, CREATE it
        if (!matchedDishId) {
          console.log(`[${timestamp}] 📝 Creating new dish: "${canonicalName}"`);
          const { data: newDish, error: dishError } = await supabase
            .from('dishes')
            .insert({
              canonical_name: canonicalName,
              cuisine_tags: ['indian'], // Default
            })
            .select('id')
            .single();

          if (!dishError && newDish) {
            matchedDishId = newDish.id;
            dishNameMap.set(canonicalName, newDish.id); // Add to map for future lookups
            console.log(`[${timestamp}] ✅ Created dish with ID: ${newDish.id}`);
          } else {
            console.error(`[${timestamp}] Failed to create dish "${canonicalName}":`, dishError);
          }
        }

        try {
        components.push({
          meal_plate_id: plateId,
          component_type: validatedType, // Use validated type
          dish_name: displayName,
          dish_id: matchedDishId || null,
          sort_order: idx,
          is_optional: comp.is_optional || false,
          exploration: comp.exploration || false,
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

        const explorationPayload = components
          .filter(c => c.exploration && c.dish_id)
          .map(c => ({
            user_id: userId,
            meal_plan_id: mealPlan.id,
            meal_plan_item_id: mealItem.id,
            dish_id: c.dish_id,
            meal_anchor: meal.meal_anchor,
            day_of_week: meal.day,
            meal_slot: meal.slot,
            weight_band: c.weight_band || 'unknown',
            role: c.role || 'unknown',
            metadata: {
              component_type: c.component_type,
              dish_name: c.dish_name,
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
      } catch (insertError) {
        console.error(`[${timestamp}] ❌ Failed to insert components for ${meal.slot} on day ${meal.day}:`, insertError);
        // Continue with next meal instead of failing completely
      }
    }

    console.timeEnd(`[${timestamp}] ⏱️  TOTAL: Database insertions`);
    console.log(`[${timestamp}] ✅ Created ${mealsCreated} meals with ${componentsCreated} components\n`);

    if (policyLogs.length > 0) {
      const { error: policyLogError } = await supabase
        .from('meal_policy_logs')
        .insert(policyLogs);
      if (policyLogError) {
        console.error(`[${timestamp}] ❌ Failed to log policy decisions:`, policyLogError);
      }
    }

    // 6. Compile any dishes that don't have recipe_variants yet
    console.log(`[${timestamp}] 🔄 Checking for dishes needing compilation...`);
    
    const dishesNeedingCompilation: Array<{ id: string; name: string }> = [];
    
    for (const meal of generatedPlan.meals) {
      for (const comp of meal.components) {
        const canonicalName = normalizeCanonicalName(comp.dish_canonical_name || comp.dish_name);
        const dishId = dishNameMap.get(canonicalName);
        
        if (dishId && !dishesNeedingCompilation.find(d => d.id === dishId)) {
          // Check if this dish has a recipe_variant
          const { data: hasVariant } = await supabase
            .from('recipe_variants')
            .select('id')
            .eq('dish_id', dishId)
            .limit(1)
            .single();
          
          if (!hasVariant) {
            dishesNeedingCompilation.push({ id: dishId, name: comp.dish_display_name || comp.dish_name || canonicalName.replace(/_/g, ' ') });
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

