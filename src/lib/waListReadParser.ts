/**
 * WhatsApp list-read intent detection and formatters (Features 18.4–18.6).
 * Rules-first: no AI.
 */

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Show-lists phrases (exact or equivalent) */
const SHOW_LISTS_PHRASES = [
  'show my lists',
  'lists',
  'my lists',
  'what lists do i have',
];

/** Clear-completed phrases: exact match when replying to list */
const CLEAR_COMPLETED_PHRASES = ['clear completed', 'remove completed', 'delete completed'];

/**
 * Detect "clear completed" / "remove completed" / "delete completed" intent.
 * Used when replying to a list preview.
 */
export function detectClearCompletedIntent(text: string): boolean {
  const norm = normalize(text);
  return CLEAR_COMPLETED_PHRASES.includes(norm);
}

/**
 * Detect "show my lists" / "lists" intent.
 */
export function detectShowListsIntent(text: string): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  return SHOW_LISTS_PHRASES.includes(norm) || norm === 'list';
}

/**
 * Detect "show &lt;list name&gt;" / "open &lt;list name&gt;" / "&lt;name&gt; list" intent.
 * Avoid matching "list" alone.
 */
export function detectShowSpecificListIntent(
  text: string
): { listName: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // show <name>, open <name>
  const showOpen = /^\s*(?:show|open)\s+(.+)\s*$/i.exec(trimmed);
  if (showOpen) {
    const name = showOpen[1]!.trim();
    return name.length >= 1 ? { listName: name } : null;
  }

  // <name> list — require at least one char before "list"
  const nameList = /^(.+)\s+list\s*$/i.exec(trimmed);
  if (nameList) {
    const name = nameList[1]!.trim();
    if (name.length >= 1 && name.toLowerCase() !== 'list') {
      return { listName: name };
    }
  }

  return null;
}

/**
 * Format list summary for "Your lists: 1. Name (n items)..."
 */
export function formatListSummary(
  lists: Array<{ name: string; item_count: number }>
): string {
  if (lists.length === 0) return '';
  const lines = lists.map(
    (l, i) => `${i + 1}. ${l.name} (${l.item_count} items)`
  );
  return (
    'Your lists:\n\n' +
    lines.join('\n') +
    '\n\nReply with the number or name to open a list.'
  );
}

/**
 * Format list preview with header, numbered items (☐/☑), and quick-action footer.
 */
export function formatListPreview(
  listName: string,
  itemCount: number,
  items: Array<{ text: string; is_done: boolean }>
): string {
  if (items.length === 0) {
    return `${listName} (0 items)\n\nReply to this message to interact with the list.\n\nThis list is empty.\n\nReply with:\nadd <items>`;
  }
  const header = `${listName} (${itemCount} items)\n\nReply to this message to interact with the list.\n\n`;
  const lines = items.map(
    (i, idx) => `${idx + 1}. ${i.is_done ? '☑' : '☐'} ${i.text}`
  );
  const footer = '\nReply with:\ndone <item>\nremove <item>\nadd <items>';
  return header + lines.join('\n') + footer;
}
