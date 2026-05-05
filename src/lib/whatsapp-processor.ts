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
import { log, warn, error as logError, logInterpretation, logExecutionPlan, logClassification, logNormalization, logSufficiency, logResponseSafety } from '@/lib/logger';
import { auditTurn, auditCorrection } from '@/lib/auditLog';
import { interpretTurn } from '@/lib/turnInterpreter';
import { detectCategory } from './categories';
import { toHHMM } from './taskRulesParser';
import { processWithLaya, ConversationMessage } from './laya-brain';
import { transcribeAudioFromWhatsApp } from './openai';
import { sendWhatsAppMessage } from './whatsapp-client';
import { splitBrainDump } from './brainDumpParser';
import { textToProposedTasksFromSegments, type ProposedTask } from './task_intake';
import { parseCompoundIntent, type CompoundListAction } from './compoundIntentParser';
import {
  getConversationState,
  upsertConversationState,
  clearConversationState,
  type WaConversationState,
} from '@/lib/waConversationState';
import {
  detectTaskFollowUpIntent,
  detectListItemFollowUpIntent,
  detectEntityToListIntent,
} from '@/lib/waFollowUpParser';
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
import { safeResponseGuard } from '@/lib/responseSafetyLayer';
import { detectUnsupportedFeature } from '@/lib/unsupportedFeatureDetector';
import type { PendingConfirmation } from '@/lib/waConversationState';

// ============================================
// SUPABASE CLIENT
// ============================================

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for backend operations
);

// ============================================
// NON-ENGLISH DETECTION + TRANSLATION
// ============================================

/**
 * Heuristic: returns true when the text likely contains non-English script.
 * Detects scripts with Unicode ranges well outside Latin (Arabic, Devanagari,
 * CJK, Cyrillic, Hebrew, Thai, etc.).
 * Does NOT trigger on English words with diacritics (café, naïve, etc.).
 */
function looksNonEnglish(text: string): boolean {
  // Non-ASCII script ranges: Arabic, Hebrew, Devanagari, CJK, Hangul, Thai, Cyrillic, etc.
  const NON_LATIN_RE = /[\u0600-\u06FF\u0590-\u05FF\u0900-\u097F\u4E00-\u9FFF\uAC00-\uD7AF\u0E00-\u0E7F\u0400-\u04FF]/;
  if (NON_LATIN_RE.test(text)) return true;

  // Heuristic: if >50% of words are unrecognised as English characters, flag it.
  const words = text.trim().split(/\s+/);
  if (words.length < 3) return false; // too short to judge
  const nonLatinWords = words.filter((w) => /[^\x00-\x7F]/.test(w));
  return nonLatinWords.length / words.length > 0.5;
}

/**
 * Translate text to English using LLM.
 * Returns null on any error (caller should skip translation flow).
 */
async function translateToEnglish(text: string): Promise<string | null> {
  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You translate text to English. Reply with ONLY the English translation, nothing else.',
        },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 200,
    });
    const translated = response.choices[0]?.message?.content?.trim();
    return translated || null;
  } catch {
    return null;
  }
}

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

/**
 * Plain social phrases that must never be treated as task titles.
 * The guard is an exact-match check on the trimmed, lowercased message so
 * "reminder: hi" still reaches task creation.
 */
const CHIT_CHAT_PHRASES = new Set([
  'hi', 'hey', 'hello', 'hiya', 'howdy',
  'thanks', 'thank you', 'ty', 'thx',
  'ok', 'okay', 'k', 'kk',
  'great', 'awesome', 'nice', 'cool', 'good',
  'sure', 'yep', 'yes', 'yup', 'yeah',
  'nope', 'no', 'nah',
  'got it', 'got it!', 'noted',
  'bye', 'goodbye', 'cya',
]);

// userFocusStore (in-memory Map) replaced by wa_conversation_state (durable DB).
// See src/lib/waConversationState.ts.

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
      ? message.content.substring(0, 60) + (message.content.length > 60 ? '...' : '')
      : null;
    log(
      `[WA] Inbound | phone=${message.phoneNumber} | ` +
      `msgId=${message.messageId} | type=${message.messageType} | ` +
      `textLen=${message.content?.length || 0} | ` +
      `preview="${textPreview || 'N/A'}"`
    );

    // 1. Get or create user (returns auth_user_id or null)
    const userId = await getOrCreateUser(message.phoneNumber);
    if (!userId) {
      // User requires account linking
      log(`[WA] Route: LINKING | phone=${message.phoneNumber} → sending link message`);
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

    log(`[WA] User resolved | phone=${message.phoneNumber} | userId=${userId}`);

    // 1b. Handle image/document: OCR → canonical intake → insert (wa_media)
    if ((message.messageType === 'image' || message.messageType === 'document') && message.mediaUrl) {
      log(`[WA] Route: MEDIA | userId=${userId} | type=${message.messageType}`);
      await handleWhatsAppMedia(userId, message);
      return;
    }

    // 2. Get final text content (transcribe audio if needed)
    let finalText: string;
    let audioUrl: string | null = null;

    if (message.messageType === 'audio' && message.audioId) {
      log(`[WA] Route: AUDIO | userId=${userId} | transcribing...`);
      // audioId for Gupshup is the direct media URL
      const transcription = await transcribeAudioFromWhatsApp(
        message.audioId,
        userId,
        message.messageId
      );
      finalText = transcription.text;
      audioUrl = transcription.audioUrl;
      log(`[WA] Transcription complete | text="${finalText.substring(0, 80)}"`);
    } else if (message.content) {
      finalText = message.content;
      log(`[WA] Text content | userId=${userId} | text="${finalText.substring(0, 80)}"`);
    } else {
      logError('[WA] No content or audio to process | userId=' + userId);
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
      log(`[WA] Route: OPT-OUT | userId=${userId}`);
      
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
      log(`[WA] Route: OPT-IN | userId=${userId}`);
      
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
      log(`[WA] Route: DIGEST-OPT-IN | userId=${userId}`);
      
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
      log(`[WA] Route: DIGEST-OPT-OUT | userId=${userId}`);
      
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

    // [NEW] 3.0 Load durable conversation state once per turn.
    // convState is null when no prior context exists or when the row has expired.
    const convState = await getConversationState(userId);

    // [NEW] 3a-clarification-apply. Proper FSM check for clarification_pending.
    // Replaces the old brittle content-string hack (checkAndClearPendingClarification).
    const pendingClarification = await getActivePendingClarification(userId);
    if (pendingClarification) {
      const numMatch = /^([1-9]\d*)$/.exec(lowerTrimmed);
      const isNegative = ['no', 'not that', 'never mind', 'nevermind', 'cancel'].includes(lowerTrimmed);

      if (isNegative) {
        log(`[WA] Route: CLARIFICATION-CANCEL | userId=${userId}`);
        await deletePendingClarification(pendingClarification.id);
        await sendWhatsAppMessage(message.phoneNumber, "Okay, no changes made.");
        return;
      }

      if (numMatch) {
        const selectedIndex = parseInt(numMatch[1]!, 10) - 1;
        const candidates = pendingClarification.payload.candidates;
        if (selectedIndex >= 0 && selectedIndex < candidates.length) {
          const selected = candidates[selectedIndex]!;
          const pending = pendingClarification.payload.pendingAction;
          log(`[WA] Route: CLARIFICATION-APPLY | userId=${userId} | selected=${selected.id}`);
          await deletePendingClarification(pendingClarification.id);
          if (pending?.type === 'add_item') {
            // Execute the deferred add-item action
            const listResult = await getListByName(pendingClarification.app_user_id, selected.title);
            const list = listResult && !('type' in listResult) ? listResult : null;
            if (list) {
              await insertListItems({ appUserId: pendingClarification.app_user_id, listId: list.id, items: [pending.item], source: 'whatsapp' });
              await upsertConversationState(userId, { active_list_id: list.id, last_list_name: list.name });
              await sendWhatsAppMessage(message.phoneNumber, `Added "${pending.item}" to *${list.name}*.`);
            } else {
              await sendWhatsAppMessage(message.phoneNumber, "I couldn't find that list. Try again with the full name.");
            }
          } else {
            // Selection resolved a pronoun reference — update active task
            await upsertConversationState(userId, { active_task_id: selected.id, last_task_title: selected.title });
            await sendWhatsAppMessage(message.phoneNumber, `Got it — now focusing on "*${selected.title}*". What would you like to do with it?`);
          }
          return;
        }
        // Out of range
        await sendWhatsAppMessage(
          message.phoneNumber,
          `Please reply with a number between 1 and ${candidates.length}.`
        );
        return;
      }

      // Unrecognized reply — re-send the clarification prompt
      const lines = pendingClarification.payload.candidates
        .map((c, i) => `${i + 1}) ${c.title}`)
        .join('\n');
      await sendWhatsAppMessage(message.phoneNumber, `Which one did you mean?\n${lines}\n\nReply with a number.`);
      return;
    }

    // 3a. Check for negative confirmation (no active clarification — continue with normal flow)
    const isNegativeConfirmation = 
      lowerTrimmed === 'no' ||
      lowerTrimmed === 'not that' ||
      lowerTrimmed === 'never mind' ||
      lowerTrimmed === 'nevermind' ||
      lowerTrimmed === 'cancel';

    if (isNegativeConfirmation) {
      log(`[WA] Route: NEGATIVE-CONFIRMATION | userId=${userId}`);
      // No pending clarification row found — fall through to normal flow
    }

    // 3a-undo. UNDO handler: restore last deleted tasks within 5 min window
    if (lowerTrimmed === 'undo') {
      log(`[WA] Route: UNDO | userId=${userId}`);
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
      log(`[WA] Route: DELETE | userId=${userId} | kind=${deleteIntent.kind}`);
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
      // Keep active_task_id current after edit so further follow-ups work
      if (updatedTask) {
        await upsertConversationState(userId, {
          active_task_id: activePending.task_id,
          last_task_title: updatedTask.title ?? undefined,
        });
      }
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
      log(`[WA] Route: EDIT-SELECT | userId=${userId} | kind=${editSelectionIntent.kind}`);
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

        // New interruption exits: delete command, edit-select command, or a task-creation message
        const isDeleteCommand = parseDeleteIntent(finalText) !== null;
        const isEditSelectCommand = parseEditSelectionIntent(finalText) !== null;
        const compoundCheckForInterrupt = parseCompoundIntent(finalText);
        const isTaskCreationMessage = compoundCheckForInterrupt.tasks.length > 0 && compoundCheckForInterrupt.listActions.length === 0;

        const shouldExitQuickAdd =
          isExitPhrase || isAddToDifferentList || isDoneRemove || isListCommand || isTaskQuery ||
          isDeleteCommand || isEditSelectCommand || isTaskCreationMessage;

        if (shouldExitQuickAdd) {
          await clearQuickAdd(userId);
          // Do NOT return — let the message fall through to the appropriate handler
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

    // [NEW] 3.4 Follow-up resolution — only runs when prior conversation state exists.
    // These three sub-steps handle implicit references like "make it Friday",
    // "add curd too", or "add it to shopping" that target the last active task/list.
    if (convState) {
      // 3.4a Task follow-up: "make it Friday", "move it to tomorrow", "delete it"
      const taskFollowUp = detectTaskFollowUpIntent(finalText);
      if (taskFollowUp && convState.active_task_id) {
        log(`[WA] Route: TASK-FOLLOW-UP | type=${taskFollowUp.type} | taskId=${convState.active_task_id}`);
        if (taskFollowUp.type === 'delete') {
          // Delegate to the existing delete flow via a synthetic delete intent
          // by falling through — but first clear state so we don't loop
          await upsertConversationState(userId, { active_task_id: null, last_task_title: null });
        } else if (taskFollowUp.type === 'mark_done') {
          const { error: doneErr } = await supabase
            .from('tasks')
            .update({ is_done: true, done_at: new Date().toISOString() })
            .eq('id', convState.active_task_id)
            .eq('user_id', userId);
          if (!doneErr) {
            const title = convState.last_task_title ?? 'that task';
            await sendWhatsAppMessage(message.phoneNumber, `Done! Marked *${title}* as complete. ✅`);
            await upsertConversationState(userId, { active_task_id: null, last_task_title: null });
            return;
          }
        } else if (taskFollowUp.type === 'patch') {
          const patch = taskFollowUp.patch;
          const tz = await getUserTimezoneByAuthUserId(userId);
          const updatePayload: Parameters<typeof updateTaskFields>[0]['patch'] = {};
          if (patch.title !== undefined) updatePayload.title = patch.title;
          if (patch.due_date !== undefined) updatePayload.due_date = patch.due_date;
          if (patch.due_time !== undefined) updatePayload.due_time = patch.due_time;
          if (patch.category !== undefined) updatePayload.category = patch.category;
          const hasChanges = Object.keys(updatePayload).length > 0;
          if (hasChanges) {
            // We need app_user_id for updateTaskFields — look it up from convState or supabase
            const { data: appUserRow } = await supabase
              .from('app_users')
              .select('id')
              .eq('auth_user_id', userId)
              .maybeSingle<{ id: string }>();
            if (appUserRow) {
              const { updatedTask } = await updateTaskFields({
                appUserId: appUserRow.id,
                taskId: convState.active_task_id,
                patch: updatePayload,
                timezone: tz,
                source: 'whatsapp',
                authUserId: userId,
              });
              const summary = formatEditConfirmation(updatedTask, patch);
              await sendWhatsAppMessage(message.phoneNumber, summary);
              if (updatedTask) {
                await upsertConversationState(userId, { last_task_title: updatedTask.title ?? undefined });
              }
              return;
            }
          }
        }
        // If none of the above fired cleanly, fall through to normal routing
      }

      // 3.4b List-item follow-up: "add curd too", "also add paneer", "add X and Y" (with active list)
      const listItemFollowUp = detectListItemFollowUpIntent(finalText, !!convState.active_list_id);
      if (listItemFollowUp && convState.active_list_id) {
        log(`[WA] Route: LIST-ITEM-FOLLOW-UP | listId=${convState.active_list_id}`);
        const { data: appUserRow } = await supabase
          .from('app_users')
          .select('id')
          .eq('auth_user_id', userId)
          .maybeSingle<{ id: string }>();
        if (appUserRow) {
          const { inserted } = await insertListItems({
            appUserId: appUserRow.id,
            listId: convState.active_list_id,
            items: listItemFollowUp.items,
            source: 'whatsapp',
          });
          const listName = convState.last_list_name ?? 'the list';
          if (inserted.length > 0) {
            const addedMsg =
              inserted.length === 1
                ? `Added *${inserted[0]!.text}* to *${listName}*.`
                : `Added ${inserted.length} items to *${listName}*:\n${inserted.map((i) => `• ${i.text}`).join('\n')}`;
            await sendWhatsAppMessage(message.phoneNumber, addedMsg);
          } else {
            await sendWhatsAppMessage(message.phoneNumber, `No new items added — already in *${listName}*.`);
          }
          return;
        }
      }

      // 3.4c Entity-to-list follow-up: "add it to shopping", "put it in grocery"
      const entityToList = detectEntityToListIntent(finalText);
      if (entityToList !== null && convState.last_entity_text) {
        log(`[WA] Route: ENTITY-TO-LIST | entity="${convState.last_entity_text}" | listName="${entityToList.listName}"`);
        const { data: appUserRow } = await supabase
          .from('app_users')
          .select('id')
          .eq('auth_user_id', userId)
          .maybeSingle<{ id: string }>();
        if (appUserRow) {
          if (entityToList.listName) {
            const allLists = await getUserLists(appUserRow.id);
            const lower = entityToList.listName.toLowerCase();
            const exact = allLists.filter((l: ListInfo) => l.name.toLowerCase() === lower);
            const partial = allLists.filter((l: ListInfo) => l.name.toLowerCase().includes(lower));
            const matches = exact.length > 0 ? exact : partial;

            if (matches.length === 1) {
              const target = matches[0]!;
              await insertListItems({
                appUserId: appUserRow.id,
                listId: target.id,
                items: [convState.last_entity_text],
                source: 'whatsapp',
              });
              await upsertConversationState(userId, { active_list_id: target.id, last_list_name: target.name });
              await sendWhatsAppMessage(
                message.phoneNumber,
                `Added *${convState.last_entity_text}* to *${target.name}*.`
              );
              return;
            } else if (matches.length > 1) {
              // Ambiguous — create clarification_pending
              await insertPendingClarification(userId, appUserRow.id, {
                questionType: 'which_list',
                candidates: matches.map((l: ListInfo) => ({ id: l.id, title: l.name })),
                pendingAction: { type: 'add_item', listName: entityToList.listName!, item: convState.last_entity_text },
              });
              const prompt = `Which list?\n${matches.map((l: ListInfo, i: number) => `${i + 1}) ${l.name}`).join('\n')}\n\nReply with a number.`;
              await sendWhatsAppMessage(message.phoneNumber, prompt);
              return;
            } else {
              await sendWhatsAppMessage(
                message.phoneNumber,
                `I couldn't find a list called "${entityToList.listName}". Say "create list ${entityToList.listName}" to create it.`
              );
              return;
            }
          } else {
            // No list name specified — ask with clarification
            const allLists = await getUserLists(appUserRow.id);
            if (allLists.length > 0) {
              await insertPendingClarification(userId, appUserRow.id, {
                questionType: 'which_list',
                candidates: allLists.slice(0, 5).map((l: ListInfo) => ({ id: l.id, title: l.name })),
                pendingAction: { type: 'add_item', listName: '', item: convState.last_entity_text },
              });
              const prompt = `Which list should I add *${convState.last_entity_text}* to?\n${allLists.slice(0, 5).map((l: ListInfo, i: number) => `${i + 1}) ${l.name}`).join('\n')}\n\nReply with a number.`;
              await sendWhatsAppMessage(message.phoneNumber, prompt);
            } else {
              await sendWhatsAppMessage(message.phoneNumber, "You don't have any lists yet. Say \"create list <name>\" to make one.");
            }
            return;
          }
        }
      }
    }

    // 3b-add-to-list. Add items to list (reply-anchored or by name)
    const addToListIntent = detectAddToListIntent(finalText);
    if (addToListIntent && addToListIntent.items.length > 0) {
      log(`[WA] Route: ADD-TO-LIST | userId=${userId} | items=${addToListIntent.items.length}`);
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

    // 3c. Detect query intent — anchored patterns only.
    // Previously used .includes() which stole messages that merely contained the
    // word "what" or "show" as part of a task title (e.g. "what to buy tomorrow"
    // → misrouted to task query instead of compound capture).
    // Now uses word-boundary anchored regex patterns that require the query word
    // to appear as a standalone intent, not embedded in a task description.
    const lowerText = finalText.toLowerCase().trim();
    const QUERY_ANCHOR_RE = /^(?:what(?:'s|\s+are|\s+do|\s+is)?\s+(?:my\s+)?(?:tasks?|todos?|due|on|for)|show(?:\s+my)?\s+(?:tasks?|todos?)|tell\s+me\s+(?:my|about\s+my)\s+tasks?|do\s+i\s+have\s+(?:any\s+)?tasks?)/i;
    const isQuery = QUERY_ANCHOR_RE.test(lowerText);

    if (isQuery) {
      log(`[WA] Route: QUERY | userId=${userId} | text="${finalText.substring(0, 80)}"`);
      await handleTaskQuery(userId, finalText, message.phoneNumber);
      return; // Exit early, don't create tasks
    }

    // 4. Greeting guard — short-circuit social phrases before compound capture
    const lowerTrimmedCapture = finalText.trim().toLowerCase();
    if (CHIT_CHAT_PHRASES.has(lowerTrimmedCapture)) {
      log(`[WA] Route: CHIT-CHAT | userId=${userId} | text="${lowerTrimmedCapture}"`);
      const chitChatReply = "Got it! Send me a task or ask 'show my tasks' to see what's on your list.";
      const sendResult = await sendWhatsAppMessage(message.phoneNumber, chitChatReply);
      await saveOutboundMessage({
        userId,
        content: chitChatReply,
        kind: 'chit_chat',
        providerMessageId: sendResult?.providerMessageId,
      });
      return;
    }

    // 5. Compound capture — parse all intents (lists + items + tasks) in one pass.
    //    Falls back to processWithLaya only when nothing was recognised.
    log(`[WA] Route: COMPOUND-CAPTURE | userId=${userId} | text="${finalText.substring(0, 80)}"`);
    await handleCompoundCapture(userId, finalText, message.phoneNumber, inboundMessageId, message.replyToMessage ?? null, convState);
  } catch (error) {
    logError('[WA] processWhatsAppMessage crashed:', error);
    
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
        logError(`[WA] getOrCreateUser: failed to insert new whatsapp_users row | phone=${phoneNumber}`, error);
        return null;
      }

      log(`[WA] getOrCreateUser: new unlinked user created | phone=${phoneNumber}`);
      return null; // Requires linking
    }

    // If user exists but NOT linked, return null
    if (!whatsappUser.auth_user_id) {
      warn(`[WA] getOrCreateUser: user exists but NOT linked | phone=${phoneNumber}`);
      return null;
    }

    // Update last_active and return auth_user_id
    await supabase
      .from('whatsapp_users')
      .update({ last_active: new Date().toISOString() })
      .eq('id', whatsappUser.id);

    log(`[WA] getOrCreateUser: linked | phone=${phoneNumber} | authUserId=${whatsappUser.auth_user_id}`);
    return whatsappUser.auth_user_id; // ✅ Returns auth.users.id
  } catch (error) {
    logError('[WA] getOrCreateUser threw:', error);
    return null;
  }
}

/**
 * Resolve the whatsapp_users.id (PK) from an auth_user_id.
 * messages.user_id FK references whatsapp_users.id, not auth.users.id.
 */
async function resolveWhatsappUserId(authUserId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('whatsapp_users')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle<{ id: string }>();
  if (error || !data) {
    logError(`[WA] resolveWhatsappUserId failed for authUserId=${authUserId}`, error);
    return null;
  }
  return data.id;
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
    const waUserId = await resolveWhatsappUserId(params.userId);
    if (!waUserId) {
      logError(`[WA] saveInboundMessage: could not resolve whatsapp_users.id for authUserId=${params.userId}`);
      return null;
    }
    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: waUserId,
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
      logError('[WA] saveInboundMessage insert failed:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    logError('[WA] saveInboundMessage threw:', error);
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
    const waUserId = await resolveWhatsappUserId(params.userId);
    if (!waUserId) {
      logError(`[WA] saveOutboundMessage: could not resolve whatsapp_users.id for authUserId=${params.userId}`);
      return null;
    }
    const { data, error } = await supabase
      .from('messages')
      .insert({
        user_id: waUserId,
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
      logError('[WA] saveOutboundMessage insert failed:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    logError('[WA] saveOutboundMessage threw:', error);
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

// ---- Clarification pending action ----

type ClarificationCandidate = { id: string; title: string };
type ClarificationPayload = {
  questionType: 'which_task' | 'which_list' | 'unresolved_pronoun';
  candidates: ClarificationCandidate[];
  pendingAction?: { type: 'add_item'; listName: string; item: string };
};
type PendingClarificationRow = {
  id: string;
  auth_user_id: string;
  app_user_id: string;
  expires_at: string;
  payload: ClarificationPayload;
};

async function getActivePendingClarification(
  authUserId: string
): Promise<PendingClarificationRow | null> {
  const { data } = await supabase
    .from('wa_pending_actions')
    .select('id, auth_user_id, app_user_id, expires_at, payload')
    .eq('auth_user_id', authUserId)
    .eq('action_type', 'clarification_pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as PendingClarificationRow | null;
}

async function deletePendingClarification(rowId: string): Promise<void> {
  await supabase.from('wa_pending_actions').delete().eq('id', rowId);
}

async function insertPendingClarification(
  authUserId: string,
  appUserId: string,
  payload: ClarificationPayload
): Promise<void> {
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await supabase.from('wa_pending_actions').insert({
    auth_user_id: authUserId,
    app_user_id: appUserId,
    action_type: 'clarification_pending',
    expires_at: expiresAt,
    payload,
  });
}

// ---- Active pending edit ----

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
 * Compound capture handler — replaces the old single-intent handleListCreate + createTasksFromTextRules.
 *
 * Parses the full message into compound intents (list creates, list item adds, tasks) in one pass
 * using the shared parseCompoundIntent pipeline, then executes all writes and sends one combined reply.
 *
 * Falls back to processWithLaya (AI) only when no rules-based content was recognised.
 * When rules-based content exists, the AI path is skipped entirely to avoid legacy grocery side-writes.
 */
/** Deferred list disambiguation — collected when >1 list matches in compound capture. */
interface DeferredListClarification {
  items: string[];
  matches: { id: string; name: string }[];
}

// ---- YES/NO reply patterns for pending confirmations ----
const YES_RE = /^(yes|y|yep|yeah|yup|confirm|ok|okay|sure|do\s+it|go\s+ahead)\b/i;
const NO_RE = /^(no|n|nope|cancel|stop|never\s*mind|nevermind|abort|don'?t)\b/i;
const ADD_RE = /^(add|yes|y|yep)\b/i;
const NEW_RE = /^(new|create\s+new|no)\b/i;

/**
 * Execute a confirmed destructive action (task delete or list item remove).
 * Called when user replies YES to a pending_confirmation prompt.
 */
async function executePendingConfirmation(
  confirmation: PendingConfirmation,
  appUserId: string,
  phoneNumber: string,
  userId: string,
): Promise<void> {
  if (confirmation.type === 'task_delete') {
    const { error } = await supabase
      .from('tasks')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', confirmation.taskId)
      .eq('app_user_id', appUserId);
    if (error) {
      await sendWhatsAppMessage(phoneNumber, `Couldn't delete "${confirmation.taskTitle}". Try again.`);
    } else {
      await sendWhatsAppMessage(phoneNumber, `Deleted "${confirmation.taskTitle}" ✓`);
      await upsertConversationState(userId, { active_task_id: null, last_task_title: null });
    }
  } else if (confirmation.type === 'list_item_remove') {
    let found: { id: string; list_id: string; text: string } | null = null;
    if (confirmation.listId) {
      found = await findListItemByText({ appUserId, listId: confirmation.listId, text: confirmation.item });
    } else {
      found = await findListItemByTextAcrossLists(appUserId, confirmation.item);
    }
    if (found) {
      await softDeleteListItem({ itemId: found.id, appUserId });
      const label = confirmation.listName ? ` from ${confirmation.listName}` : '';
      await sendWhatsAppMessage(phoneNumber, `Removed "${confirmation.item}"${label} ✓`);
    } else {
      await sendWhatsAppMessage(phoneNumber, `Couldn't find "${confirmation.item}" to remove. Try again.`);
    }
  }
}

async function handleCompoundCapture(
  userId: string,
  finalText: string,
  phoneNumber: string,
  inboundMessageId: string | null,
  replyToMessageId: string | null,
  convState: import('@/lib/waConversationState').WaConversationState | null = null
): Promise<void> {
  // ── 0a. Pending confirmation handler (YES/NO for destructive actions) ─────
  if (convState?.pending_confirmation) {
    const pending = convState.pending_confirmation as PendingConfirmation;
    const msgLower = finalText.trim();

    if (pending.type === 'translation') {
      if (YES_RE.test(msgLower)) {
        // User confirmed translation — re-process translated text
        await upsertConversationState(userId, { pending_confirmation: null });
        log(`[WA] translation confirmed | userId=${userId} | translated="${pending.translatedText}"`);
        await handleCompoundCapture(userId, pending.translatedText, phoneNumber, inboundMessageId, replyToMessageId, convState ? { ...convState, pending_confirmation: null } : null);
        return;
      } else if (NO_RE.test(msgLower)) {
        await upsertConversationState(userId, { pending_confirmation: null });
        await sendWhatsAppMessage(phoneNumber, "OK, please re-send in English and I'll capture it for you.");
        return;
      } else {
        // User provided a correction — process their corrected text directly
        await upsertConversationState(userId, { pending_confirmation: null });
        await handleCompoundCapture(userId, finalText, phoneNumber, inboundMessageId, replyToMessageId, convState ? { ...convState, pending_confirmation: null } : null);
        return;
      }
    }

    if (pending.type === 'list_disambig') {
      // ADD → add to existing; NEW → create new
      if (ADD_RE.test(msgLower)) {
        await upsertConversationState(userId, { pending_confirmation: null });
        const { data: appUserRow } = await supabase
          .from('app_users').select('id').eq('auth_user_id', userId).maybeSingle<{ id: string }>();
        const appUserId = appUserRow?.id;
        if (appUserId && pending.items.length > 0) {
          const { inserted } = await insertListItems({
            appUserId,
            listId: pending.existingListId,
            items: pending.items,
            source: 'whatsapp',
          });
          const lines = inserted.map((i) => `• ${i.text}`).join('\n');
          await sendWhatsAppMessage(phoneNumber, `Added to ${pending.existingListName}:\n${lines}`);
        } else {
          await sendWhatsAppMessage(phoneNumber, `Added to ${pending.existingListName} ✓`);
        }
        return;
      }
      if (NEW_RE.test(msgLower)) {
        await upsertConversationState(userId, { pending_confirmation: null });
        // Fall through to normal capture so the create_list runs fresh
      }
    } else if (YES_RE.test(msgLower)) {
      const { data: appUserRow } = await supabase
        .from('app_users').select('id').eq('auth_user_id', userId).maybeSingle<{ id: string }>();
      const appUserId = appUserRow?.id;
      await upsertConversationState(userId, { pending_confirmation: null });
      if (appUserId) {
        await executePendingConfirmation(pending, appUserId, phoneNumber, userId);
      } else {
        await sendWhatsAppMessage(phoneNumber, "Couldn't find your account. Try linking again.");
      }
      return;
    } else if (NO_RE.test(msgLower)) {
      await upsertConversationState(userId, { pending_confirmation: null });
      await sendWhatsAppMessage(phoneNumber, "OK, cancelled.");
      return;
    }
    // Not a YES/NO/ADD/NEW reply — clear pending and continue with normal flow
    // (user sent a new message instead of responding to the prompt)
    await upsertConversationState(userId, { pending_confirmation: null });
  }

  // ── 0b. Unsupported feature detection ────────────────────────────────────
  const unsupportedResult = detectUnsupportedFeature(finalText);
  if (unsupportedResult) {
    log(`[WA] unsupported feature detected: ${unsupportedResult.feature} | userId=${userId}`);
    await sendWhatsAppMessage(phoneNumber, unsupportedResult.message);
    await saveOutboundMessage({
      userId,
      content: unsupportedResult.message,
      kind: 'chit_chat',
    });
    return;
  }

  // ── 0c. Non-English detection + translation confirmation ─────────────────
  // Only check if pending_translation reply (YES) was not handled above.
  if (looksNonEnglish(finalText)) {
    log(`[WA] non-English input detected | userId=${userId}`);
    const translated = await translateToEnglish(finalText);
    if (translated && translated.toLowerCase() !== finalText.toLowerCase()) {
      const pending: PendingConfirmation = {
        type: 'translation',
        originalText: finalText,
        translatedText: translated,
        message: `I translated that as: "${translated}". Is that right? Reply YES to continue or correct me.`,
      };
      await upsertConversationState(userId, { pending_confirmation: pending });
      await sendWhatsAppMessage(phoneNumber, pending.message);
      return;
    }
    // Translation failed or identical — continue with original text
  }

  // --- Interpret turn (shared classification layer) ---
  const interpretation = await interpretTurn(finalText, convState, {
    channel: 'whatsapp',
    providerMessageId: inboundMessageId ?? undefined,
  });

  if (interpretation.log.classification) {
    logClassification(interpretation.log.classification);
  }
  logNormalization(interpretation.log.normalizationMeta, interpretation.turnId);
  logInterpretation(userId, interpretation);
  logExecutionPlan(userId, interpretation.executionPlan, interpretation.turnId);
  logSufficiency(userId, interpretation.log.sufficiencyResults, interpretation.turnId);

  // ── Filler: conversational messages with no task/list content ─────────────
  const isFillerOnly =
    interpretation.detectedActions.length === 1 &&
    interpretation.detectedActions[0]?.type === 'filler';
  if (isFillerOnly) {
    const fillerReply = "Sounds like a busy one. Let me know if you need to capture anything.";
    const sendResult = await sendWhatsAppMessage(phoneNumber, fillerReply);
    await saveOutboundMessage({ userId, content: fillerReply, kind: 'chit_chat', providerMessageId: sendResult?.providerMessageId });
    return;
  }

  // ── LLM needs_clarification: ambiguous input before any DB work ──────────
  const needsClarificationAction = interpretation.detectedActions.find(
    (a) => a.type === 'needs_clarification'
  ) as (Extract<(typeof interpretation.detectedActions)[0], { type: 'needs_clarification' }> | undefined);
  if (needsClarificationAction && interpretation.detectedActions.filter(a => a.type !== 'needs_clarification').length === 0) {
    void auditTurn({ appUserId: null, interpretation });
    await sendWhatsAppMessage(phoneNumber, needsClarificationAction.question);
    return;
  }

  // ── Handle confirm steps from the execution plan ──────────────────────────
  // These are destructive actions (delete/remove) that need user confirmation.
  const confirmSteps = interpretation.executionPlan.filter((s) => s.kind === 'confirm');
  if (confirmSteps.length > 0) {
    const { data: appUserRow } = await supabase
      .from('app_users').select('id').eq('auth_user_id', userId).maybeSingle<{ id: string }>();
    const appUserId = appUserRow?.id ?? null;
    void auditTurn({ appUserId, interpretation });

    const firstConfirm = confirmSteps[0]!;
    const action = firstConfirm.action;
    let pending: PendingConfirmation | null = null;

    if (action?.type === 'task_follow_up_delete') {
      pending = {
        type: 'task_delete',
        taskId: action.taskId,
        taskTitle: action.taskTitle ?? 'this task',
        message: firstConfirm.confirmationMessage ?? `Delete "${action.taskTitle}"? Reply YES to confirm, NO to cancel.`,
      };
    } else if (action?.type === 'remove_list_item') {
      pending = {
        type: 'list_item_remove',
        item: action.item,
        listId: action.listId,
        listName: action.listName,
        message: firstConfirm.confirmationMessage ?? `Remove "${action.item}"? Reply YES to confirm.`,
      };
    }

    if (pending) {
      await upsertConversationState(userId, { pending_confirmation: pending });
      await sendWhatsAppMessage(phoneNumber, pending.message);
      return;
    }
  }

  // If text-level analysis says we need clarification before any DB work, stop here.
  // (DB-level ambiguity — multiple list matches — is handled below with partial success.)
  if (interpretation.needsClarification && interpretation.detectedActions.length === 0) {
    void auditTurn({ appUserId: null, interpretation });
    const hint = interpretation.clarificationPayload?.hint ?? "Which task or list did you mean?";
    await sendWhatsAppMessage(phoneNumber, hint);
    return;
  }

  // Resolve app_users.id once for all list operations
  const { data: appUser } = await supabase
    .from('app_users')
    .select('id')
    .eq('auth_user_id', userId)
    .maybeSingle<{ id: string }>();
  const appUserId = appUser?.id ?? null;

  // Persist audit log row (fire-and-forget — never blocks the response).
  void auditTurn({ appUserId, interpretation });

  // Correction detection: if this turn is a follow-up patch, find the most recent
  // prior turn for this user (within 60s) and mark it as corrected.
  const hasPatchAction = interpretation.detectedActions.some(
    (a) => a.type === 'task_follow_up_patch'
  );
  if (hasPatchAction && appUserId) {
    const sixtySecondsAgo = new Date(Date.now() - 60_000).toISOString();
    void Promise.resolve(
      supabase
        .from('ai_turn_log')
        .select('turn_id')
        .eq('user_id', appUserId)
        .neq('turn_id', interpretation.turnId)
        .is('corrected_turn_id', null)
        .gt('created_at', sixtySecondsAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle<{ turn_id: string }>()
        .then(({ data }) => {
          if (data?.turn_id) {
            void auditCorrection(data.turn_id, interpretation.turnId);
          }
        })
    ).catch(() => {});
  }

  // Re-use compound from the interpretation to keep a single parse path.
  // Fall back to AI if nothing was recognised.
  const compound = {
    listActions: interpretation.detectedActions
      .filter((a) => a.type === 'create_list' || a.type === 'add_list_items')
      .map((a) =>
        a.type === 'create_list'
          ? ({ type: 'create_with_items' as const, listName: a.listName, items: a.items })
          : ({ type: 'add_to_existing' as const, listName: a.listName ?? '', items: a.items })
      ),
    tasks: interpretation.detectedActions
      .filter((a) => a.type === 'create_task')
      .map((a) => (a as Extract<typeof a, { type: 'create_task' }>).task),
    hasContent: interpretation.detectedActions.some(
      (a) => a.type === 'create_list' || a.type === 'add_list_items' || a.type === 'create_task'
    ),
  };

  log(`[WA] compound | userId=${userId} | listActions=${compound.listActions.length} | tasks=${compound.tasks.length}`);

  if (!compound.hasContent) {
    // Phase 4a gate fix: only invoke the AI fallback when rules AND LLM both found nothing.
    // If interpretTurn produced any actions (e.g. follow-up patch, remove_list_item, clarify)
    // those should be handled by the caller's routing, not laya-brain's legacy path.
    const hasAnyAction = interpretation.detectedActions.length > 0;
    if (hasAnyAction) {
      log(`[WA] compound: no capture content but has other actions, skipping AI fallback | userId=${userId} | actions=${interpretation.detectedActions.map(a => a.type).join(',')}`);
      return;
    }
    log(`[WA] compound: no content, falling back to AI | userId=${userId}`);
    await handleAiFallback(userId, finalText, phoneNumber, inboundMessageId, replyToMessageId, interpretation);
    return;
  }

  if (!appUserId) {
    await sendWhatsAppMessage(phoneNumber, "I couldn't find your account. Try linking again.");
    return;
  }

  // --- Execute list actions (partial success: collect deferred instead of returning early) ---
  const confirmParts: string[] = [];
  const allListIds: string[] = [];
  let lastCreatedListId: string | null = null;
  let lastCreatedListName: string | null = null;
  let createdListCount = 0;
  const deferredClarifications: DeferredListClarification[] = [];

  for (const action of compound.listActions) {
    if (action.type === 'create_with_items') {
      try {
        // ── List disambiguation: fuzzy-match existing lists before creating ─
        const { data: existingLists } = await supabase
          .from('lists')
          .select('id, name')
          .eq('app_user_id', appUserId)
          .is('deleted_at', null)
          .ilike('name', `%${action.listName.toLowerCase().replace(/\s+list\s*$/i, '').trim()}%`);
        const similar = (existingLists ?? []) as { id: string; name: string }[];
        if (similar.length > 0 && similar[0]!.name.toLowerCase().trim() !== action.listName.toLowerCase().trim()) {
          // A similar (but not identical) list exists — ask ADD or NEW
          const closest = similar[0]!;
          const pending: PendingConfirmation = {
            type: 'list_disambig',
            existingListId: closest.id,
            existingListName: closest.name,
            newListName: action.listName,
            items: action.items,
            message: `You have a list called "${closest.name}". Add to it, or create a new one? Reply ADD or NEW.`,
          };
          await upsertConversationState(userId, { pending_confirmation: pending });
          await sendWhatsAppMessage(phoneNumber, pending.message);
          return;
        }

        const { list } = await insertListWithIdempotency({
          appUserId,
          name: action.listName,
          source: 'whatsapp',
          sourceMessageId: inboundMessageId,
          importCandidates: null,
        });
        allListIds.push(list.id);
        createdListCount++;
        lastCreatedListId = list.id;
        lastCreatedListName = list.name;
        confirmParts.push(`Created list "${list.name}" ✓`);
        log(`[WA] compound: created list | listId=${list.id} | name="${list.name}"`);

        if (action.items.length > 0) {
          const { inserted } = await insertListItems({
            appUserId,
            listId: list.id,
            items: action.items,
            source: 'whatsapp',
          });
          if (inserted.length > 0) {
            confirmParts.push(
              `Added to ${list.name}:\n${inserted.map((i) => `• ${i.text}`).join('\n')}`
            );
          }
        } else {
          // No seed items — open quick-add so the next message goes directly into this list
          await upsertQuickAdd(userId, appUserId, list.id, list.name, 0);
        }
      } catch (err) {
        logError(`[WA] compound: failed to create list "${action.listName}"`, err);
      }
    } else if (action.type === 'add_to_existing') {
      // Resolve list by name (exact then contains)
      const { data: lists } = await supabase
        .from('lists')
        .select('id, name')
        .eq('app_user_id', appUserId)
        .is('deleted_at', null);
      const all = (lists ?? []) as { id: string; name: string }[];
      const exact = all.filter(
        (l) => l.name.toLowerCase().trim() === action.listName.toLowerCase().trim()
      );
      const contains = all.filter((l) =>
        l.name.toLowerCase().includes(action.listName.toLowerCase().trim())
      );
      const matches = exact.length > 0 ? exact : contains;

      if (matches.length === 1) {
        const target = matches[0]!;
        allListIds.push(target.id);
        const { inserted } = await insertListItems({
          appUserId,
          listId: target.id,
          items: action.items,
          source: 'whatsapp',
        });
        if (inserted.length > 0) {
          confirmParts.push(
            `Added to ${target.name}:\n${inserted.map((i) => `• ${i.text}`).join('\n')}`
          );
        }
        log(`[WA] compound: added ${inserted.length} item(s) to list "${target.name}"`);
      } else if (matches.length > 1) {
        // PARTIAL SUCCESS: collect for deferred clarification instead of returning early.
        // All other clear actions (tasks, unambiguous list ops) will still execute.
        log(`[WA] compound: ambiguous list name "${action.listName}" (${matches.length} matches) — deferring`);
        deferredClarifications.push({ items: action.items, matches });
      } else {
        confirmParts.push(`Couldn't find a list called "${action.listName}". Say "create list ${action.listName}" to create it.`);
      }
    }
  }

  // Persist last created list to durable state so "add curd too" follow-ups work
  if (lastCreatedListId && lastCreatedListName) {
    await upsertConversationState(userId, {
      active_list_id: lastCreatedListId,
      last_list_name: lastCreatedListName,
    });
  }

  // --- Execute task inserts ---
  const createdTaskIds: string[] = [];
  const taskConfirmations: string[] = [];

  if (compound.tasks.length > 0) {
    // ── Collision detection: check if any task already has the same date+time ─
    const tasksWithExplicitTime = compound.tasks.filter(
      (t) => t.due_date && t.due_time && !t.inferred_date && !t.inferred_time
    );
    if (tasksWithExplicitTime.length > 0) {
      for (const newTask of tasksWithExplicitTime) {
        const { data: existingAtTime } = await supabase
          .from('tasks')
          .select('id, title, due_date, due_time')
          .eq('app_user_id', appUserId)
          .eq('due_date', newTask.due_date)
          .eq('due_time', newTask.due_time)
          .is('deleted_at', null)
          .is('completed_at', null)
          .limit(1)
          .maybeSingle<{ id: string; title: string; due_date: string; due_time: string }>();

        if (existingAtTime) {
          const msg =
            `You already have "${existingAtTime.title}" at ${newTask.due_time} on ${newTask.due_date}. ` +
            `Should I still add "${newTask.title}" at the same time? Reply YES to add or tell me a different time.`;
          await upsertConversationState(userId, {
            last_entity_text: newTask.title,
          });
          await sendWhatsAppMessage(phoneNumber, msg);
          return;
        }
      }
    }

    const result = await insertTasksWithDedupe({
      tasks: compound.tasks,
      userId,
      appUserId,
      allowDuplicateIndices: [],
      source: TASK_SOURCES.WHATSAPP_TEXT,
      sourceMessageId: inboundMessageId || null,
    });
    if (result.inserted.length > 0) {
      const lastInserted = result.inserted[result.inserted.length - 1]!;
      const lastId = lastInserted.id;
      const lastTitle = lastInserted.title ?? '';
      // Persist durable conversation state so follow-up messages ("make it Friday") work
      await upsertConversationState(userId, {
        active_task_id: lastId,
        last_task_title: lastTitle,
        last_entity_text: lastTitle,
      });
      const lines = formatTaskConfirmations(result.inserted);
      taskConfirmations.push(...lines);
      createdTaskIds.push(...result.inserted.map((t) => t.id));
    }
    if (result.duplicates.length > 0) {
      log(`[WA] compound: ${result.duplicates.length} task duplicate(s) skipped`);
    }
  }

  if (taskConfirmations.length > 0) {
    confirmParts.push(taskConfirmations.join('\n'));
  }

  // --- Handle first deferred clarification (partial success) ---
  // If some actions were ambiguous, ask about the first one after confirming clear ones.
  if (deferredClarifications.length > 0) {
    const first = deferredClarifications[0]!;
    const expiresAt = new Date(Date.now() + ADD_TO_LIST_CHOOSE_EXPIRY_MS).toISOString();
    await supabase.from('wa_pending_actions').insert({
      auth_user_id: userId,
      app_user_id: appUserId,
      action_type: 'add_to_list_choose',
      task_id: null,
      expires_at: expiresAt,
      payload: {
        listIds: first.matches.map((m) => m.id),
        listNames: first.matches.map((m) => m.name),
        items: first.items,
      },
    });
    const clarificationQ = `Which list?\n${first.matches.map((n, i) => `${i + 1}. ${n.name}`).join('\n')}`;
    // Combine clear confirmations with the clarification question in one reply
    const combinedResponse =
      confirmParts.length > 0
        ? confirmParts.join('\n\n') + '\n\n' + clarificationQ
        : clarificationQ;
    const sendResult = await sendWhatsAppMessage(phoneNumber, combinedResponse);
    await saveOutboundMessage({
      userId,
      content: combinedResponse,
      taskIds: createdTaskIds.length > 0 ? createdTaskIds : undefined,
      listIds: allListIds.length > 0 ? allListIds : undefined,
      kind: 'compound_confirm',
      providerMessageId: sendResult?.providerMessageId,
    });
    log(`[WA] compound partial-success | tasks=${createdTaskIds.length} | deferred=${deferredClarifications.length}`);
    return;
  }

  // --- Build and send combined reply ---
  const finalResponse = confirmParts.join('\n\n').trim() || "Got it!";

  const sendResult = await sendWhatsAppMessage(phoneNumber, finalResponse);
  const providerMessageId = sendResult?.providerMessageId;

  await saveOutboundMessage({
    userId,
    content: finalResponse,
    taskIds: createdTaskIds.length > 0 ? createdTaskIds : undefined,
    listIds: allListIds.length > 0 ? allListIds : undefined,
    kind: createdTaskIds.length > 0 && allListIds.length > 0
      ? 'compound_confirm'
      : createdTaskIds.length > 0
        ? 'create_confirm'
        : 'list_create_confirm',
    providerMessageId,
  });

  log(
    `[WA] compound done | userId=${userId} | lists=${createdListCount} | ` +
    `listAdds=${compound.listActions.filter((a) => a.type === 'add_to_existing').length} | ` +
    `tasks=${createdTaskIds.length}`
  );
}

/**
 * AI fallback: called only when parseCompoundIntent found no rules-based content.
 * Preserves existing processWithLaya + saveStructuredData behaviour (mood, legacy groceries).
 * Wraps the LLM-generated reply through safeResponseGuard before sending.
 */
async function handleAiFallback(
  userId: string,
  finalText: string,
  phoneNumber: string,
  inboundMessageId: string | null,
  replyToMessageId: string | null,
  interpretation?: import('@/lib/turnInterpreter').TurnInterpretation | null
): Promise<void> {
  const context = await getConversationContext(userId);
  if (replyToMessageId) {
    context.push({
      role: 'assistant',
      content: `[User is replying to: "${replyToMessageId}"]`,
    });
  }

  const layaResponse = await processWithLaya(finalText, context);
  log(`[WA] AI fallback response | userId=${userId} | reply="${layaResponse.user_facing_response.substring(0, 80)}"`);

  // Guard the LLM-generated reply before sending
  const safeResult = safeResponseGuard(layaResponse.user_facing_response, {
    userText: finalText,
    interpretation: interpretation ?? null,
  });
  logResponseSafety(userId, safeResult, interpretation?.turnId);

  await saveStructuredData(userId, inboundMessageId || '', {
    ...layaResponse.structured,
    tasks: [], // tasks must always go through insertTasksWithDedupe
  });

  const sendResult = await sendWhatsAppMessage(phoneNumber, safeResult.reply);
  await saveOutboundMessage({
    userId,
    content: safeResult.reply,
    providerMessageId: sendResult?.providerMessageId,
  });
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
    log(`[WA] handleTaskQuery | userId=${userId} | query="${queryText.substring(0, 80)}"`);
    
    // Clear active-object state when processing a query (queries are context resets)
    await clearConversationState(userId);

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
      logError(`[WA] handleTaskQuery: identity not resolved (no app_users row?) | userId=${userId} | query="${queryText.substring(0, 60)}"`);
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
