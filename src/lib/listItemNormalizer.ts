/**
 * Normalize list item text for storage and lookup: trim, lowercase,
 * collapse spaces, remove trailing punctuation.
 */
export function normalizeListItem(text: string): string {
  const trimmed = text.trim().toLowerCase();
  const collapsed = trimmed.replace(/\s+/g, ' ');
  return collapsed.replace(/[.,;:!?]+$/g, '').trim();
}
