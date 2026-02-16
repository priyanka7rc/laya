/**
 * WhatsApp Cloud API Webhook
 * Handles incoming messages from WhatsApp Business
 * 
 * Endpoints:
 * - GET: Webhook verification (Meta requirement)
 * - POST: Incoming message processing
 */

import { NextRequest, NextResponse } from 'next/server';
import { processWhatsAppMessage } from '@/lib/whatsapp-processor';

// ============================================
// WEBHOOK VERIFICATION (GET)
// ============================================

/**
 * GET /api/whatsapp-webhook
 * Meta sends this to verify webhook ownership
 * 
 * Query params:
 * - hub.mode: 'subscribe'
 * - hub.challenge: random string to echo back
 * - hub.verify_token: must match our WHATSAPP_VERIFY_TOKEN
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  // Check if verification token matches
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Webhook verified');
    return new NextResponse(challenge, { status: 200 });
  }

  console.error('❌ Webhook verification failed');
  return NextResponse.json(
    { error: 'Verification failed' },
    { status: 403 }
  );
}

// ============================================
// MESSAGE PROCESSING (POST)
// ============================================

/**
 * POST /api/whatsapp-webhook
 * Receives incoming WhatsApp messages
 * 
 * Message types supported:
 * - text
 * - audio (voice notes)
 * 
 * Flow:
 * 1. Extract message data
 * 2. Validate webhook signature (optional for MVP)
 * 3. Process message (transcribe audio, call Laya brain, save to DB)
 * 4. Send response back to user
 * 5. Return 200 quickly to avoid timeout
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Log incoming webhook (helpful for debugging)
    console.log('📥 WhatsApp Webhook:', JSON.stringify(body, null, 2));

    // Detect provider format: Gupshup vs Meta
    const isGupshup = body.type === 'message' && body.payload;
    const isMeta = body.entry && Array.isArray(body.entry);

    if (!isGupshup && !isMeta) {
      console.log('⚠️ Unknown webhook format, ignoring');
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    // ============================================
    // GUPSHUP FORMAT
    // ============================================
    if (isGupshup) {
      const payload = body.payload;
      
      // Extract message data
      const phoneNumber = payload.source || payload.sender?.phone;
      const messageId = payload.id || `gupshup-${Date.now()}`;
      // Gupshup sends UNIX timestamp (milliseconds) at top level, convert to ISO string
      const timestamp = body.timestamp 
        ? new Date(body.timestamp).toISOString() 
        : new Date().toISOString();
      const messageType = payload.type;

      if (!phoneNumber) {
        console.error('❌ No phone number in Gupshup payload');
        return NextResponse.json({ status: 'ok' }, { status: 200 });
      }

      let content: string | null = null;
      let audioId: string | null = null;
      let replyToMessage: string | null = null;

      // Extract reply context if present
      // Note: Gupshup context only provides message IDs (id, gsId), not message text
      if (payload.context && payload.context.gsId) {
        console.log(`↩️ Reply to message ID: ${payload.context.gsId}`);
        // Future: Query whatsapp_messages table using payload.context.gsId to get original text
      }

      // Extract content based on message type
      if (messageType === 'text' && payload.payload?.text) {
        content = payload.payload.text;
      } else if (messageType === 'audio' && payload.payload?.url) {
        audioId = payload.payload.url; // Gupshup provides direct URL
      } else {
        console.log(`⚠️ Unsupported Gupshup message type: ${messageType}`);
        return NextResponse.json({ status: 'ok' }, { status: 200 });
      }

      // Process message asynchronously
      processWhatsAppMessage({
        phoneNumber,
        messageId,
        messageType: messageType === 'audio' ? 'audio' : 'text',
        content,
        audioId,
        timestamp,
        rawPayload: payload,
        replyToMessage: replyToMessage || undefined,
      }).catch((error) => {
        console.error('❌ Error processing Gupshup message:', error);
      });

      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }

    // ============================================
    // META CLOUD API FORMAT (Legacy Support)
    // ============================================
    if (isMeta) {
      // Process each entry
      for (const entry of body.entry) {
        const changes = entry.changes || [];
        
        for (const change of changes) {
          if (change.field !== 'messages') {
            continue;
          }

          const value = change.value;
          
          if (!value.messages || !Array.isArray(value.messages)) {
            continue;
          }

          // Process each message
          for (const message of value.messages) {
            const phoneNumber = message.from;
            const messageId = message.id;
            const timestamp = message.timestamp;

            let messageType: 'text' | 'audio' = 'text';
            let content: string | null = null;
            let audioId: string | null = null;
            let replyToMessage: string | null = null;

            // Extract reply context
            if (message.context && message.context.message) {
              replyToMessage = message.context.message;
              console.log(`↩️ Reply detected: "${replyToMessage}"`);
            }

            if (message.type === 'text' && message.text) {
              messageType = 'text';
              content = message.text.body;
            } else if (message.type === 'audio' && message.audio) {
              messageType = 'audio';
              audioId = message.audio.url || message.audio.id;
            } else {
              console.log(`⚠️ Unsupported Meta message type: ${message.type}`);
              continue;
            }

            // Process message asynchronously
            processWhatsAppMessage({
              phoneNumber,
              messageId,
              messageType,
              content,
              audioId,
              timestamp,
              rawPayload: message,
              replyToMessage: replyToMessage || undefined,
            }).catch((error) => {
              console.error('❌ Error processing Meta message:', error);
            });
          }
        }
      }
    }

    // Always return 200 OK to acknowledge receipt
    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    // Still return 200 to avoid provider retries on our errors
    return NextResponse.json(
      { status: 'error', message: 'Internal error' },
      { status: 200 }
    );
  }
}

// ============================================
// TYPES
// ============================================

/**
 * WhatsApp message structure (simplified)
 * Full spec: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
interface WhatsAppWebhook {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts?: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: 'text' | 'audio' | 'image' | 'video' | 'document';
          text?: {
            body: string;
          };
          audio?: {
            id: string;
            mime_type: string;
          };
        }>;
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id: string;
        }>;
      };
      field: 'messages';
    }>;
  }>;
}

