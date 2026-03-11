import 'server-only';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface DeleteTasksParams {
  appUserId: string;
  taskIds: string[];
  source: 'web' | 'whatsapp' | 'system';
  authUserId?: string | null;
}

export interface DeleteTasksResult {
  deletedIds: string[];
  alreadyDeletedIds: string[];
  notFoundIds: string[];
}

export interface UndoDeleteParams {
  appUserId: string;
  taskIds: string[];
  withinMinutes?: number;
  authUserId?: string | null;
}

export interface UndoDeleteResult {
  restoredIds: string[];
  notRestorableIds: string[];
}

export async function deleteTasks(params: DeleteTasksParams): Promise<DeleteTasksResult> {
  const { appUserId, taskIds, source, authUserId } = params;

  if (!taskIds.length) {
    return { deletedIds: [], alreadyDeletedIds: [], notFoundIds: [] };
  }

  // Fetch current state of those tasks for this user
  const { data: existing, error: fetchErr } = await supabase
    .from('tasks')
    .select('id, deleted_at')
    .eq('app_user_id', appUserId)
    .in('id', taskIds);

  if (fetchErr) {
    console.error('[deleteTasks] fetch error', fetchErr);
    throw new Error('Failed to query tasks before delete');
  }

  const existingIds = new Set((existing ?? []).map((r: { id: string }) => r.id));
  const alreadyDeletedIds = (existing ?? [])
    .filter((r: { id: string; deleted_at: string | null }) => r.deleted_at !== null)
    .map((r: { id: string }) => r.id);
  const notFoundIds = taskIds.filter((id) => !existingIds.has(id));
  const toDeleteIds = taskIds.filter(
    (id) => existingIds.has(id) && !alreadyDeletedIds.includes(id)
  );

  if (!toDeleteIds.length) {
    return { deletedIds: [], alreadyDeletedIds, notFoundIds };
  }

  const { error: updateErr } = await supabase
    .from('tasks')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_source: source,
      deleted_by_auth_user_id: authUserId ?? null,
    })
    .eq('app_user_id', appUserId)
    .in('id', toDeleteIds)
    .is('deleted_at', null);

  if (updateErr) {
    console.error('[deleteTasks] update error', updateErr);
    throw new Error('Failed to delete tasks');
  }

  return { deletedIds: toDeleteIds, alreadyDeletedIds, notFoundIds };
}

export async function undoDelete(params: UndoDeleteParams): Promise<UndoDeleteResult> {
  const { appUserId, taskIds, withinMinutes = 5, authUserId } = params;

  if (!taskIds.length) {
    return { restoredIds: [], notRestorableIds: [] };
  }

  const cutoff = new Date(Date.now() - withinMinutes * 60 * 1000).toISOString();

  // Find tasks that are deleted and within the undo window
  const { data: candidates, error: fetchErr } = await supabase
    .from('tasks')
    .select('id, deleted_at')
    .eq('app_user_id', appUserId)
    .in('id', taskIds)
    .not('deleted_at', 'is', null)
    .gte('deleted_at', cutoff);

  if (fetchErr) {
    console.error('[undoDelete] fetch error', fetchErr);
    throw new Error('Failed to query tasks for undo');
  }

  const restorableIds = (candidates ?? []).map((r: { id: string }) => r.id);
  const notRestorableIds = taskIds.filter((id) => !restorableIds.includes(id));

  if (!restorableIds.length) {
    return { restoredIds: [], notRestorableIds };
  }

  const { error: updateErr } = await supabase
    .from('tasks')
    .update({
      deleted_at: null,
      deleted_source: null,
      deleted_by_auth_user_id: authUserId ?? null,
    })
    .eq('app_user_id', appUserId)
    .in('id', restorableIds)
    .not('deleted_at', 'is', null);

  if (updateErr) {
    console.error('[undoDelete] update error', updateErr);
    throw new Error('Failed to restore tasks');
  }

  return { restoredIds: restorableIds, notRestorableIds };
}
