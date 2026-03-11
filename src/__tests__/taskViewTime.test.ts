/**
 * Tests for timezone-aware task view time helpers.
 */

import {
  getLocalDateString,
  getStartOfDayInTz,
  getEndOfDayInTz,
  getLocalDayWindow,
  getUpcomingWindow,
  DEFAULT_TZ,
} from '@/lib/taskView/time';

describe('taskView time', () => {
  test('getStartOfDayInTz and getEndOfDayInTz return real UTC instants for IST', () => {
    const start = getStartOfDayInTz('Asia/Kolkata', '2026-02-28');
    const end = getEndOfDayInTz('Asia/Kolkata', '2026-02-28');

    expect(start.toISOString()).toBe('2026-02-27T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-02-28T18:30:00.000Z');
  });

  test('getLocalDateString returns YYYY-MM-DD in timezone', () => {
    const d = new Date('2025-02-10T18:30:00.000Z');
    const ist = getLocalDateString('Asia/Kolkata', d);
    expect(ist).toBe('2025-02-11');
    const utc = getLocalDateString('UTC', d);
    expect(utc).toBe('2025-02-10');
  });

  test('getLocalDayWindow returns start/end and dayISO', () => {
    const d = new Date('2025-02-10T12:00:00.000Z');
    const { start, end, dayISO } = getLocalDayWindow('UTC', d, 0);
    expect(dayISO).toBe('2025-02-10');
    expect(start.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test('getUpcomingWindow returns now and now+hours', () => {
    const now = new Date('2025-02-10T12:00:00.000Z');
    const { start, end } = getUpcomingWindow('Asia/Kolkata', now, 48);
    expect(start.getTime()).toBe(now.getTime());
    expect(end.getTime() - start.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  test('DEFAULT_TZ is Asia/Kolkata', () => {
    expect(DEFAULT_TZ).toBe('Asia/Kolkata');
  });
});
