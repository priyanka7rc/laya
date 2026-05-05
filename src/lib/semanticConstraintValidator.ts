/**
 * Semantic constraint validator for task actions.
 *
 * Called in turnInterpreter after sufficiencyValidator, before building the
 * execution plan. Validates the *values* in an action, not just structural
 * completeness (that's sufficiencyValidator's job).
 *
 * Rules enforced:
 *   1. No inferred past date — if the date was inferred (not explicit) and is
 *      before today, ask the user when they want to do it.
 *   2. Business hours for appointment-type tasks — if a task title signals an
 *      appointment (doctor, dentist, etc.) and the time is outside the
 *      expected operating window, ask for clarification.
 *
 * Rule 3 (task collision — same time as existing task) requires a DB call,
 * so it lives in the whatsapp-processor execution handler, not here.
 *
 * Pure function — no DB calls, no side effects.
 */

import type { DetectedAction } from '@/lib/turnInterpreter';

// ============================================
// TYPES
// ============================================

export type SemanticConstraintDecision =
  | 'ok'
  | 'needs_clarification';

export interface SemanticConstraintResult {
  decision: SemanticConstraintDecision;
  action: DetectedAction;
  clarificationMessage?: string;
}

// ============================================
// RULE 1 — No inferred past date
// ============================================

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function isBeforeToday(dateStr: string): boolean {
  return dateStr < todayISO();
}

// ============================================
// RULE 2 — Business hours for appointment types
// ============================================

interface AppointmentType {
  /** Keywords to match in title or category (case-insensitive). */
  keywords: string[];
  /** Earliest acceptable hour (24h). */
  openHour: number;
  /** Latest acceptable hour (24h). Appointments must start before this hour. */
  closeHour: number;
  /** Human-readable label shown in the clarification message. */
  label: string;
  /** Suggested default time to offer. */
  suggestedTime: string;
}

const APPOINTMENT_TYPES: AppointmentType[] = [
  {
    keywords: ['doctor', 'physician', 'gp', 'general practitioner', 'clinic', 'hospital', 'physiotherapy', 'physio'],
    openHour: 8,
    closeHour: 19,
    label: 'doctor appointments',
    suggestedTime: '10:00',
  },
  {
    keywords: ['dentist', 'dental', 'orthodontist'],
    openHour: 8,
    closeHour: 19,
    label: 'dental appointments',
    suggestedTime: '10:00',
  },
  {
    keywords: ['vet', 'veterinary', 'veterinarian'],
    openHour: 8,
    closeHour: 18,
    label: 'vet appointments',
    suggestedTime: '10:00',
  },
  {
    keywords: ['bank', 'post office'],
    openHour: 9,
    closeHour: 17,
    label: 'bank / post office visits',
    suggestedTime: '11:00',
  },
  {
    keywords: ['interview', 'job interview'],
    openHour: 8,
    closeHour: 20,
    label: 'interviews',
    suggestedTime: '10:00',
  },
];

function findAppointmentType(title: string, category: string | null): AppointmentType | null {
  const haystack = `${title} ${category ?? ''}`.toLowerCase();
  for (const apptType of APPOINTMENT_TYPES) {
    if (apptType.keywords.some((kw) => haystack.includes(kw))) {
      return apptType;
    }
  }
  return null;
}

function timeToHour(timeStr: string): number {
  return parseInt(timeStr.split(':')[0]!, 10);
}

// ============================================
// PER-ACTION VALIDATOR
// ============================================

function validateCreateTaskConstraints(
  action: Extract<DetectedAction, { type: 'create_task' }>
): SemanticConstraintResult {
  const { task } = action;

  // ── Rule 1: No inferred past date ──────────────────────────────────────────
  if (task.inferred_date && task.due_date && isBeforeToday(task.due_date)) {
    return {
      decision: 'needs_clarification',
      action,
      clarificationMessage:
        `That date (${task.due_date}) has already passed. When did you want to do this?`,
    };
  }

  // ── Rule 2: Business hours for appointment types ───────────────────────────
  if (task.due_time && task.inferred_time !== false) {
    // Only check when time is present and was either inferred or explicitly stated.
    // We always check even for explicit times — user may have made a mistake.
    const apptType = findAppointmentType(task.title, task.category ?? null);
    if (apptType) {
      const hour = timeToHour(task.due_time);
      if (hour < apptType.openHour || hour >= apptType.closeHour) {
        return {
          decision: 'needs_clarification',
          action,
          clarificationMessage:
            `${apptType.label.charAt(0).toUpperCase() + apptType.label.slice(1)} are usually ` +
            `between ${apptType.openHour}:00 and ${apptType.closeHour}:00. ` +
            `Did you mean around ${apptType.suggestedTime}?`,
        };
      }
    }
  }

  return { decision: 'ok', action };
}

// ============================================
// MAIN EXPORTED FUNCTIONS
// ============================================

/**
 * Validate a single action against semantic constraints.
 * Only create_task actions are checked; all others pass through as 'ok'.
 */
export function validateSemanticConstraints(action: DetectedAction): SemanticConstraintResult {
  if (action.type === 'create_task') {
    return validateCreateTaskConstraints(action);
  }
  return { decision: 'ok', action };
}

/**
 * Validate all actions in a turn.
 * Returns results in the same order as the input array.
 */
export function validateAllSemanticConstraints(
  actions: DetectedAction[]
): SemanticConstraintResult[] {
  return actions.map(validateSemanticConstraints);
}
