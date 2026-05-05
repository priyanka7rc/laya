/**
 * Temporal dictionary — colloquial date/time term resolution.
 *
 * Provides deterministic, data-driven resolution of spoken English temporal
 * expressions that the regex-based parseDate/parseTime cannot handle.
 *
 * Design:
 *   - Each entry maps one or more string patterns to a resolution function.
 *   - Resolution functions take `now: Date` and return `{ date?, time? }`.
 *   - Checked BEFORE the day-name loop in parseDate() and parseTime().
 *   - Pure functions — no side effects, no DB calls.
 *
 * Learning loop:
 *   When the LLM resolves a date that rules could not, the original term and
 *   the LLM resolution are logged to ai_turn_log (temporal_term_original /
 *   temporal_term_resolved). Quarterly review promotes new terms here.
 */

// ============================================
// TYPES
// ============================================

export interface TemporalResolution {
  /** YYYY-MM-DD, or undefined if the entry only sets time. */
  date?: string;
  /** HH:MM (24-hour), or undefined if the entry only sets date. */
  time?: string;
}

export interface TemporalMatch {
  resolution: TemporalResolution;
  /** The normalised term that matched, for audit logging. */
  termMatched: string;
}

// ============================================
// HELPERS
// ============================================

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** Saturday of the current week (Sunday=0 … Saturday=6). */
function thisSaturday(now: Date): Date {
  const dow = now.getDay(); // 0=Sun … 6=Sat
  const toSat = dow === 6 ? 0 : 6 - dow;
  return addDays(now, toSat);
}

/** Monday of the current week. */
function thisMonday(now: Date): Date {
  const dow = now.getDay();
  const toMon = dow === 0 ? 1 : dow === 1 ? 0 : -(dow - 1);
  return addDays(now, toMon);
}

/** Last day of the current calendar month. */
function endOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

/** First day of the next calendar month. */
function startOfNextMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

/** Next occurrence of a named weekday (0=Sun … 6=Sat). Always at least 1 day away. */
function nextWeekday(now: Date, targetDow: number): Date {
  const dow = now.getDay();
  let diff = targetDow - dow;
  if (diff <= 0) diff += 7;
  return addDays(now, diff);
}

/**
 * Weekday in NEXT calendar week (Monday-anchored).
 * "Next Friday" when today is Monday → Friday of next week, not this Friday.
 */
function weekdayOfNextWeek(now: Date, targetDow: number): Date {
  // Go to this coming Monday, then forward one week, then to targetDow.
  const monday = thisMonday(now);
  const nextMonday = addDays(monday, now.getDay() === 1 ? 7 : 7);
  const diff = targetDow === 0 ? 6 : targetDow - 1; // Mon=0 offset
  return addDays(nextMonday, diff);
}

/** Weekday in THIS calendar week. */
function weekdayOfThisWeek(now: Date, targetDow: number): Date {
  const monday = thisMonday(now);
  const diff = targetDow === 0 ? 6 : targetDow - 1;
  return addDays(monday, diff);
}

/** Next full hour at least 1 hour from now. Used for ASAP. */
function nextFullHour(now: Date): string {
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  return `${String(next.getHours()).padStart(2, '0')}:00`;
}

// ============================================
// ENTRY TYPE
// ============================================

interface DictionaryEntry {
  /**
   * Regex that matches the term in lowercased input text.
   * Include capture groups for variable parts (e.g. "in (\d+) days").
   */
  pattern: RegExp;
  resolve: (now: Date, match: RegExpMatchArray) => TemporalResolution;
  /** Human-readable label for the term — used as `termMatched` in audit. */
  label: string;
}

// ============================================
// DICTIONARY
// ============================================

const ENTRIES: DictionaryEntry[] = [
  // ── End / start of week ────────────────────────────────────────────────────
  // NOTE: by_end_of_week and by_end_of_month must be listed BEFORE their base
  // entries so that "by end of week" matches the more-specific entry first.
  {
    label: 'by_end_of_week',
    pattern: /\bby\s+(end\s+of\s+(the\s+)?week|eow)\b/i,
    resolve: (now) => ({ date: fmt(thisSaturday(now)), time: '23:59' }),
  },
  {
    label: 'by_end_of_month',
    pattern: /\bby\s+(end\s+of\s+(the\s+)?month|eom)\b/i,
    resolve: (now) => ({ date: fmt(endOfMonth(now)), time: '23:59' }),
  },
  {
    label: 'end_of_week',
    pattern: /\b(end\s+of\s+(the\s+)?week|eow|this\s+week)\b/i,
    resolve: (now) => ({ date: fmt(thisSaturday(now)) }),
  },
  {
    label: 'over_the_weekend',
    pattern: /\bover\s+the\s+weekend\b/i,
    resolve: (now) => ({ date: fmt(thisSaturday(now)) }),
  },
  {
    label: 'start_of_next_week',
    pattern: /\b(start\s+of\s+next\s+week|next\s+week\s+start|beginning\s+of\s+next\s+week)\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 1)) }), // Monday
  },

  // ── End / start of month ───────────────────────────────────────────────────
  {
    label: 'end_of_month',
    pattern: /\b(end\s+of\s+(the\s+)?month|eom)\b/i,
    resolve: (now) => ({ date: fmt(endOfMonth(now)) }),
  },
  {
    label: 'start_of_month',
    pattern: /\b(start\s+of\s+(the\s+)?month|som|next\s+month\s*start|beginning\s+of\s+next\s+month)\b/i,
    resolve: (now) => ({ date: fmt(startOfNextMonth(now)) }),
  },

  // ── End / close of day ─────────────────────────────────────────────────────
  {
    label: 'end_of_day',
    pattern: /\b(end\s+of\s+(the\s+)?day|eod|by\s+end\s+of\s+(the\s+)?day|tonight\s+by\s+end)\b/i,
    resolve: (now) => ({ date: fmt(now), time: '23:59' }),
  },
  {
    label: 'close_of_business',
    pattern: /\b(close\s+of\s+business|cob|close\s+of\s+day|end\s+of\s+business)\b/i,
    resolve: (now) => ({ date: fmt(now), time: '18:00' }),
  },

  // ── ASAP ───────────────────────────────────────────────────────────────────
  {
    label: 'asap',
    pattern: /\b(asap|as\s+soon\s+as\s+possible|urgently|urgent)\b/i,
    resolve: (now) => ({ date: fmt(now), time: nextFullHour(now) }),
  },

  // ── First / last thing ─────────────────────────────────────────────────────
  {
    label: 'first_thing',
    pattern: /\b(first\s+thing(\s+in\s+the\s+morning)?)\b/i,
    resolve: (now) => ({ time: '09:00' }),
  },
  {
    label: 'last_thing',
    pattern: /\blast\s+thing(\s+at\s+night)?\b/i,
    resolve: () => ({ time: '21:00' }),
  },

  // ── "in X hours" ──────────────────────────────────────────────────────────
  {
    label: 'in_x_hours',
    pattern: /\bin\s+(\d+(?:\.\d+)?)\s+hours?\b/i,
    resolve: (now, m) => {
      const hrs = parseFloat(m[1]!);
      const future = new Date(now.getTime() + hrs * 60 * 60 * 1000);
      return {
        date: fmt(future),
        time: `${String(future.getHours()).padStart(2, '0')}:${String(future.getMinutes()).padStart(2, '0')}`,
      };
    },
  },

  // ── "in X days" ───────────────────────────────────────────────────────────
  {
    label: 'in_x_days',
    pattern: /\b(in|after)\s+(\d+)\s+days?\b/i,
    resolve: (now, m) => ({ date: fmt(addDays(now, parseInt(m[2]!, 10))) }),
  },

  // ── "in X weeks" ──────────────────────────────────────────────────────────
  {
    label: 'in_x_weeks',
    pattern: /\b(in|after)\s+(\d+)\s+weeks?\b/i,
    resolve: (now, m) => ({ date: fmt(addDays(now, parseInt(m[2]!, 10) * 7)) }),
  },

  // ── "in X months" ─────────────────────────────────────────────────────────
  {
    label: 'in_x_months',
    pattern: /\b(in|after)\s+(\d+)\s+months?\b/i,
    resolve: (now, m) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() + parseInt(m[2]!, 10));
      return { date: fmt(d) };
    },
  },

  // ── Couple / few days ─────────────────────────────────────────────────────
  {
    label: 'couple_of_days',
    pattern: /\b(in\s+)?a?\s*couple\s+of\s+days?\b/i,
    resolve: (now) => ({ date: fmt(addDays(now, 2)) }),
  },
  {
    label: 'few_days',
    pattern: /\b(in\s+)?a\s+few\s+days?\b/i,
    resolve: (now) => ({ date: fmt(addDays(now, 3)) }),
  },

  // ── A week / month from now ────────────────────────────────────────────────
  {
    label: 'a_week_from_now',
    pattern: /\ba\s+week\s+from\s+(now|today)\b/i,
    resolve: (now) => ({ date: fmt(addDays(now, 7)) }),
  },
  {
    label: 'a_month_from_now',
    pattern: /\ba\s+month\s+from\s+(now|today)\b/i,
    resolve: (now) => {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 1);
      return { date: fmt(d) };
    },
  },

  // ── "next [weekday]" — always means the named day of NEXT calendar week ───
  {
    label: 'next_sunday',
    pattern: /\bnext\s+sunday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 0)) }),
  },
  {
    label: 'next_monday',
    pattern: /\bnext\s+monday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 1)) }),
  },
  {
    label: 'next_tuesday',
    pattern: /\bnext\s+tuesday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 2)) }),
  },
  {
    label: 'next_wednesday',
    pattern: /\bnext\s+wednesday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 3)) }),
  },
  {
    label: 'next_thursday',
    pattern: /\bnext\s+thursday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 4)) }),
  },
  {
    label: 'next_friday',
    pattern: /\bnext\s+friday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 5)) }),
  },
  {
    label: 'next_saturday',
    pattern: /\bnext\s+saturday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfNextWeek(now, 6)) }),
  },

  // ── "this [weekday]" — the named day in the current calendar week ─────────
  {
    label: 'this_sunday',
    pattern: /\bthis\s+sunday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfThisWeek(now, 0)) }),
  },
  {
    label: 'this_monday',
    pattern: /\bthis\s+monday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfThisWeek(now, 1)) }),
  },
  {
    label: 'this_tuesday',
    pattern: /\bthis\s+tuesday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfThisWeek(now, 2)) }),
  },
  {
    label: 'this_wednesday',
    pattern: /\bthis\s+wednesday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfThisWeek(now, 3)) }),
  },
  {
    label: 'this_thursday',
    pattern: /\bthis\s+thursday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfThisWeek(now, 4)) }),
  },
  {
    label: 'this_friday',
    pattern: /\bthis\s+friday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfThisWeek(now, 5)) }),
  },
  {
    label: 'this_saturday',
    pattern: /\bthis\s+saturday\b/i,
    resolve: (now) => ({ date: fmt(weekdayOfThisWeek(now, 6)) }),
  },

  // ── "by [weekday]" — deadline end of that day ─────────────────────────────
  {
    label: 'by_sunday',
    pattern: /\bby\s+sunday\b/i,
    resolve: (now) => ({ date: fmt(nextWeekday(now, 0)), time: '23:59' }),
  },
  {
    label: 'by_monday',
    pattern: /\bby\s+monday\b/i,
    resolve: (now) => {
      // "by Monday" when today IS Monday → means this Monday (today)
      const d = now.getDay() === 1 ? now : nextWeekday(now, 1);
      return { date: fmt(d), time: '23:59' };
    },
  },
  {
    label: 'by_tuesday',
    pattern: /\bby\s+tuesday\b/i,
    resolve: (now) => {
      const d = now.getDay() === 2 ? now : nextWeekday(now, 2);
      return { date: fmt(d), time: '23:59' };
    },
  },
  {
    label: 'by_wednesday',
    pattern: /\bby\s+wednesday\b/i,
    resolve: (now) => {
      const d = now.getDay() === 3 ? now : nextWeekday(now, 3);
      return { date: fmt(d), time: '23:59' };
    },
  },
  {
    label: 'by_thursday',
    pattern: /\bby\s+thursday\b/i,
    resolve: (now) => {
      const d = now.getDay() === 4 ? now : nextWeekday(now, 4);
      return { date: fmt(d), time: '23:59' };
    },
  },
  {
    label: 'by_friday',
    pattern: /\bby\s+friday\b/i,
    resolve: (now) => {
      const d = now.getDay() === 5 ? now : nextWeekday(now, 5);
      return { date: fmt(d), time: '23:59' };
    },
  },
  {
    label: 'by_saturday',
    pattern: /\bby\s+saturday\b/i,
    resolve: (now) => {
      const d = now.getDay() === 6 ? now : nextWeekday(now, 6);
      return { date: fmt(d), time: '23:59' };
    },
  },
];

// ============================================
// EXPORTED FUNCTION
// ============================================

/**
 * Try to resolve a temporal term from the dictionary.
 *
 * Returns the first matching entry's resolution, or null if no match.
 * Call this BEFORE the day-name loop in parseDate() so that "next Friday"
 * resolves correctly rather than being caught by the bare "friday" pattern.
 *
 * @param text - Lowercased or original input text
 * @param now  - Reference time (defaults to current time; override in tests)
 */
export function resolveTemporal(
  text: string,
  now: Date = new Date()
): TemporalMatch | null {
  const lower = text.toLowerCase();
  for (const entry of ENTRIES) {
    const m = lower.match(entry.pattern);
    if (m) {
      return {
        resolution: entry.resolve(now, m),
        termMatched: entry.label,
      };
    }
  }
  return null;
}

/**
 * Exported for tests: returns all dictionary entry labels.
 */
export function getAllTemporalLabels(): string[] {
  return ENTRIES.map((e) => e.label);
}
