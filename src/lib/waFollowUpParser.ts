/**
 * Follow-up intent detectors for WhatsApp conversational continuity.
 *
 * These parsers are deterministic and rules-based (no AI).
 * They run only when a prior conversation state exists (active task / active list).
 *
 * Three exported functions:
 *
 *   detectTaskFollowUpIntent(text)
 *     Fires when the message contains an implicit reference ("it", "that") followed
 *     by a complete edit patch. Returns an EditPatch or null.
 *     Examples: "make it Friday", "move it to tomorrow", "change it to 5pm"
 *
 *   detectListItemFollowUpIntent(text)
 *     Fires when the message looks like a raw item addition with no explicit list target.
 *     Returns { items } or null.
 *     Examples: "add curd too", "also add paneer", "bananas and curd" (short plain phrase)
 *     Does NOT fire if detectAddToListIntent would already handle the message.
 *
 *   detectEntityToListIntent(text)
 *     Fires on "add it to X" / "put it in X" patterns where "it" refers to the
 *     last captured entity (e.g. the title of the last task created).
 *     Returns { listName: string | null } or null.
 *     listName is null when no list is specified (triggers clarification).
 */

import { parseEditPatch, type EditPatch } from '@/lib/waEditParser';
import { splitItemPhrase } from '@/lib/waAddToListParser';

// ============================================
// TASK FOLLOW-UP
// ============================================

/**
 * Patterns that anchor a message as referring to the previously active task.
 * All require "it" or "that" as an implicit object so they never conflict with
 * explicit edit-selection messages like "reschedule dentist appointment".
 */
const TASK_FOLLOWUP_ANCHORS = /^(?:make|move|change|set|reschedule|update|push)\s+it\b/i;
const TASK_THAT_DELETE = /^(?:delete|remove|cancel)\s+(?:it|that|that\s+one)\b/i;
const TASK_IT_DONE = /^(?:mark\s+it\s+done|complete\s+it|done\s+with\s+it)\b/i;

export type TaskFollowUpResult =
  | { type: 'patch'; patch: EditPatch }
  | { type: 'delete' }
  | { type: 'mark_done' };

/**
 * Detect whether a message is a task follow-up targeting the active task.
 * Returns the action to take, or null if this is not a follow-up.
 *
 * Only fires for messages with an implicit "it"/"that" reference so that
 * explicit messages like "reschedule dentist" continue to go through the
 * normal edit-select flow.
 */
export function detectTaskFollowUpIntent(text: string): TaskFollowUpResult | null {
  const trimmed = text.trim();

  // "delete it" / "delete that one"
  if (TASK_THAT_DELETE.test(trimmed)) return { type: 'delete' };

  // "mark it done" / "complete it"
  if (TASK_IT_DONE.test(trimmed)) return { type: 'mark_done' };

  // "make it Friday" / "move it to tomorrow" / "change it to 5pm"
  if (TASK_FOLLOWUP_ANCHORS.test(trimmed)) {
    // Strip the anchor phrase and parse the remainder as an edit patch
    const rest = trimmed.replace(TASK_FOLLOWUP_ANCHORS, '').replace(/^[\s,]+/, '').trim();
    // parseEditPatch on the remainder only (the anchor itself is not date/time content)
    // TODO(timezone): pass user timezone from getUserTimezoneByAuthUserId() instead of
    // hardcoding 'Asia/Kolkata'. Currently harmless because parseEditPatch ignores _tz,
    // but must be consistent with turnInterpreter.ts line 363 when tz support is added.
    // See: src/__tests__/timezone.regression.test.ts
    const patch = parseEditPatch(rest.length > 0 ? rest : trimmed, 'UTC');
    const hasPatch = Object.keys(patch).some((k) => patch[k as keyof EditPatch] !== undefined);
    if (hasPatch) return { type: 'patch', patch };
    return null;
  }

  return null;
}

// ============================================
// LIST ITEM FOLLOW-UP
// ============================================

/**
 * Prefixes that signal "add this item to the current list, I'm still in the same context".
 */
const LIST_FOLLOWUP_ADD_ANCHORS = /^(?:add\s+(?:.+?)\s+too|also\s+add\s+|and\s+also\s+add\s+)/i;
/**
 * Matches "add X too" — captures X.
 */
const ADD_TOO_PATTERN = /^add\s+(.+?)\s+too\s*$/i;
/**
 * Matches "also add X" or "and also add X".
 */
const ALSO_ADD_PATTERN = /^(?:and\s+)?also\s+add\s+(.+)$/i;

/**
 * Maximum word count for a plain item-list follow-up.
 * Prevents long sentences from being mistaken for item lists.
 */
const MAX_ITEM_FOLLOWUP_WORDS = 8;

/**
 * Detect ONLY the explicit follow-up markers "add X too" and "also add X".
 * Does NOT include the general short-phrase fallback that is only safe in WA
 * context with an active list.
 *
 * Use this inside compound parsing (web context) to avoid false positives on
 * normal task sub-segments like "Buy milk tomorrow".
 */
export function detectExplicitListFollowUpIntent(text: string): { items: string[] } | null {
  const trimmed = text.trim();

  const addTooMatch = ADD_TOO_PATTERN.exec(trimmed);
  if (addTooMatch) {
    const items = splitItemPhrase(addTooMatch[1]!.trim());
    return items.length > 0 ? { items } : null;
  }

  const alsoAddMatch = ALSO_ADD_PATTERN.exec(trimmed);
  if (alsoAddMatch) {
    const items = splitItemPhrase(alsoAddMatch[1]!.trim());
    return items.length > 0 ? { items } : null;
  }

  return null;
}

/** Strips conversational prefixes/suffixes from a list item string. */
const ITEM_PREFIX_RE = /^(and\s+|put\s+|also\s+|just\s+|please\s+|maybe\s+)/i;
const ITEM_SUFFIX_RE = /\s+(too|as\s+well|also|please|in\s+there)$/i;

function cleanItemText(raw: string): string {
  return raw.replace(ITEM_PREFIX_RE, '').replace(ITEM_SUFFIX_RE, '').trim();
}

function cleanItems(items: string[]): string[] {
  return items.map(cleanItemText).filter(Boolean);
}

/**
 * Detect a raw list-item addition targeting the active list.
 * Returns { items } or null.
 *
 * Fires for:
 *   "add curd too"
 *   "also add paneer"
 *   "also add turmeric and ginger"
 *   "bananas and curd" (short plain phrase — WA context only)
 *   "add butter and milk" (when hasActiveList=true, relaxes command-verb guard)
 *
 * Does NOT fire for messages that `detectAddToListIntent` already handles
 * (explicit "add X to Y list" with a named target).
 *
 * WARNING: the general short-phrase fallback at the end of this function is
 * only safe in WA context where an active list is confirmed. Use
 * detectExplicitListFollowUpIntent instead for stateless/web flows.
 *
 * @param hasActiveList - When true, relaxes the command-verb guard so that
 *   "add X [and Y]" without an explicit list target fires as a list follow-up.
 */
export function detectListItemFollowUpIntent(
  text: string,
  hasActiveList = false,
): { items: string[] } | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  // "add X too"
  const addTooMatch = ADD_TOO_PATTERN.exec(trimmed);
  if (addTooMatch) {
    const items = cleanItems(splitItemPhrase(addTooMatch[1]!.trim()));
    return items.length > 0 ? { items } : null;
  }

  // "also add X"
  const alsoAddMatch = ALSO_ADD_PATTERN.exec(trimmed);
  if (alsoAddMatch) {
    const items = cleanItems(splitItemPhrase(alsoAddMatch[1]!.trim()));
    return items.length > 0 ? { items } : null;
  }

  // Guard against messages that are better handled by explicit add-to-list
  // (i.e. contain " to " suggesting a target list name is specified).
  const hasExplicitTarget = /\bto\s+(?:the\s+|my\s+)?\w+\s*(?:list)?\s*$/i.test(lower);
  if (hasExplicitTarget) return null;

  // A4b: when hasActiveList=true, relax the command-verb guard for "add X [and Y]"
  // so that "add butter and milk" with an active list is treated as a follow-up.
  const ADD_AND_PATTERN = /^add\s+(.+?)(?:\s+and\s+(.+))?$/i;
  if (hasActiveList) {
    const addAndMatch = ADD_AND_PATTERN.exec(trimmed);
    if (addAndMatch && !hasExplicitTarget) {
      const rawItems = addAndMatch[2]
        ? [addAndMatch[1]!, addAndMatch[2]!]
        : splitItemPhrase(addAndMatch[1]!);
      const items = cleanItems(rawItems);
      if (items.length > 0) return { items };
    }
  }

  const hasCommandVerb = /\b(?:create|make|delete|remove|show|edit|update|reschedule|done|complete|remind|add)\b/i.test(lower);
  if (hasCommandVerb) return null;

  // Short plain item-list: "bananas and curd", "turmeric, ginger" — only when ≤ MAX words
  const words = trimmed.split(/\s+/);
  if (words.length > MAX_ITEM_FOLLOWUP_WORDS) return null;

  const items = cleanItems(splitItemPhrase(trimmed));
  // Require at least 1 item and reject single-word messages that could be affirmations
  if (items.length < 1 || (items.length === 1 && items[0]!.split(/\s+/).length === 1)) {
    return null;
  }

  return { items };
}

// ============================================
// ENTITY-TO-LIST FOLLOW-UP ("add it to X")
// ============================================

/**
 * Anchoring pattern for "add it to X" / "put it in X".
 * Does NOT match "add milk to shopping" (no "it").
 */
const ENTITY_TO_LIST_ANCHOR = /^(?:add|put)\s+it\b/i;

/**
 * Extracts the list name from the tail of an "add it to X" message.
 */
const ENTITY_LIST_NAME_PATTERN = /\b(?:to|in(?:to)?)\s+(?:the\s+|my\s+)?(.+?)(?:\s+list)?\s*$/i;

// ============================================
// MARK-DONE DETECTION (Fix G)
// ============================================

/**
 * Detect "mark it done", "complete it", "done with it", and explicit
 * "mark [task name] done" / "mark [task name] as done" patterns.
 *
 * Returns { taskTerm } or null.
 * taskTerm is null for implicit ("it") references.
 *
 * This runs OUTSIDE the convState guard so that web + no-state paths
 * can also route to clarification ("Which task did you want to mark done?").
 */
export function detectMarkDoneIntent(text: string): { taskTerm: string | null } | null {
  const trimmed = text.trim();

  // Implicit reference: "mark it done", "complete it", "done with it"
  if (TASK_IT_DONE.test(trimmed)) {
    return { taskTerm: null };
  }

  // Explicit task name: "mark dentist as done", "mark the plumber task done"
  const explicitMatch = trimmed.match(/^mark\s+(?:the\s+)?(.+?)\s+(?:as\s+)?done\s*$/i);
  if (explicitMatch) {
    const term = explicitMatch[1]!.trim();
    // Skip "it"/"that" — those are handled by TASK_IT_DONE above
    if (/^(?:it|that)\b/i.test(term)) return null;
    return { taskTerm: term };
  }

  return null;
}

// ============================================
// LIST-ITEM REMOVAL DETECTION (Fix F)
// ============================================

/**
 * Detect "remove X" / "remove X from [the] Y [list]" / "delete X from [the] Y [list]" patterns,
 * distinguishing list-item removal from task deletion.
 *
 * Returns { item, listName } or null.
 * listName is null when no list target is specified (triggers clarification).
 *
 * Does NOT fire for pronoun-only deletions ("remove it", "delete that") — those are task deletes.
 * Does NOT fire for "delete X" bare (no "from") — reserved for task deletion.
 * Only "remove X" bare is treated as ambiguous list-item removal (not task delete).
 */
export function detectListItemRemovalIntent(
  text: string
): { item: string; listName: string | null } | null {
  const trimmed = text.trim();

  // Guard: pronoun-only deletions are task deletes, not list removals
  if (/^(?:delete|remove|cancel)\s+(?:it|that|that\s+one)\b/i.test(trimmed)) return null;

  // "remove X from [the/my] Y [list]" or "delete X from [the/my] Y [list]"
  const fromMatch = trimmed.match(
    /^(?:remove|delete)\s+(.+?)\s+from\s+(?:the\s+|my\s+)?(.+?)(?:\s+list)?\s*$/i
  );
  if (fromMatch) {
    const item = fromMatch[1]!.trim();
    const listName = fromMatch[2]!.trim();
    if (!item || !listName) return null;
    return { item: toTitleCase(item), listName: toTitleCase(listName) };
  }

  // "remove X" bare (no "from") — treat as list-item removal needing clarification.
  // Intentionally NOT "delete X" bare — that stays as task deletion.
  const bareRemoveMatch = trimmed.match(/^remove\s+(.+?)\s*$/i);
  if (bareRemoveMatch) {
    const item = bareRemoveMatch[1]!.trim();
    // Reject if item contains task-referencing words or is too long (likely a task delete attempt)
    const isTaskLike =
      /\b(?:task|appointment|meeting|call|plan|reminder|event)\b/i.test(item) ||
      item.split(/\s+/).length > 5;
    if (isTaskLike) return null;
    return { item: toTitleCase(item), listName: null };
  }

  return null;
}

/** Capitalise the first letter of each word (reused from brainDumpParser). */
function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================
// ENTITY-TO-LIST FOLLOW-UP ("add it to X")
// ============================================

/**
 * Detect "add it to shopping" / "put it in the grocery list" patterns.
 * Returns { listName } or null.
 * listName is null when the user said "add it" without specifying a list.
 *
 * Does NOT fire for "add milk to shopping" (handled by detectAddToListIntent).
 */
export function detectEntityToListIntent(
  text: string
): { listName: string | null } | null {
  const trimmed = text.trim();

  if (!ENTITY_TO_LIST_ANCHOR.test(trimmed)) return null;

  // Strip the "add it" / "put it" anchor
  const afterAnchor = trimmed.replace(ENTITY_TO_LIST_ANCHOR, '').trim();

  if (!afterAnchor) {
    // "add it" alone — no list name
    return { listName: null };
  }

  const nameMatch = ENTITY_LIST_NAME_PATTERN.exec(afterAnchor);
  if (!nameMatch) return { listName: null };

  const listName = nameMatch[1]!.trim();
  return { listName: listName.length > 0 ? listName : null };
}
