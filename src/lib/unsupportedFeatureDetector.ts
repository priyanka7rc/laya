/**
 * Detects mentions of features that Laya does not yet support and returns
 * graceful fallback messages.
 *
 * Design:
 *   - Pure function — no DB, no LLM, no side effects.
 *   - Called in whatsapp-processor before the main execution path.
 *   - Returns null when no unsupported feature is detected; the caller
 *     continues with the normal pipeline.
 *   - Returns a UnsupportedFeatureResult when a known unsupported feature
 *     is detected; the caller sends the graceful message and returns early.
 *
 * Adding new patterns: add an entry to UNSUPPORTED_FEATURES below.
 */

// ============================================
// TYPES
// ============================================

export interface UnsupportedFeatureResult {
  /** The feature category that was detected. */
  feature: UnsupportedFeature;
  /** Human-readable response to send to the user. */
  message: string;
}

export type UnsupportedFeature =
  | 'recurring'
  | 'snooze'
  | 'video_meeting'
  | 'subtasks'
  | 'priority';

// ============================================
// FEATURE DEFINITIONS
// ============================================

interface FeatureEntry {
  feature: UnsupportedFeature;
  /** Regex to detect mention of the feature in lowercased input. */
  pattern: RegExp;
  /** Response template. Use {time} as a placeholder for a suggested replacement time. */
  message: string;
}

const UNSUPPORTED_FEATURES: FeatureEntry[] = [
  {
    feature: 'recurring',
    pattern: /\b(every\s+(day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|weekly|monthly|recurring|repeat(ing|s)?|each\s+(day|week|month))\b/i,
    message: "I can't set recurring tasks yet. I've noted this task — let me know when you want the next one added.",
  },
  {
    feature: 'snooze',
    pattern: /\b(snooze|remind\s+me\s+(again|later|in\s+\d+)|postpone\s+reminder)\b/i,
    message: "Snooze isn't available yet. If you'd like to reschedule, just tell me the new time.",
  },
  {
    feature: 'video_meeting',
    pattern: /\b(zoom\s+(link|call|meeting)|google\s+meet(\s+link)?|teams\s+meeting|meet\.google|\.zoom\.us)\b/i,
    message: "I can't generate meeting links yet. I've noted the meeting — add the link in the task details.",
  },
  {
    feature: 'subtasks',
    pattern: /\b(sub-?tasks?|checklist|sub-?items?)\b/i,
    message: "I don't support subtasks yet. I've created these as separate tasks instead.",
  },
  {
    feature: 'priority',
    pattern: /\b(high\s+priority|low\s+priority|urgent\s+task|critical\s+task|p0|p1|p2)\b/i,
    message: "Priority levels are coming soon! I've added a note in the title for now.",
  },
];

// ============================================
// MAIN EXPORTED FUNCTION
// ============================================

/**
 * Check whether input text mentions an unsupported feature.
 *
 * Returns the first matching UnsupportedFeatureResult, or null if no match.
 *
 * @param text - The raw or normalised input text (lowercasing is applied internally).
 */
export function detectUnsupportedFeature(text: string): UnsupportedFeatureResult | null {
  const lower = text.toLowerCase();
  for (const entry of UNSUPPORTED_FEATURES) {
    if (entry.pattern.test(lower)) {
      return {
        feature: entry.feature,
        message: entry.message,
      };
    }
  }
  return null;
}

/**
 * Exported for tests: returns all feature labels.
 */
export function getAllUnsupportedFeatureLabels(): UnsupportedFeature[] {
  return UNSUPPORTED_FEATURES.map((e) => e.feature);
}
