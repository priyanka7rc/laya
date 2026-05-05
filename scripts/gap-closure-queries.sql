-- ============================================================
-- Phase 4: Rule Gap Closure — Weekly Review Queries
-- ============================================================
--
-- Run these in the Supabase SQL Editor (or psql) once per sprint.
-- Goal: find inputs where rules failed and LLM succeeded (gap_fill=true),
--       promote them to src/__tests__/fixtures/interpretTurn.fixtures.ts,
--       then extend rules until the fixture passes without LLM.
--
-- After adding a rule, the gap_fill=true count for that pattern should drop.

-- ── 1. Top 50 gap-fill inputs accepted by the user (highest-value targets) ──

SELECT
  raw_input,
  actions_json,
  channel,
  created_at,
  total_ms
FROM ai_turn_log
WHERE gap_fill = true
  AND user_outcome = 'accepted'
ORDER BY created_at DESC
LIMIT 50;

-- ── 2. Gap-fill rate by week (trend — should go down as rules improve) ──

SELECT
  date_trunc('week', created_at)::date AS week,
  COUNT(*) FILTER (WHERE gap_fill = true) AS gap_fill_count,
  COUNT(*) AS total_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE gap_fill = true) / NULLIF(COUNT(*), 0),
    1
  ) AS gap_fill_pct
FROM ai_turn_log
GROUP BY 1
ORDER BY 1 DESC
LIMIT 12;

-- ── 3. Turns where the user partially rejected actions (rule missed something) ──

SELECT
  raw_input,
  actions_json,
  rejected_actions,
  channel,
  created_at
FROM ai_turn_log
WHERE user_outcome = 'partially_accepted'
  AND rejected_actions IS NOT NULL
ORDER BY created_at DESC
LIMIT 30;

-- ── 4. Turns corrected within 60s by a follow-up WA message ──

SELECT
  a.raw_input         AS original_input,
  b.raw_input         AS correction_input,
  a.actions_json      AS original_actions,
  b.actions_json      AS correction_actions,
  a.channel,
  a.created_at
FROM ai_turn_log a
JOIN ai_turn_log b ON b.turn_id = a.corrected_turn_id
ORDER BY a.created_at DESC
LIMIT 20;

-- ── 5. 0-action turns (neither rules nor LLM produced anything) ──

SELECT
  raw_input,
  reason_code,
  channel,
  created_at
FROM ai_turn_log
WHERE action_count = 0
  AND user_outcome IS DISTINCT FROM 'discarded'
ORDER BY created_at DESC
LIMIT 30;

-- ── 6. Most common action type distributions ──

SELECT
  unnest(action_types) AS action_type,
  COUNT(*) AS count
FROM ai_turn_log
WHERE created_at > now() - interval '7 days'
GROUP BY 1
ORDER BY 2 DESC;

-- ── 7. Classification source breakdown (rules vs LLM) by channel ──

SELECT
  channel,
  classification_source,
  COUNT(*) AS count,
  ROUND(AVG(total_ms)) AS avg_ms
FROM ai_turn_log
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2
ORDER BY 1, 3 DESC;
