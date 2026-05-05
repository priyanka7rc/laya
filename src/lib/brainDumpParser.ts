/**
 * Rules-first brain dump parser. Fast, deterministic, no AI.
 * - splitBrainDump: split on delimiters; sentence-boundary split; cautious "and" split
 * - parseOneSegmentWithRules: extract date/time, apply required defaults, return one task with flags
 * - detectListIntent: detect "add X to [my] list of Y" patterns, returns { item, listName } or null
 * - detectColonListIntent: detect "X: items" colon-list patterns, returns { listName, items } or null
 * Category inference uses shared guessCategory from @/lib/categories.
 */

import { guessCategory } from '@/lib/categories';
import { nudgePastTime } from '@/lib/taskRulesParser';

const DEFAULT_TIME = '20:00';

export interface ParsedTaskWithFlags {
  title: string;
  notes: string | null;
  due_date: string;
  due_time: string;
  category: string | null;
  dueDateWasDefaulted: boolean;
  dueTimeWasDefaulted: boolean;
}

/**
 * Split text into coarse sentence-level segments (no comma/semicolon splitting).
 *
 * Used by parseCompoundIntent as the outer loop so that create-list patterns and
 * colon-list patterns are tried on the full sentence before the inner comma-split pass.
 *
 * Splits on:
 *   - Sentence boundaries (period/!/? followed by whitespace + capital letter)
 *   - Newlines
 *   - Bullet / numbered list markers
 */
export function splitIntoSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.length) return [];

  const withSentenceBoundaries = trimmed.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n');

  return withSentenceBoundaries
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^[\s]*[•\-*]\s+/gm, '\n')
    .replace(/^[\s]*\d+[.)]\s+/gm, '\n')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Split brain dump text into segments.
 * - Phase 0: split on sentence boundaries (`. ` or `! ` or `? ` before a capital letter)
 *   so prose like "Pay rent. Buy milk. Call dentist." → 3 segments.
 *   Trade-off: rare abbreviations like "Dr. Singh" are split; acceptable for task messages.
 * - Phase 1: split on commas, semicolons, newlines, bullets (•, -, *, numbered)
 * - Phase 2: cautiously split on " and " only when both sides are substantial (>= 10 chars)
 *   to avoid breaking "call mom and dad"
 */
export function splitBrainDump(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.length) return [];

  // Phase 0: replace sentence boundaries (punctuation + space + capital) with newline.
  // Only fires when a period/exclamation/question is followed by whitespace and an uppercase letter.
  const withSentenceBoundaries = trimmed.replace(/([.!?])\s+(?=[A-Z])/g, '$1\n');

  // Phase 1: normalize bullets and newlines, then split on comma/semicolon/newline
  const normalized = withSentenceBoundaries
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^[\s]*[•\-*]\s+/gm, '\n')
    .replace(/^[\s]*\d+[.)]\s+/gm, '\n');

  const segments = normalized
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Phase 2: cautiously split on " and " only when both parts are substantial.
  // Exception: protect "add/put [items] to/on/in [target] and [other clause]" — split only
  // at the "and" AFTER the preposition phrase, leaving the list-item conjunction intact.
  const result: string[] = [];
  for (const seg of segments) {
    // Protected split for "add/put ... to/on/in ... and ..." patterns
    const listConjSplit = splitAddToListConjunction(seg);
    if (listConjSplit) {
      result.push(...listConjSplit);
      continue;
    }

    const parts = seg.split(/\s+and\s+/i);
    if (parts.length === 1) {
      result.push(seg);
      continue;
    }
    const trimmedParts = parts.map((p) => p.trim()).filter((p) => p.length > 0);
    const allSubstantial = trimmedParts.every((p) => p.length >= 10);
    if (allSubstantial && trimmedParts.length > 1) {
      result.push(...trimmedParts);
    } else {
      result.push(seg);
    }
  }

  return result;
}

/**
 * For "add/put [items with 'and'] to/on/in [target] and [other clause]" patterns,
 * split at the LAST " and " — which separates the list action from the following clause —
 * leaving the item-conjunction ("glue sticks and chart paper") intact.
 *
 * Returns null when the pattern does not apply (falls back to general Phase 2 split).
 *
 * Example:
 *   "Add glue sticks and chart paper to school supplies and move PTM to next Monday"
 *   → ["Add glue sticks and chart paper to school supplies", "move PTM to next Monday"]
 */
function splitAddToListConjunction(seg: string): string[] | null {
  // Only applies to segments starting with "add" or "put"
  if (!/^(?:add|put)\s+/i.test(seg)) return null;

  const lastAndIdx = seg.lastIndexOf(' and ');
  if (lastAndIdx === -1) return null;

  const beforeLastAnd = seg.slice(0, lastAndIdx);
  const afterLastAnd = seg.slice(lastAndIdx + 5); // ' and ' is 5 chars

  // The part BEFORE the last "and" must contain a preposition — confirms "add X to Y and [other]"
  if (!/\s(?:to|on|in)\s/i.test(beforeLastAnd)) return null;

  // Both parts must be non-trivial
  if (beforeLastAnd.trim().length < 5 || afterLastAnd.trim().length < 5) return null;

  return [beforeLastAnd.trim(), afterLastAnd.trim()];
}

/**
/**
 * Verbs that indicate the task is to *arrange* something for a future event.
 * "Book restaurant for Friday" → booking context → due_date = today, keep "for Friday"
 * "Submit report for Friday" → deadline context → due_date = Friday, strip "for Friday"
 */
const BOOKING_VERB_RE = /^(book|reserve|schedule|organis|organiz|arrange|plan|get|buy|order|pick\s+up|purchase|rent)\b/i;

/** Preposition + weekday combination indicating a booking event date (not a task deadline). */
const FOR_WEEKDAY_RE = /\bfor\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/**
 * Parse one segment into a single task. due_date and due_time are always set (required defaults).
 * Returns flags indicating when defaults were applied.
 *
 * Booking context rule: when the segment starts with a booking verb AND contains
 * "for [weekday]", the task is to *arrange* something for that future date.
 * In this case due_date stays today, and "for [day]" is preserved in the title.
 */
export function parseOneSegmentWithRules(segment: string): ParsedTaskWithFlags {
  const timeInfo = extractTimeFromText(segment);
  const trimmed = segment.trim();

  // Detect booking context BEFORE date extraction so we can override due_date
  const isBooking = BOOKING_VERB_RE.test(trimmed) && FOR_WEEKDAY_RE.test(trimmed);

  // For booking tasks, force due_date = today regardless of the "for [day]" phrase
  const dateInfo = isBooking ? null : extractDateFromText(segment);

  const due_date = dateInfo ?? getTodayDate();
  const rawTime = timeInfo ?? DEFAULT_TIME;
  const dueDateWasDefaulted = dateInfo == null;
  const dueTimeWasDefaulted = timeInfo == null;
  // Nudge past times forward so we never schedule a defaulted time in the past on today
  const due_time = nudgePastTime(due_date, rawTime, dueTimeWasDefaulted);

  let cleanTitle: string;
  if (isBooking) {
    // Booking: only strip time expressions; preserve "for [day]" in title
    cleanTitle = trimmed
      .replace(/\b(at|@)\s*\d{1,2}:?\d{0,2}\s*(am|pm)?\b/gi, '')
      .replace(/\btoday\b/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/[.!?]+$/, '')
      .trim();
  } else {
    cleanTitle = trimmed
      .replace(/\b(at|@)\s*\d{1,2}:?\d{0,2}\s*(am|pm)?\b/gi, '')
      .replace(/\btomorrow\b/gi, '')
      .replace(/\btoday\b/gi, '')
      .replace(/\bmonday|tuesday|wednesday|thursday|friday|saturday|sunday\b/gi, '')
      .replace(/\bnext week\b/gi, '')
      .replace(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/[.!?]+$/, '')
      .trim();
  }

  if (cleanTitle.length > 0) {
    cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
  }
  const title = cleanTitle.slice(0, 200) || 'Task';

  return {
    title,
    notes: null,
    due_date,
    due_time,
    category: guessCategory(segment),
    dueDateWasDefaulted,
    dueTimeWasDefaulted,
  };
}

/**
 * Parse full brain dump with rules only. Returns tasks array (always).
 */
export function parseBrainDumpWithRules(text: string): ParsedTaskWithFlags[] {
  const segments = splitBrainDump(text);
  if (segments.length === 0) {
    const defaultTask = parseOneSegmentWithRules(text.trim().slice(0, 500) || 'Task');
    return [defaultTask];
  }
  return segments.map((seg) => parseOneSegmentWithRules(seg));
}

export interface ListIntent {
  item: string;
  listName: string;
}

/**
 * Detect "add/put X to/on/in [my/the] [list of] Y [list]" patterns.
 * Returns { item, listName } with title-cased values, or null if not a list-intent segment.
 *
 * Patterns handled:
 *   "add mentalist to the list of TV shows"
 *   "add milk to my shopping list"
 *   "add eggs to shopping list"
 *   "put milk on my grocery list"
 *   "put butter in the grocery list"
 */
export function detectListIntent(segment: string): ListIntent | null {
  const s = segment.trim();

  // Pattern 1: add/put X to/on/in [the/my] list of Y
  const p1 = /^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:the\s+|my\s+)?list\s+of\s+(.+?)$/i;
  const m1 = s.match(p1);
  if (m1) {
    return { item: toTitleCase(m1[1].trim()), listName: toTitleCase(m1[2].trim()) };
  }

  // Pattern 2: add/put X to/on/in [the/my] Y list
  const p2 = /^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:the\s+|my\s+)?(.+?)\s+list$/i;
  const m2 = s.match(p2);
  if (m2) {
    return { item: toTitleCase(m2[1].trim()), listName: toTitleCase(m2[2].trim()) };
  }

  // Pattern 3: X on/in [my/the] Y list
  const p3 = /^(.+?)\s+(?:on|in)\s+(?:my\s+|the\s+)?(.+?)\s+list$/i;
  const m3 = s.match(p3);
  if (m3) {
    return { item: toTitleCase(m3[1].trim()), listName: toTitleCase(m3[2].trim()) };
  }

  // Pattern 4: add/put X to/on/in [the/my] Y  (bare list name, no "list" suffix)
  // "Add sunscreen to shopping", "Put milk on groceries"
  // Guard: target must be ≤ 3 words and not contain task/time context words
  const p4 = /^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:the\s+|my\s+)?(.+?)$/i;
  const m4 = s.match(p4);
  if (m4) {
    const item = m4[1].trim();
    const target = m4[2].trim();
    const wordCount = target.split(/\s+/).length;
    const isTaskContext = /\b(schedule|calendar|plan|agenda|reminder|task|note|call|meeting|today|tomorrow|tonight|morning|afternoon|evening|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(target);
    if (wordCount <= 3 && !isTaskContext) {
      return { item: toTitleCase(item), listName: toTitleCase(target) };
    }
  }

  return null;
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

// Words that, when found in the LHS of "X: items", indicate the text is a task context
// preamble rather than a list name (e.g. "I need to do these today: ...").
const TASK_PREAMBLE_WORDS = new Set([
  'need', 'want', 'have', 'these', 'following', 'also', 'this', 'some', 'few',
]);

/**
 * Split the RHS of a colon-list into individual items.
 * Handles commas and " and " connectors.
 */
function splitColonItems(rhs: string): string[] {
  const normalized = rhs.replace(/\s+and\s+/gi, ',');
  return normalized
    .split(/,+/)
    .map((s) => s.trim().replace(/[.,;:!?]+$/, ''))
    .filter((s) => s.length > 0)
    .slice(0, 10);
}

export interface ColonListIntent {
  listName: string;
  items: string[];
}

/**
 * Detect colon-list patterns in a single segment.
 *
 * Accepts:
 *   "Groceries: milk, eggs, bread"          → { listName: "Groceries", items: [...] }
 *   "list for house supplies: garbage bags"  → { listName: "house supplies", items: [...] }
 *   "packing list for Goa: sunscreen, hats"  → { listName: "Goa", items: [...] }
 *   "Need a list for X: items"              → { listName: "X", items: [...] }
 *   "Make a packing list for Goa: items"    → { listName: "Packing List For Goa", items: [...] }
 *
 * Rejects (LHS too long / contains task-preamble words):
 *   "I need to do these today: call the bank, buy fruits"  → null
 *   "Here is what I have to get: milk"                     → null
 *
 * Returns null when no colon is present or LHS does not look like a list name.
 */
export function detectColonListIntent(segment: string): ColonListIntent | null {
  const colonIdx = segment.indexOf(':');
  if (colonIdx === -1) return null;

  const lhs = segment.slice(0, colonIdx).trim();
  const rhs = segment.slice(colonIdx + 1).trim();

  if (!lhs || !rhs) return null;

  // Always accept if LHS explicitly contains "list"
  const lhsLower = lhs.toLowerCase();
  if (lhsLower.includes('list')) {
    // Extract the meaningful name part.
    // "list for X" or "packing list for X" → X
    const forMatch = lhsLower.match(/list\s+(?:for|called|named)\s+(.+)$/i);
    if (forMatch) {
      const rawName = lhs.slice(lhs.toLowerCase().lastIndexOf(forMatch[1])).trim();
      const items = splitColonItems(rhs);
      return items.length > 0 ? { listName: toTitleCase(rawName), items } : null;
    }
    // Just "list: items" → use the whole LHS as name (strip leading "a/the")
    const cleanedName = lhs.replace(/^(?:a|the|an|my)\s+/i, '').trim() || lhs;
    const items = splitColonItems(rhs);
    return items.length > 0 ? { listName: toTitleCase(cleanedName), items } : null;
  }

  // Accept short noun phrases (≤ 3 words) that don't contain task-preamble words
  const words = lhs.split(/\s+/);
  if (words.length > 3) return null;
  const hasPreambleWord = words.some((w) => TASK_PREAMBLE_WORDS.has(w.toLowerCase()));
  if (hasPreambleWord) return null;

  const items = splitColonItems(rhs);
  return items.length > 0 ? { listName: toTitleCase(lhs), items } : null;
}

/**
 * Detect preamble-colon task dumps:
 *   "Need to do these today: call the bank, buy fruits, clean the study"
 *   "Here are my tasks: pay rent, book dentist, call mom"
 *
 * Returns the RHS items as individual task segment strings, or null.
 * Only fires when the LHS contains TASK_PREAMBLE_WORDS so it does not conflict
 * with detectColonListIntent (which already handles legit list patterns).
 */
export function detectPreambleColonTaskDump(segment: string): string[] | null {
  const colonIdx = segment.indexOf(':');
  if (colonIdx === -1) return null;

  const lhs = segment.slice(0, colonIdx).trim();
  const rhs = segment.slice(colonIdx + 1).trim();
  if (!lhs || !rhs) return null;

  const lhsWords = lhs.split(/\s+/);
  const hasPreambleWord = lhsWords.some((w) => TASK_PREAMBLE_WORDS.has(w.toLowerCase()));
  if (!hasPreambleWord) return null;

  // Split RHS on comma (keep "and" intact inside segments — task names may use it)
  const items = rhs
    .split(/,+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : null;
}

// --- Date/time/category helpers (no AI) ---

function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

function getNextDayOfWeek(targetDay: number): string {
  const today = new Date();
  const currentDay = today.getDay();
  let daysUntil = targetDay - currentDay;
  if (daysUntil <= 0) daysUntil += 7;
  const nextDay = new Date(today);
  nextDay.setDate(today.getDate() + daysUntil);
  return nextDay.toISOString().split('T')[0];
}

function extractDateFromText(text: string): string | null {
  const lowerText = text.toLowerCase();
  const today = new Date();

  if (lowerText.includes('today')) return getTodayDate();
  if (lowerText.includes('tomorrow')) return getTomorrowDate();

  const dayOfWeekMatch = lowerText.match(/\b(?:by|on)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dayOfWeekMatch) {
    const dayMap: { [key: string]: number } = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    return getNextDayOfWeek(dayMap[dayOfWeekMatch[1].toLowerCase()]);
  }
  if (lowerText.includes('next week')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return nextWeek.toISOString().split('T')[0];
  }
  if (lowerText.includes('weekend')) return getNextDayOfWeek(6);
  return null;
}

function extractTimeFromText(text: string): string | null {
  const lowerText = text.toLowerCase();

  const pattern1 = /(?:at|@)\s*(\d{1,2}):?(\d{2})?\s*(am|pm)/i;
  const match1 = lowerText.match(pattern1);
  if (match1) {
    let hours = parseInt(match1[1], 10);
    const minutes = match1[2] || '00';
    const meridiem = match1[3].toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  }

  const pattern2 = /\b(\d{1,2})\s*(am|pm)\b/i;
  const match2 = lowerText.match(pattern2);
  if (match2) {
    let hours = parseInt(match2[1], 10);
    const meridiem = match2[2].toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, '0')}:00`;
  }

  const pattern3 = /\b(\d{1,2}):(\d{2})\b/i;
  const match3 = lowerText.match(pattern3);
  if (match3) {
    let hours = parseInt(match3[1], 10);
    const minutes = match3[2];
    if (hours < 8 && hours > 0) hours += 12;
    if (hours >= 0 && hours <= 23) {
      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }
  }
  return null;
}
