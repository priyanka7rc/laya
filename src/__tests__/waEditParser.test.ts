import {
  parseEditSelectionIntent,
  parseEditPatch,
  isPendingEditExpired,
  PENDING_EDIT_EXPIRY_MS,
} from '@/lib/waEditParser';

describe('parseEditSelectionIntent', () => {
  it('returns null for unrelated messages', () => {
    expect(parseEditSelectionIntent('add milk')).toBeNull();
    expect(parseEditSelectionIntent('what do I have today')).toBeNull();
    expect(parseEditSelectionIntent('delete 2')).toBeNull();
  });

  it('parses bare "edit"', () => {
    expect(parseEditSelectionIntent('edit')).toEqual({ kind: 'edit_bare' });
    expect(parseEditSelectionIntent('Edit')).toEqual({ kind: 'edit_bare' });
    expect(parseEditSelectionIntent('  change  ')).toEqual({ kind: 'edit_bare' });
  });

  it('parses edit verbs', () => {
    expect(parseEditSelectionIntent('reschedule')).toEqual({ kind: 'edit_bare' });
    expect(parseEditSelectionIntent('update')).toEqual({ kind: 'edit_bare' });
    expect(parseEditSelectionIntent('move')).toEqual({ kind: 'edit_bare' });
    expect(parseEditSelectionIntent('rename')).toEqual({ kind: 'edit_bare' });
  });

  it('parses "edit N"', () => {
    expect(parseEditSelectionIntent('edit 1')).toEqual({ kind: 'edit_index', index: 1 });
    expect(parseEditSelectionIntent('edit 2')).toEqual({ kind: 'edit_index', index: 2 });
    expect(parseEditSelectionIntent('change 3')).toEqual({ kind: 'edit_index', index: 3 });
  });

  it('parses "edit <term>" for search fallback', () => {
    expect(parseEditSelectionIntent('edit milk')).toEqual({ kind: 'edit_term', term: 'milk' });
    expect(parseEditSelectionIntent('reschedule dentist')).toEqual({ kind: 'edit_term', term: 'dentist' });
    expect(parseEditSelectionIntent('rename milk task')).toEqual({ kind: 'edit_term', term: 'milk task' });
  });
});

describe('parseEditPatch', () => {
  const tz = 'Asia/Kolkata';

  it('parses "tomorrow"', () => {
    const patch = parseEditPatch('move to tomorrow', tz);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(patch.due_date).toBe(tomorrow.toISOString().slice(0, 10));
  });

  it('parses "today"', () => {
    const patch = parseEditPatch('today', tz);
    expect(patch.due_date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('parses time 5pm', () => {
    const patch = parseEditPatch('5pm', tz);
    expect(patch.due_time).toBe('17:00');
  });

  it('parses "rename to X"', () => {
    const patch = parseEditPatch('rename to Buy eggs', tz);
    expect(patch.title).toBe('Buy eggs');
  });

  it('parses category', () => {
    const patch = parseEditPatch('set to work', tz);
    expect(patch.category).toBe('work');
  });
});

describe('isPendingEditExpired', () => {
  it('returns true for null', () => {
    expect(isPendingEditExpired(null)).toBe(true);
  });

  it('returns true for past date', () => {
    const past = new Date(Date.now() - 10000).toISOString();
    expect(isPendingEditExpired(past)).toBe(true);
  });

  it('returns false for future date', () => {
    const future = new Date(Date.now() + PENDING_EDIT_EXPIRY_MS).toISOString();
    expect(isPendingEditExpired(future)).toBe(false);
  });
});
