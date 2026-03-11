/**
 * WhatsApp edit intent parser + patch parser (rules-first, no AI).
 * Used for: (1) selecting which task to edit, (2) parsing follow-up message into a patch.
 */

export type EditSelectionIntent =
  | { kind: 'edit_bare' }
  | { kind: 'edit_index'; index: number }
  | { kind: 'edit_term'; term: string }
  | null;

const EDIT_VERBS = /^(edit|change|update|reschedule|move|rename)\b/i;

function normalizeForEdit(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parse "select task to edit" intent from message.
 * "edit", "edit 2", "reschedule", "rename milk task"
 */
export function parseEditSelectionIntent(raw: string): EditSelectionIntent {
  const norm = normalizeForEdit(raw);
  if (!EDIT_VERBS.test(norm)) return null;

  const rest = norm.replace(EDIT_VERBS, '').trim();
  if (rest === '') return { kind: 'edit_bare' };

  const indexMatch = /^(\d+)$/.exec(rest);
  if (indexMatch) {
    const index = parseInt(indexMatch[1], 10);
    if (index >= 1) return { kind: 'edit_index', index };
  }

  if (rest.length >= 2) return { kind: 'edit_term', term: rest };
  return { kind: 'edit_bare' };
}

/**
 * Result of parsing an inbound message as an edit patch (when a task is already selected).
 */
export interface EditPatch {
  title?: string;
  due_date?: string | null;
  due_time?: string | null;
  category?: string;
}

/**
 * Parse follow-up message into a partial update (patch).
 * Rules-first: date, time, "rename X", "tomorrow", "5pm", etc.
 */
export function parseEditPatch(
  text: string,
  _tz: string
): EditPatch {
  const patch: EditPatch = {};
  const lower = text.trim().toLowerCase();

  const renameMatch = /(?:rename|title|call it)\s+(?:to\s+)?["']?([^"']+)["']?$/i.exec(text.trim());
  if (renameMatch && renameMatch[1]) {
    patch.title = renameMatch[1].trim();
  }

  let dueDate: string | null = null;
  let dueTime: string | null = null;

  if (lower.includes('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    dueDate = d.toISOString().slice(0, 10);
  } else if (lower.includes('today')) {
    dueDate = new Date().toISOString().slice(0, 10);
  } else {
    const ymd = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (ymd) dueDate = ymd[0];
    const dmy = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/.exec(text);
    if (dmy && !dueDate) {
      const [, day, month, year] = dmy;
      const y = year.length === 2 ? 2000 + parseInt(year, 10) : parseInt(year, 10);
      dueDate = `${y}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
    }
  }

  const timeMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] ? timeMatch[2] : '00';
    if (timeMatch[3] === 'pm' && h < 12) h += 12;
    if (timeMatch[3] === 'am' && h === 12) h = 0;
    dueTime = `${h.toString().padStart(2, '0')}:${m}`;
  } else {
    const time24 = /\b(\d{1,2}):(\d{2})\b/.exec(text);
    if (time24) dueTime = `${time24[1].padStart(2, '0')}:${time24[2]}`;
  }

  if (dueDate !== null) patch.due_date = dueDate;
  if (dueTime !== null) patch.due_time = dueTime;

  const catMatch = /\b(work|personal|home|health|errands)\b/i.exec(lower);
  if (catMatch) patch.category = catMatch[1].toLowerCase();

  return patch;
}

/** Pending action expiry: 2 hours in ms */
export const PENDING_EDIT_EXPIRY_MS = 2 * 60 * 60 * 1000;

export function isPendingEditExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= Date.now();
}
