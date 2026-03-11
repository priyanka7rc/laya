import { getLocalDayWindow, getUpcomingWindow } from '@/lib/taskView/time';

describe('taskView upcoming window semantics', () => {
  test('upcoming window excludes overdue and local today interval when excluded', () => {
    const now = new Date('2026-02-27T10:00:00.000Z');
    const tz = 'Asia/Kolkata';

    const { start: upcomingStart, end: upcomingEnd } = getUpcomingWindow(tz, now, 48);
    const { start: todayStart, end: todayEnd } = getLocalDayWindow(tz, now, 0);

    // Helper that mirrors the upcoming filter semantics used in queryUpcomingTasks
    const inUpcoming = (dueAtISO: string) => {
      const t = new Date(dueAtISO).toISOString();
      const gtWindowStart = t > upcomingStart.toISOString();
      const lteWindowEnd = t <= upcomingEnd.toISOString();
      const inToday =
        t >= todayStart.toISOString() && t < todayEnd.toISOString();
      return gtWindowStart && lteWindowEnd && !inToday;
    };

    // Overdue (<= now) should be excluded
    expect(
      inUpcoming(now.toISOString().replace('10:00:00.000Z', '09:00:00.000Z'))
    ).toBe(false);

    // Later today should be excluded (belongs to \"today\" view instead)
    expect(
      inUpcoming(now.toISOString().replace('10:00:00.000Z', '15:00:00.000Z'))
    ).toBe(false);

    // Tomorrow within 48h window should be included
    expect(inUpcoming('2026-02-28T08:00:00.000Z')).toBe(true);
  });
});

