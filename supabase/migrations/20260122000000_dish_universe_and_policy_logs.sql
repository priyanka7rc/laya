-- ============================================================================
-- DISH UNIVERSE + MEAL POLICY LOGS
-- ============================================================================

-- Add dish_universe_id to dishes
ALTER TABLE dishes
  ADD COLUMN IF NOT EXISTS dish_universe_id TEXT;

COMMENT ON COLUMN dishes.dish_universe_id IS 'Universe identifier for dish (e.g., dal, rice, roti, dry_veg)';

-- Meal policy logs (accept/reject decisions)
CREATE TABLE IF NOT EXISTS meal_policy_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_plan_id UUID NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,
  meal_plan_item_id UUID REFERENCES meal_plan_items(id) ON DELETE SET NULL,
  dish_variant_id UUID REFERENCES dishes(id) ON DELETE SET NULL,
  dish_universe_id TEXT,
  meal_anchor meal_anchor_enum NOT NULL,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  meal_slot meal_slot NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason TEXT,
  dish_role TEXT,
  overlap_status TEXT,
  exploration_flag BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meal_policy_logs_plan_id ON meal_policy_logs(meal_plan_id);
CREATE INDEX IF NOT EXISTS idx_meal_policy_logs_user_id ON meal_policy_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_meal_policy_logs_dish_variant_id ON meal_policy_logs(dish_variant_id);

ALTER TABLE meal_policy_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own meal policy logs"
  ON meal_policy_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own meal policy logs"
  ON meal_policy_logs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
