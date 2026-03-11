/**
 * Canonical "segment string → ProposedTask" pipeline using Feature #1 parsers only.
 * Used by Brain Dump and OCR import; no duplicate parsing logic.
 */

import {
  parseDate,
  parseTime,
  detectCategory,
  stripTemporalPhrases,
  getSmartDefaultTime,
} from '@/lib/taskRulesParser';

export interface ProposedTask {
  title: string;
  due_date: string;
  due_time: string;
  category: string;
  inferred_date: boolean;
  inferred_time: boolean;
  rawCandidate: string;
}

/**
 * Turn one segment/candidate string into a ProposedTask using Feature #1 parsers only.
 * due_date/due_time always set; inferred_date/inferred_time true when defaulted.
 */
export function segmentToProposedTask(segment: string): ProposedTask {
  const trimmed = segment.trim();
  const due_date = parseDate(trimmed);
  const due_time = parseTime(trimmed);
  const smartTime = getSmartDefaultTime(trimmed);
  const inferred_time = !smartTime && due_time === '20:00';
  const inferred_date = true;
  const cleanedTitle = stripTemporalPhrases(trimmed).trim() || trimmed;
  const title =
    cleanedTitle.length > 0
      ? cleanedTitle.charAt(0).toUpperCase() + cleanedTitle.slice(1)
      : trimmed;
  const category = detectCategory(trimmed);

  return {
    title: title.slice(0, 120),
    due_date,
    due_time,
    category,
    inferred_date,
    inferred_time,
    rawCandidate: segment,
  };
}

/**
 * Map segments to ProposedTask[]. Applies optional cap (e.g. 25 for OCR).
 */
export function textToProposedTasksFromSegments(
  segments: string[],
  options?: { maxCandidates?: number }
): ProposedTask[] {
  const max = options?.maxCandidates ?? 999;
  const capped = segments.slice(0, max);
  return capped.map(segmentToProposedTask);
}
