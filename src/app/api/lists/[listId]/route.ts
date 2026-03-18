export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';

const LOG = '[lists/[listId]]';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ listId: string }> }
) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;
    const { listId } = await params;

    if (!listId) {
      return NextResponse.json({ error: 'List ID required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { name } = body as { name?: string };

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Enter a list name' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin!
      .from('lists')
      .update({ name: name.trim() })
      .eq('id', listId)
      .eq('app_user_id', appUser.id)
      .is('deleted_at', null)
      .select('id, name, updated_at')
      .maybeSingle();

    if (error) {
      console.error(LOG, error);
      return NextResponse.json({ error: 'Couldn\'t save changes' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Couldn\'t save changes' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ listId: string }> }
) {
  try {
    const auth = await getAuthUserFromRequest(_request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;
    const { listId } = await params;

    if (!listId) {
      return NextResponse.json({ error: 'List ID required' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin!
      .from('lists')
      .update({ deleted_at: now })
      .eq('id', listId)
      .eq('app_user_id', appUser.id)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(LOG, error);
      return NextResponse.json({ error: 'Couldn\'t save changes' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Couldn\'t save changes' }, { status: 500 });
  }
}
