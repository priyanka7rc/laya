/**
 * WhatsApp Cloud API Client
 * Send messages to WhatsApp users
 * 
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

import { createClient } from '@supabase/supabase-js';

// ============================================
// CONFIGURATION
// ============================================

const GUPSHUP_API_BASE = 'https://api.gupshup.io/wa/api/v1';

// Supabase client for 24-hour check
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ============================================
// 24-HOUR SESSION WINDOW CHECK
// ============================================

/**
 * Check if we can send freeform messages to a user
 * WhatsApp only allows freeform messages within 24 hours of user's last message
 * After 24 hours, must use pre-approved templates
 * 
 * @param userId - WhatsApp user ID
 * @returns true if within 24-hour window, false otherwise
 */
export async function canSendFreeformMessage(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('messages')
      .select('created_at')
      .eq('user_id', userId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!data) {
      // No inbound messages yet, can't send freeform
      console.log('⚠️ No inbound messages - cannot send freeform');
      return false;
    }

    const hoursSinceLastMessage = 
      (Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60);

    const canSend = hoursSinceLastMessage < 24;
    
    if (!canSend) {
      console.log(`⏰ 24-hour window expired (${Math.round(hoursSinceLastMessage)}hrs ago)`);
    }

    return canSend;
  } catch (error) {
    console.error('Error checking 24-hour window:', error);
    // On error, assume we can send (fail open)
    return true;
  }
}

// ============================================
// SEND MESSAGE
// ============================================

/**
 * Send a text message to a WhatsApp user via Gupshup
 * 
 * @param phoneNumber - Recipient's phone number (with country code, no +)
 * @param message - Text message to send (max 4096 characters)
 * @returns Message ID if successful
 */
export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string
): Promise<string | null> {
  const apiKey = process.env.GUPSHUP_API_KEY;
  const sourceNumber = process.env.GUPSHUP_SOURCE_NUMBER;

  // For local testing without Gupshup credentials
  if (!apiKey || !sourceNumber) {
    console.log('📤 [STUB] Would send WhatsApp message via Gupshup:');
    console.log(`   To: ${phoneNumber}`);
    console.log(`   Message: ${message}`);
    console.log('   (Add GUPSHUP_API_KEY and GUPSHUP_SOURCE_NUMBER to .env.local to enable real sending)');
    return 'stub-message-id';
  }

  try {
    // Ensure message is not too long (WhatsApp limit: 4096 chars)
    const truncatedMessage = message.length > 4096 
      ? message.substring(0, 4093) + '...' 
      : message;

    // Clean phone number (remove +, spaces, dashes)
    const cleanPhone = phoneNumber.replace(/[^\d]/g, '');

    const response = await fetch(
      `${GUPSHUP_API_BASE}/msg`,
      {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          channel: 'whatsapp',
          source: sourceNumber,
          destination: cleanPhone,
          message: JSON.stringify({
            type: 'text',
            text: truncatedMessage,
          }),
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Gupshup API error:', errorData);
      throw new Error(`Gupshup API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Message sent via Gupshup:', data.messageId || data);
    return data.messageId || 'gupshup-message-sent';
  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error);
    return null;
  }
}

// ============================================
// SEND TEMPLATE MESSAGE (Optional)
// ============================================

/**
 * Send a template message (pre-approved by Meta)
 * Useful for notifications and structured messages
 * 
 * Note: Templates must be created and approved in Meta Business Manager first
 */
export async function sendWhatsAppTemplate(
  phoneNumber: string,
  templateName: string,
  languageCode: string = 'en',
  parameters: string[] = []
): Promise<string | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.log('📤 [STUB] Would send WhatsApp template:', {
      phoneNumber,
      templateName,
      parameters,
    });
    return 'stub-template-message-id';
  }

  try {
    const cleanPhone = phoneNumber.replace(/[^\d]/g, '');

    const response = await fetch(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: languageCode,
            },
            components: parameters.length > 0 ? [
              {
                type: 'body',
                parameters: parameters.map((param) => ({
                  type: 'text',
                  text: param,
                })),
              },
            ] : [],
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ WhatsApp template error:', errorData);
      throw new Error(`WhatsApp template error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Template sent:', data.messages[0].id);
    return data.messages[0].id;
  } catch (error) {
    console.error('❌ Error sending WhatsApp template:', error);
    return null;
  }
}

// ============================================
// MARK MESSAGE AS READ (Optional)
// ============================================

/**
 * Mark an incoming message as read
 * This shows blue checkmarks in WhatsApp
 */
export async function markMessageAsRead(messageId: string): Promise<boolean> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    console.log('📤 [STUB] Would mark message as read:', messageId);
    return true;
  }

  try {
    const response = await fetch(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      }
    );

    if (!response.ok) {
      console.error('❌ Failed to mark message as read');
      return false;
    }

    console.log('✅ Message marked as read');
    return true;
  } catch (error) {
    console.error('❌ Error marking message as read:', error);
    return false;
  }
}

// ============================================
// HELPER: FORMAT MESSAGE FOR WHATSAPP
// ============================================

/**
 * Format message text for WhatsApp
 * - Handles line breaks
 * - Ensures proper emoji rendering
 * - Truncates if too long
 */
export function formatMessageForWhatsApp(text: string): string {
  // Normalize line breaks
  let formatted = text.replace(/\r\n/g, '\n').trim();

  // Truncate if too long (leave room for "...")
  if (formatted.length > 4096) {
    formatted = formatted.substring(0, 4093) + '...';
  }

  return formatted;
}

