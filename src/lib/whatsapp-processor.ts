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
  audioId: string | null; // WhatsApp media ID for audio
  timestamp: string;
  rawPayload: any;
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
      const transcription = await transcribeAudioFromWhatsApp(message.audioId);
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
 * Get or create user by phone number
 */
async function getOrCreateUser(phoneNumber: string): Promise<string | null> {
  try {
    // Check if phone number exists
    const { data: existingPhone } = await supabase
      .from('user_phone_numbers')
      .select('user_id')
      .eq('phone_number', phoneNumber)
      .single();

    if (existingPhone) {
      return existingPhone.user_id;
    }

    // Use the database function to create user
    const { data, error } = await supabase.rpc('get_or_create_user_by_phone', {
      p_phone_number: phoneNumber,
      p_country_code: null,
    });

    if (error) {
      console.error('Error creating user:', error);
      return null;
    }

    return data;
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
 */
async function getConversationContext(userId: string): Promise<ConversationMessage[]> {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('role, content')
      .eq('user_id', userId)
      .eq('channel', 'whatsapp')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error fetching conversation context:', error);
      return [];
    }

    // Reverse to get chronological order
    return (data || [])
      .reverse()
      .map((msg) => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));
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

