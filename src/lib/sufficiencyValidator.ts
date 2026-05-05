/**
 * Deterministic sufficiency validator for task/list actions.
 *
 * Called after detectedActions are assembled in turnInterpreter.
 * Decides per-action whether it is safe to execute, needs clarification,
 * or should be dropped as an invalid fallback.
 *
 * DOES NOT use model self-reported confidence.
 * Uses deterministic structural rules for each action type.
 *
 * Pure function — no DB calls, no side effects.
 */

import type { DetectedAction } from '@/lib/turnInterpreter';

// ============================================
// TYPES
// ============================================

export type SufficiencyDecision = 'executable' | 'needs_clarification' | 'invalid_fallback';

export type SufficiencyFailureReason =
  | 'missing_task_title'
  | 'stopword_only_title'
  | 'missing_list_name'
  | 'missing_list_items'
  | 'missing_list_target'
  | 'missing_entity_text'
  | 'missing_entity_list_target'
  | 'missing_task_term'
  | 'empty_patch'
  | 'missing_task_id'
  | 'missing_list_id';

export interface SufficiencyResult {
  decision: SufficiencyDecision;
  action: DetectedAction;
  /** Present when decision is needs_clarification or invalid_fallback. */
  reason?: SufficiencyFailureReason;
  /**
   * Pointed clarification message for the user.
   * References the specific missing slot, using entity names where available.
   * Never generic ("What do you want to do?").
   */
  clarificationMessage?: string;
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Words that are not meaningful standalone task titles.
 * A title consisting only of these (after splitting) is insufficient.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'this', 'that', 'it', 'do', 'did', 'done',
  'ok', 'okay', 'yes', 'no', 'hi', 'hello', 'hey', 'thanks', 'thank',
  'please', 'pls', 'plz', 'sure', 'great', 'good', 'cool',
]);

function isStopwordOnlyTitle(title: string): boolean {
  const words = title.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => STOPWORDS.has(w));
}

function isEmptyOrTrivial(s: string | null | undefined): boolean {
  return !s || s.trim().length < 2;
}

/** Pronouns and bare reference words that cannot be acted on without prior context. */
const AMBIGUOUS_REFS = new Set(['it', 'this', 'that', 'these', 'those', 'them', 'one', 'the one']);

function isAmbiguousRef(s: string): boolean {
  return AMBIGUOUS_REFS.has(s.trim().toLowerCase());
}

// ============================================
// PER-ACTION VALIDATORS
// ============================================

function validateCreateTask(
  action: Extract<DetectedAction, { type: 'create_task' }>
): SufficiencyResult {
  const title = action.task.title ?? '';

  if (isEmptyOrTrivial(title)) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_task_title',
      clarificationMessage: 'What should I call this task?',
    };
  }

  if (isStopwordOnlyTitle(title)) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'stopword_only_title',
      clarificationMessage: 'What should I add as a task?',
    };
  }

  return { decision: 'executable', action };
}

function validateCreateList(
  action: Extract<DetectedAction, { type: 'create_list' }>
): SufficiencyResult {
  if (isEmptyOrTrivial(action.listName)) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_name',
      clarificationMessage: 'What should I name this list?',
    };
  }

  return { decision: 'executable', action };
}

function validateAddListItems(
  action: Extract<DetectedAction, { type: 'add_list_items' }>
): SufficiencyResult {
  const hasTarget = !isEmptyOrTrivial(action.listName) || !isEmptyOrTrivial(action.listId);

  if (!hasTarget) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_target',
      clarificationMessage:
        action.items.length > 0
          ? `Which list should I add ${action.items.slice(0, 2).join(' and ')} to?`
          : 'Which list should I add items to?',
    };
  }

  const items = (action.items ?? []).filter((i) => i.trim().length > 0);
  if (items.length === 0) {
    const listLabel = !isEmptyOrTrivial(action.listName) ? ` to ${action.listName}` : '';
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_items',
      clarificationMessage: `What should I add${listLabel}?`,
    };
  }

  // All items are ambiguous pronouns ("it", "this", "that") — can't act without context
  if (items.every(isAmbiguousRef)) {
    const listLabel = !isEmptyOrTrivial(action.listName) ? ` to ${action.listName}` : '';
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_items',
      clarificationMessage: `What did you want to add${listLabel}?`,
    };
  }

  return { decision: 'executable', action };
}

function validateUpdateTask(
  action: Extract<DetectedAction, { type: 'update_task' }>
): SufficiencyResult {
  if (isEmptyOrTrivial(action.taskTerm) || isAmbiguousRef(action.taskTerm)) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_task_term',
      clarificationMessage: 'Which task did you mean?',
    };
  }

  const patchKeys = Object.keys(action.patch).filter(
    (k) => action.patch[k as keyof typeof action.patch] !== undefined
  );
  if (patchKeys.length === 0) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'empty_patch',
      clarificationMessage: `What should I change about the "${action.taskTerm}" task?`,
    };
  }

  return { decision: 'executable', action };
}

function validateTaskFollowUpPatch(
  action: Extract<DetectedAction, { type: 'task_follow_up_patch' }>
): SufficiencyResult {
  if (!action.taskId) {
    const label = !isEmptyOrTrivial(action.taskTitle) ? ` the ${action.taskTitle} task` : ' a task';
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_task_id',
      clarificationMessage: `Which task should I update? Reply with the task name.`,
    };
  }

  const patchKeys = Object.keys(action.patch).filter(
    (k) => action.patch[k as keyof typeof action.patch] !== undefined
  );
  if (patchKeys.length === 0) {
    const label = !isEmptyOrTrivial(action.taskTitle) ? ` the "${action.taskTitle}" task` : ' this task';
    return {
      decision: 'needs_clarification',
      action,
      reason: 'empty_patch',
      clarificationMessage: `What should I change about${label}?`,
    };
  }

  return { decision: 'executable', action };
}

function validateTaskFollowUpDelete(
  action: Extract<DetectedAction, { type: 'task_follow_up_delete' }>
): SufficiencyResult {
  if (!action.taskId) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_task_id',
      clarificationMessage: 'Which task should I delete? Reply with the task name.',
    };
  }

  return { decision: 'executable', action };
}

function validateTaskFollowUpDone(
  action: Extract<DetectedAction, { type: 'task_follow_up_done' }>
): SufficiencyResult {
  if (!action.taskId) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_task_id',
      clarificationMessage: 'Which task should I mark as done? Reply with the task name.',
    };
  }

  return { decision: 'executable', action };
}

function validateListItemFollowUp(
  action: Extract<DetectedAction, { type: 'list_item_follow_up' }>
): SufficiencyResult {
  if (!action.listId) {
    const listLabel = !isEmptyOrTrivial(action.listName) ? action.listName : null;
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_id',
      clarificationMessage: listLabel
        ? `Which list should I add to? (I don't have an active list for "${listLabel}")`
        : 'Which list should I add items to?',
    };
  }

  const items = (action.items ?? []).filter((i) => i.trim().length > 0);
  if (items.length === 0) {
    const listLabel = !isEmptyOrTrivial(action.listName) ? ` to ${action.listName}` : '';
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_items',
      clarificationMessage: `What should I add${listLabel}?`,
    };
  }

  return { decision: 'executable', action };
}

function validateRemoveListItem(
  action: Extract<DetectedAction, { type: 'remove_list_item' }>
): SufficiencyResult {
  if (isEmptyOrTrivial(action.item)) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_items',
      clarificationMessage: 'What should I remove?',
    };
  }

  const hasTarget = !isEmptyOrTrivial(action.listName) || !isEmptyOrTrivial(action.listId);
  if (!hasTarget) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_list_target',
      clarificationMessage: `Remove "${action.item}" from which list?`,
    };
  }

  return { decision: 'executable', action };
}

function validateEntityToList(
  action: Extract<DetectedAction, { type: 'entity_to_list' }>
): SufficiencyResult {
  if (isEmptyOrTrivial(action.entityText)) {
    const listLabel = !isEmptyOrTrivial(action.listName) ? ` to ${action.listName}` : '';
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_entity_text',
      clarificationMessage: `What should I add${listLabel}?`,
    };
  }

  if (isEmptyOrTrivial(action.listName)) {
    return {
      decision: 'needs_clarification',
      action,
      reason: 'missing_entity_list_target',
      clarificationMessage: `Which list should I add "${action.entityText}" to?`,
    };
  }

  return { decision: 'executable', action };
}

// ============================================
// MAIN EXPORTED FUNCTION
// ============================================

/**
 * Validate a single detected action for sufficiency.
 *
 * Returns 'executable' when the action has all required fields.
 * Returns 'needs_clarification' with a pointed message when one slot is missing.
 * Returns 'invalid_fallback' when the action is structurally broken beyond recovery.
 *
 * @param action - A single DetectedAction from the interpretation pipeline
 */
export function validateActionSufficiency(action: DetectedAction): SufficiencyResult {
  switch (action.type) {
    case 'create_task':
      return validateCreateTask(action);

    case 'create_list':
      return validateCreateList(action);

    case 'add_list_items':
      return validateAddListItems(action);

    case 'update_task':
      return validateUpdateTask(action);

    case 'task_follow_up_patch':
      return validateTaskFollowUpPatch(action);

    case 'task_follow_up_delete':
      return validateTaskFollowUpDelete(action);

    case 'task_follow_up_done':
      return validateTaskFollowUpDone(action);

    case 'list_item_follow_up':
      return validateListItemFollowUp(action);

    case 'remove_list_item':
      return validateRemoveListItem(action);

    case 'entity_to_list':
      return validateEntityToList(action);

    default: {
      // Unknown action type — treat as invalid_fallback
      return {
        decision: 'invalid_fallback',
        action,
        reason: 'missing_task_title',
        clarificationMessage: undefined,
      };
    }
  }
}

/**
 * Validate all detected actions for a turn.
 * Returns results in the same order as the input array.
 */
export function validateAllActions(actions: DetectedAction[]): SufficiencyResult[] {
  return actions.map(validateActionSufficiency);
}
