export type ImportCandidateClassification = 'list' | 'ambiguous';

export interface ImportCandidate {
  text: string;
  classification: ImportCandidateClassification;
  sourceLine?: number | null;
}

function normalizeKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeImportCandidates(input: unknown): ImportCandidate[] {
  if (!input) return [];

  if (Array.isArray(input)) {
    return input.flatMap((c): ImportCandidate[] => {
      if (typeof c === 'string') {
        return [{ text: c, classification: 'list', sourceLine: null }];
      }
      if (c && typeof c === 'object' && 'text' in c) {
        const obj = c as { text: unknown; classification?: unknown; sourceLine?: unknown };
        return [{
          text: String(obj.text),
          classification: (obj.classification as ImportCandidateClassification) ?? 'list',
          sourceLine: typeof obj.sourceLine === 'number' ? obj.sourceLine : null,
        }];
      }
      return [];
    });
  }

  return [];
}

export function mergeImportCandidates(
  existing: unknown,
  incoming: unknown
): ImportCandidate[] {
  const base = normalizeImportCandidates(existing);
  const add = normalizeImportCandidates(incoming);

  const seen = new Set<string>();
  const merged: ImportCandidate[] = [];

  for (const c of base) {
    const key = normalizeKey(c.text);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }

  for (const c of add) {
    const key = normalizeKey(c.text);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }

  return merged;
}

