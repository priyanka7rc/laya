/**
 * RELISH TYPE DEFINITIONS
 * Auto-generated types for Relish database schema
 * 
 * Note: For production, consider using:
 * npx supabase gen types typescript --project-id YOUR_PROJECT_ID > types/database.types.ts
 */

// ============================================================================
// ENUMS
// ============================================================================

export enum MealSlot {
  PRE_BREAKFAST = 'pre_breakfast',
  BREAKFAST = 'breakfast',
  MORNING_SNACK = 'morning_snack',
  LUNCH = 'lunch',
  EVENING_SNACK = 'evening_snack',
  DINNER = 'dinner',
}

export enum UnitClass {
  WEIGHT = 'weight',
  VOLUME = 'volume',
  COUNT = 'count',
}

export enum GroceryStatus {
  NEEDED = 'needed',
  PANTRY = 'pantry',
  REMOVED = 'removed',
}

export enum RecipeSourceType {
  AI = 'ai',
  API = 'api',
  USER_CHOICE = 'user_choice',
}

// ============================================================================
// GLOBAL TABLES (Server-managed, client read-only)
// ============================================================================

export interface Dish {
  id: string;
  canonical_name: string;
  cuisine_tags: string[];
  aliases: string[];
  ontology_tokens: string[];
  typical_meal_slots: string[];
  created_at: string;
}

export interface IngredientMaster {
  id: string;
  canonical_name: string;
  synonyms: string[];
  unit_class: UnitClass;
  pantry_likelihood: number;
  typical_unit: string | null;
  category: string | null;
  avg_cost_per_unit: number | null;
  created_at: string;
}

export interface RecipeVariant {
  id: string;
  dish_id: string;
  scope_user_id: string | null; // null = global variant
  variant_tags: string[];
  servings_default: number;
  description: string | null;
  ingredients_json: IngredientJSON[];
  steps_json: StepJSON[];
  validator_score: number;
  source_type: RecipeSourceType;
  source_ref: string | null;
  
  // Nutrition & metadata
  calories_per_serving: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  estimated_cost_usd: number | null;
  prep_time_min: number | null;
  cook_time_min: number | null;
  effort_level: number | null; // 1-5
  
  created_at: string;
  updated_at: string;
}

// ============================================================================
// USER-SCOPED TABLES
// ============================================================================

export interface MealPlan {
  id: string;
  user_id: string;
  week_start_date: string; // YYYY-MM-DD
  week_name: string | null;
  constraints_json: MealPlanConstraints;
  generated_by: string | null; // 'ai' | 'manual'
  created_at: string;
}

export interface MealPlanItem {
  id: string;
  meal_plan_id: string;
  day_of_week: number; // 0=Monday, 6=Sunday
  meal_slot: MealSlot;
  dish_name: string;
  dish_id: string | null;
  recipe_variant_id: string | null;
  servings: number | null;
  created_at: string;
}

export interface PantryItem {
  id: string;
  user_id: string;
  ingredient_id: string;
  confidence_score: number; // 0-1
  last_inferred_from: string | null;
  updated_at: string;
}

export interface GroceryList {
  id: string;
  meal_plan_id: string;
  user_id: string;
  created_at: string;
}

export interface GroceryListItem {
  id: string;
  grocery_list_id: string;
  ingredient_id: string | null;
  display_name: string;
  quantity: number;
  unit: string;
  normalized_grams: number | null;
  normalized_ml: number | null;
  status: GroceryStatus;
  source_dish_ids: string[];
  source_dish_names: string[];
  updated_at: string;
}

export interface UserRecipeLink {
  id: string;
  user_id: string;
  dish_id: string;
  url: string;
  domain: string;
  tags: string[];
  chosen_at: string;
}

export interface AIUsageLog {
  id: string;
  user_id: string | null;
  feature: string; // 'plan_gen', 'dish_compile', 'repair', 'normalize'
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cache_hit: boolean;
  cost_usd: number | null;
  created_at: string;
}

export interface AICache {
  cache_key: string;
  payload_json: any;
  model: string | null;
  created_at: string;
  accessed_count: number;
  last_accessed_at: string;
}

// ============================================================================
// JSON STRUCTURE TYPES
// ============================================================================

export interface IngredientJSON {
  name: string;
  qty: number;
  unit: string;
  ingredient_id?: string;
  raw_text?: string;
}

export interface StepJSON {
  step_no: number;
  body: string;
}

export interface MealPlanConstraints {
  max_calories_per_day?: number;
  max_cost_per_week?: number;
  protein_min_per_day?: number;
  max_effort_level?: number; // 1-5
  dietary_restrictions?: string[];
  disliked_ingredients?: string[];
}

// ============================================================================
// EXTENDED TYPES WITH RELATIONS
// ============================================================================

export interface DishWithVariants extends Dish {
  recipe_variants: RecipeVariant[];
}

export interface MealPlanWithItems extends MealPlan {
  meal_plan_items: MealPlanItem[];
}

export interface MealPlanItemWithDetails extends MealPlanItem {
  dish?: Dish;
  recipe_variant?: RecipeVariant;
}

export interface GroceryListWithItems extends GroceryList {
  grocery_list_items: GroceryListItem[];
}

export interface GroceryListItemWithIngredient extends GroceryListItem {
  ingredient_master?: IngredientMaster;
}

export interface RecipeVariantWithDish extends RecipeVariant {
  dish: Dish;
}

// ============================================================================
// INSERT/UPDATE TYPES (for mutations)
// ============================================================================

export type DishInsert = Omit<Dish, 'id' | 'created_at'>;
export type DishUpdate = Partial<DishInsert>;

export type RecipeVariantInsert = Omit<RecipeVariant, 'id' | 'created_at' | 'updated_at'>;
export type RecipeVariantUpdate = Partial<Omit<RecipeVariantInsert, 'dish_id' | 'scope_user_id'>>;

export type MealPlanInsert = Omit<MealPlan, 'id' | 'created_at'>;
export type MealPlanUpdate = Partial<Omit<MealPlanInsert, 'user_id'>>;

export type MealPlanItemInsert = Omit<MealPlanItem, 'id' | 'created_at'>;
export type MealPlanItemUpdate = Partial<Omit<MealPlanItemInsert, 'meal_plan_id'>>;

export type GroceryListItemInsert = Omit<GroceryListItem, 'id' | 'updated_at'>;
export type GroceryListItemUpdate = Partial<Omit<GroceryListItemInsert, 'grocery_list_id'>>;

export type PantryItemInsert = Omit<PantryItem, 'id' | 'updated_at'>;
export type PantryItemUpdate = Partial<Omit<PantryItemInsert, 'user_id' | 'ingredient_id'>>;

export type UserRecipeLinkInsert = Omit<UserRecipeLink, 'id' | 'chosen_at'>;

export type AIUsageLogInsert = Omit<AIUsageLog, 'id' | 'created_at'>;

// ============================================================================
// HELPER TYPES FOR API RESPONSES
// ============================================================================

export interface WeeklyMealPlan {
  week_start: string;
  week_name: string;
  days: DayMealPlan[];
}

export interface DayMealPlan {
  day_of_week: number;
  day_name: string;
  date: string;
  meals: {
    [key in MealSlot]?: MealPlanItemWithDetails;
  };
}

export interface GeneratedGroceryList {
  total_items: number;
  estimated_cost: number | null;
  items_by_category: {
    [category: string]: GroceryListItemWithIngredient[];
  };
}

// ============================================================================
// VALIDATION & COMPILATION TYPES
// ============================================================================

export interface DishValidationResult {
  is_valid: boolean;
  confidence: number;
  issues: string[];
  suggestions?: string[];
}

export interface IngredientNormalizationResult {
  canonical_name: string;
  canonical_id: string | null;
  qty: number;
  unit: string;
  confidence: number;
  original_text: string;
}

// ============================================================================
// AI PROMPT & RESPONSE TYPES
// ============================================================================

export interface MealPlanGenerationRequest {
  user_id: string;
  week_start_date: string;
  constraints?: MealPlanConstraints;
  user_preferences?: UserMealPreferences;
}

export interface UserMealPreferences {
  favorite_dishes: string[];
  disliked_ingredients: string[];
  preferred_cuisines: string[];
  cooking_skill_level: number; // 1-5
  available_time_minutes: number;
}

export interface DishCompilationRequest {
  dish_name: string;
  servings?: number;
  user_preferences?: {
    spice_level?: 'mild' | 'medium' | 'spicy';
    richness?: 'light' | 'medium' | 'rich';
  };
}

export interface DishCompilationResponse {
  dish_id: string;
  ingredients: IngredientJSON[];
  steps: StepJSON[];
  estimated_nutrition?: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
  prep_time_min: number;
  cook_time_min: number;
  difficulty: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  [MealSlot.PRE_BREAKFAST]: 'Pre-Breakfast',
  [MealSlot.BREAKFAST]: 'Breakfast',
  [MealSlot.MORNING_SNACK]: 'Morning Snack',
  [MealSlot.LUNCH]: 'Lunch',
  [MealSlot.EVENING_SNACK]: 'Evening Snack',
  [MealSlot.DINNER]: 'Dinner',
};

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isMealSlot(value: string): value is MealSlot {
  return Object.values(MealSlot).includes(value as MealSlot);
}

export function isUnitClass(value: string): value is UnitClass {
  return Object.values(UnitClass).includes(value as UnitClass);
}

export function isGroceryStatus(value: string): value is GroceryStatus {
  return Object.values(GroceryStatus).includes(value as GroceryStatus);
}

export function isRecipeSourceType(value: string): value is RecipeSourceType {
  return Object.values(RecipeSourceType).includes(value as RecipeSourceType);
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const MEAL_SLOTS_ORDER: MealSlot[] = [
  MealSlot.PRE_BREAKFAST,
  MealSlot.BREAKFAST,
  MealSlot.MORNING_SNACK,
  MealSlot.LUNCH,
  MealSlot.EVENING_SNACK,
  MealSlot.DINNER,
];

export const PRIMARY_MEAL_SLOTS: MealSlot[] = [
  MealSlot.BREAKFAST,
  MealSlot.LUNCH,
  MealSlot.DINNER,
];

// ============================================================================
// MEAL PLATES & COMPONENTS (Multi-dish support)
// ============================================================================

export enum ComponentType {
  CARB = 'carb',
  PROTEIN = 'protein',
  VEG = 'veg',
  BROTH = 'broth',
  CONDIMENT = 'condiment',
  DAIRY = 'dairy',
  SALAD = 'salad',
  CRUNCH = 'crunch',
  SNACK = 'snack',      // For snack items (namkeen, chips, etc.)
  FRUIT = 'fruit',      // For fruits and fruit-based items
  BEVERAGE = 'beverage', // For drinks (chai, coffee, juice, etc.)
  OTHER = 'other',
}

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  [ComponentType.CARB]: 'Carb',
  [ComponentType.PROTEIN]: 'Protein',
  [ComponentType.VEG]: 'Vegetable',
  [ComponentType.BROTH]: 'Broth',
  [ComponentType.CONDIMENT]: 'Condiment',
  [ComponentType.DAIRY]: 'Dairy',
  [ComponentType.SALAD]: 'Salad',
  [ComponentType.CRUNCH]: 'Crunch',
  [ComponentType.OTHER]: 'Other',
};

export interface MealPlate {
  id: string;
  meal_plan_item_id: string;
  created_at: string;
}

export interface MealPlateComponent {
  id: string;
  meal_plate_id: string;
  component_type: ComponentType;
  dish_name: string;
  dish_id: string | null;
  servings: number | null;
  quantity_hint: string | null;
  is_optional: boolean;
  sort_order: number;
  tags: string[];
  created_at: string;
}

export interface MealPlateWithComponents extends MealPlate {
  meal_plate_components: MealPlateComponent[];
}

export interface MealPlanItemWithPlate extends MealPlanItem {
  meal_plates: MealPlateWithComponents;
}

// Insert/Update types
export type MealPlateComponentInsert = Omit<MealPlateComponent, 'id' | 'created_at'>;
export type MealPlateComponentUpdate = Partial<Omit<MealPlateComponentInsert, 'meal_plate_id'>>;

// ============================================================================
// AI MEAL PLAN GENERATION TYPES
// ============================================================================

export interface MealComponentAI {
  component_type: ComponentType;
  dish_name: string;
  dish_id?: string;
  servings?: number;
  quantity_hint?: string;
  is_optional?: boolean;
  tags?: string[];
}

export interface MealSlotAI {
  day: number; // 0-6 (Monday-Sunday)
  slot: 'breakfast' | 'lunch' | 'dinner';
  components: MealComponentAI[];
}

export interface WeeklyMealPlanAI {
  meals: MealSlotAI[];
}

