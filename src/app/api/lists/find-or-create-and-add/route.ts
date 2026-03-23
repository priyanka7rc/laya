export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { insertListWithIdempotency } from '@/server/lists/insertListWithIdempotency';
import { insertListItems } from '@/lib/listItems';

const LOG = '[lists/find-or-create-and-add]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { listName, item } = body as { listName?: string; item?: string };

    if (!listName || typeof listName !== 'string' || !listName.trim()) {
      return NextResponse.json({ error: 'listName is required' }, { status: 400 });
    }
    if (!item || typeof item !== 'string' || !item.trim()) {
      return NextResponse.json({ error: 'item is required' }, { status: 400 });
    }

    const { data: appUser, error: auErr } = await supabaseAdmin!
      .from('app_users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle<{ id: string }>();

    if (auErr || !appUser) {
      return NextResponse.json({ error: 'App user not found' }, { status: 404 });
    }

    // Case-insensitive lookup of existing list by name
    const { data: existingList } = await supabaseAdmin!
      .from('lists')
      .select('id, name')
      .eq('app_user_id', appUser.id)
      .ilike('name', listName.trim())
      .is('deleted_at', null)
      .maybeSingle<{ id: string; name: string }>();

    let listId: string;
    let resolvedListName: string;
    let created = false;

    if (existingList) {
      listId = existingList.id;
      resolvedListName = existingList.name;
    } else {
      // Create the list
      const { list } = await insertListWithIdempotency({
        appUserId: appUser.id,
        name: listName.trim(),
        source: 'web',
        sourceMessageId: null,
      });
      listId = list.id;
      resolvedListName = list.name;
      created = true;
    }

    // Add the item to the list
    const { inserted } = await insertListItems({
      appUserId: appUser.id,
      listId,
      items: [item.trim()],
      source: 'web',
    });

    const itemId = inserted[0]?.id ?? null;

    return NextResponse.json({ listId, listName: resolvedListName, itemId, created });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to add item to list' }, { status: 500 });
  }
}
