/**
 * Deterministic candidate splitting for OCR text.
 * Segment → ProposedTask uses canonical segmentToProposedTask from @/lib/task_intake (Feature #1 only).
 */

import { segmentToProposedTask, type ProposedTask } from '@/lib/task_intake';

export type { ProposedTask } from '@/lib/task_intake';

const MAX_CANDIDATES = 25;

const BULLET_REGEX = /^\s*[\-\*\u2022]\s+/;
const CHECKBOX_REGEX = /^\s*\[\s*\]\s+/;
const NUMBERED_REGEX = /^\s*\d+[\.\)]\s+/;

const JUNK_LOW_ALPHA = /^[^a-zA-Z0-9]*$/;
const MIN_LENGTH = 3;
const PAGE_HEADER_LIKE = /^\s*(notes?|todo|list|tasks?|items?)\s*$/i;

export function normalizeText(ocrText: string): string {
  return (
    ocrText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function isHardBoundary(line: string): boolean {
  return (
    BULLET_REGEX.test(line) ||
    CHECKBOX_REGEX.test(line) ||
    NUMBERED_REGEX.test(line)
  );
}

function isJunkLine(line: string): boolean {
  const t = line.trim();
  if (t.length < MIN_LENGTH) return true;
  if (JUNK_LOW_ALPHA.test(t)) return true;
  if (PAGE_HEADER_LIKE.test(t)) return true;
  return false;
}

function stripListMarker(line: string): string {
  return line
    .replace(BULLET_REGEX, '')
    .replace(CHECKBOX_REGEX, '')
    .replace(NUMBERED_REGEX, '')
    .trim();
}

/**
 * Split normalized OCR text into candidate task strings.
 * Hard boundaries: bullets, checkboxes, numbered lists.
 * Merge continuation lines (no punctuation + next line lowercase or no bullet).
 * Drop junk lines. Cap at MAX_CANDIDATES.
 */
export function splitCandidates(normalizedText: string): string[] {
  const lines = normalizedText.split('\n').map((l) => l.trim()).filter(Boolean);
  const candidates: string[] = [];
  let current = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = stripListMarker(line);
    if (isJunkLine(stripped)) continue;

    const atHardBoundary = isHardBoundary(line);
    const prevEndsPunctuation = /[.!?\-:]\s*$/.test(current);
    const nextStartsLower = stripped.length > 0 && /^[a-z]/.test(stripped);
    const nextIsContinuation = !atHardBoundary && current.length > 0 && !prevEndsPunctuation && nextStartsLower;

    if (atHardBoundary && current) {
      candidates.push(current.trim());
      current = stripped;
    } else if (nextIsContinuation) {
      current = current + ' ' + stripped;
    } else if (atHardBoundary) {
      current = stripped;
    } else if (current) {
      candidates.push(current.trim());
      current = stripped;
    } else {
      current = stripped;
    }
  }

  if (current.trim()) {
    candidates.push(current.trim());
  }

  return candidates.filter((c) => c.length >= MIN_LENGTH);
}

/** Canonical segment → task (re-export from task_intake). */
export const candidateToProposedTask = segmentToProposedTask;

/**
 * Full pipeline: normalized text → candidates → ProposedTask[].
 * Uses canonical segmentToProposedTask. Caps at MAX_CANDIDATES and reports truncation.
 */
export function ocrTextToProposedTasks(
  ocrText: string
): { tasks: ProposedTask[]; truncated: boolean } {
  const normalized = normalizeText(ocrText);
  const candidates = splitCandidates(normalized);
  let truncated = false;
  let used = candidates;
  if (candidates.length > MAX_CANDIDATES) {
    used = candidates.slice(0, MAX_CANDIDATES);
    truncated = true;
  }
  return { tasks: used.map(segmentToProposedTask), truncated };
}
