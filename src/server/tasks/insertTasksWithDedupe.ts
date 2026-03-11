/**
 * Canonical insert-with-dedupe: one place for 5s duplicate window and task insert.
 * Used by /api/tasks/import/confirm and (optionally) Brain Dump.
 */
// IDENTITY + IDEMPOTENCY CONTRACT:
// If source_message_id exists, it is the single source of truth for idempotency.

import { createClient } from '@supabase/supabase-js';
import type { ProposedTask } from '@/lib/task_intake';
import type { TaskSource } from '@/lib/taskSources';
import { toHHMM } from '@/lib/taskRulesParser';
import { computeDueAtFromLocal, computeRemindAtFromDueAt, DEFAULT_TZ } from '@/lib/tasks/schedule';

const DUPLICATE_WINDOW_MS = 5000;

export interface InsertedTask {
  id: string;
  title: string;
  due_date: string;
  due_time: string;
  category: string;
}

export interface InsertTasksResult {
  inserted: InsertedTask[];
  duplicates: { index: number; reason: string }[];
  skippedByIdempotency?: boolean;
}

export interface InsertTasksWithDedupeParams {
  tasks: ProposedTask[];
  userId: string;
  appUserId?: string | null;
  allowDuplicateIndices?: number[];
  source?: TaskSource;
  sourceMessageId?: string | null;
}

export async function insertTasksWithDedupe(
  params: InsertTasksWithDedupeParams
): Promise<InsertTasksResult> {
  const {
    tasks: proposedTasks,
    userId,
    appUserId = null,
    allowDuplicateIndices = [],
    source,
    sourceMessageId = null,
  } = params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Strong idempotency: if source_message_id is present and we have already
  // created any task for this user + source_message_id, short-circuit before
  // running 5-second duplicate-window logic.
  if (sourceMessageId) {
    const { data: existingBySource } = await supabase
      .from('tasks')
      .select('id')
      .eq('user_id', userId)
      .eq('source_message_id', sourceMessageId)
      .limit(1);

    if (existingBySource && existingBySource.length > 0) {
      return {
        inserted: [],
        duplicates: [],
        skippedByIdempotency: true,
      };
    }
  }

  const allowSet = new Set(allowDuplicateIndices);

  const now = Date.now();
  const { data: existingTasks } = await supabase
    .from('tasks')
    .select('id, title, due_date, due_time, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  const recentTasks: { id: string; title: string | null; due_date: string | null; due_time: string | null; created_at: string }[] = (
    existingTasks ?? []
  ).filter((t) => {
    const createdAtMs = new Date(t.created_at).getTime();
    return now - createdAtMs <= DUPLICATE_WINDOW_MS;
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const DEFAULT_TASK_TIME = '20:00';

  const inserted: InsertedTask[] = [];
  const duplicates: { index: number; reason: string }[] = [];

  // Resolve a per-user timezone once for this batch, defaulting to IST.
  let userTz = DEFAULT_TZ;
  try {
    if (appUserId) {
      const { data: appUser } = await supabase
        .from('app_users')
        .select('timezone')
        .eq('id', appUserId)
        .maybeSingle<{ timezone: string | null }>();
      if (appUser?.timezone) {
        userTz = appUser.timezone;
      }
    } else {
      const { data: appUser } = await supabase
        .from('app_users')
        .select('timezone')
        .eq('auth_user_id', userId)
        .maybeSingle<{ timezone: string | null }>();
      if (appUser?.timezone) {
        userTz = appUser.timezone;
      }
    }
  } catch (e) {
    console.error('[insertTasksWithDedupe] failed to resolve user timezone, using default', e);
  }

  for (let i = 0; i < proposedTasks.length; i++) {
    const task = proposedTasks[i];

    // Enforce non-null canonical schedule with normalized time.
    let inferredDate = !!task.inferred_date;
    let inferredTime = !!task.inferred_time;

    const dueDate = task.due_date || todayStr;
    if (!task.due_date) {
      inferredDate = true;
    }

    const rawTime = task.due_time || DEFAULT_TASK_TIME;
    const normalizedTime = toHHMM(rawTime) || DEFAULT_TASK_TIME;
    if (!task.due_time || toHHMM(task.due_time) == null) {
      inferredTime = true;
    }

    // Mutate task so downstream logic (dedupe, payload) sees canonical values.
    task.due_date = dueDate;
    task.due_time = normalizedTime;
    task.inferred_date = inferredDate;
    task.inferred_time = inferredTime;

    const normalizedTitle = (task.title ?? '').trim().toLowerCase();
    const normDueTime = (task.due_time ?? '').slice(0, 5);

    const isDup = recentTasks.some(
      (t) =>
        (t.title ?? '').trim().toLowerCase() === normalizedTitle &&
        (t.due_date ?? '') === (task.due_date ?? '') &&
        (t.due_time ?? '').slice(0, 5) === normDueTime
    );

    if (isDup && !allowSet.has(i)) {
      duplicates.push({ index: i, reason: 'Duplicate of a recently added task' });
      continue;
    }

    const dueAtISO = computeDueAtFromLocal(userTz, dueDate, normalizedTime);
    const remindAtISO = computeRemindAtFromDueAt(dueAtISO);

    const payload = {
      user_id: userId,
      app_user_id: appUserId,
      source,
      source_message_id: sourceMessageId,
      title: (task.title ?? '').slice(0, 120),
      due_date: task.due_date,
      due_time: task.due_time,
      category: task.category ?? 'Tasks',
      inferred_date: !!task.inferred_date,
      inferred_time: !!task.inferred_time,
      is_done: false,
      reminder_sent: false,
      due_at: dueAtISO,
      remind_at: remindAtISO,
    };

    if (!payload.due_date || !payload.due_time) {
      throw new Error('Invariant violation: due_date and due_time must not be null');
    }

    const { data: insertedRow, error } = await supabase
      .from('tasks')
      .insert(payload)
      .select('id, title, due_date, due_time, category')
      .single();

    if (error) {
      duplicates.push({ index: i, reason: error.message || 'Insert failed' });
      continue;
    }

    inserted.push(insertedRow as InsertedTask);
    recentTasks.unshift({
      id: insertedRow.id,
      title: insertedRow.title,
      due_date: insertedRow.due_date,
      due_time: insertedRow.due_time,
      created_at: new Date().toISOString(),
    });
  }

  return { inserted, duplicates };
}
