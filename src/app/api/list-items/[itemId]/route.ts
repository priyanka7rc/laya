export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { updateListItem, softDeleteListItem } from '@/lib/listItems';

const LOG = '[list-items/[itemId]]';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;
    const { itemId } = await params;

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { is_done, text } = body as { is_done?: boolean; text?: string };

    if (is_done === undefined && (text === undefined || typeof text !== 'string')) {
      return NextResponse.json(
        { error: 'Provide is_done and/or text' },
        { status: 400 }
      );
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const updated = await updateListItem({
      itemId,
      appUserId: appUser.id,
      ...(typeof is_done === 'boolean' ? { is_done } : {}),
      ...(text !== undefined ? { text: typeof text === 'string' ? text : '' } : {}),
    });

    if (!updated) {
      return NextResponse.json({ error: 'Item not found or nothing to update' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const auth = await getAuthUserFromRequest(_request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;
    const { itemId } = await params;

    if (!itemId) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const deleted = await softDeleteListItem({ itemId, appUserId: appUser.id });
    if (!deleted) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
