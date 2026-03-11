export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { updateTaskFields } from '@/server/tasks/updateTaskFields';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { DEFAULT_TZ } from '@/lib/tasks/schedule';

const LOG = '[tasks/update]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      taskId,
      title,
      category,
      due_date,
      due_time,
      notes,
      is_done,
    } = body as {
      taskId?: string;
      title?: string;
      category?: string;
      due_date?: string | null;
      due_time?: string | null;
      notes?: string | null;
      is_done?: boolean;
    };

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({ error: 'taskId required' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id, timezone')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string; timezone?: string | null }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const patch: Parameters<typeof updateTaskFields>[0]['patch'] = {};
    if (title !== undefined) patch.title = title;
    if (category !== undefined) patch.category = category;
    if (due_date !== undefined) patch.due_date = due_date ?? null;
    if (due_time !== undefined) patch.due_time = due_time ?? null;
    if (notes !== undefined) patch.notes = notes ?? null;
    if (is_done !== undefined) patch.is_done = is_done;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const result = await updateTaskFields({
      appUserId: appUser.id,
      taskId,
      patch,
      timezone: appUser.timezone ?? DEFAULT_TZ,
      source: 'web',
      authUserId: user.id,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}
