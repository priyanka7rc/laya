/**
 * WhatsApp Message Processor
 * Core pipeline for processing incoming WhatsApp messages
 * 
 * Flow:
 * 1. Lookup/create user by phone number
 * 2. Save inbound message to database
 * 3. Transcribe audio if needed
 * 4. Get conversation context
 * 5. Process with Laya brain
 * 6. Save structured data (tasks, groceries, moods)
 * 7. Save outbound message
 * 8. Send WhatsApp reply
 */

import { createClient } from '@supabase/supabase-js';
import { detectCategory } from './categories';
import { toHHMM } from './taskRulesParser';
import { processWithLaya, ConversationMessage } from './laya-brain';
import { transcribeAudioFromWhatsApp } from './openai';
import { sendWhatsAppMessage } from './whatsapp-client';
import { splitBrainDump } from './brainDumpParser';
import { textToProposedTasksFromSegments, type ProposedTask } from './task_intake';
import { insertTasksWithDedupe } from '@/server/tasks/insertTasksWithDedupe';
import { ocrTextToProposedTasks } from './ocrCandidates';
import { buildOcrImportPreview } from '@/lib/ocr_import_preview';
import { getOrCreateSystemList } from '@/server/lists/getOrCreateSystemList';
import { insertListWithIdempotency } from '@/server/lists/insertListWithIdempotency';
import { getOcrClient } from '@/server/ocr';
import { TASK_SOURCES } from './taskSources';
import { executeTaskView } from '@/server/taskView/taskViewEngine';
import { formatTaskListForQuery, formatDigestFromResult } from '@/lib/taskView/formatters/whatsapp';
import { computeDueAtFromLocal, computeRemindAtFromDueAt, DEFAULT_TZ } from '@/lib/tasks/schedule';
import { getUserTimezoneByAuthUserId } from '@/server/tasks/getUserTimezone';
import { deleteTasks, undoDelete } from '@/server/tasks/deleteTasks';
import {
  parseDeleteIntent,
  formatDeleteConfirmation,
  formatUndoConfirmation,
  formatDeleteAmbiguityPrompt,
  formatDeleteConfirmRequest,
  isWithinUndoWindow,
} from '@/lib/waDeleteParser';
import {
  parseEditSelectionIntent,
  parseEditPatch,
  isPendingEditExpired,
  PENDING_EDIT_EXPIRY_MS,
} from '@/lib/waEditParser';
import { updateTaskFields } from '@/server/tasks/updateTaskFields';
import { detectAddToListIntent, parseDoneRemoveIntent, splitItemPhrase } from '@/lib/waAddToListParser';
import {
  detectClearCompletedIntent,
  detectShowListsIntent,
  detectShowSpecificListIntent,
  formatListSummary,
  formatListPreview,
} from '@/lib/waListReadParser';
import {
  type ListInfo,
  getUserLists,
  getListByName,
  deleteCompletedItems,
  getListItems,
} from '@/server/listQueries';
import {
  insertListItems,
  findListItemByText,
  findListItemByTextAcrossLists,
  updateListItem,
  softDeleteListItem,
} from '@/lib/listItems';

// ============================================
// SUPABASE CLIENT
// ============================================

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for backend operations
);

const TASK_QUERY_PHRASES = [
  'tasks',
  'my tasks',
  'show tasks',
  'show my tasks',
  'today',
  'show today',
];

const QUICK_ADD_EXPIRY_MS = 5 * 60 * 1000;
const QUICK_ADD_EXIT_PHRASES = ['done', 'exit', 'cancel', 'remove', 'help'];

// ============================================
// CONVERSATIONAL FOCUS STORE
// ============================================

interface FocusState {
  taskId: string;
  setAt: Date;
}

// In-memory store for current focus per user
// TTL: 2 hours (generous, cleared explicitly on new task/query)
const userFocusStore = new Map<string, FocusState>();

function setFocus(userId: string, taskId: string): void {
  userFocusStore.set(userId, { taskId, setAt: new Date() });
  console.log(`[WA] Focus: set | userId=${userId} | taskId=${taskId}`);
}

function getFocus(userId: string): string | null {
  const focus = userFocusStore.get(userId);
  if (!focus) return null;
  
  // Check TTL (2 hours)
  const twoHoursAgo = new Date();
  twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
  
  if (focus.setAt < twoHoursAgo) {
    userFocusStore.delete(userId);
    console.log(`[WA] Focus: expired | userId=${userId}`);
    return null;
  }
  
  return focus.taskId;
}

function clearFocus(userId: string, reason: string): void {
  userFocusStore.delete(userId);
  console.log(`[WA] Focus: cleared | userId=${userId} | reason=${reason}`);
}

// ============================================
// LIST ACTION COUNTER
// ============================================

// Per-user-per-list action counter; show list preview every 3 actions
const listActionCounterStore = new Map<string, { counter: number; listName: string }>();

function incrementListActionCounter(userId: string, listId: string, listName: string): number {
  const key = `${userId}:${listId}`;
  const entry = listActionCounterStore.get(key) ?? { counter: 0, listName };
  entry.counter += 1;
  listActionCounterStore.set(key, entry);
  return entry.counter;
}

function resetListActionCounter(userId: string, listId: string): void {
  listActionCounterStore.delete(`${userId}:${listId}`);
}

async function maybeSendListPreviewAfterAction(
  userId: string,
  phoneNumber: string,
  listId: string,
  listName: string
): Promise<void> {
  const counter = incrementListActionCounter(userId, listId, listName);
  if (counter >= 3) {
    resetListActionCounter(userId, listId);
    const items = await getListItems(listId);
    const msg = formatListPreview(
      listName,
      items.length,
      items.map((i) => ({ text: i.text, is_done: i.is_done }))
    );
    const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
    await saveOutboundMessage({
      userId,
      content: msg,
      listIds: [listId],
      kind: 'list_preview',
      providerMessageId: sendResult?.providerMessageId,
    });
  }
}

// ============================================
// QUICK ADD MODE
// ============================================

type QuickAddPendingRow = {
  id: string;
  app_user_id: string;
  auth_user_id: string;
  payload: { listId: string; listName: string; addCount: number };
  expires_at: string;
};

async function getActiveQuickAdd(authUserId: string): Promise<QuickAddPendingRow | null> {
  const { data } = await supabase
    .from('wa_pending_actions')
    .select('id, app_user_id, auth_user_id, payload, expires_at')
    .eq('auth_user_id', authUserId)
    .eq('action_type', 'quick_add')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as QuickAddPendingRow | null;
}

async function clearQuickAdd(authUserId: string): Promise<void> {
  await supabase
    .from('wa_pending_actions')
    .delete()
    .eq('auth_user_id', authUserId)
    .eq('action_type', 'quick_add');
}

async function upsertQuickAdd(
  authUserId: string,
  appUserId: string,
  listId: string,
  listName: string,
  addCount: number
): Promise<void> {
  await clearQuickAdd(authUserId);
  const expiresAt = new Date(Date.now() + QUICK_ADD_EXPIRY_MS).toISOString();
  await supabase.from('wa_pending_actions').insert({
    auth_user_id: authUserId,
    app_user_id: appUserId,
    action_type: 'quick_add',
    task_id: null,
    expires_at: expiresAt,
    payload: { listId, listName, addCount },
  });
}

// ============================================
// TYPES
// ============================================

export interface IncomingMessage {
  phoneNumber: string;
  messageId: string;
  messageType: 'text' | 'audio' | 'image' | 'document';
  content: string | null; // Text content or null if audio/media
  audioId: string | null; // WhatsApp media ID for audio (Gupshup: direct URL)
  timestamp: string;
  rawPayload: any;
  replyToMessage?: string;
  /** For image/document: download URL for OCR (Gupshup: payload.payload.url) */
  mediaUrl?: string;
  /** MIME type when known (e.g. image/jpeg, application/pdf) */
  mediaMimeType?: string;
}

// ============================================
// MAIN PROCESSOR
// ============================================

/**
 * Process an incoming WhatsApp message
 */
export async function processWhatsAppMessage(message: IncomingMessage): Promise<void> {
  try {
    // Log inbound message details
    const textPreview = message.content 
      ? message.content.substring(0, 30) + (message.content.length > 30 ? '...' : '')
      : null;
    console.log(
      `[WA] Inbound | phone=${message.phoneNumber} | ` +
      `msgId=${message.messageId} | type=${message.messageType} | ` +
      `textLen=${message.content?.length || 0} | ` +
      `preview="${textPreview || 'N/A'}"`
    );

    // 1. Get or create user (returns auth_user_id or null)
    const userId = await getOrCreateUser(message.phoneNumber);
    if (!userId) {
      // User requires account linking
      console.log(`[WA] Route: LINKING | phone=${message.phoneNumber}`);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const linkUrl = `${appUrl}/link-whatsapp`;
      await sendWhatsAppMessage(
        message.phoneNumber,
        "👋 Welcome to Laya!\n\n" +
        "To get started, please link your account:\n\n" +
        `1. Visit: ${linkUrl}\n` +
        "2. Sign in (or create an account)\n" +
        `3. Enter this phone number: ${message.phoneNumber}\n\n` +
        "Then message me again and I'll be ready to help! 🌿"
      );
      return; // Exit early, don't process message
    }

    // 1b. Handle image/document: OCR → canonical intake → insert (wa_media)
    if ((message.messageType === 'image' || message.messageType === 'document') && message.mediaUrl) {
      await handleWhatsAppMedia(userId, message);
      return;
    }

    // 2. Get final text content (transcribe audio if needed)
    let finalText: string;
    let audioUrl: string | null = null;

    if (message.messageType === 'audio' && message.audioId) {
      console.log('🎤 Transcribing audio message...');
      // audioId for Gupshup is the direct media URL
      const transcription = await transcribeAudioFromWhatsApp(
        message.audioId,
        userId,
        message.messageId
      );
      finalText = transcription.text;
      audioUrl = transcription.audioUrl;
      console.log(`📝 Transcription: "${finalText}"`);
    } else if (message.content) {
      finalText = message.content;
    } else {
      console.error('❌ No content or audio to process');
      await sendWhatsAppMessage(
        message.phoneNumber,
        "I didn't add this as a task. If you want me to add it, just say add."
      );
      return;
    }

    // 2a. Handle active OCR import sessions (list name / confirm tasks)
    const pendingOcr = await getActivePendingOcrImport(userId);
    if (pendingOcr) {
      const handledOcr = await handleOcrImportPending(
        userId,
        pendingOcr,
        finalText,
        message.phoneNumber
      );
      if (handledOcr) {
        return;
      }
    }

    // 2b. Handle STOP/START opt-out commands
    const trimmedText = finalText.trim();
    const lowerTrimmed = trimmedText.toLowerCase();

    if (lowerTrimmed === 'stop' || lowerTrimmed === 'stopall' || lowerTrimmed === 'unsubscribe') {
      console.log(`[WA] Route: STOP-START (opt-out) | userId=${userId}`);
      
      // Update opted_out status
      const { error: optOutError } = await supabase
        .from('whatsapp_users')
        .update({ opted_out: true })
        .eq('phone_number', message.phoneNumber);
      
      if (optOutError) {
        console.error('Error updating opt-out status:', optOutError);
      }
      
      // Send confirmation (this is allowed even after opt-out)
      await sendWhatsAppMessage(
        message.phoneNumber,
        "You've been unsubscribed. You won't receive any more messages from Laya.\n\nTo start again, reply START."
      );
      return;
    }

    if (lowerTrimmed === 'start') {
      console.log(`[WA] Route: STOP-START (opt-in) | userId=${userId}`);
      
      // Update opted_out status
      const { error: optInError } = await supabase
        .from('whatsapp_users')
        .update({ opted_out: false })
        .eq('phone_number', message.phoneNumber);
      
      if (optInError) {
        console.error('Error updating opt-in status:', optInError);
      }
      
      // Send confirmation
      await sendWhatsAppMessage(
        message.phoneNumber,
        "Welcome back! You're all set to use Laya again. 🌿\n\nSend me a task and I'll help you stay on top of things."
      );
      return;
    }

    // 2b. Handle daily digest opt-in/opt-out
    const enableDigestPhrases = [
      'enable daily summary',
      'enable digest',
      'daily summary on',
      'turn on daily summary',
      'start daily summary',
      'yes daily summary',
    ];
    
    const disableDigestPhrases = [
      'disable daily summary',
      'disable digest',
      'daily summary off',
      'turn off daily summary',
      'stop daily summary',
      'no daily summary',
    ];

    const shouldEnableDigest = enableDigestPhrases.some(phrase => 
      lowerTrimmed.includes(phrase)
    );

    const shouldDisableDigest = disableDigestPhrases.some(phrase => 
      lowerTrimmed.includes(phrase)
    );

    if (shouldEnableDigest) {
      console.log(`[WA] Route: DIGEST-OPT-IN | userId=${userId}`);
      
      const { error: enableError } = await supabase
        .from('whatsapp_users')
        .update({ daily_digest_enabled: true })
        .eq('phone_number', message.phoneNumber);
      
      if (enableError) {
        console.error('Error enabling daily digest:', enableError);
      }
      
      await sendWhatsAppMessage(
        message.phoneNumber,
        "Daily summary enabled. You'll get a morning digest of your tasks each day. 🌅"
      );
      return;
    }

    if (shouldDisableDigest) {
      console.log(`[WA] Route: DIGEST-OPT-OUT | userId=${userId}`);
      
      const { error: disableError } = await supabase
        .from('whatsapp_users')
        .update({ daily_digest_enabled: false })
        .eq('phone_number', message.phoneNumber);
      
      if (disableError) {
        console.error('Error disabling daily digest:', disableError);
      }
      
      await sendWhatsAppMessage(
        message.phoneNumber,
        "Daily summary disabled."
      );
      return;
    }

    // 3. Save inbound message to database (this path is text/audio only; image/document returned earlier)
    const inboundMessageId = await saveInboundMessage({
      userId,
      messageType: message.messageType === 'image' || message.messageType === 'document' ? 'text' : message.messageType,
      content: finalText,
      audioUrl,
      rawPayload: message.rawPayload,
    });

    // 3a. Check for negative confirmation to pending clarification
    const isNegativeConfirmation = 
      lowerTrimmed === 'no' ||
      lowerTrimmed === 'not that' ||
      lowerTrimmed === 'never mind' ||
      lowerTrimmed === 'nevermind' ||
      lowerTrimmed === 'cancel';

    if (isNegativeConfirmation) {
      console.log('❌ Negative confirmation detected');
      const hadPendingClarification = await checkAndClearPendingClarification(userId, message.phoneNumber);
      if (hadPendingClarification) {
        return; // Exit early, already sent cancellation message
      }
      // If no pending clarification, continue with normal flow
    }

    // 3a-undo. UNDO handler: restore last deleted tasks within 5 min window
    if (lowerTrimmed === 'undo') {
      console.log(`[WA] Route: UNDO | userId=${userId}`);
      const { data: waUser } = await supabase
        .from('whatsapp_users')
        .select('last_deleted_task_ids, last_deleted_at, auth_user_id')
        .eq('phone_number', message.phoneNumber)
        .maybeSingle<{ last_deleted_task_ids: string[] | null; last_deleted_at: string | null; auth_user_id: string | null }>();

      const eligible = isWithinUndoWindow(waUser?.last_deleted_at ?? null, 5);

      if (!eligible || !waUser?.last_deleted_task_ids?.length) {
        await sendWhatsAppMessage(
          message.phoneNumber,
          "Nothing to undo right now — I only keep deletions in memory for 5 minutes."
        );
        return;
      }

      // Resolve app_user_id
      const { data: appUserRow } = await supabase
        .from('app_users')
        .select('id')
        .eq('auth_user_id', userId)
        .maybeSingle<{ id: string }>();

      if (!appUserRow?.id) {
        await sendWhatsAppMessage(message.phoneNumber, "Couldn't find your account to undo.");
        return;
      }

      const undoResult = await undoDelete({
        appUserId: appUserRow.id,
        taskIds: waUser.last_deleted_task_ids,
        withinMinutes: 5,
        authUserId: userId,
      });

      // Clear undo state
      await supabase
        .from('whatsapp_users')
        .update({ last_deleted_task_ids: null, last_deleted_at: null })
        .eq('phone_number', message.phoneNumber);

      const partialFailure = undoResult.notRestorableIds.length > 0 && undoResult.restoredIds.length > 0;
      await sendWhatsAppMessage(
        message.phoneNumber,
        formatUndoConfirmation(undoResult.restoredIds.length, partialFailure)
      );
      return;
    }

    // 3a-delete. DELETE intent handler
    const deleteIntent = parseDeleteIntent(finalText);
    if (deleteIntent && deleteIntent.kind !== 'undo') {
      console.log(`[WA] Route: DELETE | userId=${userId} | kind=${deleteIntent.kind}`);
      await handleTaskDelete(userId, finalText, message.phoneNumber, message.replyToMessage ?? null);
      return;
    }

    // 3a-edit-apply. Active pending edit: apply patch (idempotency by inbound message id)
    const editSelectionIntent = parseEditSelectionIntent(finalText);
    const activePending = await getActivePendingEdit(userId);
    if (activePending && !editSelectionIntent) {
      if (isPendingEditExpired(activePending.expires_at)) {
        await supabase.from('wa_pending_actions').delete().eq('id', activePending.id);
        await sendWhatsAppMessage(
          message.phoneNumber,
          "That edit session expired — reply to the task again with EDIT."
        );
        return;
      }
      if (activePending.last_inbound_provider_message_id === message.messageId) {
        // Idempotency: this inbound provider message was already applied; echo a friendly confirmation.
        await sendWhatsAppMessage(
          message.phoneNumber,
          "Already updated ✅ You’re all set."
        );
        return;
      }
      const tz = await getUserTimezoneByAuthUserId(userId);
      const patch = parseEditPatch(finalText, tz);
      const patchKeys = Object.keys(patch) as (keyof typeof patch)[];
      const hasPatch = patchKeys.some((k) => patch[k] !== undefined);
      if (!hasPatch) {
        await sendWhatsAppMessage(
          message.phoneNumber,
          "What do you want to change? Try: tomorrow 5pm, or rename to …"
        );
        return;
      }
      const updatePayload: Parameters<typeof updateTaskFields>[0]['patch'] = {};
      if (patch.title !== undefined) updatePayload.title = patch.title;
      if (patch.due_date !== undefined) updatePayload.due_date = patch.due_date;
      if (patch.due_time !== undefined) updatePayload.due_time = patch.due_time;
      if (patch.category !== undefined) updatePayload.category = patch.category;
      await supabase
        .from('wa_pending_actions')
        .update({ last_inbound_provider_message_id: message.messageId })
        .eq('id', activePending.id);
      const { updatedTask } = await updateTaskFields({
        appUserId: activePending.app_user_id,
        taskId: activePending.task_id,
        patch: updatePayload,
        timezone: tz,
        source: 'whatsapp',
        authUserId: userId,
      });
      const summary = formatEditConfirmation(updatedTask, patch);
      const sendResult = await sendWhatsAppMessage(message.phoneNumber, summary);
      if (!sendResult) {
        console.error('[wa_pending_actions] Failed to send edit confirmation; keeping pending row for retry.');
        return;
      }
      await supabase.from('wa_pending_actions').delete().eq('id', activePending.id);
      return;
    }

    // 3a-edit-select. Edit selection intent: reply-anchored or search fallback → create pending
    if (editSelectionIntent) {
      console.log(`[WA] Route: EDIT-SELECT | userId=${userId} | kind=${editSelectionIntent.kind}`);
      const handled = await handleEditSelect(
        userId,
        finalText,
        message.phoneNumber,
        message.replyToMessage ?? null,
        editSelectionIntent,
        message.messageId
      );
      if (handled) return;
    }

    // 3a-add-to-list-choose. Pending list disambiguation: user replies with 1, 2, etc.
    const pendingAddToList = await getActivePendingAddToListChoose(userId);
    if (pendingAddToList) {
      const numMatch = finalText.trim().match(/^\s*(\d+)\s*$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1]!, 10);
        const listIds = pendingAddToList.payload?.listIds ?? [];
        const listNames = pendingAddToList.payload?.listNames ?? [];
        const items = pendingAddToList.payload?.items ?? [];
        if (idx >= 1 && idx <= listIds.length && items.length > 0) {
          const targetListId = listIds[idx - 1]!;
          const targetListName = listNames[idx - 1] ?? 'list';
          const { inserted } = await insertListItems({
            appUserId: pendingAddToList.app_user_id,
            listId: targetListId,
            items,
            source: 'whatsapp',
          });
          await supabase.from('wa_pending_actions').delete().eq('id', pendingAddToList.id);
          if (inserted.length > 0) {
            const msg =
              inserted.length === 1
                ? `Added: ${inserted[0]!.text}`
                : `Added ${inserted.length} items:\n${inserted.map((i) => `• ${i.text}`).join('\n')}`;
            const sendResult = await sendWhatsAppMessage(message.phoneNumber, msg);
            await saveOutboundMessage({
              userId,
              content: msg,
              listIds: [targetListId],
              kind: 'list_add_confirm',
              providerMessageId: sendResult?.providerMessageId,
            });
            await maybeSendListPreviewAfterAction(userId, message.phoneNumber, targetListId, targetListName);
          } else {
            await sendWhatsAppMessage(message.phoneNumber, "No new items added.\nAll items already exist in the list.");
          }
          return;
        }
      }
      // Not a valid number or expired: clear stale pending and fall through
      await supabase.from('wa_pending_actions').delete().eq('id', pendingAddToList.id);
      await sendWhatsAppMessage(message.phoneNumber, "That list choice expired. Say \"add X to <list name>\" again.");
      return;
    }

    // 3a-quick-add. Quick Add Mode: plain text → add to list (after opening list)
    const activeQuickAdd = await getActiveQuickAdd(userId);
    if (activeQuickAdd) {
      const expired = !activeQuickAdd.expires_at || new Date(activeQuickAdd.expires_at).getTime() <= Date.now();
      if (expired) {
        await clearQuickAdd(userId);
      } else {
        const norm = finalText.trim().toLowerCase().replace(/\s+/g, ' ');
        const isExitPhrase = QUICK_ADD_EXIT_PHRASES.includes(norm);
        const explicitAddIntent = detectAddToListIntent(finalText);
        const isDoneRemove = parseDoneRemoveIntent(finalText);
        const isListCommand = detectShowListsIntent(finalText) || detectShowSpecificListIntent(finalText);
        const isTaskQuery =
          TASK_QUERY_PHRASES.includes(norm) ||
          (norm.includes('what') ||
            norm.includes('show') ||
            norm.includes('tell me') ||
            norm.includes('list') ||
            norm.includes('do i have'));

        // Exit only if: explicit add with a DIFFERENT list (add X to Y where Y != active list)
        const isAddToDifferentList =
          explicitAddIntent?.listName != null &&
          explicitAddIntent.listName.toLowerCase().trim() !==
            activeQuickAdd.payload.listName.toLowerCase().trim();

        if (isExitPhrase || isAddToDifferentList || isDoneRemove || isListCommand || isTaskQuery) {
          await clearQuickAdd(userId);
        } else {
          // Plain text or "add X" (no list) or "add X to <same list>" → treat as Quick Add
          const items = explicitAddIntent?.items ?? splitItemPhrase(finalText);
          if (items.length > 0) {
            const { listId, listName, addCount } = activeQuickAdd.payload;
            const appUserId = activeQuickAdd.app_user_id;
            const { inserted } = await insertListItems({
              appUserId,
              listId,
              items,
              source: 'whatsapp',
            });
            const newAddCount = addCount + inserted.length;
            await upsertQuickAdd(userId, appUserId, listId, listName, newAddCount);

            if (inserted.length > 0) {
              const addedMsg =
                inserted.length === 1
                  ? 'Added: ' + inserted[0]!.text
                  : `Added ${inserted.length} items:\n${inserted.map((i) => `• ${i.text}`).join('\n')}`;
              await sendWhatsAppMessage(message.phoneNumber, addedMsg);
              await maybeSendListPreviewAfterAction(userId, message.phoneNumber, listId, listName);
            } else {
              await sendWhatsAppMessage(message.phoneNumber, 'No new items added.\nAll items already exist in the list.');
            }
            console.log(`[WA] Route: QUICK-ADD | userId=${userId} | added=${inserted.length}`);
            return;
          }
        }
      }
    }

    // 3b-add-to-list. Add items to list (reply-anchored or by name)
    const addToListIntent = detectAddToListIntent(finalText);
    if (addToListIntent && addToListIntent.items.length > 0) {
      console.log(`[WA] Route: ADD-TO-LIST | userId=${userId} | items=${addToListIntent.items.length}`);
      const handled = await handleAddToList(
        userId,
        addToListIntent,
        message.phoneNumber,
        message.replyToMessage ?? null
      );
      if (handled) return;
    }

    // 3b-done-remove-incomplete. Reply-to-list preview: "done"/"remove" without item
    if (message.replyToMessage) {
      const isListPreview = await isReplyToListPreview(message.replyToMessage);
      if (isListPreview) {
        const norm = finalText.trim().toLowerCase().replace(/\s+/g, ' ');
        if (norm === 'done' || norm === 'remove') {
          await sendWhatsAppMessage(
            message.phoneNumber,
            `Reply with the item number or name.

Examples:
done 1
done milk
remove bread`
          );
          return;
        }
      }
    }

    // 3b-clear-completed. Reply-to-list preview: "clear completed" / "remove completed" / "delete completed"
    if (message.replyToMessage && detectClearCompletedIntent(finalText)) {
      const { data: replied } = await supabase
        .from('messages')
        .select('list_ids')
        .eq('provider_message_id', message.replyToMessage)
        .maybeSingle<{ list_ids: string[] | null }>();
      const listIds = replied?.list_ids ?? [];
      if (listIds.length >= 1) {
        const listId = listIds[0]!;
        const deletedCount = await deleteCompletedItems(listId);
        await sendWhatsAppMessage(
          message.phoneNumber,
          `Removed ${deletedCount} completed item${deletedCount === 1 ? '' : 's'}.`
        );
        return;
      }
    }

    // 3b-done-remove. Mark list item done or remove
    const doneRemoveIntent = parseDoneRemoveIntent(finalText);
    if (doneRemoveIntent) {
      console.log(`[WA] Route: LIST-ITEM-DONE-REMOVE | userId=${userId} | cmd=${doneRemoveIntent.command}`);
      const handled = await handleListItemDoneRemove(
        userId,
        doneRemoveIntent,
        message.phoneNumber,
        message.replyToMessage ?? null
      );
      if (handled) return;
    }

    // 3b-list-read. List read (show lists, show specific list, reply-anchored open)
    // Guard: bypass list-read for task query phrases so they reach handleTaskQuery
    const normalized = finalText.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!TASK_QUERY_PHRASES.includes(normalized)) {
      const listReadHandled = await handleListRead(
        userId,
        finalText,
        message.phoneNumber,
        message.replyToMessage ?? null
      );
      if (listReadHandled) return;
    }

    // 3c. Detect query intent
    const lowerText = finalText.toLowerCase();
    const isQuery = 
      lowerText.includes('what') ||
      lowerText.includes('show') ||
      lowerText.includes('tell me') ||
      lowerText.includes('list') ||
      lowerText.includes('do i have');

    if (isQuery) {
      console.log(`[WA] Route: QUERY | userId=${userId} | textLen=${finalText.length}`);
      await handleTaskQuery(userId, finalText, message.phoneNumber);
      return; // Exit early, don't create tasks
    }

    // 4. Get recent conversation context
    const context = await getConversationContext(userId);

    // 4a. If this is a reply, add the original message to context
    if (message.replyToMessage) {
      console.log(`↩️ User replying to: "${message.replyToMessage}"`);
      context.push({
        role: 'assistant',
        content: `[User is replying to: "${message.replyToMessage}"]`,
      });
    }

    // Log CREATE routing
    const focusBefore = getFocus(userId);
    console.log(
      `[WA] Route: CREATE | userId=${userId} | ` +
      `focusBefore=${focusBefore || 'null'} | textLen=${finalText.length}`
    );

    // 5. Rules-first task creation (no AI in task path)
    const proposedTasks = createTasksFromTextRules(finalText);
    let taskConfirmations: string[] = [];
    let createdTaskIds: string[] = [];
    if (proposedTasks.length > 0) {
      const result = await insertTasksWithDedupe({
        tasks: proposedTasks,
        userId,
        appUserId: null,
        allowDuplicateIndices: [],
        source: TASK_SOURCES.WHATSAPP_TEXT,
        sourceMessageId: inboundMessageId || null,
      });
      if (result.inserted.length > 0) {
        clearFocus(userId, 'new_task_created');
        const lastId = result.inserted[result.inserted.length - 1].id;
        setFocus(userId, lastId);
        taskConfirmations = formatTaskConfirmations(result.inserted);
        createdTaskIds = result.inserted.map((t) => t.id);
      }
      if (result.duplicates.length > 0) {
        console.log(`[WA] Dedupe: ${result.duplicates.length} duplicate(s) skipped`);
      }
    }

    // 6. Process with Laya brain (for reply tone, groceries, mood)
    console.log('🧠 Processing with Laya...');
    const layaResponse = await processWithLaya(finalText, context);
    console.log('💬 Laya response:', layaResponse.user_facing_response);

    // 7. Save non-task structured data only (groceries, mood; tasks already inserted above)
    await saveStructuredData(userId, inboundMessageId || '', {
      ...layaResponse.structured,
      tasks: [],
    });

    // 8. Build final response: task confirmations from rules path, else Laya reply
    let finalResponse = layaResponse.user_facing_response;
    if (taskConfirmations.length > 0) {
      finalResponse = taskConfirmations.join('\n');
    }

    // Log action result
    const focusAfter = getFocus(userId);
    console.log(
      `[WA] Result: created ${taskConfirmations.length} task confirmations | ` +
      `focusAfter=${focusAfter || 'null'}`
    );

    // 9. Send WhatsApp reply and persist outbound message with provider id + task_ids (if any)
    const sendResult = await sendWhatsAppMessage(message.phoneNumber, finalResponse);
    const providerMessageId = sendResult?.providerMessageId;
    if (!providerMessageId && createdTaskIds.length) {
      console.warn(
        '[WA][anchor] Missing providerMessageId for create_confirm; outbound message not anchorable.'
      );
    }
    await saveOutboundMessage({
      userId,
      content: finalResponse,
      taskIds: createdTaskIds.length ? createdTaskIds : undefined,
      kind: createdTaskIds.length ? 'create_confirm' : undefined,
      providerMessageId: providerMessageId,
    });

    console.log(
      `[WA] Outbound: free-form | phone=${message.phoneNumber} | ` +
      `msgLen=${finalResponse.length}`
    );
  } catch (error) {
    console.error('❌ Error in processWhatsAppMessage:', error);
    
    // Send error message to user
    try {
      await sendWhatsAppMessage(
        message.phoneNumber,
        "I didn't add this as a task. If you want me to add it, just say add."
      );
    } catch (sendError) {
      console.error('❌ Failed to send error message:', sendError);
    }
  }
}

// ============================================
// DATABASE OPERATIONS
// ============================================

/**
 * Get or create WhatsApp user by phone number
 * Returns auth_user_id if linked, null if linking required
 */
async function getOrCreateUser(phoneNumber: string): Promise<string | null> {
  try {
    // Look up whatsapp_users record
    const { data: whatsappUser } = await supabase
      .from('whatsapp_users')
      .select('id, auth_user_id')
      .eq('phone_number', phoneNumber)
      .maybeSingle();

    // If user doesn't exist, create whatsapp_users record (unlinked)
    if (!whatsappUser) {
      const { data: newUser, error } = await supabase
        .from('whatsapp_users')
        .insert({ 
          phone_number: phoneNumber,
          daily_digest_enabled: false,
        })
        .select('id, auth_user_id')
        .single();

      if (error) {
        console.error('Error creating WhatsApp user:', error);
        return null;
      }

      console.log(`📱 Created new unlinked WhatsApp user: ${phoneNumber}`);
      return null; // Requires linking
    }

    // If user exists but NOT linked, return null
    if (!whatsappUser.auth_user_id) {
      console.log(`⚠️ WhatsApp user ${phoneNumber} requires linking`);
      return null;
    }

    // Update last_active and return auth_user_id
    await supabase
      .from('whatsapp_users')
      .update({ last_active: new Date().toISOString() })
      .eq('id', whatsappUser.id);

    return whatsappUser.auth_user_id; // ✅ Returns auth.users.id
  } catch (error) {
    console.error('Error in getOrCreateUser:', error);
    return null;
  }
}

/**
 * Save inbound message to database
 */
async function saveInboundMessage(params: {
  userId: string;
  messageType: 'text' | 'audio';
  content: string;
  audioUrl: string | null;
  rawPayload: any;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: params.userId,
        channel: 'whatsapp',
        direction: 'inbound',
        message_type: params.messageType,
        role: 'user',
        content: params.content,
        audio_url: params.audioUrl,
        raw_payload: params.rawPayload,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error saving inbound message:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error('Error in saveInboundMessage:', error);
    return null;
  }
}

/**
 * Save outbound message to database.
 * Optionally persist task_ids, list_ids (for reply-based delete/add-to-list), kind,
 * and providerMessageId (Gupshup messageId) so inbound replies can look up
 * the corresponding row via provider_message_id.
 */
async function saveOutboundMessage(params: {
  userId: string;
  content: string;
  taskIds?: string[];
  listIds?: string[];
  kind?: string;
  providerMessageId?: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: params.userId,
        channel: 'whatsapp',
        direction: 'outbound',
        message_type: 'text',
        role: 'bot',
        content: params.content,
        task_ids: params.taskIds ? params.taskIds : null,
        list_ids: params.listIds ? params.listIds : null,
        kind: params.kind ?? null,
        provider_message_id: params.providerMessageId ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error saving outbound message:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error('Error in saveOutboundMessage:', error);
    return null;
  }
}

/**
 * Get recent conversation context for a user
 * Configurable via environment variables:
 * - CONVERSATION_CONTEXT_ENABLED: true/false
 * - CONVERSATION_CONTEXT_HOURS: number of hours to look back (default: 48)
 * - CONVERSATION_CONTEXT_MAX_MESSAGES: max messages to load (default: 20)
 */
async function getConversationContext(userId: string): Promise<ConversationMessage[]> {
  try {
    // Check if context is enabled
    const contextEnabled = process.env.CONVERSATION_CONTEXT_ENABLED !== 'false';
    if (!contextEnabled) {
      console.log('📭 Conversation context disabled');
      return [];
    }

    // Get configuration
    const contextHours = parseInt(process.env.CONVERSATION_CONTEXT_HOURS || '48', 10);
    const maxMessages = parseInt(process.env.CONVERSATION_CONTEXT_MAX_MESSAGES || '20', 10);

    // Calculate time threshold
    const hoursAgo = new Date(Date.now() - contextHours * 60 * 60 * 1000).toISOString();

    console.log(`📚 Loading context: last ${contextHours}hrs, max ${maxMessages} messages`);

    const { data, error } = await supabase
      .from('messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .gte('created_at', hoursAgo)
      .order('created_at', { ascending: false })
      .limit(maxMessages);

    if (error) {
      console.error('Error fetching conversation context:', error);
      return [];
    }

    const contextMessages = (data || [])
      .reverse()
      .map((msg) => ({
        role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.content,
      }));

    console.log(`📊 Loaded ${contextMessages.length} context messages`);
    return contextMessages;
  } catch (error) {
    console.error('Error in getConversationContext:', error);
    return [];
  }
}

/** Max segments for WA brain-dump (same order as web). */
const WA_BRAIN_DUMP_MAX = 50;

/**
 * Parse message text into ProposedTask[] using rules-only (Feature #1). Single line → one task; multi-line → splitBrainDump + textToProposedTasksFromSegments.
 */
function createTasksFromTextRules(text: string): ProposedTask[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const segments = splitBrainDump(trimmed);
  const raw = segments.length > 0 ? segments : [trimmed];
  return textToProposedTasksFromSegments(raw, { maxCandidates: WA_BRAIN_DUMP_MAX });
}

/**
 * Format inserted tasks into WhatsApp confirmation lines (same style as before).
 */
function formatTaskConfirmations(inserted: Array<{ title: string; due_date: string | null; due_time: string | null }>): string[] {
  const confirmations: string[] = [];
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  for (const task of inserted) {
    let line = `✅ Added: ${task.title}`;
    if (task.due_date === today && task.due_time) line += ` (today at ${task.due_time})`;
    else if (task.due_date === today) line += ' (today)';
    else if (task.due_date === tomorrowStr && task.due_time) line += ` (tomorrow at ${task.due_time})`;
    else if (task.due_date === tomorrowStr) line += ' (tomorrow)';
    else if (task.due_date && task.due_time) line += ` (${task.due_date} at ${task.due_time})`;
    else if (task.due_date) line += ` (${task.due_date})`;
    confirmations.push(line);
  }
  return confirmations;
}

/**
 * Handle WhatsApp image/document: download → OCR → canonical intake → insertTasksWithDedupe (source: wa_media).
 */
async function handleWhatsAppMedia(
  userId: string,
  message: IncomingMessage
): Promise<void> {
  const { phoneNumber, messageId, mediaUrl, mediaMimeType } = message;
  if (!mediaUrl) return;

  try {
    const res = await fetch(mediaUrl);
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);
    const mimeType = mediaMimeType || res.headers.get('content-type') || 'image/jpeg';
    const filename = mediaUrl.split('/').pop()?.split('?')[0] || 'wa-media';

    const ocrClient = getOcrClient();
    const ocrResult = await ocrClient.extract({
      bytes,
      mimeType,
      filename,
      maxPages: 5, // Limit pages to prevent runaway OCR cost and latency.
    });

    const MAX_OCR_CHARS = 15000;
    let fullText = ocrResult.fullText || '';
    let truncated = false;
    if (fullText.length > MAX_OCR_CHARS) {
      fullText = fullText.slice(0, MAX_OCR_CHARS);
      truncated = true;
    }

    if (truncated) {
      await sendWhatsAppMessage(
        phoneNumber,
        'Document too long. Showing first portion only.'
      );
    }

    const preview = buildOcrImportPreview(fullText);

    if (preview.task_count === 0 && preview.list_count === 0) {
      await sendWhatsAppMessage(
        phoneNumber,
        "I couldn't find anything actionable in that image or document. Try a clearer photo or paste the text instead."
      );
      return;
    }

    const { data: appUser } = await supabase
      .from('app_users')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle<{ id: string }>();

    if (!appUser?.id) {
      await sendWhatsAppMessage(phoneNumber, "I couldn't find your account. Try linking again.");
      return;
    }

    const appUserId = appUser.id;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const payload = {
      // Stable import key for this media OCR session. For WhatsApp, we use the
      // inbound provider message id, which is stable across retries.
      mediaId: messageId || null,
      preview,
    };

    await supabase
      .from('wa_pending_actions')
      .delete()
      .eq('auth_user_id', userId)
      .in('action_type', ['ocr_import_list_name', 'ocr_import_confirm_tasks']);

    await supabase.from('wa_pending_actions').insert({
      auth_user_id: userId,
      app_user_id: appUserId,
      action_type: 'ocr_import_list_name',
      source_provider_message_id: messageId || null,
      expires_at: expiresAt,
      payload,
    });

    const summary = `[WA][OCR_IMPORT] Found ${preview.task_count} strong task(s), ${preview.list_count} list item(s), ` +
      `${preview.ambiguous_count} ambiguous line(s) treated as list items.`;
    console.log(summary);

    const suggestions = preview.proposedList.suggested_names.slice(0, 3);
    let msg = `I found ${preview.task_count} tasks and ${preview.list_count} list items`;
    if (preview.ambiguous_count > 0) {
      msg += ` (${preview.ambiguous_count} ambiguous saved as list items)`;
    }
    msg += `.\n\nReply with a list name, or reply INBOX to save and sort later.`;

    if (suggestions.length > 0) {
      const lines = suggestions.map((name, idx) => `${idx + 1}) ${name}`);
      msg += `\n\nSuggestions:\n${lines.join('\n')}`;
    }

    const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
    const providerMessageId = sendResult?.providerMessageId;
    await saveOutboundMessage({
      userId,
      content: msg,
      kind: 'ocr_import_prompt',
      providerMessageId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'OCR failed';
    console.error('[WA] Media OCR error:', e);
    if (msg.includes('Too many items')) {
      await sendWhatsAppMessage(phoneNumber, 'Too many items in that image — crop or send fewer pages.');
    } else {
      await sendWhatsAppMessage(phoneNumber, "I couldn't read that image or document. Try a clearer photo or paste the text instead.");
    }
  }
}

/**
 * Save structured data extracted from message (groceries, mood only; tasks are created via rules-first path).
 * Returns confirmation messages for created items (tasks no longer inserted here).
 */
async function saveStructuredData(
  userId: string,
  sourceMessageId: string,
  structured: {
    tasks: Array<{ title: string; due_date: string | null; due_time: string | null; category: string | null }>;
    groceries: Array<{ item_name: string; quantity: string | null; needed_by: string | null }>;
    reminders: Array<{ title: string; remind_at: string | null }>;
    mood_tag?: string | null;
  }
): Promise<string[]> {
  const confirmations: string[] = [];

  // Task creation is handled exclusively via insertTasksWithDedupe.
  // structured.tasks must never be inserted directly.
  if (structured.tasks && structured.tasks.length > 0) {
    console.warn(
      `[saveStructuredData] Ignoring ${structured.tasks.length} task(s) from structured data; task creation must go through insertTasksWithDedupe.`
    );
    // Do NOT insert tasks here.
  }

  try {
    // Save groceries
    if (structured.groceries && structured.groceries.length > 0) {
      const groceriesToInsert = structured.groceries.map((grocery) => ({
        user_id: userId,
        source_message_id: sourceMessageId,
        item_name: grocery.item_name,
        quantity: grocery.quantity,
        needed_by: grocery.needed_by,
        status: 'pending',
      }));

      const { error: groceriesError } = await supabase
        .from('groceries')
        .insert(groceriesToInsert);

      if (groceriesError) {
        console.error('Error saving groceries:', groceriesError);
      } else {
        console.log(`✅ Saved ${groceriesToInsert.length} grocery item(s)`);
      }
    }

    // Save mood
    if (structured.mood_tag) {
      const { error: moodError } = await supabase
        .from('moods')
        .insert({
          user_id: userId,
          source_message_id: sourceMessageId,
          tag: structured.mood_tag,
          intensity: 3, // Default medium intensity
        });

      if (moodError) {
        console.error('Error saving mood:', moodError);
      } else {
        console.log(`✅ Saved mood: ${structured.mood_tag}`);
      }
    }

    // Note: Reminders not implemented in this MVP
    // Would require a separate reminders table and notification system
    if (structured.reminders && structured.reminders.length > 0) {
      console.log(`⚠️ Reminders not yet implemented (${structured.reminders.length} reminder(s) detected)`);
    }
  } catch (error) {
    console.error('Error in saveStructuredData:', error);
  }
  
  return confirmations;
}

/**
 * Extract filters from task query message. Uses canonical categories from @/lib/categories.
 * If message starts with "search X" / "find X" / "tasks about X", returns term for search view.
 */
function extractQueryFilters(queryText: string): {
  category?: string;
  due_date?: string;
  term?: string;
} {
  const trimmed = queryText.trim();
  const searchMatch = /^(?:search|find|tasks about)\s+(.+)$/i.exec(trimmed);
  if (searchMatch) {
    return { term: searchMatch[1]!.trim() };
  }

  const detected = detectCategory(queryText);
  const category = detected === 'Tasks' ? undefined : detected;
  let due_date: string | undefined;

  if (queryText.toLowerCase().includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    due_date = tomorrow.toISOString().split('T')[0];
  } else if (queryText.toLowerCase().includes('today') || category) {
    due_date = new Date().toISOString().split('T')[0];
  }

  return { category, due_date };
}

/** Emoji and action maps use canonical categories; Bills kept for backward compat with existing tasks. */
const CATEGORY_EMOJI: Record<string, string> = {
  Shopping: '🛒', Work: '💼', Home: '🏠', Health: '🏥', Finance: '💰', Bills: '💰',
  Personal: '👤', Admin: '📝', Meals: '🍽️', Fitness: '💪', Learning: '📚', Tasks: '📋',
};
const CATEGORY_ACTION: Record<string, string> = {
  Shopping: 'buy', Work: 'work on', Home: 'do at home', Health: 'do for health',
  Finance: 'pay', Bills: 'pay', Personal: 'do', Admin: 'handle',
  Meals: 'cook', Fitness: 'do for fitness', Learning: 'study', Tasks: 'do',
};

/**
 * Normalize text for robust "today digest" intent matching:
 * - trim
 * - lowercase
 * - collapse internal whitespace
 * - strip trailing punctuation characters (?, !, ., :)
 */
export function normalizeForTodayDigestIntent(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  const collapsed = trimmed.replace(/\s+/g, ' ');
  const stripped = collapsed.replace(/[?!.:]+$/g, '');
  return stripped.trim();
}

/**
 * Match common variants of "what do I have today" style intents.
 * Call with normalized string from normalizeForTodayDigestIntent.
 *
 * Guards:
 * - If message starts with "search " or "find ", do NOT treat as digest.
 * - We also require the word "today" to appear.
 */
export function matchesTodayDigestIntent(normalized: string): boolean {
  if (!normalized) return false;

  // Avoid clashing with explicit search commands.
  if (/^(search|find)\s/.test(normalized)) {
    return false;
  }

  const exactPhrases = ['today tasks', 'tasks today'];
  if (exactPhrases.includes(normalized)) {
    return true;
  }

  if (!normalized.includes('today')) {
    return false;
  }

  if (
    normalized.includes('what do i have') ||
    normalized.includes("what's on") ||
    normalized.includes('what are my tasks')
  ) {
    return true;
  }

  return false;
}

function getCategoryEmoji(category: string | null): string {
  if (!category) return '📋';
  return CATEGORY_EMOJI[category] ?? '📋';
}

function getCategoryAction(category: string | null): string {
  if (!category) return 'do';
  return CATEGORY_ACTION[category] ?? 'do';
}

type PendingEditRow = {
  id: string;
  app_user_id: string;
  task_id: string;
  expires_at: string;
  last_inbound_provider_message_id: string | null;
};

async function getActivePendingEdit(authUserId: string): Promise<PendingEditRow | null> {
  const { data } = await supabase
    .from('wa_pending_actions')
    .select('id, app_user_id, task_id, expires_at, last_inbound_provider_message_id')
    .eq('auth_user_id', authUserId)
    .eq('action_type', 'edit')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as PendingEditRow | null;
}

type PendingOcrImportRow = {
  id: string;
  app_user_id: string;
  action_type: 'ocr_import_list_name' | 'ocr_import_confirm_tasks';
  expires_at: string;
  payload: any;
};

async function getActivePendingOcrImport(
  authUserId: string
): Promise<PendingOcrImportRow | null> {
  const { data } = await supabase
    .from('wa_pending_actions')
    .select('id, app_user_id, action_type, expires_at, payload')
    .eq('auth_user_id', authUserId)
    .in('action_type', ['ocr_import_list_name', 'ocr_import_confirm_tasks'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as PendingOcrImportRow | null;
}

function formatEditConfirmation(
  updatedTask: { title?: string; due_date?: string | null; due_time?: string | null } | null,
  patch: { title?: string; due_date?: string | null; due_time?: string | null; category?: string | null }
): string {
  const parts: string[] = ['Updated ✅'];
  if (updatedTask?.due_date || updatedTask?.due_time || patch.due_date !== undefined || patch.due_time !== undefined) {
    const d = updatedTask?.due_date ?? patch.due_date ?? '';
    const t = updatedTask?.due_time ?? patch.due_time ?? '';
    if (d && t) parts.push(`• Due: ${d} ${t}`);
    else if (d) parts.push(`• Due: ${d}`);
    else if (t) parts.push(`• Time: ${t}`);
  }
  if (patch.title !== undefined && updatedTask?.title) parts.push(`• Title: ${updatedTask.title}`);
  return parts.join('\n');
}

/**
 * Edit selection: reply-anchored (messages.task_ids) or search fallback. Create wa_pending_actions.
 * Returns true if we handled (sent a message and optionally created pending).
 */
async function handleEditSelect(
  userId: string,
  rawText: string,
  phoneNumber: string,
  replyToMessageId: string | null,
  intent: NonNullable<ReturnType<typeof parseEditSelectionIntent>>,
  _inboundProviderMessageId: string
): Promise<boolean> {
  const { data: appUser } = await supabase
    .from('app_users')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle<{ id: string }>();
  if (!appUser?.id) {
    await sendWhatsAppMessage(phoneNumber, "I couldn't find your account. Try linking again.");
    return true;
  }
  const appUserId = appUser.id;
  const expiresAt = new Date(Date.now() + PENDING_EDIT_EXPIRY_MS).toISOString();

  if (replyToMessageId) {
    const { data: replied } = await supabase
      .from('messages')
      .select('task_ids')
      .eq('provider_message_id', replyToMessageId)
      .maybeSingle<{ task_ids: string[] | null }>();
    const anchoredIds: string[] = replied?.task_ids ?? [];
    if (anchoredIds.length === 1) {
      await upsertPendingEdit(userId, appUserId, anchoredIds[0]!, replyToMessageId, expiresAt);
      await sendWhatsAppMessage(phoneNumber, "Got it. What do you want to change? (e.g. tomorrow 5pm, or rename to …)");
      return true;
    }
    if (anchoredIds.length > 1) {
      if (intent.kind === 'edit_index' && intent.index >= 1 && intent.index <= anchoredIds.length) {
        const taskId = anchoredIds[intent.index - 1]!;
        await upsertPendingEdit(userId, appUserId, taskId, replyToMessageId, expiresAt);
        await sendWhatsAppMessage(phoneNumber, "Got it. What do you want to change?");
        return true;
      }
      const cap = 10;
      const ids = anchoredIds.slice(0, cap);
      const { data: taskRows } = await supabase
        .from('tasks')
        .select('id, title')
        .in('id', ids)
        .is('deleted_at', null);
      const list = (taskRows ?? []).map((r: { title: string }, i: number) => `${i + 1}. ${r.title}`).join('\n');
      const msg = `Which one should I edit?\n${list}\n\nReply: edit 1 / edit 2 …`;
      const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
      const providerMessageId = sendResult?.providerMessageId;
      if (!providerMessageId) {
        console.warn(
          '[WA][anchor] Missing providerMessageId for edit-select list; outbound message not anchorable.'
        );
      }
      await saveOutboundMessage({
        userId,
        content: msg,
        taskIds: ids,
        kind: 'task_list',
        providerMessageId,
      });
      return true;
    }
  }

  if (intent.kind === 'edit_term') {
    const { executeTaskView } = await import('@/server/taskView/taskViewEngine');
    const searchResult = await executeTaskView({
      identity: { kind: 'authUserId', authUserId: userId },
      view: 'search',
      filters: { status: 'active', term: intent.term },
    });
    const found = searchResult.tasks;
    if (found.length === 0) {
      await sendWhatsAppMessage(phoneNumber, `No tasks found matching "${intent.term}".`);
      return true;
    }
    if (found.length === 1) {
      await upsertPendingEdit(userId, appUserId, found[0]!.id, null, expiresAt);
      await sendWhatsAppMessage(phoneNumber, "Got it. What do you want to change?");
      return true;
    }
    const cap = 10;
    const listTasks = found.slice(0, cap);
    const listMsg = listTasks.map((t, i) => `${i + 1}. ${t.title}`).join('\n');
    const msg = `Found ${found.length} tasks:\n${listMsg}\n\nReply: edit 1 / edit 2 …`;
    const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
    const providerMessageId = sendResult?.providerMessageId;
    if (!providerMessageId) {
      console.warn(
        '[WA][anchor] Missing providerMessageId for edit-term list; outbound message not anchorable.'
      );
    }
    await saveOutboundMessage({
      userId,
      content: msg,
      taskIds: listTasks.map((t) => t.id),
      kind: 'search_results',
      providerMessageId,
    });
    return true;
  }

  if (intent.kind === 'edit_bare' && !replyToMessageId) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Reply to a task list to edit from it, or say \"edit <task name>\" to search."
    );
    return true;
  }

  return false;
}

async function upsertPendingEdit(
  authUserId: string,
  appUserId: string,
  taskId: string,
  sourceProviderMessageId: string | null,
  expiresAt: string
): Promise<void> {
  await supabase.from('wa_pending_actions').delete().eq('auth_user_id', authUserId).eq('action_type', 'edit');
  await supabase.from('wa_pending_actions').insert({
    auth_user_id: authUserId,
    app_user_id: appUserId,
    action_type: 'edit',
    task_id: taskId,
    source_provider_message_id: sourceProviderMessageId,
    expires_at: expiresAt,
  });
}

async function handleOcrImportPending(
  authUserId: string,
  pending: PendingOcrImportRow,
  rawText: string,
  phoneNumber: string
): Promise<boolean> {
  const lower = rawText.trim().toLowerCase();

  const expired =
    !pending.expires_at ||
    new Date(pending.expires_at).getTime() <= Date.now();
  if (expired) {
    await supabase.from('wa_pending_actions').delete().eq('id', pending.id);
    await sendWhatsAppMessage(
      phoneNumber,
      'That import expired — please resend the image.'
    );
    return true;
  }

  if (pending.action_type === 'ocr_import_list_name') {
    const preview = pending.payload?.preview as import('@/lib/ocr_import_preview').OcrImportPreview | undefined;
    const mediaId = pending.payload?.mediaId as string | null;

    if (!preview) {
      console.warn('[WA][OCR_IMPORT] Missing preview payload on pending row.');
      await supabase.from('wa_pending_actions').delete().eq('id', pending.id);
      return false;
    }

    let chosenName: string | null = null;
    let useInbox = false;

    if (lower === 'inbox') {
      useInbox = true;
    } else {
      const idxMatch = /^(\d+)$/.exec(lower);
      if (idxMatch) {
        const idx = parseInt(idxMatch[1], 10) - 1;
        const suggestions = preview.proposedList.suggested_names;
        if (idx >= 0 && idx < suggestions.length) {
          chosenName = suggestions[idx]!;
        }
      }
      if (!chosenName) {
        chosenName = rawText.trim();
      }
    }

    const { data: appUser } = await supabase
      .from('app_users')
      .select('id')
      .eq('id', pending.app_user_id)
      .maybeSingle<{ id: string }>();

    if (!appUser?.id) {
      await sendWhatsAppMessage(phoneNumber, "I couldn't find your account. Try linking again.");
      await supabase.from('wa_pending_actions').delete().eq('id', pending.id);
      return true;
    }

    const appUserId = appUser.id;

    let targetListId: string;
    let targetListName: string;

    if (useInbox) {
      const inbox = await getOrCreateSystemList({
        appUserId,
        systemKey: 'inbox',
        defaultName: 'Inbox',
      });
      targetListId = inbox.id;
      targetListName = inbox.name;
    } else {
      if (!chosenName || !chosenName.trim()) {
        await sendWhatsAppMessage(phoneNumber, 'List name cannot be empty. Please reply with a name or INBOX.');
        return true;
      }
      const { list } = await insertListWithIdempotency({
        appUserId,
        name: chosenName,
        source: 'ocr',
        sourceMessageId: mediaId ? `${mediaId}:list:0` : null,
        importCandidates: null,
      });
      targetListId = list.id;
      targetListName = list.name;
    }

    const candidates = preview.proposedList.candidates;
    const importCandidates = candidates.map((c) => ({
      text: c.text,
      classification: c.classification,
    }));

    await supabase
      .from('lists')
      .update({
        import_candidates: importCandidates,
      })
      .eq('id', targetListId);

    const nextPayload = {
      mediaId: mediaId ?? null,
      proposedTasks: preview.proposedTasks,
    };

    await supabase
      .from('wa_pending_actions')
      .update({
        action_type: 'ocr_import_confirm_tasks',
        payload: nextPayload,
      })
      .eq('id', pending.id);

    const msg = `Saved to ${targetListName}. Confirm ${preview.task_count} tasks too? Reply YES or NO.`;
    const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
    const providerMessageId = sendResult?.providerMessageId;
    await saveOutboundMessage({
      userId: authUserId,
      content: msg,
      kind: 'ocr_import_confirm',
      providerMessageId,
    });

    return true;
  }

  if (pending.action_type === 'ocr_import_confirm_tasks') {
    const payload = pending.payload || {};
    const proposedTasks = (payload.proposedTasks || []) as ProposedTask[];
    const mediaId = (payload.mediaId as string | null) ?? null;

    const yes = lower === 'yes' || lower === 'y';
    const no = lower === 'no' || lower === 'n';

    if (!yes && !no) {
      await sendWhatsAppMessage(phoneNumber, 'Please reply YES to add tasks or NO to skip them.');
      return true;
    }

    if (no) {
      await supabase.from('wa_pending_actions').delete().eq('id', pending.id);
      await sendWhatsAppMessage(phoneNumber, 'Okay, tasks not added.');
      return true;
    }

    if (proposedTasks.length === 0) {
      await supabase.from('wa_pending_actions').delete().eq('id', pending.id);
      await sendWhatsAppMessage(phoneNumber, 'There were no tasks to add from that document.');
      return true;
    }

    const result = await insertTasksWithDedupe({
      tasks: proposedTasks,
      userId: authUserId,
      appUserId: pending.app_user_id,
      allowDuplicateIndices: [],
      source: TASK_SOURCES.WHATSAPP_MEDIA,
      sourceMessageId: mediaId || null,
    });

    await supabase.from('wa_pending_actions').delete().eq('id', pending.id);

    const confirmations = formatTaskConfirmations(result.inserted);
    const reply = result.inserted.length > 0
      ? confirmations.join('\n')
      : 'Those look like duplicates of tasks you just added. Send something new if you’d like to add more.';

    await sendWhatsAppMessage(phoneNumber, reply);
    return true;
  }

  return false;
}

const ADD_TO_LIST_CHOOSE_EXPIRY_MS = 15 * 60 * 1000;

type PendingAddToListChooseRow = {
  id: string;
  app_user_id: string;
  auth_user_id: string;
  payload: { listIds: string[]; listNames: string[]; items: string[] };
  expires_at: string;
};

async function getActivePendingAddToListChoose(authUserId: string): Promise<PendingAddToListChooseRow | null> {
  const { data } = await supabase
    .from('wa_pending_actions')
    .select('id, app_user_id, auth_user_id, payload, expires_at')
    .eq('auth_user_id', authUserId)
    .eq('action_type', 'add_to_list_choose')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as PendingAddToListChooseRow | null;
}

/**
 * Check if the user is replying to a message that contains a list preview (list_ids in metadata).
 */
async function isReplyToListPreview(replyToMessageId: string | null): Promise<boolean> {
  if (!replyToMessageId) return false;
  const { data } = await supabase
    .from('messages')
    .select('list_ids')
    .eq('provider_message_id', replyToMessageId)
    .maybeSingle<{ list_ids: string[] | null }>();
  const listIds = data?.list_ids ?? [];
  return listIds.length > 0;
}

/**
 * Handle list-read (18.4–18.6): reply-anchored open, show lists, show specific list.
 */
async function handleListRead(
  userId: string,
  finalText: string,
  phoneNumber: string,
  replyToMessageId: string | null
): Promise<boolean> {
  const { data: appUser } = await supabase
    .from('app_users')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle<{ id: string }>();
  if (!appUser?.id) return false;

  const appUserId = appUser.id;
  const replyText = finalText.trim();

  // 1) Reply-anchored "open list": user replies "1" or "2" or list name to a list summary
  if (replyToMessageId) {
    const { data: replied } = await supabase
      .from('messages')
      .select('list_ids')
      .eq('provider_message_id', replyToMessageId)
      .maybeSingle<{ list_ids: string[] | null }>();
    const listIds = replied?.list_ids ?? [];
    if (listIds.length > 0) {
      let targetListId: string | null = null;
      let targetListName: string | null = null;

      const numMatch = replyText.match(/^\s*(\d+)\s*$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1]!, 10);
        if (idx >= 1 && idx <= listIds.length) {
          targetListId = listIds[idx - 1]!;
        }
      }
      if (!targetListId) {
        const { data: listRows } = await supabase
          .from('lists')
          .select('id, name')
          .in('id', listIds)
          .eq('app_user_id', appUserId)
          .is('deleted_at', null);
        const lists = (listRows ?? []) as { id: string; name: string }[];
        const match = lists.find(
          (l) => l.name.toLowerCase().trim() === replyText.toLowerCase().trim()
        ) ?? lists.find((l) => l.name.toLowerCase().includes(replyText.toLowerCase()));
        if (match) {
          targetListId = match.id;
          targetListName = match.name;
        }
      }
      if (targetListId) {
        if (!targetListName) {
          const { data: listRow } = await supabase
            .from('lists')
            .select('name')
            .eq('id', targetListId)
            .maybeSingle<{ name: string }>();
          targetListName = listRow?.name ?? 'list';
        }
        const items = await getListItems(targetListId);
        const msg = formatListPreview(
          targetListName!,
          items.length,
          items.map((i) => ({ text: i.text, is_done: i.is_done }))
        );
        const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
        await saveOutboundMessage({
          userId,
          content: msg,
          listIds: [targetListId],
          kind: 'list_preview',
          providerMessageId: sendResult?.providerMessageId,
        });
        resetListActionCounter(userId, targetListId);
        await upsertQuickAdd(userId, appUserId, targetListId, targetListName!, 0);
        console.log(`[WA] Route: LIST-READ | userId=${userId} | reply-anchored open`);
        return true;
      }
    }
  }

  // 2) Show-lists intent
  if (detectShowListsIntent(finalText)) {
    const lists = await getUserLists(appUserId);
    if (lists.length === 0) {
      await sendWhatsAppMessage(
        phoneNumber,
        "You don't have any lists yet. Say create list  to create one."
      );
    } else {
      const msg = formatListSummary(lists);
      const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
      await saveOutboundMessage({
        userId,
        content: msg,
        listIds: lists.map((l) => l.id),
        kind: 'list_summary',
        providerMessageId: sendResult?.providerMessageId,
      });
    }
    console.log(`[WA] Route: LIST-READ | userId=${userId} | show-lists`);
    return true;
  }

  // 3) Show-specific-list intent
  const showSpecific = detectShowSpecificListIntent(finalText);
  if (showSpecific) {
    const result = await getListByName(appUserId, showSpecific.listName);
    if (!result) {
      await sendWhatsAppMessage(phoneNumber, "I couldn't find that list.");
    } else if (result && 'type' in result && result.type === 'multiple') {
      const lists = result.lists.slice(0, 5);
      const lines = lists.map((l, i) => `${i + 1}. ${l.name}`);
      const msg =
        'Multiple lists match:\n\n' +
        lines.join('\n') +
        '\n\nReply with the number or full name.';
      const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
      await saveOutboundMessage({
        userId,
        content: msg,
        listIds: lists.map((l) => l.id),
        kind: 'list_summary',
        providerMessageId: sendResult?.providerMessageId,
      });
    } else {
      const list = result as ListInfo;
      const items = await getListItems(list.id);
      const msg = formatListPreview(
        list.name,
        items.length,
        items.map((i) => ({ text: i.text, is_done: i.is_done }))
      );
      const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
      await saveOutboundMessage({
        userId,
        content: msg,
        listIds: [list.id],
        kind: 'list_preview',
        providerMessageId: sendResult?.providerMessageId,
      });
      resetListActionCounter(userId, list.id);
      await upsertQuickAdd(userId, appUserId, list.id, list.name, 0);
    }
    console.log(`[WA] Route: LIST-READ | userId=${userId} | show-specific`);
    return true;
  }

  return false;
}

/**
 * Handle add-to-list: reply-anchored (list_ids on message), explicit list name, or disambiguation.
 */
async function handleAddToList(
  userId: string,
  intent: { items: string[]; listName?: string },
  phoneNumber: string,
  replyToMessageId: string | null
): Promise<boolean> {
  const { data: appUser } = await supabase
    .from('app_users')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle<{ id: string }>();
  if (!appUser?.id) {
    await sendWhatsAppMessage(phoneNumber, "I couldn't find your account. Try linking again.");
    return true;
  }
  const appUserId = appUser.id;

  let targetListId: string | null = null;
  let targetListName: string | null = null;

  // 1) Reply-anchored: use list_ids from the message being replied to
  if (replyToMessageId) {
    const { data: replied } = await supabase
      .from('messages')
      .select('list_ids')
      .eq('provider_message_id', replyToMessageId)
      .maybeSingle<{ list_ids: string[] | null }>();
    const listIds = replied?.list_ids ?? [];
    if (listIds.length === 1) {
      targetListId = listIds[0]!;
      const { data: listRow } = await supabase
        .from('lists')
        .select('name')
        .eq('id', targetListId)
        .eq('app_user_id', appUserId)
        .is('deleted_at', null)
        .maybeSingle<{ name: string }>();
      targetListName = listRow?.name ?? null;
    }
  }

  // 2) Explicit list name: resolve by name (exact then contains)
  if (!targetListId && intent.listName) {
    const { data: lists } = await supabase
      .from('lists')
      .select('id, name')
      .eq('app_user_id', appUserId)
      .is('deleted_at', null);
    const all = (lists ?? []) as { id: string; name: string }[];
    const exact = all.filter((l) => l.name.toLowerCase().trim() === intent.listName!.toLowerCase().trim());
    const contains = all.filter((l) => l.name.toLowerCase().includes(intent.listName!.toLowerCase().trim()));
    const matches = exact.length > 0 ? exact : contains;
    if (matches.length === 1) {
      targetListId = matches[0]!.id;
      targetListName = matches[0]!.name;
    } else if (matches.length > 1) {
      const listIds = matches.map((m) => m.id);
      const listNames = matches.map((m) => m.name);
      const expiresAt = new Date(Date.now() + ADD_TO_LIST_CHOOSE_EXPIRY_MS).toISOString();
      await supabase.from('wa_pending_actions').insert({
        auth_user_id: userId,
        app_user_id: appUserId,
        action_type: 'add_to_list_choose',
        task_id: null,
        expires_at: expiresAt,
        payload: { listIds, listNames, items: intent.items },
      });
      const prompt = `Which list?\n${listNames.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;
      await sendWhatsAppMessage(phoneNumber, prompt);
      return true;
    }
  }

  if (!targetListId) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Reply to a list message to add there, or say: add X to <list name>"
    );
    return true;
  }

  const { inserted } = await insertListItems({
    appUserId,
    listId: targetListId,
    items: intent.items,
    source: 'whatsapp',
  });
  if (inserted.length === 0) {
    await sendWhatsAppMessage(phoneNumber, "No new items added.\nAll items already exist in the list.");
    return true;
  }
  const name = targetListName ?? 'list';
  const msg =
    inserted.length === 1
      ? `Added: ${inserted[0]!.text}`
      : `Added ${inserted.length} items:\n${inserted.map((i) => `• ${i.text}`).join('\n')}`;
  const sendResult = await sendWhatsAppMessage(phoneNumber, msg);
  await saveOutboundMessage({
    userId,
    content: msg,
    listIds: [targetListId],
    kind: 'list_add_confirm',
    providerMessageId: sendResult?.providerMessageId,
  });
  await maybeSendListPreviewAfterAction(userId, phoneNumber, targetListId, name);
  return true;
}

/**
 * Handle list item done/remove: reply-anchored list (with optional numeric index) or search across lists.
 */
async function handleListItemDoneRemove(
  userId: string,
  intent: { command: 'done' | 'remove'; term: string; index?: number },
  phoneNumber: string,
  replyToMessageId: string | null
): Promise<boolean> {
  const { data: appUser } = await supabase
    .from('app_users')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle<{ id: string }>();
  if (!appUser?.id) {
    await sendWhatsAppMessage(phoneNumber, "I couldn't find your account. Try linking again.");
    return true;
  }
  const appUserId = appUser.id;

  let item: { id: string; list_id: string; text: string } | null = null;

  // Numeric index without reply context: require reply to a list
  if (intent.index !== undefined && !replyToMessageId) {
    await sendWhatsAppMessage(phoneNumber, "Reply to a list to use item numbers.");
    return true;
  }

  // Numeric index with reply: resolve by index from list
  if (replyToMessageId && intent.index !== undefined) {
    const { data: replied } = await supabase
      .from('messages')
      .select('list_ids')
      .eq('provider_message_id', replyToMessageId)
      .maybeSingle<{ list_ids: string[] | null }>();
    const listIds = replied?.list_ids ?? [];
    if (listIds.length >= 1) {
      const listId = listIds[0]!;
      const items = await getListItems(listId);
      if (intent.index >= 1 && intent.index <= items.length) {
        const target = items[intent.index - 1]!;
        item = { id: target.id, list_id: listId, text: target.text };
      } else {
        await sendWhatsAppMessage(phoneNumber, "That item number isn't in the list.");
        return true;
      }
    }
  }

  // Text-based lookup: reply-anchored or across lists
  if (!item && replyToMessageId) {
    const { data: replied } = await supabase
      .from('messages')
      .select('list_ids')
      .eq('provider_message_id', replyToMessageId)
      .maybeSingle<{ list_ids: string[] | null }>();
    const listIds = replied?.list_ids ?? [];
    if (listIds.length >= 1) {
      const listId = listIds[0]!;
      const found = await findListItemByText({ appUserId, listId, text: intent.term });
      if (found) item = found;
    }
  }
  if (!item) {
    const found = await findListItemByTextAcrossLists(appUserId, intent.term);
    if (found) item = found;
  }
  if (!item) {
    await sendWhatsAppMessage(phoneNumber, `No item found matching "${intent.term}".`);
    return true;
  }
  const listId = item.list_id;
  const { data: listRow } = await supabase
    .from('lists')
    .select('name')
    .eq('id', listId)
    .maybeSingle<{ name: string }>();
  const listName = listRow?.name ?? 'list';

  if (intent.command === 'done') {
    await updateListItem({ itemId: item.id, appUserId, is_done: true });
    await sendWhatsAppMessage(phoneNumber, `✓ ${item.text} completed`);
  } else {
    await softDeleteListItem({ itemId: item.id, appUserId });
    await sendWhatsAppMessage(phoneNumber, `Removed: ${item.text}`);
  }
  await maybeSendListPreviewAfterAction(userId, phoneNumber, listId, listName);
  return true;
}

/**
 * Handle task delete messages.
 * Supports reply-anchored delete (primary) and search-based fallback.
 */
async function handleTaskDelete(
  userId: string,
  rawText: string,
  phoneNumber: string,
  replyToMessageId: string | null
): Promise<void> {
  try {
    console.log(`🗑️ Handling delete intent: "${rawText}"`);

    // Resolve app_user_id
    const { data: appUser } = await supabase
      .from('app_users')
      .select('id')
      .eq('auth_user_id', userId)
      .maybeSingle<{ id: string }>();

    if (!appUser?.id) {
      await sendWhatsAppMessage(phoneNumber, "I couldn't find your account. Try linking again.");
      return;
    }
    const appUserId = appUser.id;

    const intent = parseDeleteIntent(rawText);
    if (!intent) {
      await sendWhatsAppMessage(phoneNumber, "I didn't catch that. You can say \"delete 1\" or \"delete <task name>\".");
      return;
    }

    // ── UNDO shortcut handled in main routing before this handler ──
    // (kept here as guard only)
    if (intent.kind === 'undo') return;

    // ── Reply-anchored path ──────────────────────────────────────
    // replyToMessageId is the provider's message ID (Gupshup gsId).
    // Look up the stored outbound message via provider_message_id, not the internal UUID.
    if (replyToMessageId) {
      const { data: replied } = await supabase
        .from('messages')
        .select('task_ids, kind')
        .eq('provider_message_id', replyToMessageId)
        .maybeSingle<{ task_ids: string[] | null; kind: string | null }>();

      const anchoredIds: string[] = replied?.task_ids ?? [];

      if (anchoredIds.length > 0) {
        let idsToDelete: string[] = [];

        if (intent.kind === 'delete_bare' && anchoredIds.length === 1) {
          idsToDelete = anchoredIds;
        } else if (intent.kind === 'delete_indices') {
          idsToDelete = intent.indices
            .map((i) => anchoredIds[i - 1])
            .filter(Boolean);
        } else if (intent.kind === 'delete_all') {
          idsToDelete = anchoredIds;
        } else if (intent.kind === 'delete_bare' && anchoredIds.length > 1) {
          // Ambiguous — show numbered list and ask
          const { data: taskRows } = await supabase
            .from('tasks')
            .select('id, title')
            .in('id', anchoredIds)
            .is('deleted_at', null);
          await sendWhatsAppMessage(
            phoneNumber,
            formatDeleteAmbiguityPrompt((taskRows ?? []) as Array<{ title: string }>)
          );
          return;
        }

        if (!idsToDelete.length) {
          await sendWhatsAppMessage(phoneNumber, "I couldn't find those tasks. Try sending the list again first.");
          return;
        }

        // Fetch titles for confirmation copy
        const { data: taskRows } = await supabase
          .from('tasks')
          .select('id, title')
          .in('id', idsToDelete)
          .is('deleted_at', null);

        const titles = (taskRows ?? []).map((r: { id: string; title: string }) => r.title);
        const result = await deleteTasks({ appUserId, taskIds: idsToDelete, source: 'whatsapp', authUserId: userId });

        if (result.deletedIds.length === 0) {
          await sendWhatsAppMessage(phoneNumber, "Those tasks couldn't be deleted right now. They may already be gone.");
          return;
        }

        // Store for undo
        await supabase
          .from('whatsapp_users')
          .update({ last_deleted_task_ids: result.deletedIds, last_deleted_at: new Date().toISOString() })
          .eq('phone_number', phoneNumber);

        await sendWhatsAppMessage(phoneNumber, formatDeleteConfirmation(titles));
        return;
      }
    }

    // ── Search-based fallback ────────────────────────────────────
    const term = intent.kind === 'delete_term'
      ? intent.term
      : intent.kind === 'delete_bare'
      ? null
      : null;

    if (!term) {
      await sendWhatsAppMessage(
        phoneNumber,
        "Reply to a task list to delete from it, or say \"delete <task name>\" to search."
      );
      return;
    }

    // Search by term
    const { executeTaskView: _execView } = await import('@/server/taskView/taskViewEngine');
    const searchResult = await _execView({
      identity: { kind: 'appUserId', appUserId },
      view: 'search',
      filters: { status: 'active', term },
    });

    const found = searchResult.tasks;

    if (found.length === 0) {
      await sendWhatsAppMessage(phoneNumber, `No tasks found matching "${term}".`);
      return;
    }

    if (found.length === 1) {
      const task = found[0]!;
      // Require explicit confirmation; send first to capture provider ID for reply anchoring
      const confirmMsg = formatDeleteConfirmRequest(task.title);
      const sendResult1 = await sendWhatsAppMessage(phoneNumber, confirmMsg);
      const providerMessageId1 = sendResult1?.providerMessageId;
      if (!providerMessageId1) {
        console.warn(
          '[WA][anchor] Missing providerMessageId for delete_confirm; outbound message not anchorable.'
        );
      }
      await saveOutboundMessage({
        userId,
        content: confirmMsg,
        taskIds: [task.id],
        kind: 'delete_confirm',
        providerMessageId: providerMessageId1,
      });
      return;
    }

    // Multiple matches — show numbered list and ask
    const listMsg = formatDeleteAmbiguityPrompt(found.map((t) => ({ title: t.title })));
    const sendResult2 = await sendWhatsAppMessage(phoneNumber, listMsg);
    const providerMessageId2 = sendResult2?.providerMessageId;
    if (!providerMessageId2) {
      console.warn(
        '[WA][anchor] Missing providerMessageId for delete disambiguation list; outbound message not anchorable.'
      );
    }
    await saveOutboundMessage({
      userId,
      content: listMsg,
      taskIds: found.map((t) => t.id),
      kind: 'task_list',
      providerMessageId: providerMessageId2,
    });

  } catch (err) {
    console.error('[WA][handleTaskDelete] error', err);
    await sendWhatsAppMessage(phoneNumber, "I couldn't delete that right now. Please try again.");
  }
}

/**
 * Handle task query messages (list, filter, search)
 */
async function handleTaskQuery(
  userId: string,
  queryText: string,
  phoneNumber: string
): Promise<void> {
  try {
    console.log(`🔍 Handling task query: "${queryText}"`);
    
    // Clear focus when processing query
    clearFocus(userId, 'query_processed');

    const filters = extractQueryFilters(queryText);
    const categoryFilter = filters.category || null;
    const dateFilter = filters.due_date || null;
    const searchTerm = filters.term?.trim() || null;

    // [C1] Detect robust "today digest" style queries (Mode A: user-initiated only)
    const normalizedForDigest = normalizeForTodayDigestIntent(queryText);
    const isTodayDigestIntent =
      !searchTerm && matchesTodayDigestIntent(normalizedForDigest);

    if (isTodayDigestIntent) {
      // [C1] On-demand digest: use digest view + digest formatter
      const { data: appUser } = await supabase
        .from('app_users')
        .select('timezone')
        .eq('auth_user_id', userId)
        .maybeSingle<{ timezone: string | null }>();

      const tz = appUser?.timezone || DEFAULT_TZ;

      const digestResult = await executeTaskView({
        identity: { kind: 'authUserId', authUserId: userId },
        view: 'digest',
        filters: { status: 'active' },
        timezone: tz,
      });

      const digestText = formatDigestFromResult(digestResult, tz);
      if (!digestText.trim()) {
        await sendWhatsAppMessage(phoneNumber, "You don't have anything due today.");
      } else {
        const digestTaskIds = digestResult.tasks.map((t) => t.id);
        const sendResult = await sendWhatsAppMessage(phoneNumber, digestText);
        const providerMessageId = sendResult?.providerMessageId;
        if (!providerMessageId) {
          console.warn(
            '[WA][anchor] Missing providerMessageId for on-demand digest; outbound message not anchorable.'
          );
        }
        await saveOutboundMessage({
          userId,
          content: digestText,
          taskIds: digestTaskIds,
          kind: 'digest',
          providerMessageId,
        });
      }
      return;
    }

    const viewResult = await executeTaskView({
      identity: { kind: 'authUserId', authUserId: userId },
      view: searchTerm ? 'search' : dateFilter ? 'today' : 'all',
      filters: {
        status: 'active',
        date: dateFilter ?? undefined,
        category: categoryFilter ?? undefined,
        term: searchTerm ?? undefined,
      },
    });

    if (viewResult.identityResolved === false) {
      await sendWhatsAppMessage(
        phoneNumber,
        "I couldn't find your tasks yet. Try linking your account again."
      );
      return;
    }

    if (!viewResult.tasks || viewResult.tasks.length === 0) {
      // Empty state - calm, single-line response
      let emptyMessage = "You don't have any open tasks.";
      if (searchTerm) {
        emptyMessage = `No tasks match "${searchTerm}".`;
      } else if (categoryFilter && dateFilter === new Date().toISOString().split('T')[0]) {
        emptyMessage = `You don't have anything to ${getCategoryAction(categoryFilter)} today.`;
      } else if (categoryFilter) {
        emptyMessage = `You don't have any ${categoryFilter} tasks right now.`;
      } else if (dateFilter === new Date().toISOString().split('T')[0]) {
        emptyMessage = "You don't have anything due today.";
      }
      await sendWhatsAppMessage(phoneNumber, emptyMessage);
      return;
    }

    // Build task list message with emoji header
    const categoryEmoji = getCategoryEmoji(categoryFilter);
    const isToday = dateFilter === new Date().toISOString().split('T')[0];
    let header = '';
    if (searchTerm) {
      header = `🔍 Tasks matching "${searchTerm}":\n\n`;
    } else if (categoryFilter && isToday) {
      header = `${categoryEmoji} Things to ${getCategoryAction(categoryFilter)} today:\n\n`;
    } else if (categoryFilter) {
      header = `${categoryEmoji} ${categoryFilter} tasks:\n\n`;
    } else if (isToday) {
      header = "📋 Your tasks for today:\n\n";
    } else {
      header = "📋 Your open tasks:\n\n";
    }

    const message = formatTaskListForQuery(viewResult, header);
    const taskIds = viewResult.tasks.map((t) => t.id);
    const msgKind = searchTerm ? 'search_results' : 'task_list';

    // Send first, capture provider ID, then persist with task_ids for reply-based delete
    const sendResult = await sendWhatsAppMessage(phoneNumber, message);
    await saveOutboundMessage({ userId, content: message, taskIds, kind: msgKind, providerMessageId: sendResult?.providerMessageId ?? undefined });
    console.log(
      `[WA] Result: query returned ${viewResult.tasks.length} tasks | ` +
      `category=${categoryFilter || 'all'} | date=${dateFilter || 'all'}`
    );
  } catch (error) {
    console.error('Error in handleTaskQuery:', error);
    await sendWhatsAppMessage(
      phoneNumber,
      "I couldn't retrieve your tasks - had trouble with that query."
    );
  }
}

/**
 * Handle edit requests using conversational focus
 */
async function handleTaskEdit(
  userId: string,
  editText: string,
  phoneNumber: string
): Promise<void> {
  try {
    console.log(`✏️ Handling task edit: "${editText}"`);

    // SAFETY ASSERTION: Get current focus task
    const focusTaskId = getFocus(userId);
    
    if (!focusTaskId) {
      console.log(
        `[WA] Safety: NO FOCUS for edit | userId=${userId} | ` +
        `action=request_clarification`
      );
      
      // No focus set - DO NOT GUESS, ask for clarification
      const { data: recentTasks, error: queryError } = await supabase
        .from('tasks')
        .select('id, title, due_date, due_time')
        .eq('user_id', userId)
        .eq('source', 'whatsapp')
        .eq('is_done', false)
        .order('created_at', { ascending: false })
        .limit(3);

      if (queryError) {
        console.error('Error querying tasks:', queryError);
        throw queryError;
      }

      if (!recentTasks || recentTasks.length === 0) {
        console.log(
          `[WA] Safety: NO TASKS for clarification | userId=${userId} | ` +
          `action=send_directional_message`
        );
        await sendWhatsAppMessage(
          phoneNumber,
          "I'm not sure which task you want to change. Try saying the task name, or add a new task."
        );
        return;
      }

      // Show up to 3 recent tasks for clarification (DO NOT GUESS)
      console.log(
        `[WA] Safety: CLARIFICATION sent | userId=${userId} | ` +
        `taskCount=${recentTasks.length}`
      );
      let clarificationMessage = "Which task do you want to update?\n";
      
      recentTasks.forEach((task, index) => {
        clarificationMessage += `${index + 1}) ${task.title}\n`;
      });
      
      clarificationMessage += "\nReply with a number.";
      
      await sendWhatsAppMessage(phoneNumber, clarificationMessage);
      return;
    }
    
    console.log(
      `[WA] Safety: FOCUS exists | userId=${userId} | ` +
      `focusTaskId=${focusTaskId}`
    );

    // Fetch the focused task
    const { data: taskToEdit, error: fetchError } = await supabase
      .from('tasks')
      .select('id, title, due_date, due_time')
      .eq('id', focusTaskId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !taskToEdit) {
      console.error('Focus task not found:', focusTaskId);
      clearFocus(userId, 'focus_task_not_found');
      await sendWhatsAppMessage(
        phoneNumber,
        "I couldn't update anything just now. You can say the task name or add a new one."
      );
      return;
    }
    const lowerText = editText.toLowerCase();

    // Parse edit request
    let newDate = taskToEdit.due_date;
    let newTime = taskToEdit.due_time;
    let editType = '';

    // Date change detection
    if (lowerText.includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      newDate = tomorrow.toISOString().split('T')[0];
      editType = 'date';
    } else if (lowerText.includes('today')) {
      newDate = new Date().toISOString().split('T')[0];
      editType = 'date';
    } else if (lowerText.match(/\b(\d{1,2})\/(\d{1,2})\b/)) {
      // MM/DD format
      const match = lowerText.match(/\b(\d{1,2})\/(\d{1,2})\b/);
      const month = match![1].padStart(2, '0');
      const day = match![2].padStart(2, '0');
      const year = new Date().getFullYear();
      newDate = `${year}-${month}-${day}`;
      editType = 'date';
    }

    // Time change detection
    const timeMatch = lowerText.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] || '00';
      const meridiem = timeMatch[3].toLowerCase();

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      newTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
      editType = editType ? 'date and time' : 'time';
    } else if (lowerText.match(/\b(\d{1,2}):(\d{2})\b/)) {
      // 24-hour format
      const match = lowerText.match(/\b(\d{1,2}):(\d{2})\b/);
      const hours = match![1].padStart(2, '0');
      const minutes = match![2];
      newTime = `${hours}:${minutes}`;
      editType = editType ? 'date and time' : 'time';
    }

    // Check if any changes were detected
    if (newDate === taskToEdit.due_date && newTime === taskToEdit.due_time) {
      await sendWhatsAppMessage(
        phoneNumber,
        "I couldn't update anything just now. You can say the task name or add a new one."
      );
      return;
    }

    const normalizedNewTime = toHHMM(newTime) ?? newTime;
    const dateChanged = taskToEdit.due_date !== newDate;
    const timeChanged =
      (toHHMM(taskToEdit.due_time) ?? taskToEdit.due_time ?? '') !==
      (normalizedNewTime ?? '');

    // [R3] Use per-user timezone for schedule recompute, fallback to DEFAULT_TZ.
    const tz = await getUserTimezoneByAuthUserId(userId);
    const dueAtISO = computeDueAtFromLocal(tz, newDate, normalizedNewTime);
    const remindAtISO = computeRemindAtFromDueAt(dueAtISO);

    const updatePayload: Record<string, unknown> = {
      due_date: newDate,
      due_time: normalizedNewTime,
      due_at: dueAtISO,
      remind_at: remindAtISO,
      ...(dateChanged && { inferred_date: false }),
      ...(timeChanged && { inferred_time: false }),
    };

    const { error: updateError } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', taskToEdit.id);

    if (updateError) {
      console.error('Error updating task:', updateError);
      throw updateError;
    }

    // Build confirmation message
    let confirmation = `Done - I've updated "${taskToEdit.title}" to `;

    const isToday = newDate === new Date().toISOString().split('T')[0];
    const isTomorrow = (() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return newDate === tomorrow.toISOString().split('T')[0];
    })();

    if (isToday && newTime) {
      confirmation += `today at ${newTime}`;
    } else if (isToday) {
      confirmation += 'today';
    } else if (isTomorrow && newTime) {
      confirmation += `tomorrow at ${newTime}`;
    } else if (isTomorrow) {
      confirmation += 'tomorrow';
    } else if (newDate && newTime) {
      confirmation += `${newDate} at ${newTime}`;
    } else if (newDate) {
      confirmation += newDate;
    } else if (newTime) {
      confirmation += newTime;
    }

    confirmation += '.';

    // Maintain focus on edited task
    setFocus(userId, taskToEdit.id);

    await sendWhatsAppMessage(phoneNumber, confirmation);
    console.log(
      `[WA] Result: updated taskId=${taskToEdit.id} | ` +
      `editType=${editType} | focusAfter=${taskToEdit.id}`
    );
  } catch (error) {
    console.error('Error in handleTaskEdit:', error);
    await sendWhatsAppMessage(
      phoneNumber,
      "I couldn't update anything just now. You can say the task name or add a new one."
    );
  }
}

/**
 * Handle user's response to edit clarification
 * Returns true if a pending edit was found and applied, false otherwise
 */
async function handleEditClarification(
  userId: string,
  taskNumber: number,
  phoneNumber: string
): Promise<boolean> {
  try {
    // Check if the last outbound message was a clarification
    const { data: recentMessages, error: messageError } = await supabase
      .from('whatsapp_messages')
      .select('content, created_at')
      .eq('user_id', userId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1);

    if (messageError || !recentMessages || recentMessages.length === 0) {
      return false;
    }

    const lastMessage = recentMessages[0];
    
    // Check if the last message was a clarification (contains "Which task do you want to update?")
    if (!lastMessage.content.includes('Which task do you want to update?')) {
      return false;
    }

    // Check if the clarification is recent (within 2 hours, matching focus TTL)
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
    if (new Date(lastMessage.created_at) < twoHoursAgo) {
      await sendWhatsAppMessage(phoneNumber, "That was a while ago. What would you like to change now?");
      clearFocus(userId, 'clarification_expired');
      return true; // Handled the expired clarification
    }

    console.log(`🔢 Found recent clarification, applying to task #${taskNumber}`);

    // Get recent tasks (not time-limited, just show latest open tasks)
    const { data: recentTasks, error: queryError } = await supabase
      .from('tasks')
      .select('id, title, due_date, due_time')
      .eq('user_id', userId)
      .eq('source', 'whatsapp')
      .eq('is_done', false)
      .order('created_at', { ascending: false })
      .limit(3);

    if (queryError || !recentTasks || recentTasks.length === 0) {
      await sendWhatsAppMessage(phoneNumber, "I couldn't update anything just now. You can say the task name or add a new one.");
      return true; // Still return true because we handled the clarification
    }

    // Validate task number
    if (taskNumber < 1 || taskNumber > recentTasks.length) {
      await sendWhatsAppMessage(
        phoneNumber,
        `Please reply with a number between 1 and ${recentTasks.length}.`
      );
      return true;
    }

    const selectedTask = recentTasks[taskNumber - 1];

    // Get the most recent inbound message before the clarification to extract edit intent
    const { data: userMessages, error: userMessageError } = await supabase
      .from('whatsapp_messages')
      .select('content')
      .eq('user_id', userId)
      .eq('direction', 'inbound')
      .lt('created_at', lastMessage.created_at)
      .order('created_at', { ascending: false })
      .limit(1);

    if (userMessageError || !userMessages || userMessages.length === 0) {
      await sendWhatsAppMessage(phoneNumber, "I couldn't update anything just now. You can say the task name or add a new one.");
      return true;
    }

    const originalEditText = userMessages[0].content.toLowerCase();

    // Parse the original edit request
    let newDate = selectedTask.due_date;
    let newTime = selectedTask.due_time;

    // Date change detection
    if (originalEditText.includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      newDate = tomorrow.toISOString().split('T')[0];
    } else if (originalEditText.includes('today')) {
      newDate = new Date().toISOString().split('T')[0];
    } else if (originalEditText.match(/\b(\d{1,2})\/(\d{1,2})\b/)) {
      const match = originalEditText.match(/\b(\d{1,2})\/(\d{1,2})\b/);
      const month = match![1].padStart(2, '0');
      const day = match![2].padStart(2, '0');
      const year = new Date().getFullYear();
      newDate = `${year}-${month}-${day}`;
    }

    // Time change detection
    const timeMatch = originalEditText.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] || '00';
      const meridiem = timeMatch[3].toLowerCase();

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      newTime = `${hours.toString().padStart(2, '0')}:${minutes}`;
    } else if (originalEditText.match(/\b(\d{1,2}):(\d{2})\b/)) {
      const match = originalEditText.match(/\b(\d{1,2}):(\d{2})\b/);
      const hours = match![1].padStart(2, '0');
      const minutes = match![2];
      newTime = `${hours}:${minutes}`;
    }

    const normalizedNewTime = toHHMM(newTime) ?? newTime;
    const dateChanged = selectedTask.due_date !== newDate;
    const timeChanged =
      (toHHMM(selectedTask.due_time) ?? selectedTask.due_time ?? '') !==
      (normalizedNewTime ?? '');

    // [R3] Use per-user timezone for schedule recompute, fallback to DEFAULT_TZ.
    const tz = await getUserTimezoneByAuthUserId(userId);
    const dueAtISO = computeDueAtFromLocal(tz, newDate, normalizedNewTime);
    const remindAtISO = computeRemindAtFromDueAt(dueAtISO);

    const updatePayload: Record<string, unknown> = {
      due_date: newDate,
      due_time: normalizedNewTime,
      due_at: dueAtISO,
      remind_at: remindAtISO,
      ...(dateChanged && { inferred_date: false }),
      ...(timeChanged && { inferred_time: false }),
    };

    const { error: updateError } = await supabase
      .from('tasks')
      .update(updatePayload)
      .eq('id', selectedTask.id);

    if (updateError) {
      console.error('Error updating task:', updateError);
      throw updateError;
    }

    // Build confirmation message
    let confirmation = `Done - I've updated "${selectedTask.title}" to `;

    const isToday = newDate === new Date().toISOString().split('T')[0];
    const isTomorrow = (() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return newDate === tomorrow.toISOString().split('T')[0];
    })();

    if (isToday && newTime) {
      confirmation += `today at ${newTime}`;
    } else if (isToday) {
      confirmation += 'today';
    } else if (isTomorrow && newTime) {
      confirmation += `tomorrow at ${newTime}`;
    } else if (isTomorrow) {
      confirmation += 'tomorrow';
    } else if (newDate && newTime) {
      confirmation += `${newDate} at ${newTime}`;
    } else if (newDate) {
      confirmation += newDate;
    } else if (newTime) {
      confirmation += newTime;
    }

    confirmation += '.';

    // Set focus to the updated task
    setFocus(userId, selectedTask.id);

    await sendWhatsAppMessage(phoneNumber, confirmation);
    console.log(`✅ Updated task "${selectedTask.title}" via clarification`);
    return true;
  } catch (error) {
    console.error('Error in handleEditClarification:', error);
    await sendWhatsAppMessage(
      phoneNumber,
      "I couldn't update anything just now. You can say the task name or add a new one."
    );
    return true; // Return true to indicate we handled the clarification attempt
  }
}

/**
 * Check if there's a pending clarification and cancel it
 * Returns true if a clarification was found and cancelled, false otherwise
 */
async function checkAndClearPendingClarification(
  userId: string,
  phoneNumber: string
): Promise<boolean> {
  try {
    // Check if the last outbound message was a clarification
    const { data: recentMessages, error: messageError } = await supabase
      .from('whatsapp_messages')
      .select('content, created_at')
      .eq('user_id', userId)
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1);

    if (messageError || !recentMessages || recentMessages.length === 0) {
      return false;
    }

    const lastMessage = recentMessages[0];
    
    // Check if the last message was a clarification (contains "Which task do you want to update?")
    if (!lastMessage.content.includes('Which task do you want to update?')) {
      return false;
    }

    // Check if the clarification is recent (within 2 hours, matching focus TTL)
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);
    if (new Date(lastMessage.created_at) < twoHoursAgo) {
      return false; // Clarification is too old, let message continue to normal flow
    }

    console.log('❌ Cancelling pending clarification');
    
    // Clear focus and send cancellation message
    clearFocus(userId, 'user_cancelled');
    await sendWhatsAppMessage(phoneNumber, "Okay, I didn't make any changes.");
    
    return true;
  } catch (error) {
    console.error('Error in checkAndClearPendingClarification:', error);
    return false;
  }
}