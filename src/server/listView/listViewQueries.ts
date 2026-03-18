import { createClient } from '@supabase/supabase-js';
import { ListViewList, ListViewPageInfo, ListViewResult } from '@/lib/listView/contracts';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type DbListRow = {
  id: string;
  app_user_id: string;
  name: string;
  source: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

function mapRowToList(row: DbListRow): ListViewList {
  return {
    id: row.id,
    appUserId: row.app_user_id,
    name: row.name,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildPageInfo(rows: DbListRow[], limit: number): ListViewPageInfo {
  const hasMore = rows.length === limit;
  let nextCursor: string | null = null;
  if (hasMore) {
    const last = rows[rows.length - 1]!;
    // Cursor encodes the exact tuple used for ordering:
    // ORDER BY updated_at DESC, id DESC
    const payload = { updatedAt: last.updated_at, id: last.id };
    nextCursor = Buffer.from(JSON.stringify(payload)).toString('base64');
  }
  return { hasMore, nextCursor };
}

function applyCursor<T>(query: T, cursor?: string | null): T {
  if (!cursor) return query;
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { updatedAt: string; id: string };
    // Tuple pagination rule (stable, no duplicates/holes):
    // We page with ORDER BY updated_at DESC, id DESC, so the "next page"
    // must satisfy (updated_at, id) < (cursor.updatedAt, cursor.id).
    // Implemented as:
    //   updated_at < cursor.updatedAt
    //   OR (updated_at = cursor.updatedAt AND id < cursor.id)
    return (query as any).or(
      `updated_at.lt.${parsed.updatedAt},and(updated_at.eq.${parsed.updatedAt},id.lt.${parsed.id})`
    );
  } catch {
    return query;
  }
}

export async function queryAllLists(
  appUserId: string,
  cursor?: string | null,
  limit = 50
): Promise<ListViewResult> {
  let query = supabase
    .from('lists')
    .select('*')
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    // Deterministic ordering for pagination: updated_at DESC, id DESC.
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false });

  query = applyCursor(query, cursor).limit(limit);

  const { data, error } = await query;

  if (error || !data) {
    console.error('[listView][queryAllLists] error', error);
    return { lists: [], pageInfo: { hasMore: false } };
  }

  const rows = data as DbListRow[];
  const listIds = rows.map((r) => r.id);

  // Attach item counts per list
  const countMap = new Map<string, { total: number; done: number }>();
  if (listIds.length > 0) {
    const { data: items } = await supabase
      .from('list_items')
      .select('list_id, is_done')
      .in('list_id', listIds)
      .is('deleted_at', null);
    for (const row of items ?? []) {
      const r = row as { list_id: string; is_done: boolean };
      const cur = countMap.get(r.list_id) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (r.is_done) cur.done += 1;
      countMap.set(r.list_id, cur);
    }
  }

  const lists: ListViewList[] = rows.map((row) => {
    const list = mapRowToList(row);
    const counts = countMap.get(row.id);
    if (counts) {
      list.itemCount = counts.total;
      list.doneCount = counts.done;
    }
    return list;
  });
  const pageInfo = buildPageInfo(rows, limit);
  return { lists, pageInfo };
}

