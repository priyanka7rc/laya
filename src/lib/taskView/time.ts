/**
 * Timezone-aware day and window helpers for Task View.
 * All "today" / "tomorrow" / "upcoming" semantics should use these instead of UTC toISOString().split('T')[0].
 */

const DEFAULT_TZ = 'Asia/Kolkata';

/**
 * Return the local date string (YYYY-MM-DD) for a given instant in the given timezone.
 */
export function getLocalDateString(tz: string, date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: tz });
}

/**
 * Return the UTC Date for midnight (00:00:00) on the given local date in the given timezone.
 * dateStr must be YYYY-MM-DD.
 */
export function getStartOfDayInTz(tz: string, dateStr: string): Date {
  const d = new Date(dateStr + 'T12:00:00.000Z');
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const second = parseInt(parts.find((p) => p.type === 'second')?.value ?? '0', 10);
  const msIntoDay = (hour * 3600 + minute * 60 + second) * 1000;
  return new Date(d.getTime() - msIntoDay);
}

/**
 * Return the end of the given local date in tz (exclusive), as a UTC Date.
 * So [start, end) covers the full calendar day in tz.
 */
export function getEndOfDayInTz(tz: string, dateStr: string): Date {
  const start = getStartOfDayInTz(tz, dateStr);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Get the local date string for (baseDate + dayOffset days) in the given timezone.
 * dayOffset 0 = same day as baseDate in tz, 1 = next calendar day in tz, etc.
 */
function getLocalDateStringWithOffset(tz: string, baseDate: Date, dayOffset: number): string {
  if (dayOffset === 0) {
    return getLocalDateString(tz, baseDate);
  }
  const todayStr = getLocalDateString(tz, baseDate);
  const [y, m, d] = todayStr.split('-').map(Number);
  const localMidnight = getStartOfDayInTz(tz, todayStr);
  const nextDay = new Date(localMidnight.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  return getLocalDateString(tz, nextDay);
}

/**
 * Return the UTC time window [start, end) for the local day (baseDate + dayOffset) in the given timezone.
 * Used for "today" and "digest" views.
 */
export function getLocalDayWindow(
  tz: string,
  baseDate?: Date,
  dayOffset?: number
): { start: Date; end: Date; dayISO: string } {
  const effectiveTz = tz || DEFAULT_TZ;
  const d = baseDate ?? new Date();
  const offset = dayOffset ?? 0;
  const dayISO = getLocalDateStringWithOffset(effectiveTz, d, offset);
  const start = getStartOfDayInTz(effectiveTz, dayISO);
  const end = getEndOfDayInTz(effectiveTz, dayISO);
  return { start, end, dayISO };
}

/**
 * Return the UTC time window [start, end) for "upcoming" (e.g. next 48 hours from now, excluding today in tz).
 * Or for "reminder window": from epoch to now (tasks due in the past).
 */
export function getUpcomingWindow(
  tz: string,
  now?: Date,
  hours?: number
): { start: Date; end: Date } {
  const n = now ?? new Date();
  const h = hours ?? 48;
  return {
    start: n,
    end: new Date(n.getTime() + h * 60 * 60 * 1000),
  };
}

export function getUpcomingDaysWindow(
  tz: string,
  now: Date,
  days: number
): { start: Date; end: Date } {
  // Tomorrow start
  const tomorrow = getLocalDayWindow(tz, now, 1).start;
  // Start of day after `days` days from today (exclusive end)
  const endDayOffset = 1 + days;
  const end = getLocalDayWindow(tz, now, endDayOffset).start;
  return { start: tomorrow, end };
}

export { DEFAULT_TZ };
