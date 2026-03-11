import 'server-only';
import { createClient } from '@supabase/supabase-js';
import {
  computeDueAtFromLocal,
  computeRemindAtFromDueAt,
  DEFAULT_TZ,
} from '@/lib/tasks/schedule';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type DbTaskRow = {
  id: string;
  app_user_id: string | null;
  title: string;
  notes?: string | null;
  status: string;
  due_at: string | null;
  remind_at: string | null;
  category: string | null;
  due_date?: string | null;
  due_time?: string | null;
  is_done?: boolean;
  [key: string]: unknown;
};

export interface UpdateTaskFieldsParams {
  appUserId: string;
  taskId: string;
  patch: Partial<{
    title: string;
    category: string;
    due_date: string | null;
    due_time: string | null;
    due_at: string | null;
    remind_at: string | null;
    notes: string | null;
    is_done: boolean;
  }>;
  timezone: string;
  source: 'web' | 'whatsapp';
  authUserId?: string | null;
}

export interface UpdateTaskFieldsResult {
  updatedTask: DbTaskRow | null;
}

/**
 * Single source of truth for task field updates.
 * Enforces ownership, schedule recompute (due_at/remind_at), and returns the updated row.
 */
export async function updateTaskFields(
  params: UpdateTaskFieldsParams
): Promise<UpdateTaskFieldsResult> {
  const { appUserId, taskId, patch, timezone, source } = params;
  const tz = timezone || DEFAULT_TZ;

  // Build update payload: only include keys present in patch (no undefined overwrites)
  const updatePayload: Record<string, unknown> = {};

  if (patch.title !== undefined) updatePayload.title = patch.title;
  if (patch.category !== undefined) updatePayload.category = patch.category;
  if (patch.notes !== undefined) updatePayload.notes = patch.notes;
  if (patch.is_done !== undefined) updatePayload.is_done = patch.is_done;

  // Schedule recompute
  if (patch.due_at !== undefined) {
    updatePayload.due_at = patch.due_at;
    updatePayload.remind_at = patch.due_at
      ? computeRemindAtFromDueAt(patch.due_at)
      : null;
  } else if (
    patch.due_date !== undefined ||
    patch.due_time !== undefined
  ) {
    // Need current row to merge when only one of due_date/due_time is in patch
    const { data: current } = await supabase
      .from('tasks')
      .select('due_date, due_time')
      .eq('app_user_id', appUserId)
      .eq('id', taskId)
      .is('deleted_at', null)
      .maybeSingle<{ due_date: string | null; due_time: string | null }>();

    const dueDate =
      patch.due_date !== undefined ? patch.due_date : (current?.due_date ?? null);
    const dueTime =
      patch.due_time !== undefined ? patch.due_time : (current?.due_time ?? null);

    if (!dueDate && !dueTime) {
      updatePayload.due_at = null;
      updatePayload.remind_at = null;
      updatePayload.due_date = null;
      updatePayload.due_time = null;
    } else {
      const dueDateStr = dueDate || null;
      const dueTimeStr = dueTime || null;
      const dueAt = computeDueAtFromLocal(tz, dueDateStr, dueTimeStr);
      updatePayload.due_at = dueAt;
      updatePayload.remind_at = computeRemindAtFromDueAt(dueAt);
      updatePayload.due_date = dueDateStr;
      updatePayload.due_time = dueTimeStr;
    }
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updatePayload)
    .eq('app_user_id', appUserId)
    .eq('id', taskId)
    .is('deleted_at', null)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[updateTaskFields] error', error);
    throw new Error('Failed to update task');
  }

  return { updatedTask: data as DbTaskRow | null };
}
