/**
 * Minimal timestamped logger for server-side use.
 * Prepends an ISO-8601 timestamp to every line so correlating
 * WhatsApp webhook requests in the terminal is straightforward.
 *
 * Usage:
 *   import { log, warn, error } from '@/lib/logger';
 *   log('[WA] some event');
 *   error('[WA] something broke', err);
 */

import type { ClassificationMeta } from '@/lib/intentClassifier';
import type { NormalizationMeta } from '@/lib/domainNormalizer';
import type { SufficiencyResult } from '@/lib/sufficiencyValidator';
import type { SafetyGuardResult } from '@/lib/responseSafetyLayer';

function ts(): string {
  return new Date().toISOString();
}

export function log(...args: unknown[]): void {
  console.log(`[${ts()}]`, ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(`[${ts()}] ⚠️`, ...args);
}

export function error(...args: unknown[]): void {
  console.error(`[${ts()}] ❌`, ...args);
}

// ============================================
// VERBOSITY CONTROL
// ============================================

/**
 * True when LOG_INTENT_CLASSIFICATION_VERBOSE=true.
 * Enables text previews and full JSON dumps in classification logs.
 * Safe to enable in dev/staging; keep off in production.
 */
export function isVerboseLogging(): boolean {
  return process.env.LOG_INTENT_CLASSIFICATION_VERBOSE === 'true';
}

// ============================================
// CLASSIFICATION LOGGING
// ============================================

/**
 * Log a single structured classification event.
 *
 * Always emits a compact one-liner with:
 *   turnId, channel, classifierMode, classificationSource, reasonCode,
 *   fallbackUsed, totalMs, actionCount, actionTypes
 *
 * When LOG_INTENT_CLASSIFICATION_VERBOSE=true also emits:
 *   llmMs, rulesMs, textLengthChars, tokenCount, textPreview (40 chars max)
 *   + the full meta object as JSON for deep inspection
 */
export function logClassification(meta: ClassificationMeta): void {
  const actionSummary =
    meta.actionCount > 0 ? `${meta.actionCount}(${meta.actionTypes.join(',')})` : '0';

  log(
    `[CLASSIFY]` +
    ` turnId=${meta.turnId}` +
    ` channel=${meta.channel}` +
    ` mode=${meta.classifierMode}` +
    ` source=${meta.classificationSource}` +
    ` reason=${meta.reasonCode}` +
    ` fallback=${meta.fallbackUsed}` +
    ` totalMs=${meta.timings.totalMs}` +
    ` actions=${actionSummary}`
  );

  if (isVerboseLogging()) {
    const extras: string[] = [];
    if (meta.timings.llmMs !== undefined) extras.push(`llmMs=${meta.timings.llmMs}`);
    if (meta.timings.rulesMs !== undefined) extras.push(`rulesMs=${meta.timings.rulesMs}`);
    extras.push(`textLen=${meta.textLengthChars}`);
    if (meta.tokenCount !== undefined) extras.push(`tokens=${meta.tokenCount}`);
    if (meta.textPreview !== undefined) extras.push(`preview="${meta.textPreview}"`);

    log(`[CLASSIFY:verbose] turnId=${meta.turnId} | ${extras.join(' | ')}`);
    log(`[CLASSIFY:json]`, JSON.stringify(meta));
  }
}

// ============================================
// STRUCTURED INTERPRETATION HELPERS
// ============================================

/**
 * Log a TurnInterpretation result.
 * Emits a single line with action counts, clarification flag, step summary,
 * and classification source when available.
 */
export function logInterpretation(
  userId: string,
  result: {
    turnId?: string;
    normalizedText: string;
    detectedActions: Array<{ type: string }>;
    needsClarification: boolean;
    log: {
      clarificationReason: string | null;
      stepKinds: string[];
      classification?: ClassificationMeta | null;
    };
  }
): void {
  const actionTypes = result.detectedActions.map((a) => a.type).join(',') || 'none';
  const steps = result.log.stepKinds.join(',') || 'none';
  const source = result.log.classification?.classificationSource ?? 'unknown';
  const turnIdPart = result.turnId ? ` turnId=${result.turnId}` : '';

  log(
    `[INTERP]${turnIdPart}` +
    ` userId=${userId}` +
    ` source=${source}` +
    ` textLen=${result.normalizedText.length}` +
    ` actions=${result.detectedActions.length}(${actionTypes})` +
    ` needsClarification=${result.needsClarification}` +
    ` clarifyReason=${result.log.clarificationReason ?? 'none'}` +
    ` steps=${steps}`
  );
}

/**
 * Log an execution plan before dispatching.
 * Emits step kinds, action types, and a count summary (immediate vs deferred).
 */
export function logExecutionPlan(
  userId: string,
  steps: Array<{ kind: string; action?: { type: string }; clarificationReason?: string }>,
  turnId?: string
): void {
  const summary = steps
    .map((s) =>
      s.kind === 'execute'
        ? `execute(${s.action?.type ?? '?'})`
        : `clarify(${s.clarificationReason ?? '?'})`
    )
    .join(' → ');

  const immediate = steps.filter(s => s.kind === 'execute').length;
  const deferred = steps.filter(s => s.kind === 'clarify').length;
  const partialSuccess = immediate > 0 && deferred > 0;
  const turnIdPart = turnId ? ` turnId=${turnId}` : '';

  log(
    `[PLAN]${turnIdPart}` +
    ` userId=${userId}` +
    ` immediate=${immediate}` +
    ` deferred=${deferred}` +
    ` partialSuccess=${partialSuccess}` +
    ` | ${summary || 'empty'}`
  );
}

/**
 * Log a single reference resolution result.
 * Called once per resolved reference for granular tracing.
 */
export function logReferenceResolution(
  userId: string,
  pattern: string,
  source: string,
  confidence: string,
  turnId?: string
): void {
  const turnIdPart = turnId ? ` turnId=${turnId}` : '';
  log(`[REF]${turnIdPart} userId=${userId} | pattern=${pattern} | source=${source} | confidence=${confidence}`);
}

// ============================================
// NORMALIZATION LOGGING
// ============================================

/**
 * Log domain normalization result.
 *
 * Always emits whether the text changed and how many expansions were applied.
 * When LOG_INTENT_CLASSIFICATION_VERBOSE=true, also lists individual expansions.
 */
export function logNormalization(meta: NormalizationMeta, turnId?: string): void {
  const turnIdPart = turnId ? ` turnId=${turnId}` : '';
  const expansionCount = meta.expansionsApplied.length;

  log(
    `[NORM]${turnIdPart}` +
    ` changed=${meta.changed}` +
    ` expansions=${expansionCount}`
  );

  if (isVerboseLogging() && expansionCount > 0) {
    log(`[NORM:verbose]${turnIdPart} | ${meta.expansionsApplied.join(' | ')}`);
  }
}

// ============================================
// SUFFICIENCY LOGGING
// ============================================

/**
 * Log per-action sufficiency validation results.
 *
 * Emits a summary line with counts of executable / clarify / invalid_fallback.
 * When verbose, lists per-action decisions inline.
 */
export function logSufficiency(
  userId: string,
  results: SufficiencyResult[],
  turnId?: string
): void {
  if (results.length === 0) return;

  const executable = results.filter((r) => r.decision === 'executable').length;
  const needsClarification = results.filter((r) => r.decision === 'needs_clarification').length;
  const invalidFallback = results.filter((r) => r.decision === 'invalid_fallback').length;
  const turnIdPart = turnId ? ` turnId=${turnId}` : '';

  log(
    `[SUFFICIENCY]${turnIdPart}` +
    ` userId=${userId}` +
    ` total=${results.length}` +
    ` executable=${executable}` +
    ` needsClarification=${needsClarification}` +
    ` invalidFallback=${invalidFallback}`
  );

  if (isVerboseLogging()) {
    for (const r of results) {
      const detail =
        r.decision !== 'executable'
          ? ` reason=${r.reason ?? '?'} msg="${r.clarificationMessage ?? ''}"`
          : '';
      log(
        `[SUFFICIENCY:verbose]${turnIdPart}` +
        ` type=${r.action.type}` +
        ` decision=${r.decision}${detail}`
      );
    }
  }
}

// ============================================
// RESPONSE SAFETY LOGGING
// ============================================

/**
 * Log the outcome of the response safety guard.
 *
 * Always emits usedFallback and reason (when triggered).
 * When verbose, also shows the first 60 chars of the final reply.
 */
export function logResponseSafety(
  userId: string,
  result: SafetyGuardResult & { finalReplyPreview?: string },
  turnId?: string
): void {
  const turnIdPart = turnId ? ` turnId=${turnId}` : '';
  const reasonPart = result.usedFallback ? ` reason=${result.reason ?? 'unknown'}` : '';

  log(
    `[SAFETY]${turnIdPart}` +
    ` userId=${userId}` +
    ` usedFallback=${result.usedFallback}${reasonPart}`
  );

  if (isVerboseLogging() && result.reply) {
    const preview = result.reply.slice(0, 60);
    log(`[SAFETY:verbose]${turnIdPart} reply="${preview}${result.reply.length > 60 ? '…' : ''}"`);
  }
}
