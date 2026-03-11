/**
 * Rules-first, deterministic list name suggestions based on candidate items
 * and optional user hint. No AI in the hot path.
 */

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function suggestListNames(
  candidates: string[],
  userHint: string | null,
  now: Date
): string[] {
  const tokens = new Set<string>();

  for (const c of candidates) {
    for (const t of tokenize(c)) {
      tokens.add(t);
    }
  }

  if (userHint) {
    for (const t of tokenize(userHint)) {
      tokens.add(t);
    }
  }

  const suggestions: string[] = [];

  const hasAny = (...keys: string[]): boolean => keys.some((k) => tokens.has(k));

  if (
    hasAny(
      'grocery',
      'groceries',
      'supermarket',
      'buy',
      'shopping',
      'market',
      'store'
    ) ||
    hasAny('milk', 'eggs', 'rice', 'bread', 'tomato', 'onion', 'oil')
  ) {
    suggestions.push('Groceries');
  }

  if (hasAny('pack', 'packing', 'flight', 'travel', 'trip', 'suitcase', 'bag')) {
    suggestions.push('Packing list');
  }

  if (
    hasAny('movie', 'movies', 'film', 'films', 'watch', 'netflix', 'prime') &&
    !hasAny('work', 'task')
  ) {
    suggestions.push('Movies to watch');
  }

  if (hasAny('read', 'reading', 'book', 'books')) {
    suggestions.push('Books to read');
  }

  if (hasAny('work', 'tasks', 'todo', 'today', 'this', 'week')) {
    suggestions.push('To-do');
  }

  if (hasAny('checklist', 'steps', 'process')) {
    suggestions.push('Checklist');
  }

  if (suggestions.length === 0) {
    suggestions.push('Checklist');
  }

  suggestions.push('Notes');

  const iso = now.toISOString().slice(0, 10);
  suggestions.push(`Imported ${iso}`);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const s of suggestions) {
    if (seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }

  return unique.slice(0, 6);
}

