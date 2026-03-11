import { ocrTextToProposedTasks, type ProposedTask } from '@/lib/ocrCandidates';
import { ocrTextToProposedLists } from '@/lib/list_intake';

export type ListCandidateClassification = 'list' | 'ambiguous';

export interface ClassifiedListCandidate {
  text: string;
  classification: ListCandidateClassification;
}

export interface OcrImportPreview {
  proposedTasks: ProposedTask[];
  proposedList: {
    name_prefill: string | null;
    suggested_names: string[];
    candidates: ClassifiedListCandidate[];
  };
  task_count: number;
  list_count: number;
  ambiguous_count: number;
}

// Local normalizer for overlap removal; matches listImportCandidates.normalizeKey:
// - trim
// - lowercase
// - collapse multiple spaces
function normalizeLineKey(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Strong task detector: explicit scheduling/reminder cues.
// Examples:
// - "Pay rent tomorrow at 5pm"
// - "Call mom 2026-03-05 18:00"
function isStrongTaskLine(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(lower)) return true;
  if (/\b\d{1,2}:\d{2}\b/.test(lower)) return true;
  if (/\b(today|tomorrow|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/.test(lower)) {
    return true;
  }
  if (/\b(remind|reminder|due|deadline|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?)\b/.test(lower)) {
    return true;
  }
  if (/\b(call|email|pay|send|meet|schedule|book|follow up|follow-up)\b/.test(lower)) {
    return true;
  }
  return false;
}

function isStrongTaskFromTitle(task: ProposedTask): boolean {
  const title = task.title ?? '';
  return isStrongTaskLine(title);
}

// Weak task-ish detector: imperative verbs without strong scheduling signals.
// Examples:
// - "buy milk", "get groceries", "pick up shirts"
// - "call bank" (no date/time)
// - "remind me to send invoice" (no date/time)
function isWeakTaskLine(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return false;

  // Skip if already strong.
  if (isStrongTaskLine(lower)) return false;

  const verbish =
    /^(buy|get|pick up|pickup|pick|call|remind|email|message|schedule|pay|book|meet|order|send|submit|renew|return|collect|drop|follow up|follow-up)\b/;
  return verbish.test(lower);
}

export function buildOcrImportPreview(
  ocrText: string,
  opts?: { userHint?: string | null }
): OcrImportPreview {
  const { tasks } = ocrTextToProposedTasks(ocrText);

  const strongTasks = tasks.filter(isStrongTaskFromTitle);

  const [listCandidate] = ocrTextToProposedLists(ocrText, {
    userHint: opts?.userHint ?? null,
  });

  const rawListCandidates = listCandidate?.candidates ?? [];

  const strongRawSet = new Set(
    strongTasks
      .map((t) => normalizeLineKey(t.rawCandidate))
      .filter(Boolean)
  );

  const classified: ClassifiedListCandidate[] = rawListCandidates
    .filter((text) => !strongRawSet.has(normalizeLineKey(text)))
    .map((text) => {
      const weak = isWeakTaskLine(text);
      return {
        text,
        classification: (weak ? 'ambiguous' : 'list') as ListCandidateClassification,
      };
    });

  const list_count = classified.filter((c) => c.classification === 'list').length;
  const ambiguous_count = classified.filter((c) => c.classification === 'ambiguous').length;

  return {
    proposedTasks: strongTasks,
    proposedList: {
      name_prefill: listCandidate?.name_prefill ?? null,
      suggested_names: listCandidate?.suggested_names ?? [],
      candidates: classified,
    },
    task_count: strongTasks.length,
    list_count,
    ambiguous_count,
  };
}

