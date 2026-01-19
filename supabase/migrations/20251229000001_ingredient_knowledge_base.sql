-- ============================================================================
-- INGREDIENT NORMALIZATION KNOWLEDGE BASE (Permanent)
-- ============================================================================
-- Purpose: Store learned ingredient patterns that survive cache clears
-- Scope: Ingredient-level (not recipe-level)
-- Lifetime: Permanent (only clear if fundamentally wrong)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ingredient_normalization_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Pattern matching (composite key for lookups)
  ingredient_pattern TEXT NOT NULL,
  qty_pattern TEXT,
  unit_pattern TEXT,
  
  -- Normalized output
  canonical_name TEXT NOT NULL,
  metric_qty_per_unit NUMERIC NOT NULL,
  metric_unit TEXT NOT NULL CHECK (metric_unit IN ('g', 'ml')),
  is_liquid BOOLEAN NOT NULL DEFAULT false,
  
  -- Metadata
  learned_from TEXT NOT NULL CHECK (
    learned_from IN ('rules', 'ai', 'user_correction')
  ),
  confidence_score NUMERIC DEFAULT 1.0 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Composite unique constraint
  UNIQUE(ingredient_pattern, unit_pattern)
);

-- Indexes for fast lookups
CREATE INDEX idx_ingredient_pattern ON ingredient_normalization_rules(ingredient_pattern);
CREATE INDEX idx_usage_count ON ingredient_normalization_rules(usage_count DESC);
CREATE INDEX idx_learned_from ON ingredient_normalization_rules(learned_from);
CREATE INDEX idx_last_used ON ingredient_normalization_rules(last_used_at DESC);

-- RLS Policies
ALTER TABLE ingredient_normalization_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read ingredient rules" 
  ON ingredient_normalization_rules FOR SELECT 
  USING (true);

CREATE POLICY "Service role can insert ingredient rules" 
  ON ingredient_normalization_rules FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Service role can update ingredient rules" 
  ON ingredient_normalization_rules FOR UPDATE 
  USING (true);

CREATE POLICY "Service role can delete ingredient rules" 
  ON ingredient_normalization_rules FOR DELETE 
  USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE ingredient_normalization_rules IS 
  'Permanent knowledge base of ingredient normalization patterns. Survives cache clears.';

COMMENT ON COLUMN ingredient_normalization_rules.ingredient_pattern IS 
  'Ingredient name pattern (e.g., "onion", "medium onion", "pinch asafoetida")';

COMMENT ON COLUMN ingredient_normalization_rules.learned_from IS 
  'Source: rules (hardcoded), ai (learned from LLM), user_correction (manual fix)';

COMMENT ON COLUMN ingredient_normalization_rules.usage_count IS 
  'How many times this pattern has been matched. Higher = more common.';

COMMENT ON COLUMN ingredient_normalization_rules.confidence_score IS 
  'How confident we are in this normalization (0-1). Lower = needs review.';



