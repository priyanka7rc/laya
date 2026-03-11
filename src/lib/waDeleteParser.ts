/**
 * WhatsApp delete intent parser + confirmation copy helpers.
 * All pure functions (no DB, no side-effects) — testable without mocks.
 */

export type DeleteIntent =
  | { kind: 'undo' }
  | { kind: 'delete_indices'; indices: number[] }  // 1-based display indices
  | { kind: 'delete_all' }
  | { kind: 'delete_term'; term: string }
  | { kind: 'delete_bare' }   // "delete" with no extra info — use context
  | null;

const DELETE_VERBS = /^(delete|remove)\b/i;

/**
 * Normalize text for intent matching: trim, lowercase, collapse whitespace.
 */
export function normalizeForDeleteIntent(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parse a WhatsApp message into a DeleteIntent.
 * Returns null if not a delete-related message.
 */
export function parseDeleteIntent(raw: string): DeleteIntent {
  const norm = normalizeForDeleteIntent(raw);

  if (norm === 'undo') return { kind: 'undo' };

  if (!DELETE_VERBS.test(norm)) return null;

  // Strip the leading verb
  const rest = norm.replace(DELETE_VERBS, '').trim();

  if (rest === '' ) return { kind: 'delete_bare' };
  if (rest === 'all') return { kind: 'delete_all' };

  // Match indices: "2", "2 and 3", "2,3", "2, 3 and 4", "1 2 3"
  const indexMatch = /^[\d][0-9,\s&and]*$/.test(rest.replace(/\band\b/g, ','));
  if (indexMatch) {
    const nums = rest
      .replace(/\band\b/gi, ',')
      .split(/[,\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (nums.length > 0) return { kind: 'delete_indices', indices: nums };
  }

  // Fallback: treat rest as a search term
  if (rest.length >= 2) return { kind: 'delete_term', term: rest };

  return { kind: 'delete_bare' };
}

// ─── Copy helpers ───────────────────────────────────────────────────────────

export function formatDeleteConfirmation(titles: string[]): string {
  if (titles.length === 0) return 'Nothing was deleted.';
  if (titles.length === 1) {
    return `Deleted ✅ "${titles[0]}"\nReply UNDO to restore — I'll keep it in memory for 5 minutes.`;
  }
  return `Deleted ✅ ${titles.length} tasks\nReply UNDO to restore — I'll keep them in memory for 5 minutes.`;
}

export function formatUndoConfirmation(restoredCount: number, partialFailure: boolean): string {
  if (restoredCount === 0) {
    return "Nothing to undo right now — I only keep deletions in memory for 5 minutes.";
  }
  if (partialFailure) {
    return "Restored what I could ✅ A couple were already out of the 5-minute window.";
  }
  return "Restored ✅ You're all set.";
}

export function formatDeleteAmbiguityPrompt(tasks: Array<{ title: string }>): string {
  const numbered = tasks
    .map((t, i) => `${i + 1}. ${t.title}`)
    .join('\n');
  return `Which task(s) should I delete? Reply with the number(s):\n\n${numbered}`;
}

export function formatDeleteConfirmRequest(title: string): string {
  return `Delete "${title}"? Reply YES to confirm or NO to cancel.`;
}

// ─── Undo eligibility (pure) ─────────────────────────────────────────────────

export function isWithinUndoWindow(lastDeletedAt: string | null, windowMinutes: number = 5): boolean {
  if (!lastDeletedAt) return false;
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000);
  return new Date(lastDeletedAt) >= cutoff;
}
