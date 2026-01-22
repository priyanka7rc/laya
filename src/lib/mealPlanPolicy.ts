import { Dish, MealAnchor, MealSlot, DishEffortLevel, ComponentType } from '@/types/relish';

export type WeightBand = 'safe' | 'borderline' | 'invalid';
export type DishRole = 'staple_carb' | 'staple_side' | 'regular' | 'novelty';
export type OverlapStatus = 'fresh' | 'overlap';

export interface MealPlanGenerationConfigShape {
  rice_plate_ratio: number;
  roti_plate_ratio: number;
  familiarity_mode: string | null;
  effort_ceiling: DishEffortLevel | null;
  exploration_budget: number;
}

export interface MealHistory {
  recentDishIds: Set<string>;
  recentSlotDishIds: Map<string, Set<string>>;
  recentDishAnchorPairs: Set<string>;
  recentPlanSignatures: Set<string>;
  recentExploredPairs: Set<string>;
}

export interface MealPolicyState {
  overlapRatio: number;
  usedUniqueDishIds: Set<string>;
  overlapDishIds: Set<string>;
  explorationBudget: number;
  usedMealSignatures: Set<string>;
  currentExploredPairs: Set<string>;
}

export interface CandidateDecision {
  allowed: boolean;
  reason?: string;
  explorationUsed: boolean;
  weightBand: WeightBand;
  role: DishRole;
  overlapStatus: OverlapStatus;
}

const EFFORT_RANK: Record<DishEffortLevel, number> = {
  [DishEffortLevel.EASY]: 1,
  [DishEffortLevel.MEDIUM]: 2,
  [DishEffortLevel.HIGH]: 3,
};

const PRIMARY_COMPONENT_TYPES = new Set<ComponentType>([
  ComponentType.CARB,
  ComponentType.PROTEIN,
  ComponentType.VEG,
]);

const UNIVERSAL_STAPLE_UNIVERSES = new Set<string>([
  'dal',
  'rice',
  'roti',
  'carb',
  'breakfast_main',
]);

export function isOverlapCandidate(dish: Dish, history: MealHistory): boolean {
  const universeId = (dish.dish_universe_id || '').toLowerCase();
  return history.recentDishIds.has(dish.id) && !UNIVERSAL_STAPLE_UNIVERSES.has(universeId);
}

const SIDE_COMPONENT_TYPES = new Set<ComponentType>([
  ComponentType.CONDIMENT,
  ComponentType.DAIRY,
  ComponentType.SALAD,
  ComponentType.CRUNCH,
  ComponentType.BROTH,
  ComponentType.BEVERAGE,
  ComponentType.SNACK,
  ComponentType.FRUIT,
  ComponentType.OTHER,
]);

export function getEffortRank(level?: DishEffortLevel | null): number {
  if (!level) return EFFORT_RANK[DishEffortLevel.MEDIUM];
  return EFFORT_RANK[level] ?? EFFORT_RANK[DishEffortLevel.MEDIUM];
}

export function getWeightForAnchor(dish: Dish, anchor: MealAnchor): number {
  const weightMap = dish.serving_context_weight || {};
  const value = weightMap?.[anchor];
  if (typeof value === 'number') return value;
  return 0;
}

export function getWeightBand(weight: number): WeightBand {
  if (weight >= 70) return 'safe';
  if (weight >= 40) return 'borderline';
  return 'invalid';
}

export function deriveDishRole(options: {
  dish: Dish;
  anchor: MealAnchor;
  weightBand: WeightBand;
  weight: number;
  isPrimary: boolean;
  componentType: ComponentType;
  recentExploredPairs: Set<string>;
}): DishRole {
  const { dish, anchor, weightBand, weight, recentExploredPairs } = options;
  const effortRank = getEffortRank(dish.effort_level ?? DishEffortLevel.MEDIUM);
  const exploredKey = `${dish.id}:${anchor}`;
  const recentlyExplored = recentExploredPairs.has(exploredKey);
  const universeId = (dish.dish_universe_id || '').toLowerCase();

  if (weight < 50 || weightBand === 'invalid' || recentlyExplored) {
    return 'novelty';
  }
  if (UNIVERSAL_STAPLE_UNIVERSES.has(universeId) && weight >= 80 && effortRank === EFFORT_RANK[DishEffortLevel.EASY]) {
    return 'staple_carb';
  }
  if (weight >= 80 && effortRank === EFFORT_RANK[DishEffortLevel.EASY]) {
    return 'staple_side';
  }
  return 'regular';
}

export function buildWeeklyAnchorPlan(options: {
  slots: Array<{ slot: MealSlot; dayOfWeek: number }>;
  ricePlateRatio: number;
  rotiPlateRatio: number;
}): Map<string, MealAnchor> {
  const anchorPlan = new Map<string, MealAnchor>();
  const mainSlots = options.slots.filter(({ slot }) => slot === MealSlot.LUNCH || slot === MealSlot.DINNER);
  const totalMain = mainSlots.length;
  const riceRatio = options.ricePlateRatio + options.rotiPlateRatio > 0
    ? options.ricePlateRatio / (options.ricePlateRatio + options.rotiPlateRatio)
    : 0.5;
  const riceTarget = Math.round(totalMain * riceRatio);
  let riceRemaining = riceTarget;
  let rotiRemaining = totalMain - riceTarget;

  for (const { slot, dayOfWeek } of options.slots) {
    const slotKey = `${dayOfWeek}-${slot}`;
    if (slot === MealSlot.BREAKFAST) {
      anchorPlan.set(slotKey, MealAnchor.BREAKFAST_PLATE);
      continue;
    }
    if (slot === MealSlot.MORNING_SNACK || slot === MealSlot.EVENING_SNACK || slot === MealSlot.PRE_BREAKFAST) {
      anchorPlan.set(slotKey, MealAnchor.SNACK);
      continue;
    }
    if (slot === MealSlot.LUNCH || slot === MealSlot.DINNER) {
      if (riceRemaining >= rotiRemaining) {
        anchorPlan.set(slotKey, MealAnchor.RICE_PLATE);
        riceRemaining = Math.max(0, riceRemaining - 1);
      } else {
        anchorPlan.set(slotKey, MealAnchor.ROTI_PLATE);
        rotiRemaining = Math.max(0, rotiRemaining - 1);
      }
    }
  }

  return anchorPlan;
}

export function createMealPolicyState(options: {
  overlapRatio: number;
  explorationBudget: number;
}): MealPolicyState {
  return {
    overlapRatio: options.overlapRatio,
    usedUniqueDishIds: new Set<string>(),
    overlapDishIds: new Set<string>(),
    explorationBudget: options.explorationBudget,
    usedMealSignatures: new Set<string>(),
    currentExploredPairs: new Set<string>(),
  };
}

export function buildMealSignature(slot: MealSlot, anchor: MealAnchor, dishIds: string[]): string {
  const normalized = [...dishIds].sort().join('|');
  return `${slot}:${anchor}:${normalized}`;
}

export function isSideComponent(componentType: ComponentType): boolean {
  return SIDE_COMPONENT_TYPES.has(componentType);
}

export function isPrimaryComponent(componentType: ComponentType): boolean {
  return PRIMARY_COMPONENT_TYPES.has(componentType);
}

export function evaluateCandidate(options: {
  dish: Dish;
  anchor: MealAnchor;
  slot: MealSlot;
  dayOfWeek: number;
  componentType: ComponentType;
  isPrimary: boolean;
  effortCeiling: DishEffortLevel;
  history: MealHistory;
  policy: MealPolicyState;
}): CandidateDecision {
  const { dish, anchor, slot, dayOfWeek, componentType, isPrimary, effortCeiling, history, policy } = options;
  const weight = getWeightForAnchor(dish, anchor);
  const weightBand = getWeightBand(weight);
  const exploredKey = `${dish.id}:${anchor}`;
  const recentExploredPairs = new Set([
    ...history.recentExploredPairs,
    ...policy.currentExploredPairs,
  ]);
  const role = deriveDishRole({
    dish,
    anchor,
    weightBand,
    weight,
    isPrimary,
    componentType,
    recentExploredPairs,
  });
  const overlapCandidate = isOverlapCandidate(dish, history);
  const overlapStatus: OverlapStatus = overlapCandidate ? 'overlap' : 'fresh';
  const alreadyCounted = policy.usedUniqueDishIds.has(dish.id);
  const overlapAlreadyCounted = policy.overlapDishIds.has(dish.id);

  if (getEffortRank(dish.effort_level ?? DishEffortLevel.MEDIUM) > getEffortRank(effortCeiling)) {
    return { allowed: false, reason: 'effort_exceeds_ceiling', explorationUsed: false, weightBand, role, overlapStatus };
  }

  if (weightBand === 'invalid') {
    return { allowed: false, reason: 'invalid_weight_band', explorationUsed: false, weightBand, role, overlapStatus };
  }

  if (recentExploredPairs.has(exploredKey)) {
    return { allowed: false, reason: 'recently_explored_novelty', explorationUsed: false, weightBand, role, overlapStatus };
  }

  const slotKey = `${dayOfWeek}-${slot}`;
  const slotHistory = history.recentSlotDishIds.get(slotKey);
  if (slotHistory && slotHistory.has(dish.id)) {
    return { allowed: false, reason: 'slot_repeat_week_over_week', explorationUsed: false, weightBand, role, overlapStatus };
  }

  const nextUniqueCount = policy.usedUniqueDishIds.size + (alreadyCounted ? 0 : 1);
  const nextOverlapCount = policy.overlapDishIds.size + (overlapCandidate && !overlapAlreadyCounted ? 1 : 0);
  if (nextUniqueCount > 0 && nextOverlapCount / nextUniqueCount > policy.overlapRatio) {
    return { allowed: false, reason: 'overlap_quota_exceeded', explorationUsed: false, weightBand, role, overlapStatus };
  }

  if (weightBand === 'borderline') {
    if (anchor === MealAnchor.COMPLETE_ONE_BOWL || isPrimaryComponent(componentType)) {
      return { allowed: false, reason: 'borderline_primary_not_allowed', explorationUsed: false, weightBand, role, overlapStatus };
    }
    if (!isSideComponent(componentType)) {
      return { allowed: false, reason: 'borderline_side_only', explorationUsed: false, weightBand, role, overlapStatus };
    }
    if (policy.explorationBudget <= 0) {
      return { allowed: false, reason: 'exploration_budget_exhausted', explorationUsed: false, weightBand, role, overlapStatus };
    }
    return { allowed: true, explorationUsed: true, weightBand, role, overlapStatus };
  }

  return { allowed: true, explorationUsed: false, weightBand, role, overlapStatus };
}

export function registerAcceptedDish(options: {
  dish: Dish;
  anchor: MealAnchor;
  overlapStatus: OverlapStatus;
  explorationUsed: boolean;
  policy: MealPolicyState;
}): void {
  const { dish, anchor, overlapStatus, explorationUsed, policy } = options;
  policy.usedUniqueDishIds.add(dish.id);
  if (overlapStatus === 'overlap') {
    policy.overlapDishIds.add(dish.id);
  }
  if (explorationUsed) {
    policy.explorationBudget = Math.max(0, policy.explorationBudget - 1);
    policy.currentExploredPairs.add(`${dish.id}:${anchor}`);
  }
}

export function applyPolicyToMealComponents(options: {
  components: any[];
  day: number;
  slot: MealSlot;
  anchor: MealAnchor;
  dishNameMap: Map<string, string>;
  dishLookup: Map<string, Dish>;
  history: MealHistory;
  policy: MealPolicyState;
  effortCeiling: DishEffortLevel;
}): { components: any[]; explorationEvents: any[]; rejected: string[]; logs: any[] } {
  const { components, day, slot, anchor, dishNameMap, dishLookup, history, policy, effortCeiling } = options;
  const accepted: any[] = [];
  const rejected: string[] = [];
  const explorationEvents: any[] = [];
  const logs: any[] = [];

  for (const comp of components || []) {
    const dishName = (comp.dish_name || '').toLowerCase().trim();
    if (!dishName) {
      console.log('[Policy] ❌ Rejected component - missing_dish_name');
      rejected.push('missing_dish_name');
      logs.push({
        decision: 'rejected',
        reason: 'missing_dish_name',
        dish_id: null,
        dish_universe_id: null,
        meal_anchor: anchor,
        day_of_week: day,
        meal_slot: slot,
        dish_role: null,
        overlap_status: null,
        exploration: false,
        metadata: { component_type: comp.component_type },
      });
      continue;
    }
    const dishId = dishNameMap.get(dishName);
    if (!dishId) {
      console.log(`[Policy] ❌ Rejected ${dishName} - unknown_dish`);
      rejected.push(`unknown_dish:${dishName}`);
      logs.push({
        decision: 'rejected',
        reason: 'unknown_dish',
        dish_id: null,
        dish_universe_id: null,
        meal_anchor: anchor,
        day_of_week: day,
        meal_slot: slot,
        dish_role: null,
        overlap_status: null,
        exploration: false,
        metadata: { dish_name: dishName, component_type: comp.component_type },
      });
      continue;
    }
    const dish = dishLookup.get(dishId);
    if (!dish) {
      console.log(`[Policy] ❌ Rejected ${dishName} - dish_lookup_missing`);
      rejected.push(`dish_lookup_missing:${dishName}`);
      logs.push({
        decision: 'rejected',
        reason: 'dish_lookup_missing',
        dish_id: dishId,
        dish_universe_id: null,
        meal_anchor: anchor,
        day_of_week: day,
        meal_slot: slot,
        dish_role: null,
        overlap_status: null,
        exploration: false,
        metadata: { dish_name: dishName, component_type: comp.component_type },
      });
      continue;
    }

    const decision = evaluateCandidate({
      dish,
      anchor,
      slot,
      dayOfWeek: day,
      componentType: comp.component_type,
      isPrimary: isPrimaryComponent(comp.component_type),
      effortCeiling,
      history,
      policy,
    });

    if (!decision.allowed) {
      console.log(`[Policy] ❌ Rejected ${dish.canonical_name} - ${decision.reason}`);
      rejected.push(`${dish.canonical_name}:${decision.reason}`);
      logs.push({
        decision: 'rejected',
        reason: decision.reason,
        dish_id: dishId,
        dish_universe_id: dish.dish_universe_id ?? null,
        meal_anchor: anchor,
        day_of_week: day,
        meal_slot: slot,
        dish_role: decision.role,
        overlap_status: decision.overlapStatus,
        exploration: false,
        metadata: { dish_name: dish.canonical_name, component_type: comp.component_type },
      });
      continue;
    }

    registerAcceptedDish({
      dish,
      anchor,
      overlapStatus: decision.overlapStatus,
      explorationUsed: decision.explorationUsed,
      policy,
    });

    console.log(`[Policy] ✅ Accepted ${dish.canonical_name} role=${decision.role} band=${decision.weightBand} overlap=${decision.overlapStatus} exploration=${decision.explorationUsed}`);

    accepted.push({
      ...comp,
      dish_id: dishId,
      exploration: decision.explorationUsed,
      role: decision.role,
      weight_band: decision.weightBand,
      overlap_status: decision.overlapStatus,
    });

    logs.push({
      decision: 'accepted',
      reason: null,
      dish_id: dishId,
      dish_universe_id: dish.dish_universe_id ?? null,
      meal_anchor: anchor,
      day_of_week: day,
      meal_slot: slot,
      dish_role: decision.role,
      overlap_status: decision.overlapStatus,
      exploration: decision.explorationUsed,
      metadata: { dish_name: dish.canonical_name, component_type: comp.component_type },
    });

    if (decision.explorationUsed) {
      explorationEvents.push({
        dish_id: dishId,
        meal_anchor: anchor,
        day_of_week: day,
        meal_slot: slot,
        weight_band: decision.weightBand,
        role: decision.role,
        metadata: {
          component_type: comp.component_type,
          dish_name: dish.canonical_name,
        },
      });
    }
  }

  return { components: accepted, explorationEvents, rejected, logs };
}
