export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { insertListItems } from '@/lib/listItems';

const LOG = '[lists/[listId]/items]';

export async function GET(
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

    const { data: list } = await supabaseAdmin!
      .from('lists')
      .select('id')
      .eq('id', listId)
      .eq('app_user_id', appUser.id)
      .is('deleted_at', null)
      .maybeSingle();

    const { data: listRow } = await supabaseAdmin!
      .from('lists')
      .select('id, name')
      .eq('id', listId)
      .eq('app_user_id', appUser.id)
      .is('deleted_at', null)
      .maybeSingle<{ id: string; name: string }>();

    if (!listRow) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    const { data: rows, error } = await supabaseAdmin!
      .from('list_items')
      .select('id, list_id, text, is_done, source, created_at, updated_at, deleted_at')
      .eq('list_id', listId)
      .eq('app_user_id', appUser.id)
      .is('deleted_at', null)
      .order('is_done', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error(LOG, error);
      return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
    }

    const items = (rows ?? []) as Array<{
      id: string;
      list_id: string;
      text: string;
      is_done: boolean;
      source: string;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    }>;
    const doneCount = items.filter((i) => i.is_done).length;
    const totalCount = items.length;

    return NextResponse.json({
      list: { id: listRow.id, name: listRow.name },
      items,
      doneCount,
      totalCount,
    });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to load items' }, { status: 500 });
  }
}

export async function POST(
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
    const { text } = body as { text?: string };
    if (text === undefined || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    const { data: listRow } = await supabaseAdmin!
      .from('lists')
      .select('id')
      .eq('id', listId)
      .eq('app_user_id', appUser.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (!listRow) {
      return NextResponse.json({ error: 'List not found' }, { status: 404 });
    }

    const { inserted } = await insertListItems({
      appUserId: appUser.id,
      listId,
      items: [text.trim()],
      source: 'web',
    });

    if (inserted.length === 0) {
      return NextResponse.json({ error: 'Item not added (empty or duplicate)' }, { status: 400 });
    }

    return NextResponse.json(inserted[0]);
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to add item' }, { status: 500 });
  }
}
