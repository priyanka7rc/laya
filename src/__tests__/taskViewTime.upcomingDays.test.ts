import { getLocalDayWindow, getUpcomingDaysWindow } from '@/lib/taskView/time';

describe('taskView upcoming days window', () => {
  it('computes tomorrow + day after window correctly for Asia/Kolkata', () => {
    const tz = 'Asia/Kolkata';
    const now = new Date('2026-03-02T12:00:00.000Z');

    const { start: tomorrowStart } = getLocalDayWindow(tz, now, 1);
    const { start: thirdDayStart } = getLocalDayWindow(tz, now, 3);

    const { start, end } = getUpcomingDaysWindow(tz, now, 2);

    expect(start.toISOString()).toBe(tomorrowStart.toISOString());
    expect(end.toISOString()).toBe(thirdDayStart.toISOString());
  });
});

