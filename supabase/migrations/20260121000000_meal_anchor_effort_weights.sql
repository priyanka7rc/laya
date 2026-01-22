-- ============================================================================
-- MEAL ANCHORS + SERVING CONTEXT WEIGHTS + EXPLORATION EVENTS
-- ============================================================================

-- Meal anchor enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meal_anchor_enum') THEN
    CREATE TYPE meal_anchor_enum AS ENUM (
      'complete_one_bowl',
      'rice_plate',
      'roti_plate',
      'breakfast_plate',
      'snack'
    );
  END IF;
END$$;

-- Dish effort level enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dish_effort_level_enum') THEN
    CREATE TYPE dish_effort_level_enum AS ENUM ('easy', 'medium', 'high');
  END IF;
END$$;

-- Add serving context weight + effort level to dishes
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS effort_level dish_effort_level_enum,
  ADD COLUMN IF NOT EXISTS serving_context_weight JSONB DEFAULT '{}'::JSONB;

COMMENT ON COLUMN dishes.effort_level IS 'Effort level for preparing the dish: easy|medium|high';
COMMENT ON COLUMN dishes.serving_context_weight IS 'Anchor-specific weight map (0-100) for dish suitability';

-- Add meal_anchor to meal_plan_items
ALTER TABLE meal_plan_items
  ADD COLUMN IF NOT EXISTS meal_anchor meal_anchor_enum;

UPDATE meal_plan_items
SET meal_anchor = CASE
  WHEN meal_slot IN ('morning_snack', 'evening_snack', 'pre_breakfast') THEN 'snack'::meal_anchor_enum
  WHEN meal_slot = 'breakfast' THEN 'breakfast_plate'::meal_anchor_enum
  ELSE 'rice_plate'::meal_anchor_enum
END
WHERE meal_anchor IS NULL;

ALTER TABLE meal_plan_items
  ALTER COLUMN meal_anchor SET NOT NULL;

COMMENT ON COLUMN meal_plan_items.meal_anchor IS 'Meal anchor chosen prior to dish selection';

-- Add exploration flag to meal_plate_components
ALTER TABLE meal_plate_components
  ADD COLUMN IF NOT EXISTS exploration BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN meal_plate_components.exploration IS 'Whether this dish pairing was selected via exploration';

-- Meal plan generation config (per plan)
CREATE TABLE IF NOT EXISTS meal_plan_generation_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  rice_plate_ratio NUMERIC(4,2) DEFAULT 0.5,
  roti_plate_ratio NUMERIC(4,2) DEFAULT 0.5,
  familiarity_mode TEXT,
  effort_ceiling dish_effort_level_enum DEFAULT 'medium',
  exploration_budget INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meal_plan_id)
);

ALTER TABLE meal_plan_generation_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own meal plan configs"
  ON meal_plan_generation_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans mp
      WHERE mp.id = meal_plan_generation_config.meal_plan_id
      AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own meal plan configs"
  ON meal_plan_generation_config FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meal_plans mp
      WHERE mp.id = meal_plan_generation_config.meal_plan_id
      AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own meal plan configs"
  ON meal_plan_generation_config FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans mp
      WHERE mp.id = meal_plan_generation_config.meal_plan_id
      AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own meal plan configs"
  ON meal_plan_generation_config FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plans mp
      WHERE mp.id = meal_plan_generation_config.meal_plan_id
      AND mp.user_id = auth.uid()
    )
  );

-- Exploration events
CREATE TABLE IF NOT EXISTS meal_exploration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  meal_plan_item_id UUID REFERENCES meal_plan_items(id) ON DELETE SET NULL,
  dish_id UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  meal_anchor meal_anchor_enum NOT NULL,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_slot meal_slot NOT NULL,
  weight_band TEXT NOT NULL,
  role TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meal_exploration_events_plan_id ON meal_exploration_events(meal_plan_id);
CREATE INDEX IF NOT EXISTS idx_meal_exploration_events_dish_id ON meal_exploration_events(dish_id);

ALTER TABLE meal_exploration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own exploration events"
  ON meal_exploration_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own exploration events"
  ON meal_exploration_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
