-- ============================================================================
-- RELISH MVP DATABASE MIGRATION
-- ============================================================================
-- Purpose: Create core tables for meal planning, dish management, and grocery lists
-- Author: Laya Team
-- Date: 2025-01-16
-- Dependencies: Supabase Postgres with auth.users table
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

CREATE TYPE meal_slot AS ENUM (
  'pre_breakfast',
  'breakfast', 
  'morning_snack',
  'lunch',
  'evening_snack',
  'dinner'
);

CREATE TYPE unit_class AS ENUM (
  'weight',
  'volume', 
  'count'
);

CREATE TYPE grocery_status AS ENUM (
  'needed',
  'pantry',
  'removed'
);

CREATE TYPE recipe_source_type AS ENUM (
  'ai',
  'api',
  'user_choice'
);

-- ============================================================================
-- GLOBAL TABLES (Shared across users, server-managed)
-- ============================================================================

-- Dishes: Canonical dish concepts (e.g., "Palak Paneer")
CREATE TABLE dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT UNIQUE NOT NULL,
  cuisine_tags TEXT[] DEFAULT '{}',
  aliases TEXT[] DEFAULT '{}',
  ontology_tokens TEXT[] DEFAULT '{}', -- Expected ingredient tokens for validation
  typical_meal_slots TEXT[] DEFAULT '{}', -- e.g., ['lunch', 'dinner']
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ingredient Master: Canonical ingredient list with synonyms
CREATE TABLE ingredient_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name TEXT UNIQUE NOT NULL,
  synonyms TEXT[] DEFAULT '{}',
  unit_class unit_class NOT NULL,
  pantry_likelihood NUMERIC(3,2) DEFAULT 0.3 CHECK (pantry_likelihood BETWEEN 0 AND 1),
  typical_unit TEXT, -- e.g., 'cup', 'gram', 'piece'
  category TEXT, -- e.g., 'vegetable', 'spice', 'dairy'
  avg_cost_per_unit NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recipe Variants: Different ways to make a dish
CREATE TABLE recipe_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  scope_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL = global variant
  variant_tags TEXT[] DEFAULT '{}',
  servings_default INT DEFAULT 2,
  description TEXT,
  ingredients_json JSONB NOT NULL, -- [{ name, qty, unit, ingredient_id? }]
  steps_json JSONB DEFAULT '[]'::JSONB, -- [{ step_no, body }]
  validator_score NUMERIC(3,2) DEFAULT 0,
  source_type recipe_source_type NOT NULL,
  source_ref TEXT, -- URL or API reference
  
  -- Nutrition & metadata (future-proofing)
  calories_per_serving INT,
  protein_g NUMERIC(5,1),
  carbs_g NUMERIC(5,1),
  fat_g NUMERIC(5,1),
  estimated_cost_usd NUMERIC(6,2),
  prep_time_min INT,
  cook_time_min INT,
  effort_level INT CHECK (effort_level BETWEEN 1 AND 5),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(dish_id, scope_user_id, variant_tags)
);

-- ============================================================================
-- USER-SCOPED TABLES (Private per user)
-- ============================================================================

-- Meal Plans: Weekly meal planning container
CREATE TABLE meal_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_name TEXT, -- e.g., "Week of Jan 15"
  constraints_json JSONB DEFAULT '{}'::JSONB, -- Future: calorie limits, macros, budget
  generated_by TEXT, -- 'ai' | 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, week_start_date)
);

-- Meal Plan Items: Individual meals in the plan
CREATE TABLE meal_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Monday
  meal_slot meal_slot NOT NULL,
  dish_name TEXT NOT NULL,
  dish_id UUID REFERENCES dishes(id) ON DELETE SET NULL,
  recipe_variant_id UUID REFERENCES recipe_variants(id) ON DELETE SET NULL,
  servings INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(meal_plan_id, day_of_week, meal_slot)
);

-- Pantry Items: User's inferred pantry inventory
CREATE TABLE pantry_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredient_master(id) ON DELETE CASCADE,
  confidence_score NUMERIC(3,2) DEFAULT 0.5 CHECK (confidence_score BETWEEN 0 AND 1),
  last_inferred_from TEXT, -- e.g., 'grocery_skip', 'repeated_dish'
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, ingredient_id)
);

-- Grocery Lists: Generated from meal plans
CREATE TABLE grocery_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(meal_plan_id)
);

-- Grocery List Items: Individual items to buy
CREATE TABLE grocery_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grocery_list_id UUID NOT NULL REFERENCES grocery_lists(id) ON DELETE CASCADE,
  ingredient_id UUID REFERENCES ingredient_master(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'unit',
  normalized_grams NUMERIC(10,2),
  normalized_ml NUMERIC(10,2),
  status grocery_status NOT NULL DEFAULT 'needed',
  source_dish_ids UUID[] DEFAULT '{}', -- Which dishes need this ingredient
  source_dish_names TEXT[] DEFAULT '{}', -- Human-readable dish names
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Recipe Links: Track which external recipes users explicitly chose
CREATE TABLE user_recipe_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dish_id UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  chosen_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, dish_id, url)
);

-- AI Usage Logs: Track OpenAI costs and performance
CREATE TABLE ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL, -- 'plan_gen', 'dish_compile', 'repair', 'normalize'
  model TEXT NOT NULL,
  tokens_in INT DEFAULT 0,
  tokens_out INT DEFAULT 0,
  latency_ms INT DEFAULT 0,
  cache_hit BOOLEAN DEFAULT FALSE,
  cost_usd NUMERIC(10,6),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Cache: Reusable AI responses
CREATE TABLE ai_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accessed_count INT DEFAULT 0,
  last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Foreign key indexes
CREATE INDEX idx_recipe_variants_dish_id ON recipe_variants(dish_id);
CREATE INDEX idx_recipe_variants_scope_user_id ON recipe_variants(scope_user_id);
CREATE INDEX idx_recipe_variants_dish_scope ON recipe_variants(dish_id, scope_user_id);

CREATE INDEX idx_meal_plans_user_id ON meal_plans(user_id);
CREATE INDEX idx_meal_plans_week_start ON meal_plans(week_start_date);

CREATE INDEX idx_meal_plan_items_meal_plan_id ON meal_plan_items(meal_plan_id);
CREATE INDEX idx_meal_plan_items_dish_id ON meal_plan_items(dish_id);

CREATE INDEX idx_pantry_items_user_id ON pantry_items(user_id);
CREATE INDEX idx_pantry_items_ingredient_id ON pantry_items(ingredient_id);
CREATE INDEX idx_pantry_items_user_ingredient ON pantry_items(user_id, ingredient_id);

CREATE INDEX idx_grocery_lists_meal_plan_id ON grocery_lists(meal_plan_id);
CREATE INDEX idx_grocery_lists_user_id ON grocery_lists(user_id);

CREATE INDEX idx_grocery_list_items_grocery_list_id ON grocery_list_items(grocery_list_id);
CREATE INDEX idx_grocery_list_items_ingredient_id ON grocery_list_items(ingredient_id);

CREATE INDEX idx_user_recipe_links_user_id ON user_recipe_links(user_id);
CREATE INDEX idx_user_recipe_links_dish_id ON user_recipe_links(dish_id);
CREATE INDEX idx_user_recipe_links_user_dish ON user_recipe_links(user_id, dish_id);

CREATE INDEX idx_ai_usage_logs_user_id ON ai_usage_logs(user_id);
CREATE INDEX idx_ai_usage_logs_feature ON ai_usage_logs(feature);
CREATE INDEX idx_ai_usage_logs_created_at ON ai_usage_logs(created_at DESC);
CREATE INDEX idx_ai_usage_logs_user_feature ON ai_usage_logs(user_id, feature, created_at);

-- GIN indexes for array searches
CREATE INDEX idx_dishes_ontology ON dishes USING GIN(ontology_tokens);
CREATE INDEX idx_dishes_aliases ON dishes USING GIN(aliases);
CREATE INDEX idx_ingredient_master_synonyms ON ingredient_master USING GIN(synonyms);
CREATE INDEX idx_grocery_list_items_source_dishes ON grocery_list_items USING GIN(source_dish_ids);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables with updated_at
CREATE TRIGGER update_recipe_variants_updated_at 
  BEFORE UPDATE ON recipe_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pantry_items_updated_at 
  BEFORE UPDATE ON pantry_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_grocery_list_items_updated_at 
  BEFORE UPDATE ON grocery_list_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- AI cache access counter
CREATE OR REPLACE FUNCTION increment_cache_access()
RETURNS TRIGGER AS $$
BEGIN
    NEW.accessed_count = OLD.accessed_count + 1;
    NEW.last_accessed_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_ai_cache_access
  BEFORE UPDATE ON ai_cache
  FOR EACH ROW EXECUTE FUNCTION increment_cache_access();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE grocery_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE grocery_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_recipe_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_cache ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS POLICIES: GLOBAL TABLES (Read-only for clients)
-- ============================================================================

-- Dishes: Readable by all authenticated users
CREATE POLICY "Dishes are readable by authenticated users"
  ON dishes FOR SELECT
  TO authenticated
  USING (true);

-- Ingredient Master: Readable by all authenticated users
CREATE POLICY "Ingredient master is readable by authenticated users"
  ON ingredient_master FOR SELECT
  TO authenticated
  USING (true);

-- Recipe Variants: Users can read global variants + their own
CREATE POLICY "Recipe variants are readable by authenticated users"
  ON recipe_variants FOR SELECT
  TO authenticated
  USING (
    scope_user_id IS NULL OR scope_user_id = auth.uid()
  );

-- Recipe Variants: Users can insert their own variants
CREATE POLICY "Users can insert their own recipe variants"
  ON recipe_variants FOR INSERT
  TO authenticated
  WITH CHECK (scope_user_id = auth.uid());

-- Recipe Variants: Users can update their own variants
CREATE POLICY "Users can update their own recipe variants"
  ON recipe_variants FOR UPDATE
  TO authenticated
  USING (scope_user_id = auth.uid())
  WITH CHECK (scope_user_id = auth.uid());

-- Recipe Variants: Users can delete their own variants
CREATE POLICY "Users can delete their own recipe variants"
  ON recipe_variants FOR DELETE
  TO authenticated
  USING (scope_user_id = auth.uid());

-- ============================================================================
-- RLS POLICIES: USER-SCOPED TABLES (Full CRUD for own data)
-- ============================================================================

-- Meal Plans
CREATE POLICY "Users can view their own meal plans"
  ON meal_plans FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own meal plans"
  ON meal_plans FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own meal plans"
  ON meal_plans FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own meal plans"
  ON meal_plans FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Meal Plan Items
CREATE POLICY "Users can view their own meal plan items"
  ON meal_plan_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans
      WHERE meal_plans.id = meal_plan_items.meal_plan_id
      AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own meal plan items"
  ON meal_plan_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meal_plans
      WHERE meal_plans.id = meal_plan_items.meal_plan_id
      AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own meal plan items"
  ON meal_plan_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans
      WHERE meal_plans.id = meal_plan_items.meal_plan_id
      AND meal_plans.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own meal plan items"
  ON meal_plan_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans
      WHERE meal_plans.id = meal_plan_items.meal_plan_id
      AND meal_plans.user_id = auth.uid()
    )
  );

-- Pantry Items
CREATE POLICY "Users can view their own pantry items"
  ON pantry_items FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own pantry items"
  ON pantry_items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own pantry items"
  ON pantry_items FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own pantry items"
  ON pantry_items FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Grocery Lists
CREATE POLICY "Users can view their own grocery lists"
  ON grocery_lists FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own grocery lists"
  ON grocery_lists FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own grocery lists"
  ON grocery_lists FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own grocery lists"
  ON grocery_lists FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Grocery List Items
CREATE POLICY "Users can view their own grocery list items"
  ON grocery_list_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM grocery_lists
      WHERE grocery_lists.id = grocery_list_items.grocery_list_id
      AND grocery_lists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own grocery list items"
  ON grocery_list_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM grocery_lists
      WHERE grocery_lists.id = grocery_list_items.grocery_list_id
      AND grocery_lists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own grocery list items"
  ON grocery_list_items FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM grocery_lists
      WHERE grocery_lists.id = grocery_list_items.grocery_list_id
      AND grocery_lists.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own grocery list items"
  ON grocery_list_items FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM grocery_lists
      WHERE grocery_lists.id = grocery_list_items.grocery_list_id
      AND grocery_lists.user_id = auth.uid()
    )
  );

-- User Recipe Links
CREATE POLICY "Users can view their own recipe links"
  ON user_recipe_links FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own recipe links"
  ON user_recipe_links FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recipe links"
  ON user_recipe_links FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recipe links"
  ON user_recipe_links FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- AI Usage Logs
CREATE POLICY "Users can view their own AI usage logs"
  ON ai_usage_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- AI Cache (read-only for clients, server manages writes)
CREATE POLICY "Authenticated users can read AI cache"
  ON ai_cache FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get or create a dish by name
CREATE OR REPLACE FUNCTION get_or_create_dish(
  p_dish_name TEXT,
  p_cuisine_tags TEXT[] DEFAULT '{}',
  p_aliases TEXT[] DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_dish_id UUID;
BEGIN
  -- Try to find existing dish
  SELECT id INTO v_dish_id
  FROM dishes
  WHERE canonical_name = p_dish_name;
  
  -- If not found, create it
  IF v_dish_id IS NULL THEN
    INSERT INTO dishes (canonical_name, cuisine_tags, aliases)
    VALUES (p_dish_name, p_cuisine_tags, p_aliases)
    RETURNING id INTO v_dish_id;
  END IF;
  
  RETURN v_dish_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE dishes IS 'Canonical dish concepts (e.g., Palak Paneer). Server-managed.';
COMMENT ON TABLE ingredient_master IS 'Master ingredient list with synonyms and normalization data. Server-managed.';
COMMENT ON TABLE recipe_variants IS 'Different recipes for the same dish. Can be global or user-specific.';
COMMENT ON TABLE meal_plans IS 'User meal plans for a specific week.';
COMMENT ON TABLE meal_plan_items IS 'Individual meals within a meal plan.';
COMMENT ON TABLE pantry_items IS 'User pantry inventory inferred from behavior.';
COMMENT ON TABLE grocery_lists IS 'Generated grocery lists from meal plans.';
COMMENT ON TABLE grocery_list_items IS 'Individual items in a grocery list.';
COMMENT ON TABLE user_recipe_links IS 'External recipe URLs explicitly chosen by users.';
COMMENT ON TABLE ai_usage_logs IS 'OpenAI API usage tracking for cost and performance monitoring.';
COMMENT ON TABLE ai_cache IS 'Cached AI responses to avoid redundant API calls.';

COMMENT ON COLUMN dishes.ontology_tokens IS 'Expected ingredient tokens for learned validation (e.g., spinach:critical, cream:common)';
COMMENT ON COLUMN recipe_variants.validator_score IS 'Quality score from learned validator (0-1)';
COMMENT ON COLUMN pantry_items.confidence_score IS 'Confidence that user has this ingredient (0-1)';
COMMENT ON COLUMN grocery_list_items.normalized_grams IS 'Quantity normalized to grams for weight ingredients';
COMMENT ON COLUMN grocery_list_items.normalized_ml IS 'Quantity normalized to ml for volume ingredients';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

