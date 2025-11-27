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
    console.log(`📨 Processing message from ${message.phoneNumber}`);

    // 1. Get or create user
    const userId = await getOrCreateUser(message.phoneNumber);
    if (!userId) {
      throw new Error('Failed to get/create user');
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

    // 5. Process with Laya brain
    console.log('🧠 Processing with Laya...');
    const layaResponse = await processWithLaya(finalText, context);
    console.log('💬 Laya response:', layaResponse.user_facing_response);

    // 6. Save structured data
    await saveStructuredData(userId, inboundMessageId, layaResponse.structured);

    // 7. Save outbound message
    await saveOutboundMessage({
      userId,
      content: layaResponse.user_facing_response,
    });

    // 8. Send WhatsApp reply
    await sendWhatsAppMessage(message.phoneNumber, layaResponse.user_facing_response);

    console.log('✅ Message processed successfully');
  } catch (error) {
    console.error('❌ Error in processWhatsAppMessage:', error);
    
    // Send error message to user (optional)
    try {
      await sendWhatsAppMessage(
        message.phoneNumber,
        'Sorry, I had trouble processing that. Could you try again? 🌿'
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
 */
async function getOrCreateUser(phoneNumber: string): Promise<string | null> {
  try {
    // Check if phone number exists
    const { data: existingUser } = await supabase
      .from('whatsapp_users')
      .select('id')
      .eq('phone_number', phoneNumber)
      .single();

    if (existingUser) {
      // Update last_active timestamp
      await supabase
        .from('whatsapp_users')
        .update({ last_active: new Date().toISOString() })
        .eq('id', existingUser.id);
      
      return existingUser.id;
    }

    // Create new WhatsApp user
    const { data: newUser, error } = await supabase
      .from('whatsapp_users')
      .insert({
        phone_number: phoneNumber,
        last_active: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error creating WhatsApp user:', error);
      return null;
    }

    console.log(`✅ Created new WhatsApp user: ${phoneNumber}`);
    return newUser.id;
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
        role: msg.role === 'user' ? 'user' : 'assistant',
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
 */
async function saveStructuredData(
  userId: string,
  sourceMessageId: string,
  structured: {
    tasks: Array<{ title: string; due_date: string | null; due_time: string | null; category: string | null }>;
    groceries: Array<{ item_name: string; quantity: string | null; needed_by: string | null }>;
    reminders: Array<{ title: string; remind_at: string | null }>;
    mood_tag: string | null;
  }
): Promise<void> {
  try {
    // Save tasks
    if (structured.tasks && structured.tasks.length > 0) {
      const tasksToInsert = structured.tasks.map((task) => ({
        user_id: userId,
        source_message_id: sourceMessageId,
        title: task.title,
        due_date: task.due_date,
        due_time: task.due_time,
        category: task.category || 'Tasks',
        is_done: false,
      }));

      const { error: tasksError } = await supabase
        .from('tasks')
        .insert(tasksToInsert);

      if (tasksError) {
        console.error('Error saving tasks:', tasksError);
      } else {
        console.log(`✅ Saved ${tasksToInsert.length} task(s)`);
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
}

