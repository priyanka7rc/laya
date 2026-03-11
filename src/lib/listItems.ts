import { supabaseAdmin } from '@/lib/supabaseClient';

export type ListItemSource = 'web' | 'whatsapp' | 'ocr';

export type ListItem = {
  id: string;
  list_id: string;
  text: string;
  is_done: boolean;
  source: ListItemSource;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

type InsertListItemsParams = {
  appUserId: string;
  listId: string;
  items: string[];
  source: ListItemSource;
};

export async function insertListItems(
  params: InsertListItemsParams
): Promise<{ inserted: ListItem[] }> {
  const { appUserId, listId, items, source } = params;

  // 1. Normalize incoming items: trim, drop empties, build keys.
  const normalizedIncoming = items
    .map((raw) => {
      const trimmed = (raw ?? '').trim();
      if (!trimmed) return null;
      return { text: trimmed, key: normalizeKey(trimmed) };
    })
    .filter((v): v is { text: string; key: string } => v !== null);

  if (normalizedIncoming.length === 0) {
    return { inserted: [] };
  }

  // 2. Remove duplicates within the incoming batch by normalized key.
  const seen = new Set<string>();
  const uniqueIncoming: { text: string; key: string }[] = [];
  for (const item of normalizedIncoming) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    uniqueIncoming.push(item);
  }

  if (uniqueIncoming.length === 0) {
    return { inserted: [] };
  }

  const keys = uniqueIncoming.map((i) => i.key);

  // 3. Look up existing items in this list for this user with same normalized_text.
  const { data: existing, error: existingError } = await supabaseAdmin!
    .from('list_items')
    .select('normalized_text')
    .eq('app_user_id', appUserId)
    .eq('list_id', listId)
    .is('deleted_at', null)
    .in('normalized_text', keys);

  if (existingError) {
    console.error('[listItems.insertListItems] Failed to fetch existing items', existingError);
    return { inserted: [] };
  }

  const existingKeys = new Set<string>((existing ?? []).map((row: { normalized_text: string }) => row.normalized_text));

  // 4. Build rows only for keys that do not already exist.
  const rowsToInsert = uniqueIncoming
    .filter((item) => !existingKeys.has(item.key))
    .map((item) => ({
      app_user_id: appUserId,
      list_id: listId,
      text: item.text,
      normalized_text: item.key,
      source,
      is_done: false,
    }));

  if (rowsToInsert.length === 0) {
    return { inserted: [] };
  }

  const { data, error } = await supabaseAdmin!
    .from('list_items')
    .insert(rowsToInsert)
    .select('id, list_id, text, is_done, source, created_at, updated_at, deleted_at');

  if (error) {
    console.error('[listItems.insertListItems] Failed to insert items', error);
    return { inserted: [] };
  }

  return {
    inserted: (data ?? []) as ListItem[],
  };
}

type UpdateListItemParams = {
  itemId: string;
  appUserId: string;
  is_done?: boolean;
  text?: string;
};

export async function updateListItem(
  params: UpdateListItemParams
): Promise<ListItem | null> {
  const { itemId, appUserId, is_done, text } = params;

  const updates: Record<string, unknown> = {};

  if (typeof is_done === 'boolean') {
    updates.is_done = is_done;
  }

  if (typeof text === 'string') {
    const trimmed = text.trim();
    if (!trimmed) {
      // Do not allow empty text updates; treat as no-op for text field.
    } else {
      updates.text = trimmed;
      updates.normalized_text = normalizeKey(trimmed);
    }
  }

  if (Object.keys(updates).length === 0) {
    return null;
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin!
    .from('list_items')
    .update(updates)
    .eq('id', itemId)
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    .select('id, list_id, text, is_done, source, created_at, updated_at, deleted_at')
    .maybeSingle<ListItem>();

  if (error) {
    console.error('[listItems.updateListItem] Failed to update item', error);
    return null;
  }

  return data ?? null;
}

type SoftDeleteListItemParams = {
  itemId: string;
  appUserId: string;
};

export async function softDeleteListItem(
  params: SoftDeleteListItemParams
): Promise<boolean> {
  const { itemId, appUserId } = params;

  const { data, error } = await supabaseAdmin!
    .from('list_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    console.error('[listItems.softDeleteListItem] Failed to soft delete item', error);
    return false;
  }

  return !!data?.length;
}

type FindListItemByTextParams = {
  appUserId: string;
  listId: string;
  text: string;
};

export async function findListItemByText(
  params: FindListItemByTextParams
): Promise<{ id: string; list_id: string; text: string } | null> {
  const { appUserId, listId, text } = params;
  const key = normalizeKey(text);

  const { data, error } = await supabaseAdmin!
    .from('list_items')
    .select('id, list_id, text')
    .eq('app_user_id', appUserId)
    .eq('list_id', listId)
    .eq('normalized_text', key)
    .is('deleted_at', null)
    .maybeSingle<{ id: string; list_id: string; text: string }>();

  if (error) {
    console.error('[listItems.findListItemByText] Failed to find item', error);
    return null;
  }

  return data ?? null;
}

export async function findListItemByTextAcrossLists(
  appUserId: string,
  text: string
): Promise<{ id: string; list_id: string; text: string } | null> {
  const key = normalizeKey(text);

  const { data, error } = await supabaseAdmin!
    .from('list_items')
    .select('id, list_id, text')
    .eq('app_user_id', appUserId)
    .eq('normalized_text', key)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; list_id: string; text: string }>();

  if (error) {
    console.error('[listItems.findListItemByTextAcrossLists] Failed to find item across lists', error);
    return null;
  }

  return data ?? null;
}

