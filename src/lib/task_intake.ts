/**
 * Canonical "segment string → ProposedTask" pipeline using Feature #1 parsers only.
 * Used by Brain Dump and OCR import; no duplicate parsing logic.
 */

import {
  parseDate,
  parseTime,
  detectCategory,
  stripTemporalPhrases,
  getSmartDefaultTime,
  nudgePastTime,
} from '@/lib/taskRulesParser';

/**
 * Intent-signalling prefixes that the user writes to direct Laya but should not
 * appear in the stored task title.
 *
 * Applied after temporal phrases are stripped so date/time parsing still sees the
 * full original text. Falls back to the pre-strip value if stripping would empty
 * the title.
 *
 * Examples:
 *   "Remind me to buy groceries today"  → "Buy groceries"
 *   "Remember to call the dentist"       → "Call the dentist"
 *   "Don't forget to pay the bill"       → "Pay the bill"
 *   "Please schedule a meeting"          → "Schedule a meeting"
 *   "And remind me to pay the bill"      → "Pay the bill"
 *   "Need to call the dentist"           → "Call the dentist"
 *   "I need to book a flight"            → "Book a flight"
 */
const INTENT_PREFIX_PATTERNS: RegExp[] = [
  /^and\s+also\s+remind(?:\s+me)?\s+to\s+/i,
  /^and\s+remind(?:\s+me)?\s+to\s+/i,
  /^also\s+remind(?:\s+me)?\s+to\s+/i,
  /^also\s+remember\s+to\s+/i,
  /^remind(?:\s+me)?\s+to\s+/i,
  /^remember\s+to\s+/i,
  /^don'?t\s+forget\s+to\s+/i,
  /^i\s+need\s+to\s+/i,
  /^need\s+to\s+/i,
  /^please\s+/i,
  /^can\s+you\s+/i,
  /^could\s+you\s+/i,
  /^and\s+also\s+/i,
  /^also\s+/i,
  /^and\s+/i,
];

/**
 * Action verbs that signal a segment is an actionable task rather than
 * conversational filler ("This week is a bit mad", "It's been busy").
 * A segment that has no action verb and no temporal signal is skipped.
 */
const ACTION_VERB_PATTERN = /\b(buy|call|pay|book|send|get|pick|order|check|remind|schedule|follow|bring|make|take|go|see|meet|fix|clean|drop|collect|return|submit|confirm|email|message|text|ask|tell|update|review|sign|fill|print|upload|download|install|set|cancel|move|reschedule|rename|create|add|remove|delete|plan|prepare|organise|organize|finish|complete|start|register|apply|request|notify|inform|arrange|visit|attend|buy|reserve|hire|contact|reach|ping|write|read|watch|listen|record|test|deploy|push|pull|merge|build|run|check|look|search|find|research|compare|decide|choose)\b/i;

/**
 * Strip leading intent-signalling prefixes from a title string.
 * Only the first matching prefix is stripped (prevents over-stripping).
 */
export function stripIntentPrefixes(title: string): string {
  for (const pattern of INTENT_PREFIX_PATTERNS) {
    if (pattern.test(title)) {
      const stripped = title.replace(pattern, '').trim();
      return stripped || title;
    }
  }
  return title;
}

export interface ProposedTask {
  title: string;
  due_date: string;
  due_time: string;
  category: string;
  inferred_date: boolean;
  inferred_time: boolean;
  rawCandidate: string;
}

/**
 * Turn one segment/candidate string into a ProposedTask using Feature #1 parsers only.
 * due_date/due_time always set; inferred_date/inferred_time true when defaulted.
 */
export function segmentToProposedTask(segment: string): ProposedTask {
  const trimmed = segment.trim();
  const due_date = parseDate(trimmed);
  const rawTime = parseTime(trimmed);
  const smartTime = getSmartDefaultTime(trimmed);
  const inferred_time = !smartTime && rawTime === '20:00';
  // Nudge past times forward so we never schedule a defaulted time in the past
  const due_time = nudgePastTime(due_date, rawTime, !!smartTime || inferred_time);
  const inferred_date = true;
  const afterTemporal = stripTemporalPhrases(trimmed).trim() || trimmed;
  const afterIntentStrip = stripIntentPrefixes(afterTemporal).trim() || afterTemporal;
  const cleanedTitle = afterIntentStrip.replace(/[.!?]+$/, '').trim();
  const title =
    cleanedTitle.length > 0
      ? cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1)
      : trimmed;
  const category = detectCategory(trimmed);

  return {
    title: title.slice(0, 120),
    due_date,
    due_time,
    category,
    inferred_date,
    inferred_time,
    rawCandidate: segment,
  };
}

/**
 * Map segments to ProposedTask[]. Applies optional cap (e.g. 25 for OCR).
 */
/**
 * Whether a segment has a temporal signal (date or time keyword).
 * Segments with a temporal signal are always kept even without an action verb,
 * since "dentist Friday" or "meeting at 3pm" are valid task-like inputs.
 */
function hasTemporalSignal(seg: string): boolean {
  return /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|this\s+week|morning|afternoon|evening|night|weekend|\d{1,2}\s*(?:am|pm)|\d{1,2}:\d{2})\b/i.test(seg);
}

/**
 * Whether a segment looks like conversational filler rather than an actionable task.
 * Filters out segments like "This week is a bit mad", "It's been busy", "Hectic day".
 * A segment is considered filler when:
 *   - It has no recognised action verb, AND
 *   - It has no temporal signal, AND
 *   - It is short (≤ 6 words) — longer segments may be valid even without a clear verb
 */
function isFillerSegment(seg: string): boolean {
  const wordCount = seg.trim().split(/\s+/).length;
  if (wordCount > 6) return false; // Long enough to be real content; keep it
  if (hasTemporalSignal(seg)) return false;
  if (ACTION_VERB_PATTERN.test(seg)) return false;
  return true;
}

export function textToProposedTasksFromSegments(
  segments: string[],
  options?: { maxCandidates?: number }
): ProposedTask[] {
  const max = options?.maxCandidates ?? 999;
  const filtered = segments.filter((seg) => !isFillerSegment(seg));
  const capped = filtered.slice(0, max);
  return capped.map(segmentToProposedTask);
}
