export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { executeListView } from '@/server/listView/listViewEngine';

const LOG = '[lists/view]';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor');
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) || undefined : undefined;

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const result = await executeListView({
      appUserId: appUser.id,
      cursor,
      limit,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to load lists' }, { status: 500 });
  }
}

