import {
  parseDeleteIntent,
  normalizeForDeleteIntent,
  formatDeleteConfirmation,
  formatUndoConfirmation,
  isWithinUndoWindow,
} from '@/lib/waDeleteParser';

// ─── Parser tests ────────────────────────────────────────────────────────────

describe('parseDeleteIntent', () => {
  it('returns null for unrelated messages', () => {
    expect(parseDeleteIntent('add milk')).toBeNull();
    expect(parseDeleteIntent('what do I have today')).toBeNull();
    expect(parseDeleteIntent('hello')).toBeNull();
  });

  it('parses bare "delete"', () => {
    expect(parseDeleteIntent('delete')).toEqual({ kind: 'delete_bare' });
    expect(parseDeleteIntent('Delete')).toEqual({ kind: 'delete_bare' });
    expect(parseDeleteIntent('REMOVE')).toEqual({ kind: 'delete_bare' });
  });

  it('parses "undo"', () => {
    expect(parseDeleteIntent('undo')).toEqual({ kind: 'undo' });
    expect(parseDeleteIntent('UNDO')).toEqual({ kind: 'undo' });
  });

  it('parses single index', () => {
    expect(parseDeleteIntent('delete 2')).toEqual({ kind: 'delete_indices', indices: [2] });
    expect(parseDeleteIntent('remove 3')).toEqual({ kind: 'delete_indices', indices: [3] });
  });

  it('parses multiple indices with "and"', () => {
    expect(parseDeleteIntent('delete 2 and 3')).toEqual({
      kind: 'delete_indices',
      indices: [2, 3],
    });
  });

  it('parses comma-separated indices', () => {
    expect(parseDeleteIntent('delete 1,3')).toEqual({
      kind: 'delete_indices',
      indices: [1, 3],
    });
  });

  it('parses "delete all"', () => {
    expect(parseDeleteIntent('delete all')).toEqual({ kind: 'delete_all' });
    expect(parseDeleteIntent('remove all')).toEqual({ kind: 'delete_all' });
  });

  it('parses a named term as delete_term', () => {
    expect(parseDeleteIntent('delete milk')).toEqual({ kind: 'delete_term', term: 'milk' });
    expect(parseDeleteIntent('remove grocery run')).toEqual({
      kind: 'delete_term',
      term: 'grocery run',
    });
  });
});

// ─── Copy helpers ────────────────────────────────────────────────────────────

describe('formatDeleteConfirmation', () => {
  it('returns "nothing deleted" for empty list', () => {
    expect(formatDeleteConfirmation([])).toBe('Nothing was deleted.');
  });

  it('formats single task', () => {
    const msg = formatDeleteConfirmation(['Buy milk']);
    expect(msg).toContain('"Buy milk"');
    expect(msg).toContain('UNDO');
    expect(msg).toContain('5 minutes');
  });

  it('formats multiple tasks', () => {
    const msg = formatDeleteConfirmation(['Task A', 'Task B']);
    expect(msg).toContain('2 tasks');
    expect(msg).toContain('UNDO');
    expect(msg).not.toContain('"Task A"');
  });
});

describe('formatUndoConfirmation', () => {
  it('nothing to undo when count is 0', () => {
    expect(formatUndoConfirmation(0, false)).toContain('5 minutes');
  });

  it('partial restore message', () => {
    const msg = formatUndoConfirmation(2, true);
    expect(msg).toContain('Restored what I could');
  });

  it('full restore message', () => {
    const msg = formatUndoConfirmation(3, false);
    expect(msg).toContain('Restored');
    expect(msg).toContain("You're all set");
  });
});

// ─── Undo eligibility (pure) ─────────────────────────────────────────────────

describe('isWithinUndoWindow', () => {
  it('returns false for null', () => {
    expect(isWithinUndoWindow(null)).toBe(false);
  });

  it('returns true for very recent timestamp', () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
    expect(isWithinUndoWindow(recent, 5)).toBe(true);
  });

  it('returns false for timestamp older than window', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    expect(isWithinUndoWindow(old, 5)).toBe(false);
  });

  it('returns true for timestamp exactly at window boundary', () => {
    const boundary = new Date(Date.now() - 4.9 * 60 * 1000).toISOString();
    expect(isWithinUndoWindow(boundary, 5)).toBe(true);
  });
});
