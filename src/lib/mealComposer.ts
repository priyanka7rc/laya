/**
 * Meal Composer
 * 
 * Intelligently composes balanced meals from database dishes
 * based on component types and meal composition rules.
 */

import { supabaseAdmin } from '@/lib/supabaseClient';
import { Dish, ComponentType, MealSlot, MealAnchor, DishEffortLevel } from '@/types/relish';
import { MEAL_COMPOSITION_RULES } from '@/config/meal-composition';
import {
  buildMealSignature,
  evaluateCandidate,
  getWeightBand,
  registerAcceptedDish,
  type MealHistory,
  type MealPlanGenerationConfigShape,
  type MealPolicyState,
  type DishRole,
  type WeightBand,
  type OverlapStatus,
  isPrimaryComponent,
} from '@/lib/mealPlanPolicy';

export interface ComposedDish {
  dish: Dish;
  componentType: ComponentType;
  role: DishRole;
  weightBand: WeightBand;
  overlapStatus: OverlapStatus;
  exploration: boolean;
}

/**
 * Compose a balanced meal from database dishes
 * 
 * @param userId - User ID (for user-specific preferences in future)
 * @param slot - Meal slot to compose for
 * @param dayOfWeek - Day of week (0-6)
 * @param recentDishes - Set of recently used dish IDs to avoid (25% overlap rule)
 * @returns Composed meal with dishes, or null if composition failed
 */
export async function composeMealFromDatabase(
  userId: string,
  slot: MealSlot,
  dayOfWeek: number,
  recentDishes: Set<string>,
  excludeDishIds: Set<string> = new Set(),
  options?: {
    anchor: MealAnchor;
    history: MealHistory;
    policy: MealPolicyState;
    effortCeiling: DishEffortLevel;
    logCandidate?: (entry: {
      decision: 'accepted' | 'rejected';
      reason?: string;
      dish: Dish;
      anchor: MealAnchor;
      slot: MealSlot;
      dayOfWeek: number;
      role: DishRole;
      overlapStatus: OverlapStatus;
      explorationUsed: boolean;
      componentType: ComponentType;
    }) => void;
  }
): Promise<ComposedDish[] | null> {
  console.log(`\n🎯 [Composer] Starting composition for ${slot} on day ${dayOfWeek}`);
  
  const anchor = options?.anchor ?? defaultAnchorForSlot(slot);
  const rule = getCompositionRuleForAnchor(slot, anchor);
  const selectedDishes: ComposedDish[] = [];
  const selectedTypes = new Set<ComponentType>();
  
  // Step 1: Fetch all available dishes for this slot WITH component types
  console.time(`[Composer] Fetch dishes for ${slot}`);
  const { data: availableDishes, error } = await supabaseAdmin
    .from('dishes')
    .select('*')
    .contains('typical_meal_slots', [slot])
    .not('primary_component_type', 'is', null);
  console.timeEnd(`[Composer] Fetch dishes for ${slot}`);
  
  if (error) {
    console.error(`❌ [Composer] Error fetching dishes:`, error);
    return null;
  }
  
  if (!availableDishes || availableDishes.length === 0) {
    console.log(`❌ [Composer] No dishes available for ${slot}`);
    return null;
  }
  
  console.log(`✅ [Composer] Found ${availableDishes.length} dishes for ${slot}`);
  
  // Step 2: Group dishes by component type
  const dishesByType = new Map<ComponentType, Dish[]>();
  for (const dish of availableDishes) {
    const type = dish.primary_component_type as ComponentType;
    if (!dishesByType.has(type)) {
      dishesByType.set(type, []);
    }
    dishesByType.get(type)!.push(dish);
  }
  
  console.log(`📊 [Composer] Available component types:`, 
    Array.from(dishesByType.keys()).map(t => `${t}(${dishesByType.get(t)!.length})`).join(', ')
  );
  
  const history = options?.history;
  const policy = options?.policy;
  const effortCeiling = options?.effortCeiling ?? DishEffortLevel.MEDIUM;

  // Step 3: Select required components first
  console.log(`🎯 [Composer] Selecting ${rule.required.length} required components...`);
  for (const requiredType of rule.required) {
    const dish = selectDishOfType(requiredType, dishesByType, recentDishes, selectedDishes, excludeDishIds, {
      anchor,
      slot,
      dayOfWeek,
      isPrimary: true,
      history,
      policy,
      effortCeiling,
      logCandidate: options?.logCandidate,
    });
    if (!dish) {
      console.log(`❌ [Composer] Cannot find ${requiredType} dish (required)`);
      return null; // Can't compose meal without required component
    }
    selectedDishes.push(dish);
    selectedTypes.add(requiredType);
    console.log(`  ✅ Selected ${dish.dish.canonical_name} (${requiredType})`);
  }
  
  // Step 4: Add optional components up to maxComponents
  console.log(`🎯 [Composer] Adding optional components (max ${rule.maxComponents})...`);
  const remainingSlots = rule.maxComponents - selectedDishes.length;
  let addedOptional = 0;
  
  for (const optionalType of rule.optional) {
    if (addedOptional >= remainingSlots) break;
    if (selectedTypes.has(optionalType)) continue; // Already have this type
    
    const dish = selectDishOfType(optionalType, dishesByType, recentDishes, selectedDishes, excludeDishIds, {
      anchor,
      slot,
      dayOfWeek,
      isPrimary: false,
      history,
      policy,
      effortCeiling,
      logCandidate: options?.logCandidate,
    });
    if (dish) {
      selectedDishes.push(dish);
      selectedTypes.add(optionalType);
      addedOptional++;
      console.log(`  ✅ Added optional ${dish.dish.canonical_name} (${optionalType})`);
    }
  }
  
  // Step 5: Validate composition
  if (selectedDishes.length < rule.minComponents) {
    console.log(`❌ [Composer] Not enough components (${selectedDishes.length} < ${rule.minComponents})`);
    return null;
  }
  
  if (policy) {
    const mealSignature = buildMealSignature(slot, anchor, selectedDishes.map(item => item.dish.id));
    if (policy.usedMealSignatures.has(mealSignature)) {
      console.log(`❌ [Composer] Duplicate meal signature detected for ${slot} on day ${dayOfWeek}`);
      return null;
    }
    policy.usedMealSignatures.add(mealSignature);
  }

  console.log(`✅ [Composer] Composition complete: ${selectedDishes.length} dishes`);
  return selectedDishes;
}

/**
 * Select a single dish of a specific component type
 * 
 * Prioritizes fresh dishes (not recently used) but falls back to recent if needed
 */
function selectDishOfType(
  componentType: ComponentType,
  dishesByType: Map<ComponentType, Dish[]>,
  recentDishes: Set<string>,
  alreadySelected: ComposedDish[],
  excludeDishIds: Set<string> = new Set(),
  context?: {
    anchor: MealAnchor;
    slot: MealSlot;
    dayOfWeek: number;
    isPrimary: boolean;
    history?: MealHistory;
    policy?: MealPolicyState;
    effortCeiling: DishEffortLevel;
    logCandidate?: (entry: {
      decision: 'accepted' | 'rejected';
      reason?: string;
      dish: Dish;
      anchor: MealAnchor;
      slot: MealSlot;
      dayOfWeek: number;
      role: DishRole;
      overlapStatus: OverlapStatus;
      explorationUsed: boolean;
      componentType: ComponentType;
    }) => void;
  }
): ComposedDish | null {
  const candidates = dishesByType.get(componentType) || [];
  if (candidates.length === 0) return null;
  
  // Filter out already selected dishes
  const alreadySelectedIds = new Set(alreadySelected.map(d => d.dish.id));
  const available = candidates.filter(d => !alreadySelectedIds.has(d.id) && !excludeDishIds.has(d.id));
  if (available.length === 0) return null;
  
  const history = context?.history;
  const policy = context?.policy;
  const anchor = context?.anchor;

  const allowedCandidates: Array<{ dish: Dish; decision: ReturnType<typeof evaluateCandidate> }> = [];

  for (const dish of available) {
    if (!history || !policy || !anchor) {
      allowedCandidates.push({
        dish,
        decision: {
          allowed: true,
          explorationUsed: false,
          weightBand: getWeightBand(100),
          role: 'regular',
          overlapStatus: recentDishes.has(dish.id) ? 'overlap' : 'fresh',
        },
      });
      continue;
    }

    const decision = evaluateCandidate({
      dish,
      anchor,
      slot: context?.slot ?? MealSlot.LUNCH,
      dayOfWeek: context?.dayOfWeek ?? 0,
      componentType,
      isPrimary: context?.isPrimary ?? isPrimaryComponent(componentType),
      effortCeiling: context?.effortCeiling ?? DishEffortLevel.MEDIUM,
      history,
      policy,
    });

    if (!decision.allowed) {
      console.log(`[Composer] ❌ Rejected ${dish.canonical_name} (${componentType}) - ${decision.reason}`);
      context?.logCandidate?.({
        decision: 'rejected',
        reason: decision.reason,
        dish,
        anchor: context?.anchor ?? MealAnchor.RICE_PLATE,
        slot: context?.slot ?? MealSlot.LUNCH,
        dayOfWeek: context?.dayOfWeek ?? 0,
        role: decision.role,
        overlapStatus: decision.overlapStatus,
        explorationUsed: decision.explorationUsed,
        componentType,
      });
      continue;
    }

    allowedCandidates.push({ dish, decision });
  }

  if (allowedCandidates.length === 0) return null;

  // Prefer fresh dishes (not recently used) but allow overlap per policy
  const fresh = allowedCandidates.filter(c => !recentDishes.has(c.dish.id));
  const pool = fresh.length > 0 ? fresh : allowedCandidates;
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  if (policy && anchor) {
    registerAcceptedDish({
      dish: chosen.dish,
      anchor,
      overlapStatus: chosen.decision.overlapStatus,
      explorationUsed: chosen.decision.explorationUsed,
      policy,
    });
  }

  console.log(`[Composer] ✅ Accepted ${chosen.dish.canonical_name} role=${chosen.decision.role} band=${chosen.decision.weightBand} overlap=${chosen.decision.overlapStatus} exploration=${chosen.decision.explorationUsed}`);
  context?.logCandidate?.({
    decision: 'accepted',
    dish: chosen.dish,
    anchor: context?.anchor ?? MealAnchor.RICE_PLATE,
    slot: context?.slot ?? MealSlot.LUNCH,
    dayOfWeek: context?.dayOfWeek ?? 0,
    role: chosen.decision.role,
    overlapStatus: chosen.decision.overlapStatus,
    explorationUsed: chosen.decision.explorationUsed,
    componentType,
  });

  return {
    dish: chosen.dish,
    componentType,
    role: chosen.decision.role,
    weightBand: chosen.decision.weightBand,
    overlapStatus: chosen.decision.overlapStatus,
    exploration: chosen.decision.explorationUsed,
  };
}

/**
 * Batch compose meals for multiple slots
 * 
 * More efficient than calling composeMealFromDatabase individually
 */
export async function batchComposeMeals(
  userId: string,
  slots: Array<{ slot: MealSlot; dayOfWeek: number }>,
  recentDishes: Set<string>,
  options?: {
    anchorPlan?: Map<string, MealAnchor>;
    history?: MealHistory;
    policy?: MealPolicyState;
    effortCeiling?: DishEffortLevel;
    logCandidate?: (entry: {
      decision: 'accepted' | 'rejected';
      reason?: string;
      dish: Dish;
      anchor: MealAnchor;
      slot: MealSlot;
      dayOfWeek: number;
      role: DishRole;
      overlapStatus: OverlapStatus;
      explorationUsed: boolean;
      componentType: ComponentType;
    }) => void;
  }
): Promise<Map<string, ComposedDish[] | null>> {
  console.log(`\n🔀 [Batch Composer] Composing ${slots.length} meals...`);
  console.time('[Batch Composer] Total time');
  
  // Fetch ALL dishes once
  const uniqueSlots = [...new Set(slots.map(s => s.slot))];
  console.log(`📥 [Batch Composer] Fetching dishes for slots: ${uniqueSlots.join(', ')}`);
  
  const { data: allDishes, error } = await supabaseAdmin
    .from('dishes')
    .select('*')
    .not('primary_component_type', 'is', null);
  
  if (error || !allDishes) {
    console.error('❌ [Batch Composer] Error fetching dishes:', error);
    console.timeEnd('[Batch Composer] Total time');
    return new Map();
  }
  
  console.log(`✅ [Batch Composer] Fetched ${allDishes.length} dishes`);
  
  // Pre-group dishes by slot and component type
  const dishesBySlot = new Map<MealSlot, Map<ComponentType, Dish[]>>();
  
  for (const dish of allDishes) {
    const slots = dish.typical_meal_slots as MealSlot[];
    const componentType = dish.primary_component_type as ComponentType;
    
    for (const slot of slots) {
      if (!dishesBySlot.has(slot)) {
        dishesBySlot.set(slot, new Map());
      }
      const typeMap = dishesBySlot.get(slot)!;
      if (!typeMap.has(componentType)) {
        typeMap.set(componentType, []);
      }
      typeMap.get(componentType)!.push(dish);
    }
  }
  
  // Compose each meal
  const results = new Map<string, ComposedDish[] | null>();
  const policy = options?.policy;
  const history = options?.history;
  const effortCeiling = options?.effortCeiling ?? DishEffortLevel.MEDIUM;
  
  for (const { slot, dayOfWeek } of slots) {
    const key = `${dayOfWeek}-${slot}`;
    const anchor = options?.anchorPlan?.get(key) ?? defaultAnchorForSlot(slot);
    const rule = getCompositionRuleForAnchor(slot, anchor);
    const selectedDishes: ComposedDish[] = [];
    const selectedTypes = new Set<ComponentType>();
    const excludeDishIds = new Set<string>();
    
    if (slot === MealSlot.EVENING_SNACK) {
      const morningKey = `${dayOfWeek}-${MealSlot.MORNING_SNACK}`;
      const morningDishes = results.get(morningKey);
      if (morningDishes && morningDishes.length > 0) {
        morningDishes.forEach(dish => excludeDishIds.add(dish.dish.id));
      }
    }
    
    const dishesByType = dishesBySlot.get(slot) || new Map();
    const policySnapshot = policy ? cloneMealPolicyState(policy) : undefined;
    
    // Select required components
    let failed = false;
    for (const requiredType of rule.required) {
      const dish = selectDishOfType(requiredType, dishesByType, recentDishes, selectedDishes, excludeDishIds, {
        anchor,
        slot,
        dayOfWeek,
        isPrimary: true,
        history,
        policy: policySnapshot,
        effortCeiling,
        logCandidate: options?.logCandidate,
      });
      if (!dish) {
        failed = true;
        break;
      }
      selectedDishes.push(dish);
      selectedTypes.add(requiredType);
    }
    
    if (failed) {
      results.set(key, null);
      continue;
    }
    
    // Add optional components
    const remainingSlots = rule.maxComponents - selectedDishes.length;
    let addedOptional = 0;
    
    for (const optionalType of rule.optional) {
      if (addedOptional >= remainingSlots) break;
      if (selectedTypes.has(optionalType)) continue;
      
      const dish = selectDishOfType(optionalType, dishesByType, recentDishes, selectedDishes, excludeDishIds, {
        anchor,
        slot,
        dayOfWeek,
        isPrimary: false,
        history,
        policy: policySnapshot,
        effortCeiling,
        logCandidate: options?.logCandidate,
      });
      if (dish) {
        selectedDishes.push(dish);
        selectedTypes.add(optionalType);
        addedOptional++;
      }
    }
    
    // Validate
    if (selectedDishes.length < rule.minComponents) {
      results.set(key, null);
      continue;
    }

    if (policySnapshot) {
      const mealSignature = buildMealSignature(slot, anchor, selectedDishes.map(item => item.dish.id));
      if (policySnapshot.usedMealSignatures.has(mealSignature)) {
        console.log(`[Batch Composer] ❌ Duplicate meal signature for ${key}`);
        results.set(key, null);
        continue;
      }
      policySnapshot.usedMealSignatures.add(mealSignature);
    }

    results.set(key, selectedDishes);
    if (policy && policySnapshot) {
      copyMealPolicyState(policySnapshot, policy);
    }
  }
  
  console.timeEnd('[Batch Composer] Total time');
  console.log(`✅ [Batch Composer] Composed ${Array.from(results.values()).filter(v => v !== null).length}/${slots.length} meals`);
  
  return results;
}

function defaultAnchorForSlot(slot: MealSlot): MealAnchor {
  if (slot === MealSlot.BREAKFAST) return MealAnchor.BREAKFAST_PLATE;
  if (slot === MealSlot.MORNING_SNACK || slot === MealSlot.EVENING_SNACK || slot === MealSlot.PRE_BREAKFAST) {
    return MealAnchor.SNACK;
  }
  return MealAnchor.RICE_PLATE;
}

function getCompositionRuleForAnchor(slot: MealSlot, anchor: MealAnchor) {
  if ((slot === MealSlot.LUNCH || slot === MealSlot.DINNER) && anchor === MealAnchor.COMPLETE_ONE_BOWL) {
    return {
      required: [ComponentType.CARB],
      optional: [ComponentType.DAIRY, ComponentType.SALAD, ComponentType.CONDIMENT, ComponentType.CRUNCH],
      minComponents: 1,
      maxComponents: 3,
      description: 'Complete one-bowl meal + optional light sides',
    };
  }
  return MEAL_COMPOSITION_RULES[slot];
}

function cloneMealPolicyState(policy: MealPolicyState): MealPolicyState {
  return {
    overlapRatio: policy.overlapRatio,
    usedUniqueDishIds: new Set(policy.usedUniqueDishIds),
    overlapDishIds: new Set(policy.overlapDishIds),
    explorationBudget: policy.explorationBudget,
    usedMealSignatures: new Set(policy.usedMealSignatures),
    currentExploredPairs: new Set(policy.currentExploredPairs),
  };
}

function copyMealPolicyState(source: MealPolicyState, target: MealPolicyState): void {
  target.overlapRatio = source.overlapRatio;
  target.usedUniqueDishIds = new Set(source.usedUniqueDishIds);
  target.overlapDishIds = new Set(source.overlapDishIds);
  target.explorationBudget = source.explorationBudget;
  target.usedMealSignatures = new Set(source.usedMealSignatures);
  target.currentExploredPairs = new Set(source.currentExploredPairs);
}
