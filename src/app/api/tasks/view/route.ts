/**
 * POST /api/tasks/view
 *
 * Server-side wrapper around executeTaskView.
 * Called by client components (home, tasks, app) that cannot import
 * taskViewEngine directly because it uses SUPABASE_SERVICE_ROLE_KEY.
 *
 * Request body: TaskViewRequest with identity.kind = "appUserId"
 * Response: TaskViewResult
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { executeTaskView } from '@/server/taskView/taskViewEngine';
import { supabaseAdmin } from '@/lib/supabaseClient';
import type { TaskViewView, TaskViewFilters, TaskViewPagination } from '@/lib/taskView/contracts';

const LOG = '[tasks/view]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({})) as {
      view?: string;
      filters?: TaskViewFilters;
      pagination?: TaskViewPagination;
      /** ISO string for the "now" reference point (used by app/page.tsx for tomorrow view). */
      now?: string;
    };

    const view = (body.view ?? 'today') as TaskViewView;

    // Resolve app_user_id from the authenticated user
    if (!supabaseAdmin) {
      console.error(LOG, 'supabaseAdmin not available');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const { data: appUser } = await supabaseAdmin
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (!appUser?.id) {
      return NextResponse.json(
        { tasks: [], pageInfo: { hasMore: false, nextCursor: null }, identityResolved: false },
        { status: 200 }
      );
    }

    const result = await executeTaskView({
      identity: { kind: 'appUserId', appUserId: appUser.id },
      view,
      filters: body.filters,
      pagination: body.pagination,
      now: body.now ? new Date(body.now) : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(LOG, 'error', msg);
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }
}
