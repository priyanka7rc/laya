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
 * Send a text message to a WhatsApp user via Gupshup.
 *
 * Canonical return shape for anchoring is:
 *   { providerMessageId: string }
 */
export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string
): Promise<{ providerMessageId: string } | null> {
  // Feature flag check
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    console.log('[WA] Outbound blocked by feature flag | type=free-form');
    return { providerMessageId: 'stub-message-id' };
  }

  const apiKey = process.env.GUPSHUP_API_KEY;
  const sourceNumber = process.env.GUPSHUP_SOURCE_NUMBER;

  // For local testing without Gupshup credentials
    if (!apiKey || !sourceNumber) {
      console.log('📤 [STUB] Would send WhatsApp message via Gupshup:');
      console.log(`   To: ${phoneNumber}`);
      console.log(`   Message: ${message}`);
      console.log('   (Add GUPSHUP_API_KEY and GUPSHUP_SOURCE_NUMBER to .env.local to enable real sending)');
      return { providerMessageId: 'stub-message-id' };
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

    const data: any = await response.json();
    const providerMessageId: string | undefined =
      data.messageId ||
      data.messageID ||
      data.id ||
      data.message_id;

    if (!providerMessageId) {
      console.error(
        '❌ Gupshup response missing provider message id; outbound message will not be anchorable:',
        data
      );
      return null;
    }

    console.log('✅ Message sent via Gupshup:', providerMessageId);
    return { providerMessageId };
  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error);
    return null;
  }
}

// ============================================
// SESSION-AWARE MESSAGE ROUTER
// ============================================

/**
 * Smart message router that decides between free-form and template based on 24-hour window
 * 
 * Rules:
 * - If last inbound message from user is within 24 hours → use free-form message
 * - If outside 24 hours → use template message
 * - Checks opt-out status before sending
 * 
 * @param options - Routing options
 * @param options.phoneNumber - Recipient's phone number
 * @param options.userId - WhatsApp user ID (for session window check)
 * @param options.message - Free-form message text (used if within 24h window)
 * @param options.templateId - Template ID (used if outside 24h window)
 * @param options.templateParams - Template parameters (used if outside 24h window)
 * @returns Message ID if successful, null if blocked or failed
 * 
 * Example:
 * await sendWhatsAppMessageWithFallback({
 *   phoneNumber: "919876543210",
 *   userId: "user-uuid",
 *   message: "Your task reminder: Buy milk",
 *   templateId: "reminder_template_id",
 *   templateParams: ["Buy milk", "Today at 5pm"]
 * });
 */
export async function sendWhatsAppMessageWithFallback(options: {
  phoneNumber: string;
  userId: string;
  message: string;
  templateId?: string;
  templateParams?: string[];
}): Promise<string | null> {
  const { phoneNumber, userId, message, templateId, templateParams } = options;

  // Feature flag check
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    console.log('[WA] Outbound blocked by feature flag | type=fallback');
    return null;
  }

  try {
    // SAFETY ASSERTION 1: Check opt-out status
    const { data: whatsappUser } = await supabase
      .from('whatsapp_users')
      .select('opted_out')
      .eq('phone_number', phoneNumber)
      .maybeSingle();
    
    if (whatsappUser?.opted_out) {
      console.log(
        `[WA] Safety: BLOCKED proactive message | ` +
        `phone=${phoneNumber} | reason=opted_out`
      );
      return null;
    }

    // SAFETY ASSERTION 2: Check 24-hour session window
    const withinWindow = await canSendFreeformMessage(userId);

    if (withinWindow) {
      // Within 24 hours - use free-form message
      console.log(
        `[WA] Safety: ALLOW free-form | userId=${userId} | ` +
        `reason=within_24h_window`
      );
      const result = await sendWhatsAppMessage(phoneNumber, message);
      return result?.providerMessageId ?? null;
    } else {
      // Outside 24 hours - require template
      if (!templateId) {
        console.log(
          `[WA] Safety: BLOCKED free-form | userId=${userId} | ` +
          `reason=outside_24h_window_no_template`
        );
        return null;
      }
      console.log(
        `[WA] Safety: ALLOW template | userId=${userId} | ` +
        `reason=outside_24h_window_has_template`
      );
      return await sendGupshupTemplate(phoneNumber, templateId, templateParams || []);
    }
  } catch (error) {
    console.error('[WA] Safety: ERROR in message router:', error);
    return null;
  }
}

// ============================================
// SEND TEMPLATE MESSAGE (GUPSHUP)
// ============================================

/**
 * Send a template message via Gupshup
 * Templates must be pre-approved in Gupshup dashboard
 * 
 * @param phoneNumber - Recipient's phone number (with country code, no +)
 * @param templateId - Template ID from Gupshup dashboard (e.g., "c6aecef6-bcb0-4fb1-8100-28c094e3bc6b")
 * @param params - Array of variable values (order must match template placeholders)
 * @returns Message ID if successful
 * 
 * Example:
 * await sendGupshupTemplate(
 *   "919876543210",
 *   "reminder_template_id",
 *   ["Buy milk", "Today at 5pm"]
 * );
 */
export async function sendGupshupTemplate(
  phoneNumber: string,
  templateId: string,
  params: string[] = []
): Promise<string | null> {
  // Feature flag check
  if (process.env.WHATSAPP_ENABLED !== 'true') {
    console.log('[WA] Outbound blocked by feature flag | type=template');
    return null;
  }

  const apiKey = process.env.GUPSHUP_API_KEY;
  const sourceNumber = process.env.GUPSHUP_SOURCE_NUMBER;

  // For local testing without Gupshup credentials
  if (!apiKey || !sourceNumber) {
    console.log('📤 [STUB] Would send Gupshup template:');
    console.log(`   To: ${phoneNumber}`);
    console.log(`   Template ID: ${templateId}`);
    console.log(`   Params: ${JSON.stringify(params)}`);
    console.log('   (Add GUPSHUP_API_KEY and GUPSHUP_SOURCE_NUMBER to .env.local to enable real sending)');
    return 'stub-template-message-id';
  }

  try {
    // SAFETY ASSERTION: Check if user has opted out
    const { data: whatsappUser } = await supabase
      .from('whatsapp_users')
      .select('opted_out')
      .eq('phone_number', phoneNumber)
      .maybeSingle();
    
    if (whatsappUser?.opted_out) {
      console.log(
        `[WA] Safety: BLOCKED template | ` +
        `phone=${phoneNumber} | reason=opted_out`
      );
      return null;
    }

    // Clean phone number (remove +, spaces, dashes)
    const cleanPhone = phoneNumber.replace(/[^\d]/g, '');

    // Construct template object
    const templatePayload = {
      id: templateId,
      params: params,
    };

    const response = await fetch(
      `${GUPSHUP_API_BASE}/template/msg`,
      {
        method: 'POST',
        headers: {
          'apikey': apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          source: sourceNumber,
          destination: cleanPhone,
          template: JSON.stringify(templatePayload),
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ Gupshup template API error:', errorData);
      throw new Error(`Gupshup template API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Template message sent via Gupshup:', {
      templateId,
      messageId: data.messageId || data,
      params,
    });
    return data.messageId || 'gupshup-template-sent';
  } catch (error) {
    console.error('❌ Error sending Gupshup template:', error);
    return null;
  }
}

// ============================================
// UNUSED META CLOUD API FUNCTIONS
// ============================================
// NOTE: These functions are commented out because:
// 1. They use Meta Cloud API (not Gupshup, which is our current provider)
// 2. They reference undefined constant WHATSAPP_API_BASE
// 3. They are never called anywhere in the codebase
// 4. Keeping them would crash if accidentally invoked
//
// If you need Meta Cloud API integration in the future:
// - Uncomment these functions
// - Define WHATSAPP_API_BASE = 'https://graph.facebook.com/v18.0'
// - Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to .env
// ============================================

/*
// ============================================
// SEND TEMPLATE MESSAGE (Optional)
// ============================================

/**
 * Send a template message (pre-approved by Meta)
 * Useful for notifications and structured messages
 * 
 * Note: Templates must be created and approved in Meta Business Manager first
 *‎/
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
 *‎/
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
*/

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

