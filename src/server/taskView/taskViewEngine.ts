import {
  TaskViewIdentity,
  TaskViewRequest,
  TaskViewResult,
  TaskViewView,
} from '@/lib/taskView/contracts';
import { getLocalDayWindow, getUpcomingWindow, getUpcomingDaysWindow, DEFAULT_TZ } from '@/lib/taskView/time';
import {
  queryAllTasks,
  queryTodayTasks,
  queryTodayTasksInWindow,
  queryUpcomingTasks,
  queryInboxTasks,
  querySearchTasks,
  queryReminderWindowTasks,
} from '@/server/taskView/taskViewQueries';
import { supabase } from '@/lib/supabaseClient';

const DEFAULT_LIMIT = 50;

function getNow(requestNow?: Date): Date {
  return requestNow ?? new Date();
}

function getTz(request: TaskViewRequest): string {
  return request.timezone ?? DEFAULT_TZ;
}

async function resolveIdentity(identity: TaskViewIdentity): Promise<string | null> {
  if (identity.kind === 'appUserId') {
    return identity.appUserId;
  }

  if (identity.kind === 'authUserId') {
    const { data, error } = await supabase
      .from('app_users')
      .select('id')
      .eq('auth_user_id', identity.authUserId)
      .maybeSingle<{ id: string }>();

    if (error || !data) {
      console.error('[taskView][resolveIdentity] authUserId lookup failed', error);
      return null;
    }
    return data.id;
  }

  if (identity.kind === 'phone') {
    // First try direct phone mapping on app_users.phone_e164
    const primary = await supabase
      .from('app_users')
      .select('id')
      .eq('phone_e164', identity.phoneE164)
      .maybeSingle<{ id: string }>();

    if (primary.data?.id) {
      return primary.data.id;
    }

    // Fallback: resolve via whatsapp_users.phone_number -> auth_user_id -> app_users.id
    const wa = await supabase
      .from('whatsapp_users')
      .select('auth_user_id')
      .eq('phone_number', identity.phoneE164)
      .maybeSingle<{ auth_user_id: string | null }>();

    if (!wa.data?.auth_user_id) {
      if (primary.error || wa.error) {
        console.error('[taskView][resolveIdentity] phone lookup failed', primary.error || wa.error);
      }
      return null;
    }

    const appFromAuth = await supabase
      .from('app_users')
      .select('id')
      .eq('auth_user_id', wa.data.auth_user_id)
      .maybeSingle<{ id: string }>();

    if (appFromAuth.error || !appFromAuth.data) {
      console.error('[taskView][resolveIdentity] phone->auth_user lookup failed', appFromAuth.error);
      return null;
    }
    return appFromAuth.data.id;
  }

  return null;
}

function normalizeView(view: TaskViewView): TaskViewView {
  return view;
}

export async function executeTaskView(request: TaskViewRequest): Promise<TaskViewResult> {
  const view = normalizeView(request.view);
  const now = getNow(request.now);
  const filters = request.filters ?? {};
  const pagination = {
    ...request.pagination,
    limit: Math.min(request.pagination?.limit ?? DEFAULT_LIMIT, DEFAULT_LIMIT),
  };

  const appUserId = await resolveIdentity(request.identity);
  if (!appUserId) {
    return {
      tasks: [],
      pageInfo: { hasMore: false, nextCursor: null },
      identityResolved: false,
    };
  }

  const withResolved = <T extends TaskViewResult>(r: T): T => ({
    ...r,
    identityResolved: true,
  });

  if (view === 'all') {
    return withResolved(await queryAllTasks(appUserId, filters, pagination));
  }

  if (view === 'inbox') {
    return withResolved(await queryInboxTasks(appUserId, pagination));
  }

  if (view === 'today' || view === 'digest') {
    const tz = getTz(request);
    if (filters.date && filters.date !== 'today' && /^\d{4}-\d{2}-\d{2}$/.test(filters.date)) {
      return withResolved(await queryTodayTasks(appUserId, filters.date, pagination));
    }
    const { start, end } = getLocalDayWindow(tz, now, 0);
    return withResolved(
      await queryTodayTasksInWindow(appUserId, start.toISOString(), end.toISOString(), pagination)
    );
  }

  if (view === 'upcoming') {
    const tz = getTz(request);
    // [C3] Upcoming = next 2 calendar days (tomorrow + day after)
    const { start, end } = getUpcomingDaysWindow(tz, now, 2);
    return withResolved(
      await queryUpcomingTasks(
        appUserId,
        start.toISOString(),
        end.toISOString(),
        '',
        pagination
      )
    );
  }

  if (view === 'search') {
    const term = filters.term?.trim();
    // Enforce a minimum term length to avoid expensive %t% scans.
    if (!term || term.length < 2) {
      return { tasks: [], pageInfo: { hasMore: false, nextCursor: null }, identityResolved: true };
    }
    return withResolved(await querySearchTasks(appUserId, term, filters, pagination));
  }

  if (view === 'reminderWindow') {
    return withResolved(await queryReminderWindowTasks(appUserId, now.toISOString(), pagination));
  }

  return { tasks: [], pageInfo: { hasMore: false, nextCursor: null }, identityResolved: true };
}

