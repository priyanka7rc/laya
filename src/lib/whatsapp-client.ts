/**
 * WhatsApp Cloud API Client
 * Send messages to WhatsApp users
 * 
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 */

// ============================================
// CONFIGURATION
// ============================================

const WHATSAPP_API_VERSION = 'v18.0';
const WHATSAPP_API_BASE = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

// ============================================
// SEND MESSAGE
// ============================================

/**
 * Send a text message to a WhatsApp user
 * 
 * @param phoneNumber - Recipient's phone number (with country code, no +)
 * @param message - Text message to send (max 4096 characters)
 * @returns Message ID if successful
 */
export async function sendWhatsAppMessage(
  phoneNumber: string,
  message: string
): Promise<string | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // For local testing without WhatsApp credentials
  if (!accessToken || !phoneNumberId) {
    console.log('📤 [STUB] Would send WhatsApp message:');
    console.log(`   To: ${phoneNumber}`);
    console.log(`   Message: ${message}`);
    console.log('   (Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to .env.local to enable real sending)');
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
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: {
            preview_url: false,
            body: truncatedMessage,
          },
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('❌ WhatsApp API error:', errorData);
      throw new Error(`WhatsApp API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Message sent:', data.messages[0].id);
    return data.messages[0].id;
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

