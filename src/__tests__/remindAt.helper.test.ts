import { computeRemindAtFromDueAt } from '@/lib/tasks/schedule';

describe('computeRemindAtFromDueAt', () => {
  it('subtracts 15 minutes from due_at', () => {
    const dueAt = '2026-03-02T04:30:00.000Z';
    const remindAt = computeRemindAtFromDueAt(dueAt);
    expect(remindAt).toBe('2026-03-02T04:15:00.000Z');
  });
});

