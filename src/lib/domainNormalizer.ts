/**
 * Domain-bounded text normalization pre-pass.
 *
 * Runs before any interpretation or classification. Produces a cleaned,
 * expanded version of the raw input while preserving the original text.
 *
 * Shorthand and alias expansions are **data-driven** from the curated map in
 * `domainNormalizationMap.ts` — add new real-world variants there; do not edit
 * the expansion loop here unless changing behavior (e.g. word-boundary policy).
 *
 * Does NOT:
 *   - broad slang handling
 *   - grammar correction
 *   - stemming or lemmatisation
 *   - spelling correction beyond the curated map
 *
 * Pure function — no side effects, no DB calls.
 */

import {
  DEFAULT_EXPANSION_RULES,
  getDomainNormalizationMapSnapshot,
  type BuiltExpansionRule,
  type DomainNormalizationMap,
} from '@/lib/domainNormalizationMap';

export {
  DOMAIN_NORMALIZATION_MAP,
  validateNormalizationMap,
  buildExpansionRulesFromMap,
} from '@/lib/domainNormalizationMap';

// ============================================
// TYPES
// ============================================

export interface NormalizationMeta {
  /** Each entry is "input→output", e.g. "tmrw→tomorrow". */
  expansionsApplied: string[];
  /** True when normalizedText differs from originalText after cleanup. */
  changed: boolean;
}

export interface NormalizationResult {
  originalText: string;
  normalizedText: string;
  meta: NormalizationMeta;
}

// ============================================
// RE-EXPORTS (audit / tooling)
// ============================================

/** Curated map snapshot for one-place inspection during reviews. */
export { getDomainNormalizationMapSnapshot };
export type { DomainNormalizationMap };

// ============================================
// BASIC CLEANUP
// ============================================

/**
 * Clean up whitespace, quotes, dashes, and line breaks.
 * Applied before shorthand expansion.
 */
function basicCleanup(text: string): string {
  return text
    // Curly / smart quotes → straight quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Em dash / en dash → hyphen-space
    .replace(/[\u2014\u2013]/g, ' - ')
    // Ellipsis character → three dots
    .replace(/\u2026/g, '...')
    // Non-breaking space → regular space
    .replace(/\u00A0/g, ' ')
    // Collapse line breaks to space (WhatsApp messages can have \n inside a single message)
    .replace(/[\r\n]+/g, ' ')
    // Collapse repeated spaces
    .replace(/[ \t]{2,}/g, ' ')
    // Remove leading/trailing whitespace
    .trim();
}

// ============================================
// MAIN EXPORTED FUNCTION
// ============================================

/**
 * Normalize raw input text for task/list interpretation.
 *
 * Returns both the original and the normalized form so callers can:
 *   - Use normalizedText for all parsing and classification
 *   - Log originalText for debugging and audit
 *   - Inspect meta.expansionsApplied to understand what changed
 *
 * @param rulesOverride - For tests only: supply alternate rules; defaults to
 *                        DEFAULT_EXPANSION_RULES from the curated map.
 */
export function normalizeDomainText(
  text: string,
  rulesOverride?: readonly BuiltExpansionRule[]
): NormalizationResult {
  const originalText = text;
  const expansionsApplied: string[] = [];
  const rules = rulesOverride ?? DEFAULT_EXPANSION_RULES;

  // Phase 1: basic character-level cleanup
  let working = basicCleanup(text);

  // Phase 2: shorthand expansion (patterns from curated map; word-boundary for simple tokens)
  for (const { pattern, replacement, label } of rules) {
    const before = working;
    working = working.replace(pattern, replacement);
    if (working !== before) {
      if (!expansionsApplied.includes(label)) {
        expansionsApplied.push(label);
      }
    }
  }

  // Phase 3: final whitespace collapse (expansions may introduce extra spaces)
  working = working.replace(/[ \t]{2,}/g, ' ').trim();

  const normalizedText = working;
  const changed = normalizedText !== originalText;

  return {
    originalText,
    normalizedText,
    meta: {
      expansionsApplied,
      changed,
    },
  };
}
