/**
 * Domain-bounded reference resolver for task/list context.
 *
 * Pure function — no DB calls. Resolves text-level references (pronouns,
 * implicit references, explicit names) against durable conversation state.
 *
 * Resolution priority for task references:
 *   1. Explicit name — "the bill task" → matched against last_task_title
 *   2. Pronoun — "it" / "that" / "that one" → mapped to active_task_id
 *   3. Unresolved — no state to resolve against
 *
 * Resolution priority for list references:
 *   1. Explicit name — "the school snacks list" → matched against last_list_name
 *   2. Pronoun — "this list" / "that list" → mapped to active_list_id
 *   3. Unresolved
 *
 * Resolution priority for entity references:
 *   1. "add it to X" / "put it in X" → last_entity_text
 *   2. Unresolved
 *
 * Only resolves references within the task/list domain.
 * Does not attempt open-ended pronoun resolution for general conversation.
 */

import type { WaConversationState } from '@/lib/waConversationState';

// ============================================
// TYPES
// ============================================

export type ResolutionSource = 'active_state' | 'entity_text' | 'explicit_name' | 'none';
export type ResolutionConfidence = 'high' | 'low' | 'none';

export interface TaskReferenceResult {
  resolved: boolean;
  taskId: string | null;
  taskTitle: string | null;
  confidence: ResolutionConfidence;
  resolutionSource: ResolutionSource;
}

export interface ListReferenceResult {
  resolved: boolean;
  listId: string | null;
  listName: string | null;
  confidence: ResolutionConfidence;
  resolutionSource: ResolutionSource;
}

export interface EntityReferenceResult {
  entityText: string | null;
  confidence: ResolutionConfidence;
  resolutionSource: ResolutionSource;
}

// ============================================
// PATTERNS
// ============================================

/** Pronouns that implicitly refer to the last active task. */
const TASK_PRONOUN = /\b(it|that|that\s+one)\b/i;

/** Explicit task reference: "the bill task", "the dentist task" */
const EXPLICIT_TASK_REF = /\bthe\s+(.+?)\s+task\b/i;

/** Explicit list reference: "the school snacks list", "the grocery list" */
const EXPLICIT_LIST_REF = /\bthe\s+(.+?)\s+list\b/i;

/** List pronoun: "this list", "that list" */
const LIST_PRONOUN = /\b(this|that|it)\s+list\b/i;

/** Entity reference: "add it to X" / "put it in X" */
const ENTITY_IT_ANCHOR = /\b(add|put)\s+it\b/i;

// ============================================
// EXPORTED RESOLVERS
// ============================================

/**
 * Resolve a task reference from text + conversation state.
 *
 * Returns `resolved: true` with `taskId` when a confident target is found.
 * Returns `resolved: false, confidence: 'none'` when no resolution is possible
 * (caller should consider clarification for risky operations like delete).
 */
export function resolveTaskReference(
  text: string,
  convState: WaConversationState | null
): TaskReferenceResult {
  const trimmed = text.trim();

  // 1. Explicit name: "the bill task"
  const explicitMatch = EXPLICIT_TASK_REF.exec(trimmed);
  if (explicitMatch) {
    const nameInText = explicitMatch[1]!.trim().toLowerCase();
    if (convState?.last_task_title) {
      const titleLower = convState.last_task_title.toLowerCase();
      // Fuzzy: text name is contained in title or vice versa
      if (titleLower.includes(nameInText) || nameInText.includes(titleLower.split(' ')[0]!)) {
        return {
          resolved: !!convState.active_task_id,
          taskId: convState.active_task_id,
          taskTitle: convState.last_task_title,
          confidence: 'high',
          resolutionSource: 'explicit_name',
        };
      }
    }
    // Name pattern found but no match in current state
    return {
      resolved: false,
      taskId: null,
      taskTitle: explicitMatch[1]!.trim(),
      confidence: 'low',
      resolutionSource: 'explicit_name',
    };
  }

  // 2. Pronoun: "it" / "that" / "that one"
  if (TASK_PRONOUN.test(trimmed)) {
    if (convState?.active_task_id) {
      return {
        resolved: true,
        taskId: convState.active_task_id,
        taskTitle: convState.last_task_title,
        confidence: 'high',
        resolutionSource: 'active_state',
      };
    }
    // Pronoun present but no active task to resolve it against
    return {
      resolved: false,
      taskId: null,
      taskTitle: null,
      confidence: 'none',
      resolutionSource: 'none',
    };
  }

  // 3. No reference
  return {
    resolved: false,
    taskId: null,
    taskTitle: null,
    confidence: 'none',
    resolutionSource: 'none',
  };
}

/**
 * Resolve a list reference from text + conversation state.
 */
export function resolveListReference(
  text: string,
  convState: WaConversationState | null
): ListReferenceResult {
  const trimmed = text.trim();

  // 1. Explicit name: "the school snacks list"
  const explicitMatch = EXPLICIT_LIST_REF.exec(trimmed);
  if (explicitMatch) {
    const nameInText = explicitMatch[1]!.trim().toLowerCase();
    if (convState?.last_list_name) {
      const listLower = convState.last_list_name.toLowerCase();
      if (listLower.includes(nameInText) || nameInText.includes(listLower.split(' ')[0]!)) {
        return {
          resolved: !!convState.active_list_id,
          listId: convState.active_list_id,
          listName: convState.last_list_name,
          confidence: 'high',
          resolutionSource: 'explicit_name',
        };
      }
    }
    return {
      resolved: false,
      listId: null,
      listName: explicitMatch[1]!.trim(),
      confidence: 'low',
      resolutionSource: 'explicit_name',
    };
  }

  // 2. List pronoun: "add to this list"
  if (LIST_PRONOUN.test(trimmed)) {
    if (convState?.active_list_id) {
      return {
        resolved: true,
        listId: convState.active_list_id,
        listName: convState.last_list_name,
        confidence: 'high',
        resolutionSource: 'active_state',
      };
    }
    return {
      resolved: false,
      listId: null,
      listName: null,
      confidence: 'none',
      resolutionSource: 'none',
    };
  }

  // 3. No reference
  return {
    resolved: false,
    listId: null,
    listName: null,
    confidence: 'none',
    resolutionSource: 'none',
  };
}

/**
 * Resolve an entity reference from "add it to X" / "put it in X".
 * Returns `entityText` when `last_entity_text` is set in conversation state.
 */
export function resolveEntityReference(
  text: string,
  convState: WaConversationState | null
): EntityReferenceResult {
  const trimmed = text.trim();

  if (!ENTITY_IT_ANCHOR.test(trimmed)) {
    return { entityText: null, confidence: 'none', resolutionSource: 'none' };
  }

  if (convState?.last_entity_text) {
    return {
      entityText: convState.last_entity_text,
      confidence: 'high',
      resolutionSource: 'entity_text',
    };
  }

  // "add it" anchor found but no entity text in state
  return { entityText: null, confidence: 'none', resolutionSource: 'none' };
}
