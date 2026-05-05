/**
 * Fire-and-forget audit log writer for every interpretTurn() call.
 *
 * Writes one row to ai_turn_log per turn. Never throws, never awaited by the
 * caller — call with `void auditTurn(...)` so latency never reaches the user.
 *
 * Populated from:
 *   - src/app/api/parseDump/route.ts       (web Unload)
 *   - src/lib/whatsapp-processor.ts        (WhatsApp handleCompoundCapture)
 *
 * Phase 2 feedback (user_outcome, rejected_actions, corrected_turn_id) is
 * written back separately by the feedback API route and WA correction detector.
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { TurnInterpretation } from '@/lib/turnInterpreter';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface AuditTurnOptions {
  /** app_users.id (not auth user id). Pass null if unauthenticated or unknown. */
  appUserId: string | null;
  /** The full TurnInterpretation result from interpretTurn(). */
  interpretation: TurnInterpretation;
}

/**
 * Persist one interpretTurn call to ai_turn_log.
 *
 * Fire-and-forget: await this with `void auditTurn(...)`.
 * Any error is caught and logged to console only — never rethrown.
 */
export async function auditTurn(opts: AuditTurnOptions): Promise<void> {
  try {
    const { appUserId, interpretation } = opts;
    const meta = interpretation.log.classification;

    const row = {
      turn_id:               interpretation.turnId,
      channel:               meta?.channel ?? 'unknown',
      user_id:               appUserId ?? null,
      raw_input:             interpretation.originalText,
      normalized_input:      interpretation.normalizedText !== interpretation.originalText
                               ? interpretation.normalizedText
                               : null,
      classifier_mode:       meta?.classifierMode ?? null,
      classification_source: meta?.classificationSource ?? null,
      reason_code:           meta?.reasonCode ?? null,
      gap_fill:              meta?.reasonCode === 'llm_gap_fill',
      fallback_used:         meta?.fallbackUsed ?? false,
      action_count:          interpretation.detectedActions.length,
      action_types:          interpretation.detectedActions.map((a) => a.type),
      actions_json:          interpretation.detectedActions,
      execution_steps:       interpretation.executionPlan,
      needs_clarification:   interpretation.needsClarification,
      clarification_reason:  interpretation.log.clarificationReason ?? null,
      llm_ms:                meta?.timings?.llmMs ?? null,
      rules_ms:              meta?.timings?.rulesMs ?? null,
      total_ms:              meta?.timings?.totalMs ?? null,
      token_count:           meta?.tokenCount ?? null,
    };

    const supabase = getSupabase();
    const { error } = await supabase.from('ai_turn_log').insert(row);

    if (error) {
      console.warn('[auditLog] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[auditLog] unexpected error:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Write user feedback back to an existing ai_turn_log row.
 * Called by POST /api/parseDump/feedback after the user applies or discards.
 */
export async function auditFeedback(
  turnId: string,
  outcome: 'accepted' | 'partially_accepted' | 'discarded',
  rejectedActions?: unknown[]
): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('ai_turn_log')
      .update({
        user_outcome:     outcome,
        rejected_actions: rejectedActions && rejectedActions.length > 0 ? rejectedActions : null,
      })
      .eq('turn_id', turnId);

    if (error) {
      console.warn('[auditLog] feedback update failed:', error.message);
    }
  } catch (err) {
    console.warn('[auditLog] feedback error:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * Record that a prior turn was corrected by a follow-up.
 * Called from whatsapp-processor when a task_follow_up_patch fires within 60s of the prior turn.
 */
export async function auditCorrection(
  correctedTurnId: string,
  correctionTurnId: string
): Promise<void> {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('ai_turn_log')
      .update({ corrected_turn_id: correctionTurnId })
      .eq('turn_id', correctedTurnId);

    if (error) {
      console.warn('[auditLog] correction update failed:', error.message);
    }
  } catch (err) {
    console.warn('[auditLog] correction error:', err instanceof Error ? err.message : String(err));
  }
}
