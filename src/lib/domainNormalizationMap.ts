/**
 * Curated domain normalization map — single source of truth for Laya’s
 * task / list / household / productivity shorthand and aliases.
 *
 * ---------------------------------------------------------------------------
 * CONTRIBUTION CONTRACT (read before editing)
 * ---------------------------------------------------------------------------
 *
 * HOW TO ADD A NEW SHORTHAND SAFELY
 * - Add a row under the most fitting category in DOMAIN_NORMALIZATION_MAP.
 * - Use `variants` for plain tokens (letters/numbers only). Each variant is
 *   matched with word boundaries (\\b) and case-insensitive flags — you do
 *   not write regex here for simple tokens.
 * - Use `regexRules` only when the match is a phrase or needs special
 *   boundaries (e.g. "today pm", "w/").
 * - Prefer one canonical form per real-world meaning; add multiple variants
 *   pointing to the same canonical, not the reverse.
 *
 * HOW TO AVOID COLLISIONS
 * - Run tests: validateNormalizationMap() runs at module load and throws if
 *   the same variant maps to two different canonical strings.
 * - If two meanings share the same token (e.g. "cb"), pick one canonical for
 *   the product context or omit the token — do not add duplicate variants.
 *
 * HOW TO AVOID OVER-EXPANDING INSIDE LARGER WORDS
 * - Simple variants are always wrapped in \\b ... \\b — "doc" does not match
 *   inside "document", "eb" does not match inside "web".
 * - Do not add very short ambiguous tokens unless you accept false positives.
 * - For phrases, use regexRules with explicit patterns (see timeDate regex).
 *
 * WHEN TO ADD AN ALIAS VS NOT
 * - Add: recurring household / school / errand language users type in WhatsApp.
 * - Add: common typos of domain terms (tomoro → tomorrow).
 * - Do not add: general slang, memes, or open-ended spelling correction.
 * - Do not add: tokens that are common English words unless context is safe
 *   (word boundaries still help: "eve" as evening is borderline; kept because
 *   it is a standalone token in reminders).
 *
 * KEEP THE MAP DOMAIN-FOCUSED
 * - This is not a general English corrector. Cap total entries; prefer
 *   high-signal phrases for Indian household / productivity chat.
 * - Review periodically; remove entries that cause bad expansions in the wild.
 *
 * ---------------------------------------------------------------------------
 */

// ============================================
// TYPES
// ============================================

/** Logical buckets for editors; runtime order follows this declaration order. */
export type NormalizationCategory =
  | 'timeDate'
  | 'politeness'
  | 'householdAdmin'
  | 'schoolKids'
  | 'groceryList'
  | 'productivity';

/**
 * One or more surface forms (variants) that expand to a single canonical phrase.
 * Variants are matched as whole words only (see buildExpansionRulesFromMap).
 */
export interface NormalizationSimpleEntry {
  readonly variants: readonly string[];
  /** Canonical form used in interpretation (lowercase phrase is fine). */
  readonly canonical: string;
}

/**
 * Non-token rules: phrases or punctuation-heavy patterns.
 * Use sparingly; each must document intent in `label`.
 */
export interface NormalizationRegexRule {
  readonly pattern: RegExp;
  readonly replacement: string;
  /** Log label, e.g. "tmrw→tomorrow" or "today pm→this evening". */
  readonly label: string;
}

export interface NormalizationCategoryBlock {
  readonly simple: readonly NormalizationSimpleEntry[];
  /** Applied after all simple rules in this category block, in array order. */
  readonly regexRules?: readonly NormalizationRegexRule[];
}

export type DomainNormalizationMap = Record<NormalizationCategory, NormalizationCategoryBlock>;

// ============================================
// CURATED MAP (edit here only for new shorthands)
// ============================================

/**
 * Central curated map. Flattened at runtime by buildExpansionRulesFromMap().
 * Exported for audits and tooling.
 */
export const DOMAIN_NORMALIZATION_MAP: DomainNormalizationMap = {
  timeDate: {
    simple: [
      { variants: ['tmrw', 'tmr', 'tomoro'], canonical: 'tomorrow' },
      { variants: ['wknd'], canonical: 'weekend' },
      { variants: ['morn'], canonical: 'morning' },
      { variants: ['eve', 'evng'], canonical: 'evening' },
      { variants: ['nxt'], canonical: 'next' },
    ],
    regexRules: [
      {
        pattern: /\btoday\s*pm\b/gi,
        replacement: 'this evening',
        label: 'today pm→this evening',
      },
    ],
  },

  politeness: {
    simple: [{ variants: ['pls', 'plz'], canonical: 'please' }],
  },

  householdAdmin: {
    simple: [
      { variants: ['eb'], canonical: 'electricity bill' },
      { variants: ['ptm'], canonical: 'parent teacher meeting' },
      { variants: ['appt'], canonical: 'appointment' },
      { variants: ['doc'], canonical: 'doctor' },
    ],
  },

  schoolKids: {
    simple: [{ variants: ['schl'], canonical: 'school' }],
  },

  groceryList: {
    // Longer token first so "grocs" normalizes cleanly before "groc" where both apply.
    simple: [
      { variants: ['grocs', 'groc'], canonical: 'groceries' },
    ],
  },

  productivity: {
    simple: [
      // Note: "rc"/"cb" are high-ambiguity; kept as task-list idioms. Change canonical
      // here only if product copy and tests are updated together.
      { variants: ['rc'], canonical: 'return call' },
      { variants: ['cb'], canonical: 'call back' },
    ],
    regexRules: [
      { pattern: /\bw\/\b/gi, replacement: 'with', label: 'w/→with' },
      {
        pattern: /\bw\b(?=\s+\w)/gi,
        replacement: 'with',
        label: 'w→with',
      },
    ],
  },
};

// ============================================
// VALIDATION
// ============================================

export class NormalizationMapValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormalizationMapValidationError';
  }
}

/**
 * Validates that no two simple variants map to different canonical strings.
 * Call at startup; throws if the map is inconsistent.
 */
export function validateNormalizationMap(map: DomainNormalizationMap = DOMAIN_NORMALIZATION_MAP): void {
  const variantToCanonical = new Map<string, string>();

  for (const category of Object.keys(map) as NormalizationCategory[]) {
    const block = map[category];
    for (const entry of block.simple) {
      for (const v of entry.variants) {
        const key = v.toLowerCase();
        if (variantToCanonical.has(key)) {
          const existing = variantToCanonical.get(key)!;
          if (existing !== entry.canonical) {
            throw new NormalizationMapValidationError(
              `Duplicate variant "${v}" maps to both "${existing}" and "${entry.canonical}" (category ${category})`
            );
          }
        } else {
          variantToCanonical.set(key, entry.canonical);
        }
      }
    }
  }
}

// Run validation at module load so bad edits fail fast in dev/test.
validateNormalizationMap(DOMAIN_NORMALIZATION_MAP);

// ============================================
// BUILD RUNTIME RULES (used by domainNormalizer)
// ============================================

export interface BuiltExpansionRule {
  readonly pattern: RegExp;
  readonly replacement: string;
  /** Stable label for meta.expansionsApplied logging. */
  readonly label: string;
}

function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Flatten the curated map into ordered regex rules (simple token rules first
 * per category, then regexRules for that category). Category order is fixed
 * in DOMAIN_NORMALIZATION_MAP key order.
 */
export function buildExpansionRulesFromMap(
  map: DomainNormalizationMap = DOMAIN_NORMALIZATION_MAP
): BuiltExpansionRule[] {
  const rules: BuiltExpansionRule[] = [];
  const categoryOrder = Object.keys(map) as NormalizationCategory[];

  for (const category of categoryOrder) {
    const block = map[category];
    for (const entry of block.simple) {
      for (const variant of entry.variants) {
        const pattern = new RegExp(`\\b${escapeRegExpLiteral(variant)}\\b`, 'gi');
        const label = `${variant}→${entry.canonical}`;
        rules.push({ pattern, replacement: entry.canonical, label });
      }
    }
    if (block.regexRules) {
      for (const r of block.regexRules) {
        rules.push({
          pattern: r.pattern,
          replacement: r.replacement,
          label: r.label,
        });
      }
    }
  }

  return rules;
}

/**
 * Pre-built rules for the default map — avoids rebuilding on every normalize call.
 */
export const DEFAULT_EXPANSION_RULES: BuiltExpansionRule[] = buildExpansionRulesFromMap(
  DOMAIN_NORMALIZATION_MAP
);

/**
 * Shallow clone of the map for inspection in audits (categories preserved).
 */
export function getDomainNormalizationMapSnapshot(): DomainNormalizationMap {
  return DOMAIN_NORMALIZATION_MAP;
}
