/**
 * Server list queries for WhatsApp list-read (Features 18.4–18.6).
 * Uses service role for server-side access; scope by app_user_id where applicable.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type ListWithItemCount = {
  id: string;
  name: string;
  item_count: number;
};

export type ListInfo = {
  id: string;
  name: string;
};

export type GetListByNameResult =
  | ListInfo
  | { type: 'multiple'; lists: ListInfo[] }
  | null;

export type ListItemRow = {
  id: string;
  text: string;
  is_done: boolean;
  created_at: string;
};

const LISTS_LIMIT = 10;
const ITEMS_LIMIT = 20;

/**
 * Get user's lists with item counts.
 * Ordered by created_at DESC, limited to 10.
 */
export async function getUserLists(appUserId: string): Promise<ListWithItemCount[]> {
  const { data: lists, error } = await supabase
    .from('lists')
    .select('id, name, created_at')
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(LISTS_LIMIT);

  if (error || !lists) {
    console.error('[listQueries][getUserLists] error', error);
    return [];
  }

  if (lists.length === 0) return [];

  const listIds = lists.map((l) => l.id);
  const { data: counts } = await supabase
    .from('list_items')
    .select('list_id')
    .in('list_id', listIds)
    .is('deleted_at', null);

  const countMap = new Map<string, number>();
  for (const row of counts ?? []) {
    const lid = (row as { list_id: string }).list_id;
    countMap.set(lid, (countMap.get(lid) ?? 0) + 1);
  }

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    item_count: countMap.get(l.id) ?? 0,
  }));
}

const DISAMBIGUATION_LIMIT = 5;

/**
 * Find a list by name (exact match first, then ilike contains).
 * Returns single list, multiple (for disambiguation), or null.
 */
export async function getListByName(
  appUserId: string,
  name: string
): Promise<GetListByNameResult> {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return null;

  // 1. Exact match (case-insensitive via ilike with no wildcards)
  const { data: exact } = await supabase
    .from('lists')
    .select('id, name')
    .eq('app_user_id', appUserId)
    .ilike('name', trimmed)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (exact) return { id: exact.id, name: exact.name };

  // 2. Contains match — fetch all matches, up to DISAMBIGUATION_LIMIT
  const { data: contains } = await supabase
    .from('lists')
    .select('id, name')
    .eq('app_user_id', appUserId)
    .ilike('name', `%${trimmed}%`)
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(DISAMBIGUATION_LIMIT);

  const lists = (contains ?? []) as ListInfo[];
  if (lists.length === 0) return null;
  if (lists.length === 1) return lists[0]!;
  return { type: 'multiple', lists };
}

/**
 * Get list items for a list.
 * Order: is_done ASC, created_at DESC; limit 20.
 */
export async function getListItems(listId: string): Promise<ListItemRow[]> {
  const { data, error } = await supabase
    .from('list_items')
    .select('id, text, is_done, created_at')
    .eq('list_id', listId)
    .is('deleted_at', null)
    .order('is_done', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(ITEMS_LIMIT);

  if (error || !data) {
    console.error('[listQueries][getListItems] error', error);
    return [];
  }

  return data as ListItemRow[];
}

/**
 * Soft-delete (set deleted_at) all completed items in a list.
 * Returns the number of items that were deleted.
 */
export async function deleteCompletedItems(listId: string): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('list_items')
    .update({ deleted_at: now })
    .eq('list_id', listId)
    .eq('is_done', true)
    .is('deleted_at', null)
    .select('id');

  if (error) {
    console.error('[listQueries][deleteCompletedItems] error', error);
    return 0;
  }

  return (data ?? []).length;
}
