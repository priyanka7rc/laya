/**
 * Durable per-user WhatsApp conversation state.
 *
 * Replaces the in-memory `userFocusStore` Map in whatsapp-processor.ts.
 * One row per auth_user_id in `wa_conversation_state`, upserted on every
 * meaningful turn so active-object context survives server restarts and
 * works correctly in horizontally-scaled deployments.
 *
 * Intended usage in whatsapp-processor.ts:
 *   const convState = await getConversationState(userId);   // once per turn
 *   // ...handlers read convState...
 *   await upsertConversationState(userId, { active_task_id: t.id, ... });
 */

import 'server-only';
import { createClient } from '@supabase/supabase-js';

// ---- Supabase client (service role, same pattern as other server helpers) ----
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// TYPES
// ============================================

/**
 * Serialisable payload for a pending destructive action or list-disambiguation prompt.
 * Stored as jsonb in wa_conversation_state.pending_confirmation.
 *
 * Three subtypes:
 *  - task_delete:    user said "delete X"; we asked "Delete X? YES/NO"
 *  - list_item_remove: user said "remove Y from Z"; we asked "Remove Y? YES/NO"
 *  - list_disambig:  user said "create X list"; an existing list with a similar name exists
 */
export type PendingConfirmation =
  | { type: 'task_delete'; taskId: string; taskTitle: string; message: string }
  | { type: 'list_item_remove'; item: string; listId: string | null; listName: string | null; message: string }
  | { type: 'list_disambig'; existingListId: string; existingListName: string; newListName: string; items: string[]; message: string }
  | { type: 'translation'; originalText: string; translatedText: string; message: string };

export interface WaConversationState {
  auth_user_id: string;
  /** ID of the last task created or edited — follow-up target for "make it Friday". */
  active_task_id: string | null;
  /** ID of the last list created or modified — follow-up target for "add curd too". */
  active_list_id: string | null;
  /** Human-readable title for the active task (confirmation messages, pronoun hints). */
  last_task_title: string | null;
  /** Human-readable name for the active list. */
  last_list_name: string | null;
  /**
   * Last salient noun phrase from any capture.
   * Used for "add it to shopping" → we know "it" = last_entity_text.
   * Usually set to the task title of the last created task.
   */
  last_entity_text: string | null;
  /**
   * Pending action awaiting YES/NO confirmation (destructive) or ADD/NEW
   * (list disambiguation). Cleared on every confirmation response.
   */
  pending_confirmation: PendingConfirmation | null;
  updated_at: string;
  expires_at: string | null;
}

export type WaConversationStatePatch = Partial<
  Omit<WaConversationState, 'auth_user_id' | 'updated_at'>
>;

// 2-hour TTL matching the wa_pending_actions edit expiry
const CONVERSATION_STATE_TTL_MS = 2 * 60 * 60 * 1000;

// ============================================
// HELPERS
// ============================================

/**
 * Read the current conversation state for a user.
 * Returns null if no row exists or if the row has expired.
 */
export async function getConversationState(
  authUserId: string
): Promise<WaConversationState | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('wa_conversation_state')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle<WaConversationState>();

  if (error || !data) return null;

  // Treat expired rows as null so callers never act on stale context
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return data;
}

/**
 * Upsert conversation state for a user.
 * Always refreshes `updated_at` and resets `expires_at` to now + 2 h.
 * Only the keys present in `patch` are written; other columns are left unchanged.
 */
export async function upsertConversationState(
  authUserId: string,
  patch: WaConversationStatePatch
): Promise<void> {
  const supabase = getSupabase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONVERSATION_STATE_TTL_MS).toISOString();

  await supabase
    .from('wa_conversation_state')
    .upsert(
      {
        auth_user_id: authUserId,
        ...patch,
        updated_at: now.toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: 'auth_user_id' }
    );
}

/**
 * Clear all active-object fields for a user (mode-agnostic reset).
 * Call this after a task query (context reset) or explicit "cancel".
 * Keeps the row alive so we can track the TTL; nulls all entity fields.
 */
export async function clearConversationState(authUserId: string): Promise<void> {
  await upsertConversationState(authUserId, {
    active_task_id: null,
    active_list_id: null,
    last_task_title: null,
    last_list_name: null,
    last_entity_text: null,
    pending_confirmation: null,
  });
}
