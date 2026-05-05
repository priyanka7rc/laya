-- Learning loop: track when the LLM resolved a temporal term that rules could not.
-- Quarterly review of rows where temporal_term_original IS NOT NULL identifies new
-- terms to add to temporalDictionary.ts.

ALTER TABLE public.ai_turn_log
  ADD COLUMN IF NOT EXISTS temporal_term_original  TEXT,
  ADD COLUMN IF NOT EXISTS temporal_term_resolved  TEXT;

-- Index for learning loop queries: find all turns where LLM resolved a new temporal term
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_temporal_terms
  ON public.ai_turn_log (temporal_term_original, created_at DESC)
  WHERE temporal_term_original IS NOT NULL;

COMMENT ON COLUMN public.ai_turn_log.temporal_term_original IS
  'Original colloquial temporal phrase used in the input when rules could not resolve it '
  '(e.g. "eow", "first thing tomorrow", "in a few days"). Populated on gap-fill LLM turns only. '
  'Used by the learning loop to identify new terms for temporalDictionary.ts.';

COMMENT ON COLUMN public.ai_turn_log.temporal_term_resolved IS
  'The YYYY-MM-DD or HH:MM value the LLM resolved temporal_term_original to. '
  'Helps reviewers see if the LLM resolved it correctly before promoting to the dictionary.';
