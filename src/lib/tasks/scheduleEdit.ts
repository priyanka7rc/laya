import { computeDueAtFromLocal, computeRemindAtFromDueAt } from '@/lib/tasks/schedule';

export function buildScheduleUpdatePayload(
  dueDate: string,
  dueTime: string,
  tz: string
): { due_at: string | null; remind_at: string | null } {
  const due_at = computeDueAtFromLocal(tz, dueDate, dueTime);
  const remind_at = computeRemindAtFromDueAt(due_at);
  return { due_at, remind_at };
}

