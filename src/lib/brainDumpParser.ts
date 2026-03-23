/**
 * Rules-first brain dump parser. Fast, deterministic, no AI.
 * - splitBrainDump: split on delimiters; cautious "and" split
 * - parseOneSegmentWithRules: extract date/time, apply required defaults, return one task with flags
 * - detectListIntent: detect "add X to [my] list of Y" patterns, returns { item, listName } or null
 * Category inference uses shared guessCategory from @/lib/categories.
 */

import { guessCategory } from '@/lib/categories';

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
 * Split brain dump text into segments.
 * - Split on: commas, semicolons, newlines, bullets (•, -, *, numbered)
 * - Cautiously split on " and " only when both sides are substantial (>= 10 chars) to avoid breaking "call mom and dad"
 */
export function splitBrainDump(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.length) return [];

  // Normalize bullets and newlines to a single split token, then split
  const normalized = trimmed
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/^[\s]*[•\-*]\s+/gm, '\n')
    .replace(/^[\s]*\d+[.)]\s+/gm, '\n');

  const segments = normalized
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Cautiously split on " and " only when both parts are substantial
  const result: string[] = [];
  for (const seg of segments) {
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
 * Parse one segment into a single task. due_date and due_time are always set (required defaults).
 * Returns flags indicating when defaults were applied.
 */
export function parseOneSegmentWithRules(segment: string): ParsedTaskWithFlags {
  const timeInfo = extractTimeFromText(segment);
  const dateInfo = extractDateFromText(segment);

  const due_date = dateInfo ?? getTodayDate();
  const due_time = timeInfo ?? DEFAULT_TIME;
  const dueDateWasDefaulted = dateInfo == null;
  const dueTimeWasDefaulted = timeInfo == null;

  let cleanTitle = segment
    .replace(/\b(at|@)\s*\d{1,2}:?\d{0,2}\s*(am|pm)?\b/gi, '')
    .replace(/\btomorrow\b/gi, '')
    .replace(/\btoday\b/gi, '')
    .replace(/\bmonday|tuesday|wednesday|thursday|friday|saturday|sunday\b/gi, '')
    .replace(/\bnext week\b/gi, '')
    .replace(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

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

  return null;
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
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
