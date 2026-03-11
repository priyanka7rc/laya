import { getStartOfDayInTz, DEFAULT_TZ } from '@/lib/taskView/time';

const REMINDER_OFFSET_MS = 15 * 60 * 1000;

export function computeDueAtFromLocal(
  tz: string,
  dueDate: string | null,
  dueTime: string | null
): string | null {
  if (!dueDate) return null;
  const dayStart = getStartOfDayInTz(tz, dueDate); // UTC midnight for local day
  if (!dueTime) {
    return dayStart.toISOString();
  }
  const [hStr, mStr] = dueTime.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    return dayStart.toISOString();
  }
  const msOffset = (h * 60 + m) * 60 * 1000;
  return new Date(dayStart.getTime() + msOffset).toISOString();
}

export function computeRemindAtFromDueAt(dueAtISO: string | null): string | null {
  if (!dueAtISO) return null;
  const base = new Date(dueAtISO);
  return new Date(base.getTime() - REMINDER_OFFSET_MS).toISOString();
}

export { DEFAULT_TZ };

