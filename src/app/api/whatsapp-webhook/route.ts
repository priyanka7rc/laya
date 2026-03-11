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

/** Resolve Meta Cloud API media ID to a download URL (requires WHATSAPP_ACCESS_TOKEN). */
async function getMetaMediaUrl(mediaId: string): Promise<string | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

/**
 * POST /api/whatsapp-webhook
 * Receives incoming WhatsApp messages
 *
 * Message types supported:
 * - text
 * - audio (voice notes)
 * - image (Gupshup: direct URL; Meta: resolve via Graph API)
 * - document (Gupshup: direct URL; Meta: resolve via Graph API)
 *
 * Flow:
 * 1. Extract message data
 * 2. Validate webhook signature (optional for MVP)
 * 3. Process message (transcribe audio, OCR media, or rules-first task creation)
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

      // Extract reply context if present.
      // Gupshup provides the provider message ID in payload.context.gsId.
      // We store this so handleTaskDelete can look up the replied-to message
      // via messages.provider_message_id.
      if (payload.context && payload.context.gsId) {
        replyToMessage = payload.context.gsId;
        console.log(`↩️ Reply to provider message ID: ${payload.context.gsId}`);
      }

      let mediaUrl: string | undefined;
      let mediaMimeType: string | undefined;
      let resolvedMessageType: 'text' | 'audio' | 'image' | 'document' = 'text';

      if (messageType === 'text' && payload.payload?.text) {
        content = payload.payload.text;
        resolvedMessageType = 'text';
      } else if (messageType === 'audio' && payload.payload?.url) {
        audioId = payload.payload.url;
        resolvedMessageType = 'audio';
      } else if ((messageType === 'image' || messageType === 'file' || messageType === 'document') && payload.payload?.url) {
        mediaUrl = payload.payload.url;
        mediaMimeType = payload.payload.contentType;
        resolvedMessageType = messageType === 'file' || messageType === 'document' ? 'document' : 'image';
      } else {
        console.log(`⚠️ Unsupported Gupshup message type: ${messageType}`);
        return NextResponse.json({ status: 'ok' }, { status: 200 });
      }

      processWhatsAppMessage({
        phoneNumber,
        messageId,
        messageType: resolvedMessageType,
        content,
        audioId,
        timestamp,
        rawPayload: payload,
        replyToMessage: replyToMessage || undefined,
        mediaUrl,
        mediaMimeType,
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

            let messageType: 'text' | 'audio' | 'image' | 'document' = 'text';
            let content: string | null = null;
            let audioId: string | null = null;
            let mediaUrl: string | undefined;
            let mediaMimeType: string | undefined;
            let replyToMessage: string | null = null;

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
            } else if (message.type === 'image' && (message as any).image?.id) {
              messageType = 'image';
              const url = await getMetaMediaUrl((message as any).image.id);
              if (url) {
                mediaUrl = url;
                mediaMimeType = (message as any).image.mime_type;
              } else {
                console.log('⚠️ Meta image: could not resolve media URL');
                continue;
              }
            } else if (message.type === 'document' && (message as any).document?.id) {
              messageType = 'document';
              const url = await getMetaMediaUrl((message as any).document.id);
              if (url) {
                mediaUrl = url;
                mediaMimeType = (message as any).document.mime_type;
              } else {
                console.log('⚠️ Meta document: could not resolve media URL');
                continue;
              }
            } else {
              console.log(`⚠️ Unsupported Meta message type: ${(message as any).type}`);
              continue;
            }

            processWhatsAppMessage({
              phoneNumber,
              messageId,
              messageType,
              content,
              audioId,
              timestamp,
              rawPayload: message,
              replyToMessage: replyToMessage || undefined,
              mediaUrl,
              mediaMimeType,
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

