/**
 * Meal Composition Rules
 * 
 * Defines how many and which types of components should be included
 * in each meal slot. Used for intelligent meal composition from database dishes.
 */

import { ComponentType, MealSlot } from '@/types/relish';

export interface MealCompositionRule {
  /**
   * Component types that MUST be included in this meal
   */
  required: ComponentType[];
  
  /**
   * Component types that MAY be included (optional)
   * System will try to add these if available
   */
  optional: ComponentType[];
  
  /**
   * Minimum number of components for this meal
   */
  minComponents: number;
  
  /**
   * Maximum number of components for this meal
   */
  maxComponents: number;
  
  /**
   * Human-readable description of this meal structure
   */
  description: string;
}

/**
 * Meal composition rules for all meal slots
 * 
 * These rules ensure balanced, culturally appropriate meals:
 * - Snacks: Simple, single items
 * - Breakfast: Light, 2-3 items
 * - Main meals (lunch/dinner): Balanced thalis with 3-5 components
 */
export const MEAL_COMPOSITION_RULES: Record<MealSlot, MealCompositionRule> = {
  [MealSlot.PRE_BREAKFAST]: {
    required: [],
    optional: [ComponentType.BEVERAGE, ComponentType.FRUIT],
    minComponents: 1,
    maxComponents: 1,
    description: 'Light beverage or fruit (e.g., warm water, soaked nuts)',
  },
  
  [MealSlot.BREAKFAST]: {
    required: [ComponentType.CARB],
    optional: [ComponentType.PROTEIN, ComponentType.DAIRY, ComponentType.CONDIMENT, ComponentType.BEVERAGE],
    minComponents: 2,
    maxComponents: 3,
    description: 'Carb + Protein/Dairy + optional beverage (e.g., Paratha + Curd + Chai)',
  },
  
  [MealSlot.MORNING_SNACK]: {
    required: [],
    optional: [ComponentType.SNACK, ComponentType.FRUIT, ComponentType.BEVERAGE],
    minComponents: 1,
    maxComponents: 1,
    description: 'Single snack, fruit, or beverage (e.g., Banana, Chai, Namkeen)',
  },
  
  [MealSlot.LUNCH]: {
    required: [ComponentType.CARB, ComponentType.PROTEIN, ComponentType.VEG],
    optional: [ComponentType.DAIRY, ComponentType.SALAD, ComponentType.CONDIMENT],
    minComponents: 3,
    maxComponents: 5,
    description: 'Balanced thali: Carb + Protein + Veg + optional Dairy/Salad/Condiment (e.g., Rice + Dal + Sabzi + Raita + Pickle)',
  },
  
  [MealSlot.EVENING_SNACK]: {
    required: [],
    optional: [ComponentType.SNACK, ComponentType.FRUIT, ComponentType.BEVERAGE],
    minComponents: 1,
    maxComponents: 1,
    description: 'Single snack, fruit, or beverage (e.g., Samosa, Apple, Coffee)',
  },
  
  [MealSlot.DINNER]: {
    required: [ComponentType.CARB, ComponentType.PROTEIN, ComponentType.VEG],
    optional: [ComponentType.DAIRY, ComponentType.SALAD, ComponentType.CONDIMENT],
    minComponents: 3,
    maxComponents: 5,
    description: 'Balanced thali: Carb + Protein + Veg + optional Dairy/Salad/Condiment (e.g., Roti + Paneer + Aloo Gobi + Raita)',
  },
};

/**
 * Get composition rule for a meal slot
 */
export function getMealCompositionRule(slot: MealSlot): MealCompositionRule {
  return MEAL_COMPOSITION_RULES[slot];
}

/**
 * Check if a meal composition is valid according to rules
 */
export function isValidMealComposition(
  slot: MealSlot,
  componentTypes: ComponentType[]
): boolean {
  const rule = MEAL_COMPOSITION_RULES[slot];
  
  // Check component count
  if (componentTypes.length < rule.minComponents || componentTypes.length > rule.maxComponents) {
    return false;
  }
  
  // Check all required components are present
  for (const required of rule.required) {
    if (!componentTypes.includes(required)) {
      return false;
    }
  }
  
  // Check all components are either required or optional
  const allowed = new Set([...rule.required, ...rule.optional]);
  for (const type of componentTypes) {
    if (!allowed.has(type)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Get a human-readable description of what a meal slot should contain
 */
export function getMealDescription(slot: MealSlot): string {
  return MEAL_COMPOSITION_RULES[slot].description;
}
