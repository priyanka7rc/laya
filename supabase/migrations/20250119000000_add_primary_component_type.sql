-- Add primary_component_type column to dishes table
-- This allows intelligent meal composition from database dishes

-- Step 1: Add the column (nullable initially)
ALTER TABLE dishes 
ADD COLUMN IF NOT EXISTS primary_component_type component_type_enum;

-- Step 2: Create index for fast filtering by component type
CREATE INDEX IF NOT EXISTS idx_dishes_primary_component_type 
ON dishes(primary_component_type);

-- Step 3: Create index for combined filtering (component type + meal slot)
CREATE INDEX IF NOT EXISTS idx_dishes_component_and_slot 
ON dishes USING gin(typical_meal_slots);

COMMENT ON COLUMN dishes.primary_component_type IS 'The primary component type of this dish (e.g., carb, protein, veg). Used for intelligent meal composition.';
