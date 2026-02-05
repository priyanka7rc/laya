import { ComponentType, MealSlot, type Dish, type MealComponentAI } from '@/types/relish';

export const ALLOWED_STRUCTURAL_UNIVERSES = new Set([
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

const STRUCTURAL_TO_COMPONENT: Record<string, ComponentType> = {
  rice: ComponentType.CARB,
  roti: ComponentType.CARB,
  bread: ComponentType.CARB,
  one_bowl_meal: ComponentType.CARB,
  dal: ComponentType.PROTEIN,
  legume_curry: ComponentType.PROTEIN,
  paneer_main: ComponentType.PROTEIN,
  egg_main: ComponentType.PROTEIN,
  dry_veg: ComponentType.VEG,
  gravy_veg: ComponentType.VEG,
  condiment: ComponentType.CONDIMENT,
  beverage: ComponentType.BEVERAGE,
  fruit: ComponentType.FRUIT,
  snack: ComponentType.SNACK,
  breakfast_main: ComponentType.CARB,
};

const REPEAT_EXEMPT_UNIVERSES = new Set(['rice', 'roti']);

const BREAKFAST_MAINS = new Set([
  'idli',
  'dosa',
  'vada',
  'upma',
  'poha',
  'egg_omelette',
  'egg_bhurji',
  'paneer_bhurji',
]);

const BREAKFAST_PAIRINGS: Record<string, string[]> = {
  idli: ['sambar', 'coconut_chutney'],
  dosa: ['sambar', 'coconut_chutney'],
  vada: ['sambar', 'coconut_chutney'],
  upma: ['coconut_chutney', 'curd'],
  poha: ['lemon', 'peanuts', 'curd'],
  egg_omelette: ['bread', 'roti'],
  egg_bhurji: ['bread', 'roti'],
  paneer_bhurji: ['bread', 'roti'],
};

const SAFE_DEFAULTS: Omit<MealComponentAI, 'dish_canonical_name' | 'dish_display_name' | 'structural_universe' | 'confidence'> = {
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
};

const ALLOWED_COOKING_METHODS = new Set(['saute', 'boil', 'pressure_cook', 'shallow_fry', 'other', 'deep_fry']);

export function normalizeCanonicalName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function clampHomestyleDefaults(component: MealComponentAI): MealComponentAI {
  return {
    ...component,
    effort_level: component.effort_level === 'high' ? 'medium' : component.effort_level,
    fat_intensity: component.fat_intensity === 'high' ? 'medium' : component.fat_intensity,
    frequency_class: component.frequency_class === 'occasional' ? 'weekly' : component.frequency_class,
  };
}

function validateHomestyle(component: MealComponentAI, isWeekend: boolean): string | null {
  if (component.ingredient_count > 12 && !isWeekend) return 'ingredient_count_exceeded';
  if (component.non_pantry_ingredient_count > 4) return 'non_pantry_exceeded';
  if (component.fat_intensity === 'high') return 'fat_intensity_high';
  if (component.cooking_method === 'deep_fry') return 'deep_fry_disallowed';
  if (component.cream_based) return 'cream_based_disallowed';
  if (component.nut_paste_based) return 'nut_paste_based_disallowed';
  if (component.base_masala_type === 'complex_paste') return 'complex_paste_disallowed';
  if (component.effort_level === 'high') return 'effort_high';
  if (!isWeekend && component.frequency_class === 'occasional') return 'frequency_occasional';
  return null;
}

function inferComponentType(structuralUniverse: string): ComponentType {
  return STRUCTURAL_TO_COMPONENT[structuralUniverse] ?? ComponentType.OTHER;
}

function inferUniverseFromDish(dish: Dish, componentType: ComponentType): string {
  const universe = (dish.dish_universe_id || '').toLowerCase();
  if (ALLOWED_STRUCTURAL_UNIVERSES.has(universe)) return universe;
  if (componentType === ComponentType.CONDIMENT) return 'condiment';
  if (componentType === ComponentType.BEVERAGE) return 'beverage';
  if (componentType === ComponentType.FRUIT) return 'fruit';
  if (componentType === ComponentType.SNACK) return 'snack';
  if (componentType === ComponentType.PROTEIN) return 'dal';
  if (componentType === ComponentType.VEG) return 'dry_veg';
  return 'rice';
}

function buildBackfillComponent(dish: Dish, componentType: ComponentType): MealComponentAI {
  const canonical = normalizeCanonicalName(dish.canonical_name);
  const displayName = dish.canonical_name.replace(/_/g, ' ');
  return {
    dish_canonical_name: canonical,
    dish_display_name: displayName,
    dish_name: displayName,
    structural_universe: inferUniverseFromDish(dish, componentType),
    confidence: 0.9,
    component_type: componentType,
    ...SAFE_DEFAULTS,
  };
}

function pickCandidate(
  componentType: ComponentType,
  candidatesByComponentType: Map<ComponentType, Dish[]>,
  usedCanonicals: Set<string>
): Dish | null {
  const candidates = candidatesByComponentType.get(componentType) || [];
  return candidates.find(dish => !usedCanonicals.has(normalizeCanonicalName(dish.canonical_name))) || null;
}

function findCandidateByCanonical(
  allowedCanonicals: string[],
  candidatesByComponentType: Map<ComponentType, Dish[]>,
  usedCanonicals: Set<string>
): { dish: Dish; type: ComponentType } | null {
  for (const [type, dishes] of candidatesByComponentType.entries()) {
    for (const dish of dishes) {
      const canonical = normalizeCanonicalName(dish.canonical_name);
      if (usedCanonicals.has(canonical)) continue;
      if (allowedCanonicals.includes(canonical)) {
        return { dish, type };
      }
    }
  }
  return null;
}

export function normalizeMealSlot(options: {
  day: number;
  slot: MealSlot;
  components: MealComponentAI[];
  usedCanonicals: Set<string>;
  candidatesByComponentType: Map<ComponentType, Dish[]>;
}): { components: MealComponentAI[]; needsRetry: boolean; rejectedReasons: string[] } {
  const { day, slot, components, usedCanonicals, candidatesByComponentType } = options;
  const isWeekend = day >= 5;
  const rejectedReasons: string[] = [];
  let needsRetry = false;

  const normalized: MealComponentAI[] = [];

  for (const component of components || []) {
    if (!component.dish_canonical_name || !component.dish_display_name) {
      rejectedReasons.push('missing_names');
      continue;
    }
    if (!ALLOWED_STRUCTURAL_UNIVERSES.has(component.structural_universe)) {
      rejectedReasons.push(`invalid_universe:${component.dish_canonical_name}`);
      continue;
    }
    if (typeof component.confidence !== 'number') {
      rejectedReasons.push(`missing_confidence:${component.dish_canonical_name}`);
      continue;
    }
    if (
      component.ingredient_count == null ||
      component.non_pantry_ingredient_count == null ||
      !component.fat_intensity ||
      !component.effort_level ||
      !component.cooking_method ||
      !component.base_masala_type ||
      component.cream_based == null ||
      component.nut_paste_based == null ||
      !component.frequency_class ||
      component.blender_required == null
    ) {
      rejectedReasons.push(`missing_metadata:${component.dish_canonical_name}`);
      continue;
    }
    if (!ALLOWED_COOKING_METHODS.has(component.cooking_method)) {
      rejectedReasons.push(`invalid_cooking_method:${component.dish_canonical_name}`);
      continue;
    }

    const canonical = normalizeCanonicalName(component.dish_canonical_name);
    const universe = component.structural_universe;
    const repeatExempt = REPEAT_EXEMPT_UNIVERSES.has(universe);

    if (component.confidence < 0.5) {
      needsRetry = true;
      rejectedReasons.push(`low_confidence:${canonical}`);
      continue;
    }

    const normalizedComponent: MealComponentAI =
      component.confidence < 0.75 ? clampHomestyleDefaults(component) : component;

    const homestyleError = validateHomestyle(normalizedComponent, isWeekend);
    if (homestyleError) {
      rejectedReasons.push(`${homestyleError}:${canonical}`);
      continue;
    }

    if (usedCanonicals.has(canonical) && !repeatExempt) {
      rejectedReasons.push(`weekly_repeat:${canonical}`);
      continue;
    }

    const componentType = inferComponentType(universe);
    usedCanonicals.add(canonical);
    normalized.push({
      ...normalizedComponent,
      dish_canonical_name: canonical,
      dish_display_name: normalizedComponent.dish_display_name,
      dish_name: normalizedComponent.dish_display_name,
      component_type: componentType,
    });
  }

  if (slot === MealSlot.MORNING_SNACK || slot === MealSlot.EVENING_SNACK) {
    normalized.sort((a, b) => b.confidence - a.confidence);
    return {
      components: normalized.slice(0, 1),
      needsRetry,
      rejectedReasons,
    };
  }

  if (slot === MealSlot.BREAKFAST) {
    const main = normalized.find(comp => comp.structural_universe === 'breakfast_main' || BREAKFAST_MAINS.has(comp.dish_canonical_name));
    const mainCanonical = main?.dish_canonical_name;
    if (mainCanonical) {
      const allowed = BREAKFAST_PAIRINGS[mainCanonical] || [];
      const hasPairing = normalized.some(comp => allowed.includes(comp.dish_canonical_name));
      if (!hasPairing && allowed.length > 0) {
        const pairingByName = findCandidateByCanonical(allowed, candidatesByComponentType, usedCanonicals);
        if (pairingByName) {
          normalized.push(buildBackfillComponent(pairingByName.dish, pairingByName.type));
        } else {
          const pairingCandidate = pickCandidate(ComponentType.CONDIMENT, candidatesByComponentType, usedCanonicals);
          if (pairingCandidate) {
            normalized.push(buildBackfillComponent(pairingCandidate, ComponentType.CONDIMENT));
          }
        }
      }
      const coconutIndex = normalized.findIndex(comp => comp.dish_canonical_name === 'coconut_chutney');
      if (coconutIndex >= 0 && !['idli', 'dosa', 'vada'].includes(mainCanonical)) {
        normalized.splice(coconutIndex, 1);
        const fallback = pickCandidate(ComponentType.CONDIMENT, candidatesByComponentType, usedCanonicals);
        if (fallback) {
          normalized.push(buildBackfillComponent(fallback, ComponentType.CONDIMENT));
        }
      }
    }
  }

  if (slot === MealSlot.LUNCH || slot === MealSlot.DINNER) {
    const required: ComponentType[] = [
      ComponentType.CARB,
      ComponentType.PROTEIN,
      ComponentType.VEG,
      ComponentType.CONDIMENT,
    ];
    const present = new Set(normalized.map(comp => comp.component_type));
    for (const needed of required) {
      if (!present.has(needed)) {
        const candidate = pickCandidate(needed, candidatesByComponentType, usedCanonicals);
        if (candidate) {
          normalized.push(buildBackfillComponent(candidate, needed));
          present.add(needed);
        }
      }
    }
  }

  return { components: normalized, needsRetry, rejectedReasons };
}

export function buildCandidatesByComponentType(dishes: Dish[]): Map<ComponentType, Dish[]> {
  const byType = new Map<ComponentType, Dish[]>();
  dishes.forEach(dish => {
    const type = dish.primary_component_type as ComponentType | null;
    if (!type) return;
    if (!byType.has(type)) {
      byType.set(type, []);
    }
    byType.get(type)!.push(dish);
  });
  return byType;
}
