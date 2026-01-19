-- ============================================================================
-- MEAL PLATES MIGRATION
-- ============================================================================
-- Purpose: Support multiple dishes per meal using a "plate" model
-- ============================================================================

-- Create component type enum
CREATE TYPE component_type_enum AS ENUM (
  'carb',
  'protein',
  'veg',
  'broth',
  'condiment',
  'dairy',
  'salad',
  'crunch',
  'other'
);

-- ============================================================================
-- TABLES
-- ============================================================================

-- Meal Plates: One per meal_plan_item
CREATE TABLE meal_plates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plan_item_id UUID NOT NULL REFERENCES meal_plan_items(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meal_plan_item_id)
);

-- Meal Plate Components: Multiple dishes per plate
CREATE TABLE meal_plate_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_plate_id UUID NOT NULL REFERENCES meal_plates(id) ON DELETE CASCADE,
  component_type component_type_enum NOT NULL,
  dish_name TEXT NOT NULL,
  dish_id UUID REFERENCES dishes(id) ON DELETE SET NULL,
  servings INT,
  quantity_hint TEXT,
  is_optional BOOLEAN DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meal_plate_id, sort_order)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX idx_meal_plates_item_id ON meal_plates(meal_plan_item_id);
CREATE INDEX idx_meal_plate_components_plate_id ON meal_plate_components(meal_plate_id);
CREATE INDEX idx_meal_plate_components_dish_id ON meal_plate_components(dish_id);
CREATE INDEX idx_meal_plate_components_type ON meal_plate_components(component_type);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

-- Enable RLS
ALTER TABLE meal_plates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plate_components ENABLE ROW LEVEL SECURITY;

-- Meal Plates: User-scoped through meal_plan_items
CREATE POLICY "Users can view their own meal plates"
  ON meal_plates FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plan_items mpi
      JOIN meal_plans mp ON mp.id = mpi.meal_plan_id
      WHERE mpi.id = meal_plates.meal_plan_item_id
      AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own meal plates"
  ON meal_plates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meal_plan_items mpi
      JOIN meal_plans mp ON mp.id = mpi.meal_plan_id
      WHERE mpi.id = meal_plates.meal_plan_item_id
      AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own meal plates"
  ON meal_plates FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plan_items mpi
      JOIN meal_plans mp ON mp.id = mpi.meal_plan_id
      WHERE mpi.id = meal_plates.meal_plan_item_id
      AND mp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own meal plates"
  ON meal_plates FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plan_items mpi
      JOIN meal_plans mp ON mp.id = mpi.meal_plan_id
      WHERE mpi.id = meal_plates.meal_plan_item_id
      AND mp.user_id = auth.uid()
    )
  );

-- Meal Plate Components: User-scoped through meal_plates
CREATE POLICY "Users can view their own meal plate components"
  ON meal_plate_components FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plates mp
      JOIN meal_plan_items mpi ON mpi.id = mp.meal_plan_item_id
      JOIN meal_plans plan ON plan.id = mpi.meal_plan_id
      WHERE mp.id = meal_plate_components.meal_plate_id
      AND plan.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own meal plate components"
  ON meal_plate_components FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meal_plates mp
      JOIN meal_plan_items mpi ON mpi.id = mp.meal_plan_item_id
      JOIN meal_plans plan ON plan.id = mpi.meal_plan_id
      WHERE mp.id = meal_plate_components.meal_plate_id
      AND plan.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own meal plate components"
  ON meal_plate_components FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plates mp
      JOIN meal_plan_items mpi ON mpi.id = mp.meal_plan_item_id
      JOIN meal_plans plan ON plan.id = mpi.meal_plan_id
      WHERE mp.id = meal_plate_components.meal_plate_id
      AND plan.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own meal plate components"
  ON meal_plate_components FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meal_plates mp
      JOIN meal_plan_items mpi ON mpi.id = mp.meal_plan_item_id
      JOIN meal_plans plan ON plan.id = mpi.meal_plan_id
      WHERE mp.id = meal_plate_components.meal_plate_id
      AND plan.user_id = auth.uid()
    )
  );

-- ============================================================================
-- HELPER FUNCTION
-- ============================================================================

-- Auto-create meal_plate when meal_plan_item is created
CREATE OR REPLACE FUNCTION create_meal_plate_for_item()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO meal_plates (meal_plan_item_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER create_meal_plate_trigger
  AFTER INSERT ON meal_plan_items
  FOR EACH ROW
  EXECUTE FUNCTION create_meal_plate_for_item();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE meal_plates IS 'Container for multiple dishes in a meal slot';
COMMENT ON TABLE meal_plate_components IS 'Individual dishes/components in a plate';
COMMENT ON COLUMN meal_plate_components.component_type IS 'Type: carb, protein, veg, broth, condiment, dairy, salad, crunch, other';
COMMENT ON COLUMN meal_plate_components.quantity_hint IS 'Human-readable hint like "1 cup cooked rice"';
COMMENT ON COLUMN meal_plate_components.is_optional IS 'Whether this component is optional (e.g., condiment)';

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

