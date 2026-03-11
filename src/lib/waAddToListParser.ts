/**
 * WhatsApp add-to-list intent parser.
 * Rules-first: no AI. Returns items and optional list name.
 */

export interface AddToListIntent {
  items: string[];
  listName?: string;
}

const ADD_PREFIX = /^\s*add\s+/i;

/** Normalize for matching: trim, lowercase, collapse spaces */
function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

const MAX_ITEMS_PER_MESSAGE = 10;

/**
 * Split a string into item tokens by: comma, newline, bullet, numbered list, " and ".
 * Trims whitespace, ignores empty tokens, dedupes, caps at MAX_ITEMS_PER_MESSAGE.
 */
export function splitItemPhrase(phrase: string): string[] {
  if (!phrase || !phrase.trim()) return [];
  let text = phrase.trim();
  // Replace " and " with comma for uniform split
  text = text.replace(/\s+and\s+/gi, ',');
  // Split by comma, newline, or bullet/number patterns
  const parts = text.split(/[\n,]+|\s*[•\-*]\s+|\s*\d+[.)]\s*/);
  const items = parts
    .map((p) => p.replace(/^[\s•\-*]+|[\s•\-*]+$/g, '').trim())
    .filter((p) => p.length > 0);
  return [...new Set(items)].slice(0, MAX_ITEMS_PER_MESSAGE);
}

/**
 * Detect "add X" / "add X to Y list" intent.
 * Returns { items, listName? } or null.
 */
export function detectAddToListIntent(text: string): AddToListIntent | null {
  const norm = normalize(text);
  if (!ADD_PREFIX.test(norm)) return null;

  const afterAdd = norm.replace(ADD_PREFIX, '').trim();
  if (!afterAdd) return null;

  // Optional: " to <list name> list" or " to <list name>"
  const toListMatch = afterAdd.match(/\s+to\s+(.+?)(?:\s+list)?\s*$/i);
  let itemsPart = afterAdd;
  let listName: string | undefined;
  if (toListMatch) {
    listName = toListMatch[1]!.trim();
    itemsPart = afterAdd.slice(0, afterAdd.length - (toListMatch[0]?.length ?? 0)).trim();
  }
  if (!itemsPart) return null;

  const items = splitItemPhrase(itemsPart);
  if (items.length === 0) return null;

  return { items, listName };
}

/** Result of done/remove intent: { command: 'done'|'remove', term: string, index?: number } or null */
export interface DoneRemoveIntent {
  command: 'done' | 'remove';
  term: string;
  index?: number; // 1-based when numeric (e.g. "done 2" -> index: 2)
}

const DONE_REMOVE_NUMERIC = /^\s*(done|remove)\s+(\d+)\s*$/i;
const DONE_REMOVE = /^\s*(done|remove)\s+(.+)\s*$/i;

export function parseDoneRemoveIntent(text: string): DoneRemoveIntent | null {
  const trimmed = text.trim();
  const numMatch = trimmed.match(DONE_REMOVE_NUMERIC);
  if (numMatch) {
    const cmd = numMatch[1]!.toLowerCase() === 'done' ? 'done' : 'remove';
    const idx = parseInt(numMatch[2]!, 10);
    return { command: cmd, term: numMatch[2]!, index: idx };
  }
  const m = trimmed.match(DONE_REMOVE);
  if (!m) return null;
  const term = m[2]!.trim();
  if (!term) return null;
  return { command: m[1]!.toLowerCase() === 'done' ? 'done' : 'remove', term };
}
