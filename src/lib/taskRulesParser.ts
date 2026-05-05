/**
 * Task rules parser — mobile-parity parsing for Tasks tab (keyboard input).
 * Pure functions, no AI. Date format YYYY-MM-DD, time format HH:MM.
 * Category detection uses shared canonical list from @/lib/categories.
 *
 * Date resolution priority:
 *   1. temporalDictionary (colloquial terms: eow, asap, "next Friday", "in 3 days", etc.)
 *   2. Explicit "today" / "tomorrow"
 *   3. Day-name loop (bare weekday names, e.g. "Friday") — same-day resolves to TODAY
 *   4. "next week" fallback (+7 days)
 *   5. Default: today
 */

export { detectCategory } from '@/lib/categories';
import { resolveTemporal } from '@/lib/temporalDictionary';

/**
 * Normalize due_time to HH:MM (24-hour). Accepts HH:MM or HH:MM:SS; returns HH:MM or null.
 */
export function toHHMM(s: string | null | undefined): string | null {
  if (s == null || !String(s).trim()) return null;
  const parts = String(s).trim().split(':');
  const h = parseInt(parts[0], 10);
  const m = parts[1] != null ? parseInt(parts[1], 10) : 0;
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse relative date from text. Always returns YYYY-MM-DD (default today).
 *
 * Resolution order:
 *   1. temporalDictionary — handles colloquial terms like "eow", "asap", "next Friday",
 *      "in 3 days", "by Monday", etc. before any bare day-name matching.
 *   2. Explicit "today" / "tomorrow".
 *   3. Bare day-name loop — same-day (daysToAdd = 0) resolves to TODAY, not next week.
 *      Only already-past days in the current week wrap to the next occurrence.
 *   4. "next week" (+7 days from today).
 *   5. Default: today.
 */
export function parseDate(text: string, _now?: Date): string {
  const lowerText = text.toLowerCase();
  const today = _now ?? new Date();

  // ── Step 1: temporal dictionary (handles "next Friday", "eow", "asap", etc.) ──
  const dictMatch = resolveTemporal(lowerText, today);
  if (dictMatch?.resolution.date) {
    return dictMatch.resolution.date;
  }

  // ── Step 2: explicit today / tomorrow ─────────────────────────────────────
  if (lowerText.includes('today')) return formatDateToYYYYMMDD(today);
  if (lowerText.includes('tomorrow')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateToYYYYMMDD(tomorrow);
  }

  // ── Step 3: bare day-name loop ────────────────────────────────────────────
  // Fix: daysToAdd < 0 (not <= 0) so same-day (daysToAdd = 0) stays today.
  // "Call dentist on Tuesday" when today IS Tuesday → today, not next Tuesday.
  // "Pay by Monday" when today IS Monday → today, not next Monday.
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dayNames.length; i++) {
    if (lowerText.includes(dayNames[i]!)) {
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd < 0) daysToAdd += 7; // only wrap past days, not same-day
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + daysToAdd);
      return formatDateToYYYYMMDD(targetDate);
    }
  }

  // ── Step 4: "next week" without a specific day (+7 days) ─────────────────
  if (lowerText.includes('next week')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    return formatDateToYYYYMMDD(nextWeek);
  }

  // ── Step 5: default ───────────────────────────────────────────────────────
  return formatDateToYYYYMMDD(today);
}

/**
 * Same as parseDate but also returns the temporal term that matched (for audit logging).
 */
export function parseDateWithMeta(
  text: string,
  _now?: Date
): { date: string; termMatched: string | null } {
  const lowerText = text.toLowerCase();
  const today = _now ?? new Date();

  const dictMatch = resolveTemporal(lowerText, today);
  if (dictMatch?.resolution.date) {
    return { date: dictMatch.resolution.date, termMatched: dictMatch.termMatched };
  }

  return { date: parseDate(text, _now), termMatched: null };
}

/**
 * Smart default time from keywords. Returns HH:MM or null.
 */
export function getSmartDefaultTime(text: string): string | null {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('breakfast')) return '08:00';
  if (lowerText.includes('brunch')) return '11:00';
  if (lowerText.includes('lunch')) return '12:00';
  if (lowerText.includes('snack')) return '15:00';
  if (lowerText.includes('dinner')) return '18:30';
  if (lowerText.includes('supper')) return '19:00';
  if (lowerText.includes('dessert')) return '20:00';
  if (lowerText.includes('morning')) {
    if (lowerText.includes('gym') || lowerText.includes('workout') || lowerText.includes('exercise')) return '07:00';
    return '08:00';
  }
  if (lowerText.includes('noon')) return '12:00';
  if (lowerText.includes('afternoon')) return '14:00';
  if (lowerText.includes('evening')) return '18:00';
  if (lowerText.includes('night') || lowerText.includes('tonight')) return '20:00';
  if (lowerText.includes('midnight')) return '00:00';
  if (lowerText.includes('doctor') || lowerText.includes('dentist') ||
      lowerText.includes('checkup') || lowerText.includes('physical') ||
      lowerText.includes('therapy')) return '10:00';
  return null;
}

/**
 * Parse time from text. Always returns HH:MM (24-hour).
 * Checks temporal dictionary first (for eod, cob, asap, first thing),
 * then explicit time patterns, then getSmartDefaultTime, then 20:00 fallback.
 */
export function parseTime(text: string, _now?: Date): string {
  const lowerText = text.toLowerCase();

  // ── Temporal dictionary time hints (eod, cob, asap, first thing, etc.) ────
  const dictMatch = resolveTemporal(lowerText, _now ?? new Date());
  if (dictMatch?.resolution.time) {
    return dictMatch.resolution.time;
  }

  const timePatterns: { regex: RegExp; hasColon: boolean }[] = [
    { regex: /at\s*(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)/i, hasColon: true },
    { regex: /(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)/i, hasColon: true },
    { regex: /(\d{1,2}):(\d{2})(?!\s*[ap]\.?m)/i, hasColon: true },
    { regex: /at\s*(\d{1,2})\s*([ap]\.?m\.?)/i, hasColon: false },
    { regex: /(\d{1,2})\s*([ap]\.?m\.?)/i, hasColon: false },
  ];

  for (const { regex, hasColon } of timePatterns) {
    const match = lowerText.match(regex);
    if (match) {
      let hours: number;
      let minutes: number;
      const meridiem = match[3] ?? match[2];
      if (hasColon) {
        hours = parseInt(match[1], 10);
        minutes = parseInt(match[2], 10);
      } else {
        hours = parseInt(match[1], 10);
        minutes = 0;
      }
      if (meridiem) {
        const m = meridiem.toLowerCase().replace(/\./g, '');
        if (m === 'pm' && hours < 12) hours += 12;
        if (m === 'am' && hours === 12) hours = 0;
      }
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    }
  }

  const smart = getSmartDefaultTime(text);
  if (smart) return smart;
  return '20:00';
}

/**
 * If a defaulted (inferred) time has already passed for today's date, nudge it
 * forward to the next full hour at least 1 hour from now.
 * Never touches user-specified times.
 */
export function nudgePastTime(due_date: string, due_time: string, wasDefaulted: boolean): string {
  if (!wasDefaulted) return due_time;
  const today = new Date().toISOString().slice(0, 10);
  if (due_date !== today) return due_time;
  const [h, m] = due_time.split(':').map(Number);
  const taskTime = new Date();
  taskTime.setHours(h, m, 0, 0);
  if (taskTime.getTime() > Date.now()) return due_time;
  // Round up to next full hour, at least 1 hour from now
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return `${String(next.getHours()).padStart(2, '0')}:00`;
}

/**
 * Strip date/time and temporal phrases from title for display/storage.
 * Returns trimmed string; does not capitalize.
 *
 * Booking-context rule: "for [specific weekday]" is NOT stripped when
 * the title starts with a booking/arranging verb (book, reserve, schedule,
 * organise, arrange, plan, get, buy, order, pick up). This preserves
 * context like "Book restaurant for Friday" → title stays as-is.
 *
 * LLM-generated titles should bypass this function entirely — the LLM
 * preserves booking context ("for Friday", "for mom") correctly on its own.
 */
const BOOKING_VERB_PATTERN = /^(book|reserve|schedule|organis|organiz|arrange|plan|get|buy|order|pick\s+up)\b/i;
const WEEKDAY_NAMES = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday)';

export function stripTemporalPhrases(text: string): string {
  const isBookingContext = BOOKING_VERB_PATTERN.test(text.trim());

  let result = text
    .replace(/\b(at|@|by)\s*\d{1,2}:?\d{0,2}\s*([ap]\.?m\.?)?/gi, '')
    .replace(/\b[ap]\.?m\.?\b/gi, '')
    .replace(/\bin the\s+(morning|afternoon|evening|night)\b/gi, '')
    .replace(/\b(morning|afternoon|evening|night)\b/gi, '')
    .replace(/\b(on|by|in)\s+(tomorrow|today|tonight|this|next)\b/gi, '')
    .replace(/\bfor\s+(tomorrow|today|tonight|this|next)\b/gi, '');

  if (isBookingContext) {
    // Booking context: strip "on/by/in [day]" but preserve "for [specific weekday]"
    result = result
      .replace(new RegExp(`\\b(on|by|in)\\s+${WEEKDAY_NAMES}\\b`, 'gi'), '')
      .replace(/\bby\s+next\s+(week|month|year)\b/gi, '')
      .replace(/\bnext\s+(week|month|year)\b/gi, '')
      .replace(/\btoday\b/gi, '')
      .replace(/\btomorrow\b/gi, '')
      .replace(/\btonigh?t\b/gi, '')
      .replace(/\bthis\s+(morning|afternoon|evening|night|weekend|week|month|year)\b/gi, '')
      .replace(/\bweekend\b/gi, '')
      .replace(/\bweek\b/gi, '')
      .replace(/\bmonth\b/gi, '');
  } else {
    // Non-booking: strip all temporal references including "for [day]"
    result = result
      .replace(new RegExp(`\\b(for|on|by|in)\\s+${WEEKDAY_NAMES}\\b`, 'gi'), '')
      .replace(/\bby\s+next\s+(week|month|year)\b/gi, '')
      .replace(new RegExp(`\\bnext\\s+(week|month|year|${WEEKDAY_NAMES.slice(1, -1)})\\b`, 'gi'), '')
      .replace(/\btomorrow\b/gi, '')
      .replace(/\btoday\b/gi, '')
      .replace(/\btonigh?t\b/gi, '')
      .replace(/\bthis\s+(morning|afternoon|evening|night|weekend|week|month|year)\b/gi, '')
      .replace(new RegExp(`\\b${WEEKDAY_NAMES}\\b`, 'gi'), '')
      .replace(/\bweekend\b/gi, '')
      .replace(/\bweek\b/gi, '')
      .replace(/\bmonth\b/gi, '');
  }

  return result
    .replace(/\s+/g, ' ')
    .replace(/\b(for|at|on|by|in)\s*$/gi, '')
    .trim();
}
