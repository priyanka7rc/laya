-- ============================================================================
-- NORMALIZED RECIPE INGREDIENT CACHE
-- Cache normalized ingredients per recipe to avoid re-normalizing
-- ============================================================================

-- Create cache table for normalized recipe ingredients
CREATE TABLE IF NOT EXISTS normalized_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  recipe_servings_default INTEGER NOT NULL DEFAULT 2,
  
  -- Original ingredient data
  original_name TEXT NOT NULL,
  original_qty NUMERIC NOT NULL,
  original_unit TEXT,
  
  -- Normalized data (for 1x serving)
  canonical_name TEXT NOT NULL,
  metric_qty_per_serving NUMERIC NOT NULL,
  metric_unit TEXT NOT NULL CHECK (metric_unit IN ('g', 'ml')),
  is_liquid BOOLEAN NOT NULL DEFAULT false,
  
  -- Metadata
  normalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  normalization_version INTEGER NOT NULL DEFAULT 1,
  
  -- Index for line order within recipe
  ingredient_index INTEGER NOT NULL,
  
  UNIQUE(dish_id, ingredient_index)
);

-- Index for fast lookups
CREATE INDEX idx_normalized_recipe_dish_id ON normalized_recipe_ingredients(dish_id);
CREATE INDEX idx_normalized_recipe_normalized_at ON normalized_recipe_ingredients(normalized_at);

-- RLS Policies (public read for all recipes, write for service role only)
ALTER TABLE normalized_recipe_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read normalized recipe ingredients"
  ON normalized_recipe_ingredients
  FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert normalized recipe ingredients"
  ON normalized_recipe_ingredients
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update normalized recipe ingredients"
  ON normalized_recipe_ingredients
  FOR UPDATE
  USING (true);

CREATE POLICY "Service role can delete normalized recipe ingredients"
  ON normalized_recipe_ingredients
  FOR DELETE
  USING (true);

COMMENT ON TABLE normalized_recipe_ingredients IS 'Cache of AI-normalized ingredients per recipe to speed up grocery list generation';
COMMENT ON COLUMN normalized_recipe_ingredients.metric_qty_per_serving IS 'Metric quantity normalized to 1 serving (will be multiplied by actual servings when generating grocery list)';
COMMENT ON COLUMN normalized_recipe_ingredients.normalization_version IS 'Version number for cache invalidation when normalization logic changes';

