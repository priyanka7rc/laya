import { buildScheduleUpdatePayload } from '@/lib/tasks/scheduleEdit';

describe('buildScheduleUpdatePayload', () => {
  test('produces different due_at for different timezones', () => {
    const d = '2026-02-28';
    const t = '10:00';

    const ist = buildScheduleUpdatePayload(d, t, 'Asia/Kolkata');
    const la = buildScheduleUpdatePayload(d, t, 'America/Los_Angeles');

    expect(ist.due_at).not.toBe(la.due_at);
  });

  test('keeps remind_at as due_at - 15 minutes', () => {
    const d = '2026-02-28';
    const t = '10:00';
    const { due_at, remind_at } = buildScheduleUpdatePayload(d, t, 'Asia/Kolkata');

    if (!due_at || !remind_at) {
      throw new Error('due_at and remind_at must be non-null in this test');
    }

    const diffMs = new Date(due_at).getTime() - new Date(remind_at).getTime();
    expect(diffMs).toBe(15 * 60 * 1000);
  });
});

