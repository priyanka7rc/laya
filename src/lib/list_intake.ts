/**
 * Rules-first list extraction from OCR text (Feature #20, upgraded).
 * Produces ProposedList with heading confidence, candidates, and suggested names.
 * Candidates are stored in lists.import_candidates for later conversion to list
 * items (Feature #17/#19).
 */

import { suggestListNames } from '@/lib/list_name_suggest';

export type HeadingConfidence = 'high' | 'low' | 'none';

export interface ProposedList {
  name_prefill: string | null;
  heading_confidence: HeadingConfidence;
  candidates: string[];
  suggested_names: string[];
}

const MAX_CANDIDATES = 50;

const BULLET_REGEX = /^\s*[\-\*\u2022]\s+/;
const CHECKBOX_REGEX = /^\s*\[\s*\]\s+/;
const NUMBERED_REGEX = /^\s*\d+[\.\)]\s+/;

function normalizeText(ocrText: string): string {
  return ocrText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isHardBoundary(line: string): boolean {
  return (
    BULLET_REGEX.test(line) ||
    CHECKBOX_REGEX.test(line) ||
    NUMBERED_REGEX.test(line)
  );
}

function stripListMarker(line: string): string {
  return line
    .replace(BULLET_REGEX, '')
    .replace(CHECKBOX_REGEX, '')
    .replace(NUMBERED_REGEX, '')
    .trim();
}

function looksLikeItem(line: string): boolean {
  const t = line.trim().toLowerCase();
  if (!t) return false;

  if (/^(\d+|\d+(\.\d+)?)(x|\s|$)/.test(t)) return true;
  if (/^(kg|g|lbs?|oz|ml|l|pack|packs|pcs?)\b/.test(t)) return true;
  if (/^\d+[\.\)]\s+/.test(line)) return true;

  return false;
}

function isShortHeading(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.length > 30) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  return true;
}

function detectHeading(
  lines: string[]
): { heading: string | null; confidence: HeadingConfidence; remaining: string[] } {
  if (lines.length === 0) {
    return { heading: null, confidence: 'none', remaining: [] };
  }

  const first = lines[0].trim();

  if (!first) {
    const remaining = lines.slice(1);
    return { heading: null, confidence: 'none', remaining };
  }

  if (isShortHeading(first) && !looksLikeItem(first)) {
    const endsWithColon = first.endsWith(':');
    const confidence: HeadingConfidence = endsWithColon ? 'high' : 'high';
    const headingText = endsWithColon ? first.slice(0, -1).trim() : first;
    const remaining = lines.slice(1);
    return { heading: headingText || null, confidence, remaining };
  }

  return { heading: null, confidence: 'none', remaining: lines };
}

function buildCandidates(lines: string[]): string[] {
  const candidates: string[] = [];
  let current = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = stripListMarker(line);
    if (!stripped) continue;

    const atHardBoundary = isHardBoundary(line);

    if (atHardBoundary && current) {
      candidates.push(current.trim());
      current = stripped;
    } else if (atHardBoundary) {
      current = stripped;
    } else if (current) {
      current = current + ' ' + stripped;
    } else {
      current = stripped;
    }
  }

  if (current.trim()) {
    candidates.push(current.trim());
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  if (deduped.length > MAX_CANDIDATES) {
    throw new Error(
      `Too many items — crop or upload fewer pages. Maximum ${MAX_CANDIDATES} items per list.`
    );
  }

  return deduped;
}

export interface OcrListOptions {
  userHint?: string | null;
  nowISO?: string;
}

export function ocrTextToProposedLists(
  ocrText: string,
  opts?: OcrListOptions
): ProposedList[] {
  const normalized = normalizeText(ocrText);
  const rawLines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);

  const now = opts?.nowISO ? new Date(opts.nowISO) : new Date();

  if (rawLines.length === 0) {
    const suggested = suggestListNames([], opts?.userHint ?? null, now);
    return [
      {
        name_prefill: null,
        heading_confidence: 'none',
        candidates: [],
        suggested_names: suggested,
      },
    ];
  }

  const { heading, confidence, remaining } = detectHeading(rawLines);
  const candidateLines = confidence === 'high' && heading ? remaining : rawLines;

  const candidates = buildCandidates(candidateLines);

  const suggested = suggestListNames(candidates, opts?.userHint ?? null, now);

  return [
    {
      name_prefill: confidence === 'high' && heading ? heading : null,
      heading_confidence: confidence,
      candidates,
      suggested_names: suggested,
    },
  ];
}

