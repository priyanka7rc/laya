import { supabase } from '@/lib/supabaseClient';

export interface Task {
  id: string;
  app_user_id: string | null;
  title: string;
  status: string;
  due_at: string | null;
  remind_at: string | null;
  category: string | null;
  parse_confidence: number | null;
  created_at: string;
}

function toDateOnlyISO(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

export async function getTodayTasks(appUserId: string, baseDate: Date): Promise<Task[]> {
  const day = toDateOnlyISO(baseDate);

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .eq('status', 'active')
    .or(
      [
        `due_at::date.eq.${day}`,
        `remind_at::date.eq.${day}`,
      ].join(',')
    )
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('remind_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[tasks][getTodayTasks] error', error);
    return [];
  }

  return (data ?? []) as Task[];
}

export async function getUpcomingTasks(appUserId: string, now: Date): Promise<Task[]> {
  const nowIso = now.toISOString();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  const today = toDateOnlyISO(now);

  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .eq('status', 'active')
    .gt('due_at', nowIso)
    .lte('due_at', in48h)
    .neq('due_at', null)
    .neq('due_at::date', today)
    .order('due_at', { ascending: true });

  if (error) {
    console.error('[tasks][getUpcomingTasks] error', error);
    return [];
  }

  return (data ?? []) as Task[];
}

export async function getInboxTasks(appUserId: string, limit = 5): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('app_user_id', appUserId)
    .or('status.eq.needs_clarification,parse_confidence.lt.0.65')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[tasks][getInboxTasks] error', error);
    return [];
  }

  return (data ?? []) as Task[];
}

