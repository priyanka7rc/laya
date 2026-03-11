import { supabase } from '@/lib/supabaseClient';

// SCHEDULING MODEL:
// due_date + due_time are canonical.
// due_at / remind_at are deprecated for new writes.

/** @deprecated Use POST /api/tasks/create instead. */
export interface CreateTaskInput {
  appUserId: string;
  title: string;
  dueAt?: Date | null;
  remindAt?: Date | null;
  category?: string | null;
}

function toIsoOrNull(d?: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/**
 * DEPRECATED: Use /api/tasks/create instead.
 * No longer performs a direct insert; returns an error so callers migrate to the canonical API.
 */
export async function createTask(
  _input: CreateTaskInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  return {
    ok: false,
    error: 'Use POST /api/tasks/create for task creation.',
  };
}

export async function setTaskStatus(id: string, status: 'active' | 'completed' | 'needs_clarification') {
  const { error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', id);

  if (error) {
    console.error('[tasks][setTaskStatus] error', error);
  }
}

export async function setTaskDueAt(id: string, dueAt: Date | null) {
  // Convert Date → canonical due_date (YYYY-MM-DD) + due_time (HH:MM, 24h),
  // and derive due_at / remind_at from that canonical schedule.
  const DEFAULT_TASK_TIME = '20:00';

  let year: number;
  let month: string;
  let day: string;
  let hours: string;
  let minutes: string;

  if (dueAt) {
    year = dueAt.getFullYear();
    month = String(dueAt.getMonth() + 1).padStart(2, '0');
    day = String(dueAt.getDate()).padStart(2, '0');
    hours = String(dueAt.getHours()).padStart(2, '0');
    minutes = String(dueAt.getMinutes()).padStart(2, '0');
  } else {
    console.warn('[tasks][setTaskDueAt] Null dueAt coerced to default schedule');
    const now = new Date();
    year = now.getFullYear();
    month = String(now.getMonth() + 1).padStart(2, '0');
    day = String(now.getDate()).padStart(2, '0');
    [hours, minutes] = DEFAULT_TASK_TIME.split(':');
  }

  const due_date = `${year}-${month}-${day}`;
  const due_time = `${hours}:${minutes}`;

  const due_at = dueAt ? dueAt.toISOString() : null;
  const remind_at = due_at ? new Date(new Date(due_at).getTime() - 15 * 60 * 1000).toISOString() : null;

  const update = {
    due_date,
    due_time,
    due_at,
    remind_at,
  };

  const { error } = await supabase
    .from('tasks')
    .update(update)
    .eq('id', id);

  if (error) {
    console.error('[tasks][setTaskDueAt] error', error);
  }
}

export async function setTaskRemindAt(id: string, remindAt: Date | null) {
  // Legacy remind_at column retained but not used in canonical scheduling.
  const { error } = await supabase
    .from('tasks')
    .update({ remind_at: toIsoOrNull(remindAt) })
    .eq('id', id);

  if (error) {
    console.error('[tasks][setTaskRemindAt] error', error);
  }
}

export async function snoozeTaskToTodayEvening(id: string) {
  const now = new Date();
  const evening = new Date(now);
  evening.setHours(20, 0, 0, 0); // 8 PM local time
  await setTaskRemindAt(id, evening);
}

export async function snoozeTaskInTwoHours(id: string) {
  const now = new Date();
  const twoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  await setTaskRemindAt(id, twoHours);
}

