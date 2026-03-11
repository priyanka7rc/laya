export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { undoDelete } from '@/server/tasks/deleteTasks';
import { supabaseAdmin } from '@/lib/supabaseClient';

const LOG = '[tasks/undo-delete]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { taskIds } = body as { taskIds?: string[] };

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return NextResponse.json({ error: 'taskIds required' }, { status: 400 });
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

    const result = await undoDelete({
      appUserId: appUser.id,
      taskIds,
      withinMinutes: 5,
      authUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to undo delete' }, { status: 500 });
  }
}
