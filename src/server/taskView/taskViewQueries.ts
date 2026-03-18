import { supabase } from '@/lib/supabaseClient';
import {
  TaskViewTask,
  TaskViewPageInfo,
  TaskViewResult,
  TaskViewFilters,
  TaskViewPagination,
} from '@/lib/taskView/contracts';

type DbTaskRow = {
  id: string;
  app_user_id: string | null;
  title: string;
  notes?: string | null;
  status: string;
  due_at: string | null;
  remind_at: string | null;
  category: string | null;
  parse_confidence: number | null;
  created_at: string;
  is_done?: boolean;
  due_date?: string | null;
  due_time?: string | null;
};

function mapRowToTask(row: DbTaskRow): TaskViewTask {
  const dueAt = row.due_at;
  const due_date = row.due_date ?? (dueAt ? dueAt.slice(0, 10) : null);
  const due_time = row.due_time ?? (dueAt && dueAt.length > 16 ? dueAt.slice(11, 16) : null);
  return {
    id: row.id,
    appUserId: row.app_user_id!,
    title: row.title,
    status: row.status,
    dueAt: row.due_at,
    remindAt: row.remind_at,
    category: row.category,
    parseConfidence: row.parse_confidence,
    createdAt: row.created_at,
    is_done: row.is_done ?? (row.status === 'completed'),
    due_date,
    due_time,
    created_at: row.created_at,
  };
}

function buildPageInfo(rows: DbTaskRow[], pagination?: TaskViewPagination): TaskViewPageInfo {
  const limit = pagination?.limit ?? 50;
  if (rows.length === 0) {
    return { hasMore: false, nextCursor: null };
  }

  const hasMore = rows.length === limit;
  const last = rows[rows.length - 1];
  const cursorPayload = { createdAt: last.created_at, id: last.id };
  const nextCursor = hasMore ? Buffer.from(JSON.stringify(cursorPayload)).toString('base64') : null;

  return { hasMore, nextCursor };
}

function applyCursorFilter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  pagination?: TaskViewPagination
) {
  if (!pagination?.cursor) return query;

  try {
    const decoded = Buffer.from(pagination.cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { createdAt: string; id: string };
    return query
      .lt('created_at', parsed.createdAt)
      .order('created_at', { ascending: false });
  } catch {
    return query;
  }
}

export async function queryAllTasks(
  appUserId: string,
  filters?: TaskViewFilters,
  pagination?: TaskViewPagination
): Promise<TaskViewResult> {
  const limit = pagination?.limit ?? 50;

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .is('deleted_at', null);

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  query = query.order('created_at', { ascending: false });
  query = applyCursorFilter(query, pagination).limit(limit);

  const { data, error } = await query;
  if (error || !data) {
    console.error('[taskView][queryAllTasks] error', error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }

  const rows = data as DbTaskRow[];
  const tasks = rows.map(mapRowToTask);
  const pageInfo = buildPageInfo(rows, pagination);
  return { tasks, pageInfo };
}

export async function queryTodayTasks(
  appUserId: string,
  dayISO: string,
  pagination?: TaskViewPagination
): Promise<TaskViewResult> {
  const limit = pagination?.limit ?? 50;

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .or(
      [
        `due_at::date.eq.${dayISO}`,
        `remind_at::date.eq.${dayISO}`,
      ].join(',')
    )
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('remind_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  query = applyCursorFilter(query, pagination).limit(limit);

  const { data, error } = await query;
  if (error || !data) {
    console.error('[taskView][queryTodayTasks] error', error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }

  const rows = data as DbTaskRow[];
  const tasks = rows.map(mapRowToTask);
  const pageInfo = buildPageInfo(rows, pagination);
  return { tasks, pageInfo };
}

/** Timezone-correct: today/digest by UTC window [startISO, endISO). */
export async function queryTodayTasksInWindow(
  appUserId: string,
  startISO: string,
  endISO: string,
  pagination?: TaskViewPagination
): Promise<TaskViewResult> {
  const limit = pagination?.limit ?? 50;
  const seen = new Set<string>();

  const [dueRes, remindRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('app_user_id', appUserId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .gte('due_at', startISO)
      .lt('due_at', endISO)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(limit * 2),
    supabase
      .from('tasks')
      .select('*')
      .eq('app_user_id', appUserId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .gte('remind_at', startISO)
      .lt('remind_at', endISO)
      .order('remind_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(limit * 2),
  ]);

  if (dueRes.error) {
    console.error('[taskView][queryTodayTasksInWindow] due_at error', dueRes.error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }
  if (remindRes.error) {
    console.error('[taskView][queryTodayTasksInWindow] remind_at error', remindRes.error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }

  const merged: DbTaskRow[] = [];
  const byDue = ((dueRes.data ?? []) as DbTaskRow[]).sort(
    (a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? '') || a.created_at.localeCompare(b.created_at)
  );
  const byRemind = ((remindRes.data ?? []) as DbTaskRow[]).sort(
    (a, b) => (a.remind_at ?? '').localeCompare(b.remind_at ?? '') || a.created_at.localeCompare(b.created_at)
  );
  let i = 0,
    j = 0;
  while (merged.length < limit && (i < byDue.length || j < byRemind.length)) {
    const a = byDue[i];
    const b = byRemind[j];
    if (!a && !b) break;
    if (!b || (a && (a.due_at ?? '').localeCompare(b.remind_at ?? '') <= 0)) {
      if (a && !seen.has(a.id)) {
        seen.add(a.id);
        merged.push(a);
      }
      i++;
    } else {
      if (b && !seen.has(b.id)) {
        seen.add(b.id);
        merged.push(b);
      }
      j++;
    }
  }

  const tasks = merged.map(mapRowToTask);
  const pageInfo: TaskViewPageInfo = {
    hasMore: merged.length === limit,
    nextCursor: merged.length === limit && merged[merged.length - 1]
      ? Buffer.from(JSON.stringify({ createdAt: merged[merged.length - 1].created_at, id: merged[merged.length - 1].id })).toString('base64')
      : null,
  };
  return { tasks, pageInfo };
}

export async function queryUpcomingTasks(
  appUserId: string,
  windowStartISO: string,
  windowEndISO: string,
  todayISO: string,
  pagination?: TaskViewPagination,
  excludeStartISO?: string,
  excludeEndISO?: string
): Promise<TaskViewResult> {
  const limit = pagination?.limit ?? 50;

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .eq('status', 'active')
    .is('deleted_at', null)
    // Upcoming window: tasks strictly after windowStartISO (usually "now")
    // and up to and including windowEndISO (e.g. now+48h), based on due_at.
    .gt('due_at', windowStartISO)
    .lte('due_at', windowEndISO)
    .not('due_at', 'is', null)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (excludeStartISO != null && excludeEndISO != null) {
    // Exclude the local "today" window [excludeStartISO, excludeEndISO) so
    // upcoming does not duplicate the separate "today" view.
    query = query.or(`due_at.lt.${excludeStartISO},due_at.gte.${excludeEndISO}`);
  }

  query = applyCursorFilter(query, pagination).limit(limit);

  const { data, error } = await query;
  if (error || !data) {
    console.error('[taskView][queryUpcomingTasks] error', error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }

  const rows = data as DbTaskRow[];
  const tasks = rows.map(mapRowToTask);
  const pageInfo = buildPageInfo(rows, pagination);
  return { tasks, pageInfo };
}

export async function queryInboxTasks(
  appUserId: string,
  pagination?: TaskViewPagination
): Promise<TaskViewResult> {
  const limit = pagination?.limit ?? 20;

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    .or('status.eq.needs_clarification,parse_confidence.lt.0.65')
    .order('created_at', { ascending: false });

  query = applyCursorFilter(query, pagination).limit(limit);

  const { data, error } = await query;
  if (error || !data) {
    console.error('[taskView][queryInboxTasks] error', error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }

  const rows = data as DbTaskRow[];
  const tasks = rows.map(mapRowToTask);
  const pageInfo = buildPageInfo(rows, pagination);
  return { tasks, pageInfo };
}

/** Tasks due at or before asOfISO that need a reminder (reminder_sent = false, is_done = false). */
export async function queryReminderWindowTasks(
  appUserId: string,
  asOfISO: string,
  pagination?: TaskViewPagination
): Promise<TaskViewResult> {
  const limit = pagination?.limit ?? 100;
  const windowHoursBack = 24;
  const asOf = new Date(asOfISO);
  const lowerBoundISO = new Date(
    asOf.getTime() - windowHoursBack * 60 * 60 * 1000
  ).toISOString();

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .eq('is_done', false)
    .eq('reminder_sent', false)
    .is('deleted_at', null)
    .not('remind_at', 'is', null)
    // Only remind tasks whose remind_at fell in the recent window (e.g. last 24h)
    .gt('remind_at', lowerBoundISO)
    .lte('remind_at', asOfISO)
    .order('remind_at', { ascending: true })
    .order('created_at', { ascending: true });

  query = applyCursorFilter(query, pagination).limit(limit);

  const { data, error } = await query;
  if (error || !data) {
    console.error('[taskView][queryReminderWindowTasks] error', error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }

  const rows = data as DbTaskRow[];
  const tasks = rows.map(mapRowToTask);
  const pageInfo = buildPageInfo(rows, pagination);
  return { tasks, pageInfo };
}

export async function querySearchTasks(
  appUserId: string,
  term: string,
  filters?: TaskViewFilters,
  pagination?: TaskViewPagination
): Promise<TaskViewResult> {
  const limit = pagination?.limit ?? 50;
  const likeTerm = `%${term}%`;

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    .or(
      [
        `title.ilike.${likeTerm}`,
        `category.ilike.${likeTerm}`,
        `notes.ilike.${likeTerm}`,
      ].join(',')
    );

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  query = query.order('created_at', { ascending: false });
  query = applyCursorFilter(query, pagination).limit(limit);

  const { data, error } = await query;
  if (error || !data) {
    console.error('[taskView][querySearchTasks] error', error);
    return { tasks: [], pageInfo: { hasMore: false } };
  }

  const rows = data as DbTaskRow[];
  const tasks = rows.map(mapRowToTask);
  const pageInfo = buildPageInfo(rows, pagination);
  return { tasks, pageInfo };
}

