/**
 * Domain-bounded clarification policy for the task/list assistant.
 *
 * Pure function — no DB calls. Decides whether a turn needs clarification
 * before executing, based on text-level analysis and reference resolution.
 *
 * This layer handles TEXT-LEVEL ambiguity only:
 *   - Unresolved pronouns in delete/edit commands (risky without a clear target)
 *   - "add it" with no known entity text
 *
 * DB-level ambiguity (multiple list name matches, multiple task search results)
 * is handled at execution time in handleCompoundCapture / delete handler.
 * Those handlers have actual DB access to build numbered candidate lists.
 *
 * Clarification is intentionally conservative: only clarify when the ambiguity
 * materially changes the action target in a way that is risky or irreversible.
 *
 * Examples that trigger clarification:
 *   "delete it" / "delete that one" with no active_task_id → dangerous_delete_no_target
 *   "make it Friday" with no active_task_id → unresolved_pronoun
 *   "add it to shopping" with no last_entity_text → unresolved_pronoun
 *
 * Examples that do NOT trigger clarification here (handled at DB level):
 *   "add sunscreen to shopping" — list name resolved against user's actual lists
 *   "delete dentist task" — search term resolved against actual task DB
 *
 * Clarification messages are:
 *   - Short, calm, domain-specific
 *   - Reference the specific missing variable (entity names when available)
 *   - Never ask the user to restate the whole intent
 *   - Never use generic AI filler like "Can you clarify?"
 */

import type {
  TaskReferenceResult,
  ListReferenceResult,
  EntityReferenceResult,
} from '@/lib/domainReferenceResolver';

// ============================================
// TYPES
// ============================================

export type ClarificationReason =
  // Text-level pronoun / reference failures
  | 'unresolved_pronoun'
  | 'dangerous_delete_no_target'
  | 'conflicting_active_objects'
  // Structural slot failures (from sufficiency validator integration)
  | 'missing_task_title'
  | 'missing_list_name'
  | 'missing_list_items'
  | 'missing_entity_text'
  | 'ambiguous_list_target';

export interface ClarificationPayload {
  questionType: 'which_task' | 'which_list' | 'which_entity';
  hint: string;
  /**
   * Optional entity name extracted from the message or action.
   * Used to produce pointed hints like "Which plumber task?" or "Which shopping list?".
   */
  entityName?: string;
}

export type ClarificationDecision =
  | { needsClarification: false }
  | { needsClarification: true; reason: ClarificationReason; payload: ClarificationPayload };

// ============================================
// PATTERNS
// ============================================

const PRONOUN_PATTERN = /\b(it|that|that\s+one)\b/i;
const DELETE_VERB_PATTERN = /^(?:delete|remove|cancel)\s+/i;
const EDIT_FOLLOW_UP_PATTERN =
  /^(?:make|move|change|set|reschedule|update|push)\s+it\b/i;

// ============================================
// HINT GENERATORS
// ============================================

/**
 * Build a pointed "which task?" hint using the entity name when available.
 *
 * Good: "Which plumber task did you mean?"
 * Good: "Which task should I delete? Reply with the task name."
 * Bad:  "Which task did you mean?" (generic, no entity)
 */
export function buildWhichTaskHint(
  operation: 'delete' | 'update' | 'generic',
  entityName?: string
): string {
  const label = entityName ? `${entityName} ` : '';
  switch (operation) {
    case 'delete':
      return entityName
        ? `Which ${label}task should I delete?`
        : 'Which task should I delete? Reply with the task name.';
    case 'update':
      return entityName
        ? `Which ${label}task should I update?`
        : 'Which task did you mean? Reply with the task name.';
    default:
      return entityName
        ? `Which ${label}task did you mean?`
        : 'Which task did you mean? Reply with the task name.';
  }
}

/**
 * Build a pointed "which list?" hint.
 *
 * Good: "Which shopping list did you mean?"
 * Bad:  "Which list did you mean?"
 */
export function buildWhichListHint(listNameHint?: string): string {
  return listNameHint
    ? `Which ${listNameHint} list should I use?`
    : 'Which list did you mean?';
}

/**
 * Build a pointed "what to add?" hint.
 *
 * Good: "What should I add to groceries?"
 * Bad:  "What should I add?"
 */
export function buildWhatToAddHint(listName?: string): string {
  return listName
    ? `What should I add to ${listName}?`
    : 'What should I add to the list?';
}

// ============================================
// EXPORTED FUNCTION
// ============================================

/**
 * Assess whether a turn needs text-level clarification before execution.
 *
 * @param text - Normalized message text
 * @param actionTypes - Action type strings from the interpreter's detectedActions
 * @param refs - Reference resolution results
 * @param entityName - Optional entity name from detected action (e.g. task term, list name)
 *                     Used to make clarification hints more specific.
 */
export function assessClarification(
  text: string,
  actionTypes: string[],
  refs: {
    task: TaskReferenceResult;
    list: ListReferenceResult;
    entity: EntityReferenceResult;
  },
  entityName?: string
): ClarificationDecision {
  const trimmed = text.trim();
  const hasTaskPronoun = PRONOUN_PATTERN.test(trimmed);

  // ── Dangerous delete with no resolved target ─────────────────────────────
  // "delete it" / "delete that one" with no active task — would silently do nothing
  // or prompt the wrong delete flow. Clarify before executing.
  const isDeleteLike =
    actionTypes.includes('delete_task') ||
    actionTypes.includes('task_follow_up_delete') ||
    DELETE_VERB_PATTERN.test(trimmed);

  if (isDeleteLike && hasTaskPronoun && refs.task.confidence === 'none') {
    return {
      needsClarification: true,
      reason: 'dangerous_delete_no_target',
      payload: {
        questionType: 'which_task',
        hint: buildWhichTaskHint('delete', entityName),
        entityName,
      },
    };
  }

  // ── Edit follow-up with unresolved pronoun ────────────────────────────────
  // "make it Friday" / "move it to tomorrow" — needs an active task to target.
  const isEditFollowUp =
    actionTypes.includes('update_task') ||
    actionTypes.includes('task_follow_up_patch') ||
    EDIT_FOLLOW_UP_PATTERN.test(trimmed);

  if (isEditFollowUp && hasTaskPronoun && refs.task.confidence === 'none') {
    return {
      needsClarification: true,
      reason: 'unresolved_pronoun',
      payload: {
        questionType: 'which_task',
        hint: buildWhichTaskHint('update', entityName),
        entityName,
      },
    };
  }

  // ── "Add it" with no entity text ─────────────────────────────────────────
  // "add it to shopping" — "it" has no referent in state.
  const hasEntityToList =
    actionTypes.includes('entity_to_list') ||
    actionTypes.includes('add_list_items');

  if (
    hasEntityToList &&
    /\badd\s+it\b|\bput\s+it\b/i.test(trimmed) &&
    refs.entity.confidence === 'none'
  ) {
    // Use entityName as list name hint if available
    return {
      needsClarification: true,
      reason: 'unresolved_pronoun',
      payload: {
        questionType: 'which_entity',
        hint: buildWhatToAddHint(entityName),
        entityName,
      },
    };
  }

  return { needsClarification: false };
}
