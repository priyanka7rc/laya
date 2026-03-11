import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { insertListWithIdempotency, type ListRow } from '@/server/lists/insertListWithIdempotency';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface GetOrCreateSystemListParams {
  appUserId: string;
  systemKey: 'inbox';
  defaultName: string;
}

export async function getOrCreateSystemList(
  params: GetOrCreateSystemListParams
): Promise<ListRow> {
  const { appUserId, systemKey, defaultName } = params;

  const { data: existing, error: existingErr } = await supabase
    .from('lists')
    .select('*')
    .eq('app_user_id', appUserId)
    .eq('system_key', systemKey)
    .is('deleted_at', null)
    .maybeSingle<ListRow>();

  if (existingErr) {
    console.error('[lists][system] lookup error', existingErr);
    throw new Error('Failed to load system list');
  }

  if (existing) {
    return existing;
  }

  const { list } = await insertListWithIdempotency({
    appUserId,
    name: defaultName,
    source: 'system',
    sourceMessageId: `system:${systemKey}`,
    importCandidates: null,
    isSystem: true,
    systemKey,
  });

  return list;
}

