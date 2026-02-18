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
import { processWithLaya, ConversationMessage } from './laya-brain';
import { transcribeAudioFromWhatsApp } from './openai';
import { sendWhatsAppMessage } from './whatsapp-client';

// ============================================
// SUPABASE CLIENT
// ============================================

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role for backend operations
);

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
// TYPES
// ============================================

export interface IncomingMessage {
  phoneNumber: string;
  messageId: string;
  messageType: 'text' | 'audio';
  content: string | null; // Text content or null if audio
  audioId: string | null; // WhatsApp media ID for audio (Gupshup: direct URL)
  timestamp: string;
  rawPayload: any;
  replyToMessage?: string; // Original message being replied to
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

    // 2a. Handle STOP/START opt-out commands
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

    // 3. Save inbound message to database
    const inboundMessageId = await saveInboundMessage({
      userId,
      messageType: message.messageType,
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

    // 3b. Check if this is a number response to a pending edit clarification
    if (/^[1-3]$/.test(trimmedText)) {
      console.log('🔢 Number response detected, checking for pending edit...');
      const handled = await handleEditClarification(userId, parseInt(trimmedText), message.phoneNumber);
      if (handled) {
        return; // Exit early, edit was applied
      }
      // If not handled, continue with normal flow (user might just be sending a number)
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

    // 3d. Detect edit intent
    // STRICT RULE: Edit requires BOTH verb AND referential term
    // EXCEPTION: Implicit corrections (actually, wait, I mean) are always edits
    // Verbs alone → NEW TASK (not edit)
    
    const hasImplicitCorrection = 
      /^(actually|wait|no\s+wait|correction|i\s+mean)\b/i.test(trimmedText);
    
    const hasEditVerb = /\b(change|update|make|set)\b/.test(lowerText);
    const hasReferentialTerm = 
      /\b(it|that|this)\b/.test(lowerText) ||
      /the\s+last\s+one/.test(lowerText) ||
      /the\s+previous\s+(task|one)/.test(lowerText) ||
      /the\s+earlier\s+one/.test(lowerText) ||
      /\binstead\b/.test(lowerText);

    const isEdit = hasImplicitCorrection || (hasEditVerb && hasReferentialTerm);

    if (isEdit) {
      const focusBefore = getFocus(userId);
      console.log(
        `[WA] Route: EDIT | userId=${userId} | ` +
        `focusBefore=${focusBefore || 'null'} | ` +
        `implicit=${hasImplicitCorrection}`
      );
      await handleTaskEdit(userId, finalText, message.phoneNumber);
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

    // 5. Process with Laya brain
    console.log('🧠 Processing with Laya...');
    const layaResponse = await processWithLaya(finalText, context);
    console.log('💬 Laya response:', layaResponse.user_facing_response);

    // 6. Save structured data and get confirmations
    const confirmations = await saveStructuredData(userId, inboundMessageId || '', layaResponse.structured);

    // Log action result
    const focusAfter = getFocus(userId);
    console.log(
      `[WA] Result: created ${confirmations.length} confirmations | ` +
      `focusAfter=${focusAfter || 'null'}`
    );

    // 7. Build final response with confirmations
    let finalResponse = layaResponse.user_facing_response;
    if (confirmations.length > 0) {
      finalResponse = confirmations.join('\n');
    }

    // 8. Save outbound message
    await saveOutboundMessage({
      userId,
      content: finalResponse,
    });

    // 9. Send WhatsApp reply
    await sendWhatsAppMessage(message.phoneNumber, finalResponse);

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
 * Save outbound message to database
 */
async function saveOutboundMessage(params: {
  userId: string;
  content: string;
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

/**
 * Save structured data extracted from message
 * Returns confirmation messages for created tasks
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
  
  try {
    // Save tasks
    if (structured.tasks && structured.tasks.length > 0) {
      // Clear focus when creating new task(s)
      clearFocus(userId, 'new_task_created');
      
      const tasksToInsert = structured.tasks.map((task) => ({
        user_id: userId,
        source: 'whatsapp',
        source_message_id: sourceMessageId,
        title: task.title,
        due_date: task.due_date,
        due_time: task.due_time,
        category: task.category || 'Tasks',
        is_done: false,
        reminder_sent: false,
      }));

      const { data: insertedTasks, error: tasksError } = await supabase
        .from('tasks')
        .insert(tasksToInsert)
        .select('id');

      if (tasksError) {
        console.error('Error saving tasks:', tasksError);
      } else {
        console.log(`✅ Saved ${tasksToInsert.length} task(s)`);
        
        // Set focus to the last created task (most recent)
        if (insertedTasks && insertedTasks.length > 0) {
          const lastTaskId = insertedTasks[insertedTasks.length - 1].id;
          setFocus(userId, lastTaskId);
        }
        
        // Build confirmation messages
        for (const task of structured.tasks) {
          let confirmation = `✅ Added: ${task.title}`;
          
          const isToday = task.due_date === new Date().toISOString().split('T')[0];
          const isTomorrow = (() => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            return task.due_date === tomorrow.toISOString().split('T')[0];
          })();
          
          if (isToday && task.due_time) {
            confirmation += ` (today at ${task.due_time})`;
          } else if (isToday) {
            confirmation += ' (today)';
          } else if (isTomorrow && task.due_time) {
            confirmation += ` (tomorrow at ${task.due_time})`;
          } else if (isTomorrow) {
            confirmation += ' (tomorrow)';
          } else if (task.due_date && task.due_time) {
            confirmation += ` (${task.due_date} at ${task.due_time})`;
          } else if (task.due_date) {
            confirmation += ` (${task.due_date})`;
          }
          
          confirmations.push(confirmation);
        }
      }
    }

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
 * Extract filters from task query message
 */
function extractQueryFilters(queryText: string): { category?: string; due_date?: string } {
  const lower = queryText.toLowerCase();
  let category: string | undefined;
  let due_date: string | undefined;

  // Extract category using phrase patterns
  if (lower.match(/\b(buy|purchase|shop|shopping|things?\s+(i|to)\s+(need|want)\s+to\s+buy)\b/)) {
    category = 'Shopping';
  } else if (lower.match(/\b(bill|bills|pay|payment|subscription)\b/)) {
    category = 'Bills';
  } else if (lower.match(/\b(health|doctor|dentist|medical|medicine)\b/)) {
    category = 'Health';
  } else if (lower.match(/\b(work|office|project|meeting)\b/)) {
    category = 'Work';
  } else if (lower.match(/\b(home|house|clean|laundry)\b/)) {
    category = 'Home';
  } else if (lower.match(/\b(personal|family|friend)\b/)) {
    category = 'Personal';
  } else if (lower.match(/\b(admin|appointment|schedule|booking)\b/)) {
    category = 'Admin';
  }

  // Extract date scope
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    due_date = tomorrow.toISOString().split('T')[0];
  } else if (lower.includes('today') || category) {
    // Default to today if category is specified but no date mentioned
    due_date = new Date().toISOString().split('T')[0];
  }

  return { category, due_date };
}

/**
 * Get emoji for category
 */
function getCategoryEmoji(category: string | null): string {
  if (!category) return '📋';
  
  const emojiMap: Record<string, string> = {
    'Shopping': '🛒',
    'Work': '💼',
    'Home': '🏠',
    'Health': '🏥',
    'Bills': '💰',
    'Personal': '👤',
    'Admin': '📝',
  };
  
  return emojiMap[category] || '📋';
}

/**
 * Get action verb for category
 */
function getCategoryAction(category: string | null): string {
  if (!category) return 'do';
  
  const actionMap: Record<string, string> = {
    'Shopping': 'buy',
    'Work': 'work on',
    'Home': 'do at home',
    'Health': 'do for health',
    'Bills': 'pay',
    'Personal': 'do',
    'Admin': 'handle',
  };
  
  return actionMap[category] || 'do';
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

    // Parse query filters
    const filters = extractQueryFilters(queryText);
    const categoryFilter = filters.category || null;
    const dateFilter = filters.due_date || null;

    // Build query
    let query = supabase
      .from('tasks')
      .select('title, due_date, due_time, category')
      .eq('user_id', userId)
      .eq('is_done', false);

    if (categoryFilter) {
      query = query.eq('category', categoryFilter);
    }

    if (dateFilter) {
      query = query.eq('due_date', dateFilter);
    }

    // Order by due_time (nulls last)
    query = query.order('due_time', { ascending: true, nullsFirst: false });

    const { data: tasks, error } = await query;

    if (error) {
      console.error('Error querying tasks:', error);
      throw error;
    }

    // Format response
    if (!tasks || tasks.length === 0) {
      // Empty state - calm, single-line response
      let emptyMessage = "You don't have any open tasks.";
      
      if (categoryFilter && dateFilter === new Date().toISOString().split('T')[0]) {
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
    if (categoryFilter && isToday) {
      header = `${categoryEmoji} Things to ${getCategoryAction(categoryFilter)} today:\n\n`;
    } else if (categoryFilter) {
      header = `${categoryEmoji} ${categoryFilter} tasks:\n\n`;
    } else if (isToday) {
      header = "📋 Your tasks for today:\n\n";
    } else {
      header = "📋 Your open tasks:\n\n";
    }

    const taskLines = tasks.map((task) => {
      const time = task.due_time ? ` (${task.due_time})` : '';
      return `• ${task.title}${time}`;
    });

    const message = header + taskLines.join('\n');

    await sendWhatsAppMessage(phoneNumber, message);
    console.log(
      `[WA] Result: query returned ${tasks.length} tasks | ` +
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

    // Update the task
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        due_date: newDate,
        due_time: newTime,
      })
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

    // Update the task
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        due_date: newDate,
        due_time: newTime,
      })
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