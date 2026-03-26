/**
 * Gupshup WhatsApp inbound webhook.
 * POST `/api/whatsapp-webhook` → `processWhatsAppMessage` in `@/lib/whatsapp-processor`.
 *
 * Inbound transport is Gupshup only (dashboard callback). Supports:
 * - Gupshup native envelope: `type === "message"` + nested `payload`
 * - Gupshup "Meta format (v3)": `entry[] → changes[] → value.messages[]` (no Meta tokens or Graph media API)
 *
 * Configure the callback URL and payload format in the Gupshup dashboard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { processWhatsAppMessage } from '@/lib/whatsapp-processor';
import type { IncomingMessage } from '@/lib/whatsapp-processor';

function extractGupshupSenderPhone(payload: Record<string, unknown>): string | null {
  if (typeof payload.source === 'string' && payload.source) {
    return payload.source;
  }
  const sender = payload.sender;
  if (sender === null || sender === undefined || typeof sender !== 'object') {
    return null;
  }
  const phone = (sender as { phone?: unknown }).phone;
  if (typeof phone === 'string' && phone) {
    return phone;
  }
  return null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object';
}

/** Meta v3 timestamps are usually Unix seconds (string or number). */
function metaTimestampToIso(ts: unknown): string {
  if (typeof ts === 'string' && /^\d+$/.test(ts)) {
    return new Date(parseInt(ts, 10) * 1000).toISOString();
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    // Heuristic: if looks like ms, use as-is; else seconds
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

/** Prefer a direct URL if Gupshup/Meta payload includes one; no Graph API fetch. */
function metaMediaDirectUrl(media: Record<string, unknown> | null): string | null {
  if (!media) return null;
  const candidates = [media.url, media.link, media.media_url];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

function collectMetaV3UserMessages(
  body: Record<string, unknown>
): Array<{ value: Record<string, unknown>; message: Record<string, unknown> }> {
  const out: Array<{ value: Record<string, unknown>; message: Record<string, unknown> }> = [];
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const ent of entries) {
    if (!isRecord(ent)) continue;
    const changes = Array.isArray(ent.changes) ? ent.changes : [];
    for (const ch of changes) {
      if (!isRecord(ch)) continue;
      const value = ch.value;
      if (!isRecord(value)) continue;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of messages) {
        if (isRecord(msg)) {
          out.push({ value, message: msg });
        }
      }
    }
  }
  return out;
}

function normalizeMetaV3Message(
  value: Record<string, unknown>,
  message: Record<string, unknown>
): IncomingMessage | null {
  const from = message.from;
  if (typeof from !== 'string' || !from) {
    console.error('[whatsapp-webhook] Meta v3 message without from');
    return null;
  }

  const phoneNumber = from;
  const messageId =
    typeof message.id === 'string' && message.id ? message.id : `gupshup-${Date.now()}`;
  const timestamp = metaTimestampToIso(message.timestamp);

  let replyToMessage: string | undefined;
  const ctx = message.context;
  if (isRecord(ctx)) {
    const cid = ctx.id;
    if (typeof cid === 'string' && cid) {
      replyToMessage = cid;
      console.log(`↩️ Reply to provider message ID (Meta v3 context.id): ${cid}`);
    }
  }

  const rawPayload: Record<string, unknown> = {
    ...value,
    _processedMessage: message,
  };

  const mt = typeof message.type === 'string' ? message.type : null;
  if (!mt) {
    console.log('[whatsapp-webhook] Meta v3 message without type');
    return null;
  }

  if (mt === 'text') {
    const textObj = message.text;
    const body =
      isRecord(textObj) && typeof textObj.body === 'string' ? textObj.body : null;
    if (body == null) {
      console.log('[whatsapp-webhook] Ignored: Meta v3 text without text.body');
      return null;
    }
    return {
      phoneNumber,
      messageId,
      messageType: 'text',
      content: body,
      audioId: null,
      timestamp,
      rawPayload,
      replyToMessage,
    };
  }

  if (mt === 'audio') {
    const audio = isRecord(message.audio) ? message.audio : null;
    const url = metaMediaDirectUrl(audio);
    if (!url) {
      console.log(
        '[whatsapp-webhook] Meta v3 audio without direct URL (id-only media); skipped — no Graph media fetch'
      );
      return null;
    }
    return {
      phoneNumber,
      messageId,
      messageType: 'audio',
      content: null,
      audioId: url,
      timestamp,
      rawPayload,
      replyToMessage,
    };
  }

  if (mt === 'image') {
    const image = isRecord(message.image) ? message.image : null;
    const url = metaMediaDirectUrl(image);
    if (!url) {
      console.log(
        '[whatsapp-webhook] Meta v3 image without direct URL (id-only media); skipped — no Graph media fetch'
      );
      return null;
    }
    const mime = image && typeof image.mime_type === 'string' ? image.mime_type : undefined;
    const caption =
      image && typeof image.caption === 'string' ? image.caption : null;
    return {
      phoneNumber,
      messageId,
      messageType: 'image',
      content: caption,
      audioId: null,
      timestamp,
      rawPayload,
      replyToMessage,
      mediaUrl: url,
      mediaMimeType: mime,
    };
  }

  if (mt === 'document') {
    const doc = isRecord(message.document) ? message.document : null;
    const url = metaMediaDirectUrl(doc);
    if (!url) {
      console.log(
        '[whatsapp-webhook] Meta v3 document without direct URL (id-only media); skipped — no Graph media fetch'
      );
      return null;
    }
    const mime = doc && typeof doc.mime_type === 'string' ? doc.mime_type : undefined;
    const caption = doc && typeof doc.caption === 'string' ? doc.caption : null;
    return {
      phoneNumber,
      messageId,
      messageType: 'document',
      content: caption,
      audioId: null,
      timestamp,
      rawPayload,
      replyToMessage,
      mediaUrl: url,
      mediaMimeType: mime,
    };
  }

  if (mt === 'button') {
    const btn = isRecord(message.button) ? message.button : null;
    const text = btn && typeof btn.text === 'string' ? btn.text : null;
    if (text == null) {
      console.log('[whatsapp-webhook] Ignored: Meta v3 button without button.text');
      return null;
    }
    return {
      phoneNumber,
      messageId,
      messageType: 'text',
      content: text,
      audioId: null,
      timestamp,
      rawPayload,
      replyToMessage,
    };
  }

  if (mt === 'interactive') {
    const inter = message.interactive;
    let text: string | null = null;
    if (isRecord(inter)) {
      const br = inter.button_reply;
      const lr = inter.list_reply;
      if (isRecord(br) && typeof br.title === 'string') text = br.title;
      else if (isRecord(lr) && typeof lr.title === 'string') text = lr.title;
    }
    if (text == null) {
      console.log(
        '[whatsapp-webhook] Ignored: Meta v3 interactive without button_reply / list_reply title'
      );
      return null;
    }
    return {
      phoneNumber,
      messageId,
      messageType: 'text',
      content: text,
      audioId: null,
      timestamp,
      rawPayload,
      replyToMessage,
    };
  }

  console.log(`[whatsapp-webhook] Unsupported Meta v3 message type: ${mt}`);
  return null;
}

function normalizeGupshupNative(
  b: Record<string, unknown>
): IncomingMessage | null {
  const payload = b.payload as Record<string, unknown>;
  const inner = payload.payload;
  const innerObj = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : null;

  const phoneNumber = extractGupshupSenderPhone(payload);

  const messageId =
    typeof payload.id === 'string' && payload.id ? payload.id : `gupshup-${Date.now()}`;

  const timestamp =
    typeof b.timestamp === 'number'
      ? new Date(b.timestamp).toISOString()
      : typeof b.timestamp === 'string'
        ? new Date(b.timestamp).toISOString()
        : new Date().toISOString();

  const messageType = typeof payload.type === 'string' ? payload.type : null;

  if (!phoneNumber) {
    console.error('[whatsapp-webhook] No phone number in Gupshup payload');
    return null;
  }

  if (!messageType) {
    console.log('[whatsapp-webhook] Ignored: missing payload.type');
    return null;
  }

  let content: string | null = null;
  let audioId: string | null = null;
  let replyToMessage: string | undefined;

  const ctx = payload.context;
  if (ctx && typeof ctx === 'object' && ctx !== null) {
    const gsId = (ctx as { gsId?: string }).gsId;
    if (typeof gsId === 'string') {
      replyToMessage = gsId;
      console.log(`↩️ Reply to provider message ID: ${gsId}`);
    }
  }

  let mediaUrl: string | undefined;
  let mediaMimeType: string | undefined;
  let resolvedMessageType: 'text' | 'audio' | 'image' | 'document' = 'text';

  if (messageType === 'text') {
    const text =
      innerObj && typeof innerObj.text === 'string' ? innerObj.text : null;
    if (text == null) {
      console.log('[whatsapp-webhook] Ignored: text message without payload.payload.text');
      return null;
    }
    content = text;
    resolvedMessageType = 'text';
  } else if (messageType === 'audio') {
    const url = innerObj && typeof innerObj.url === 'string' ? innerObj.url : null;
    if (!url) {
      console.log('[whatsapp-webhook] Ignored: audio without payload.payload.url');
      return null;
    }
    audioId = url;
    resolvedMessageType = 'audio';
  } else if (
    messageType === 'image' ||
    messageType === 'file' ||
    messageType === 'document'
  ) {
    const url = innerObj && typeof innerObj.url === 'string' ? innerObj.url : null;
    if (!url) {
      console.log(
        `[whatsapp-webhook] Ignored: ${messageType} without payload.payload.url`
      );
      return null;
    }
    mediaUrl = url;
    mediaMimeType =
      innerObj && typeof innerObj.contentType === 'string'
        ? innerObj.contentType
        : undefined;
    resolvedMessageType =
      messageType === 'file' || messageType === 'document' ? 'document' : 'image';
  } else {
    console.log(`[whatsapp-webhook] Unsupported Gupshup message type: ${messageType}`);
    return null;
  }

  return {
    phoneNumber,
    messageId,
    messageType: resolvedMessageType,
    content,
    audioId,
    timestamp,
    rawPayload: payload,
    replyToMessage,
    mediaUrl,
    mediaMimeType,
  };
}

function enqueueProcess(incoming: IncomingMessage): void {
  processWhatsAppMessage(incoming).catch((error) => {
    console.error('❌ Error processing WhatsApp message:', error);
  });
}

/**
 * POST /api/whatsapp-webhook
 *
 * Supported inbound shapes:
 * - Gupshup native: `type === "message"` and nested `payload` (URLs in payload.payload for media).
 * - Gupshup Meta v3: `entry[].changes[].value.messages[]` (Cloud API shape; media requires a direct URL in the payload — no Graph fetch).
 *
 * Always returns 200 for successful HTTP handling so the provider does not retry storms;
 * processing errors are logged.
 */
export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      console.error('[whatsapp-webhook] Invalid JSON body');
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }

    if (!body || typeof body !== 'object') {
      console.log('[whatsapp-webhook] Ignored: body is not an object');
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    const b = body as Record<string, unknown>;
    console.log('📥 WhatsApp Webhook (Gupshup):', JSON.stringify(body, null, 2));

    const isGupshupNative =
      b.type === 'message' && b.payload != null && typeof b.payload === 'object';

    if (isGupshupNative) {
      const incoming = normalizeGupshupNative(b);
      if (incoming) {
        enqueueProcess(incoming);
      }
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }

    if (Array.isArray(b.entry)) {
      const pairs = collectMetaV3UserMessages(b);
      if (pairs.length === 0) {
        console.log(
          '[whatsapp-webhook] Ignored: Meta v3 envelope with no user messages (e.g. statuses-only or empty)'
        );
        return NextResponse.json({ status: 'ignored' }, { status: 200 });
      }
      for (const { value, message } of pairs) {
        const incoming = normalizeMetaV3Message(value, message);
        if (incoming) {
          enqueueProcess(incoming);
        }
      }
      return NextResponse.json({ status: 'ok' }, { status: 200 });
    }

    console.log(
      '[whatsapp-webhook] Ignored: not Gupshup native (type/message) or Meta v3 (entry)'
    );
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return NextResponse.json(
      { status: 'error', message: 'Internal error' },
      { status: 200 }
    );
  }
}
