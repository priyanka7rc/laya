import 'server-only';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface InsertListParams {
  appUserId: string;
  name: string;
  source: string;
  sourceMessageId?: string | null;
  /** Candidates for later list-item conversion (Feature #17/#19); stored in import_candidates. */
  importCandidates?: string[] | null;
  isSystem?: boolean;
  systemKey?: string | null;
}

export interface ListRow {
  id: string;
  app_user_id: string;
  name: string;
  source: string;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  import_candidates?: any;
  is_system?: boolean;
  system_key?: string | null;
}

export async function insertListWithIdempotency(
  params: InsertListParams
): Promise<{ list: ListRow }> {
  const { appUserId, source, sourceMessageId } = params;
  const name = params.name.trim();

  // IDEMPOTENCY + SOFT DELETE CONTRACT:
  // - A UNIQUE partial index enforces (app_user_id, source, source_message_id)
  //   only for rows where deleted_at IS NULL.
  // - This helper also scopes its idempotency check to deleted_at IS NULL.
  // - If a row is soft-deleted, a subsequent insert with the same
  //   (app_user_id, source, source_message_id) will create a NEW row and will
  //   NOT violate the unique constraint, because the deleted row is excluded
  //   from the index.

  if (!name) {
    throw new Error('List name cannot be empty.');
  }

  if (sourceMessageId) {
    const { data: existing, error: existingErr } = await supabase
      .from('lists')
      .select('*')
      .eq('app_user_id', appUserId)
      .eq('source', source)
      .eq('source_message_id', sourceMessageId)
      .is('deleted_at', null)
      .maybeSingle<ListRow>();

    if (existingErr) {
      console.error('[lists][insert] idempotency check error', existingErr);
      throw new Error('Failed to check existing list');
    }

    if (existing) {
      return { list: existing };
    }
  }

  const insertPayload = {
    app_user_id: appUserId,
    name,
    source,
    source_message_id: sourceMessageId ?? null,
    import_candidates:
      params.importCandidates != null && Array.isArray(params.importCandidates)
        ? params.importCandidates
        : null,
    is_system: params.isSystem ?? false,
    system_key: params.systemKey ?? null,
  };

  const { data, error } = await supabase
    .from('lists')
    .insert(insertPayload)
    .select('*')
    .maybeSingle<ListRow>();

  if (error || !data) {
    console.error('[lists][insert] insert error', error);
    throw new Error('Failed to create list');
  }

  return { list: data };
}

