export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { insertListWithIdempotency } from '@/server/lists/insertListWithIdempotency';

const LOG = '[lists/create]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { name } = body as {
      name?: string;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'List name is required' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const result = await insertListWithIdempotency({
      appUserId: appUser.id,
      name,
      source: 'web',
      // Web creates are not keyed by sourceMessageId; idempotency for web
      // is handled at higher layers if needed.
      sourceMessageId: null,
    });

    return NextResponse.json(result.list);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to create list' }, { status: 500 });
  }
}

