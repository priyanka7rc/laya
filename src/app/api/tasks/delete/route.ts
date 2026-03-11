export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { deleteTasks } from '@/server/tasks/deleteTasks';
import { supabaseAdmin } from '@/lib/supabaseClient';

const LOG = '[tasks/delete]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { taskId, taskIds: taskIdsRaw } = body as {
      taskId?: string;
      taskIds?: string[];
    };

    const ids: string[] = taskId
      ? [taskId]
      : Array.isArray(taskIdsRaw)
      ? taskIdsRaw
      : [];

    if (!ids.length) {
      return NextResponse.json({ error: 'taskId or taskIds required' }, { status: 400 });
    }

    // Resolve app_user_id via service role (bypasses RLS; auth already validated above)
    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const result = await deleteTasks({
      appUserId: appUser.id,
      taskIds: ids,
      source: 'web',
      authUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 });
  }
}
