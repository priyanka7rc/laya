-- Migration: Add 'snack', 'fruit', and 'beverage' values to component_type_enum
-- Required for snack meal slots (morning_snack, evening_snack) and beverages (chai, coffee)

-- Add new enum values
ALTER TYPE component_type_enum ADD VALUE IF NOT EXISTS 'snack';
ALTER TYPE component_type_enum ADD VALUE IF NOT EXISTS 'fruit';
ALTER TYPE component_type_enum ADD VALUE IF NOT EXISTS 'beverage';

-- Verify the enum has all values
-- Expected: carb, protein, veg, broth, condiment, dairy, salad, crunch, snack, fruit, beverage, other
