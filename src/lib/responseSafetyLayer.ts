/**
 * Facade-safe response guard for user-facing WhatsApp replies.
 *
 * Applied to any LLM-generated reply before it is sent to the user.
 * Ensures the assistant never sends weird, off-domain, overly generic,
 * or technically broken text.
 *
 * NOT applied to rules-path confirmations (those are deterministic and safe).
 * Primarily used in handleAiFallback where text is LLM-generated.
 *
 * Pure function — no DB calls, no side effects.
 *
 * Philosophy:
 *   - Reject replies that are empty, AI-flavoured, technically leaked, or ungrounded
 *   - Replace with short deterministic fallbacks from the interpretation context
 *   - Never silence a perfectly good reply — the bar for rejection is deliberate
 */

import type { TurnInterpretation } from '@/lib/turnInterpreter';

// ============================================
// TYPES
// ============================================

export type SafetyRejectionReason =
  | 'empty_reply'
  | 'ai_filler_phrase'
  | 'internal_plumbing_word'
  | 'reply_too_long'
  | 'ungrounded_reply';

export interface SafetyGuardResult {
  /** The final reply to send (may be the original or a fallback). */
  reply: string;
  /** True when the original reply was rejected and replaced with a fallback. */
  usedFallback: boolean;
  /** Present when usedFallback is true. */
  reason?: SafetyRejectionReason;
}

export interface SafetyGuardContext {
  /** Raw user text that triggered this reply. Used for grounding check. */
  userText: string;
  /** Optional interpretation result — used to build context-aware fallbacks. */
  interpretation?: TurnInterpretation | null;
}

// ============================================
// REJECTION CRITERIA
// ============================================

/**
 * AI filler phrases that indicate a generic, non-domain-specific reply.
 * All lowercase for case-insensitive matching.
 */
const AI_FILLER_PHRASES: string[] = [
  'as an ai',
  "i'd be happy to",
  'certainly!',
  'of course!',
  'great question',
  'feel free to',
  'i understand your',
  'please let me know if',
  'i apologize',
  'i am sorry to hear',
  'i hope this helps',
  'is there anything else',
  'how can i assist',
  'how can i help you today',
  'i am here to help',
  "i'm here to help",
  'thank you for reaching out',
  'happy to assist',
  'absolutely!',
  'sure thing!',
];

/**
 * Internal plumbing words that should never appear in a user-facing message.
 */
const INTERNAL_WORDS: string[] = [
  'json',
  'schema',
  'webhook',
  'undefined',
  'null',
  'error:',
  'exception',
  'stack trace',
  'traceback',
  'internal server',
  '500',
  'supabase',
  'postgres',
  'sql',
  'database error',
  'api key',
  'openai',
  'llm',
  'gpt-',
  'model:',
  'prompt:',
];

const MAX_REPLY_LENGTH = 700;

// ============================================
// CHECK FUNCTIONS
// ============================================

function isEmpty(reply: string): boolean {
  return !reply || reply.trim().length === 0;
}

function hasAIFillerPhrase(reply: string): boolean {
  const lower = reply.toLowerCase();
  return AI_FILLER_PHRASES.some((phrase) => lower.includes(phrase));
}

function hasInternalWord(reply: string): boolean {
  const lower = reply.toLowerCase();
  return INTERNAL_WORDS.some((word) => lower.includes(word));
}

function isTooLong(reply: string): boolean {
  return reply.length > MAX_REPLY_LENGTH;
}

/**
 * Check whether the reply has any word overlap with the user's input.
 * A reply with zero word overlap is likely completely off-topic.
 *
 * Only rejects when userText has >= 3 meaningful words (avoids false positives
 * on very short inputs like "hi" or single emoji).
 */
function isUngrounded(reply: string, userText: string): boolean {
  const userWords = userText
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 3);

  if (userWords.length < 3) return false; // Too short to do a reliable grounding check

  const replyLower = reply.toLowerCase();
  const hasOverlap = userWords.some((w) => replyLower.includes(w));
  return !hasOverlap;
}

// ============================================
// FALLBACK GENERATION
// ============================================

/**
 * Build a deterministic, domain-safe fallback based on interpretation context.
 *
 * Priority:
 *   1. Clarification payload hint (already pointed)
 *   2. List name from detected list action
 *   3. Task title from detected task action
 *   4. Generic domain fallback
 */
function buildFallbackReply(context: SafetyGuardContext): string {
  const interp = context.interpretation;

  if (!interp) {
    return "I got that. Anything else to add?";
  }

  // Use existing clarification hint if present
  if (interp.needsClarification && interp.clarificationPayload?.hint) {
    return interp.clarificationPayload.hint;
  }

  // Find a list action to reference
  const listAction = interp.detectedActions.find(
    (a) => a.type === 'create_list' || a.type === 'add_list_items'
  );
  if (listAction) {
    const listName =
      listAction.type === 'create_list'
        ? listAction.listName
        : listAction.listName ?? null;
    if (listName) {
      return `What should I add to ${listName}?`;
    }
    return "What should I add to the list?";
  }

  // Find a task action to reference
  const taskAction = interp.detectedActions.find((a) => a.type === 'create_task');
  if (taskAction) {
    return "Got it. Anything else?";
  }

  return "I understood part of that. What would you like to add?";
}

// ============================================
// MAIN EXPORTED FUNCTION
// ============================================

/**
 * Guard a user-facing reply before sending it.
 *
 * If the reply passes all checks → returns it unchanged with usedFallback: false.
 * If the reply fails any check → returns a deterministic fallback with usedFallback: true.
 *
 * @param reply   - The LLM-generated reply string
 * @param context - User input and optional interpretation for fallback generation
 */
export function safeResponseGuard(
  reply: string,
  context: SafetyGuardContext
): SafetyGuardResult {
  // Check 1: empty
  if (isEmpty(reply)) {
    return {
      reply: buildFallbackReply(context),
      usedFallback: true,
      reason: 'empty_reply',
    };
  }

  // Check 2: AI filler phrases
  if (hasAIFillerPhrase(reply)) {
    return {
      reply: buildFallbackReply(context),
      usedFallback: true,
      reason: 'ai_filler_phrase',
    };
  }

  // Check 3: internal plumbing words
  if (hasInternalWord(reply)) {
    return {
      reply: buildFallbackReply(context),
      usedFallback: true,
      reason: 'internal_plumbing_word',
    };
  }

  // Check 4: reply too long
  if (isTooLong(reply)) {
    // Truncate and warn rather than full fallback — long replies may still be valid
    return {
      reply: reply.slice(0, MAX_REPLY_LENGTH - 3) + '...',
      usedFallback: true,
      reason: 'reply_too_long',
    };
  }

  // Check 5: zero word overlap (ungrounded)
  if (isUngrounded(reply, context.userText)) {
    return {
      reply: buildFallbackReply(context),
      usedFallback: true,
      reason: 'ungrounded_reply',
    };
  }

  return { reply, usedFallback: false };
}
