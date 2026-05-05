-- Persistent audit log for every interpretTurn call (web + WhatsApp).
--
-- Every call to interpretTurn() writes one row here (fire-and-forget).
-- This enables:
--   • Debugging regressions by replaying real inputs
--   • Identifying INTENT_GAP patterns (gap_fill=true rows) for rule expansion
--   • Measuring accuracy trends over time
--   • Phase 2 feedback: user_outcome written back after Apply / Discard

CREATE TABLE IF NOT EXISTS public.ai_turn_log (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Correlation
  turn_id                TEXT NOT NULL,
  channel                TEXT NOT NULL CHECK (channel IN ('web', 'whatsapp', 'unknown')),
  user_id                UUID REFERENCES public.app_users(id) ON DELETE SET NULL,

  -- Input
  raw_input              TEXT NOT NULL,
  normalized_input       TEXT,

  -- Classification metadata (mirrors ClassificationMeta)
  classifier_mode        TEXT,   -- 'rules' | 'llm' | 'llm_with_rules_fallback'
  classification_source  TEXT,   -- 'rules' | 'llm' | 'llm_failed_rules_used'
  reason_code            TEXT,   -- ClassificationReasonCode value
  gap_fill               BOOLEAN NOT NULL DEFAULT false,  -- true when reason_code = 'llm_gap_fill'
  fallback_used          BOOLEAN NOT NULL DEFAULT false,

  -- Actions produced
  action_count           INT NOT NULL DEFAULT 0,
  action_types           TEXT[],
  actions_json           JSONB,

  -- Execution plan
  execution_steps        JSONB,
  needs_clarification    BOOLEAN NOT NULL DEFAULT false,
  clarification_reason   TEXT,

  -- Timing
  llm_ms                 INT,
  rules_ms               INT,
  total_ms               INT,
  token_count            INT,

  -- Phase 2: user feedback (written back after Apply / Discard on web;
  --           corrected_turn_id written on WA correction detection)
  user_outcome           TEXT CHECK (user_outcome IN ('accepted', 'partially_accepted', 'discarded')),
  rejected_actions       JSONB,
  corrected_turn_id      TEXT  -- turn_id of the prior turn that was corrected
);

-- Fast lookup by turn_id (for feedback writes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_turn_log_turn_id
  ON public.ai_turn_log (turn_id);

-- Analytics: find gap_fill rows for rule expansion
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_gap_fill
  ON public.ai_turn_log (gap_fill, created_at DESC)
  WHERE gap_fill = true;

-- Analytics: find turns needing review by user_outcome
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_outcome
  ON public.ai_turn_log (user_outcome, created_at DESC)
  WHERE user_outcome IS NOT NULL;

-- Analytics: per-user history
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_user_id
  ON public.ai_turn_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Analytics: per-channel breakdown
CREATE INDEX IF NOT EXISTS idx_ai_turn_log_channel
  ON public.ai_turn_log (channel, created_at DESC);

COMMENT ON TABLE public.ai_turn_log IS
  'Persistent audit log for every interpretTurn() call. '
  'One row per turn, written fire-and-forget. '
  'gap_fill=true rows are candidates for rule expansion (Phase 4). '
  'user_outcome is written back after web Apply/Discard (Phase 2).';
