/**
 * Shared turn interpretation layer for task/list capture.
 *
 * Pure function — no DB calls. Wraps existing deterministic parsers into a
 * unified TurnInterpretation object. Callable from both the WhatsApp processor
 * (compound capture path) and the web parseDump route so both channels share
 * the same parsing and classification logic.
 *
 * Pipeline:
 *   0. Domain normalization pre-pass (typos, shorthand, basic cleanup)
 *   1. If convState provided: run follow-up detectors (task, list, entity-to-list)
 *   2. Single-turn edit/move detection
 *   3. Run classifyIntent — task and list actions from fresh message text
 *   4. Resolve domain references (pronouns, "the X task", "add it to Y")
 *   5. Assess text-level clarification need (entity-aware)
 *   6. Run per-action sufficiency validation (structural completeness)
 *   7. Build execution plan (execute vs. clarify steps)
 *   8. Attach observability log
 *
 * What this does NOT do:
 *   - DB lookups — list name matching and task search stay in their handlers
 *   - Open-ended pronoun resolution outside task/list domain
 *   - Routing for WhatsApp-specific pending states (OCR, edit FSM, quick-add)
 *   - Broad conversational intelligence or general planning
 *
 * Scope is strictly bounded to tasks and lists.
 */

import { parseCompoundIntent } from '@/lib/compoundIntentParser';
import { classifyIntent, type ClassificationMeta, type ClassificationSource } from '@/lib/intentClassifier';
import { splitBrainDump } from '@/lib/brainDumpParser';
import type { ProposedTask } from '@/lib/task_intake';
import type { EditPatch } from '@/lib/waEditParser';
import { parseDeleteIntent } from '@/lib/waDeleteParser';
import { parseEditSelectionIntent, parseEditPatch } from '@/lib/waEditParser';
import {
  detectTaskFollowUpIntent,
  detectListItemFollowUpIntent,
  detectEntityToListIntent,
  detectMarkDoneIntent,
  detectListItemRemovalIntent,
} from '@/lib/waFollowUpParser';
import type { WaConversationState } from '@/lib/waConversationState';
import {
  resolveTaskReference,
  resolveListReference,
  resolveEntityReference,
  type TaskReferenceResult,
  type ListReferenceResult,
  type EntityReferenceResult,
  type ResolutionSource,
  type ResolutionConfidence,
} from '@/lib/domainReferenceResolver';
import {
  assessClarification,
  type ClarificationReason,
  type ClarificationPayload,
} from '@/lib/clarificationPolicy';
import { normalizeDomainText, type NormalizationMeta } from '@/lib/domainNormalizer';
import { validateAllActions, type SufficiencyResult } from '@/lib/sufficiencyValidator';
import { validateAllSemanticConstraints, type SemanticConstraintResult } from '@/lib/semanticConstraintValidator';

// ============================================
// TYPES
// ============================================

/**
 * A single domain action detected in this turn.
 * Discriminated union covering all task/list operations.
 */
export type DetectedAction =
  // ── Compound: fresh capture ────────────────────────────────────────────────
  | { type: 'create_task'; task: ProposedTask }
  | { type: 'create_list'; listName: string; items: string[] }
  | { type: 'add_list_items'; listName: string | null; listId: string | null; items: string[] }
  // ── Single-turn edit/move (web capture + WhatsApp compound) ───────────────
  | { type: 'update_task'; taskTerm: string; patch: EditPatch }
  // ── List maintenance ────────────────────────────────────────────────────────
  | { type: 'remove_list_item'; item: string; listName: string | null; listId: string | null }
  // ── Follow-ups: require active conversation state ──────────────────────────
  | { type: 'task_follow_up_patch'; patch: EditPatch; taskId: string; taskTitle: string | null }
  | { type: 'task_follow_up_delete'; taskId: string; taskTitle: string | null }
  | { type: 'task_follow_up_done'; taskId: string; taskTitle: string | null }
  | { type: 'list_item_follow_up'; items: string[]; listId: string; listName: string | null }
  | { type: 'entity_to_list'; entityText: string; listName: string | null }
  // ── LLM-signalled special states ──────────────────────────────────────────
  | { type: 'filler' }
  | { type: 'needs_clarification'; question: string; reason: string };

/** One step in the execution plan. */
export interface ExecutionStep {
  kind: 'execute' | 'clarify' | 'confirm';
  action?: DetectedAction;
  clarificationReason?: ClarificationReason;
  clarificationMessage?: string;
  /** Present when kind === 'confirm'. Message to send before executing a destructive action. */
  confirmationMessage?: string;
}

/** Observability log emitted with every interpretation. */
export interface InterpretationLog {
  normalizedText: string;
  /** Present when domain normalization changed the input text. */
  normalizationMeta: NormalizationMeta;
  compoundListActions: number;
  compoundTasks: number;
  followUpFired: boolean;
  listFollowUpFired: boolean;
  entityToListFired: boolean;
  referenceResolutions: Array<{
    pattern: string;
    source: ResolutionSource;
    confidence: ResolutionConfidence;
  }>;
  clarificationReason: ClarificationReason | null;
  stepKinds: Array<'execute' | 'clarify' | 'confirm'>;
  /** Full classification observability record. Populated after compound classification step. */
  classification: ClassificationMeta | null;
  /** Per-action sufficiency validation results. */
  sufficiencyResults: SufficiencyResult[];
  /** Per-action semantic constraint validation results (dates, business hours). */
  semanticConstraintResults: SemanticConstraintResult[];
}

/**
 * Optional per-call context for end-to-end traceability.
 * Passing this threads the same turnId and channel label through every log event
 * for this turn (classification, interpretation, execution plan).
 */
export interface InterpretationContext {
  /** Correlation ID for the full request lifecycle. Generated if not provided. */
  turnId?: string;
  /** Channel that originated this turn. */
  channel?: 'web' | 'whatsapp' | 'unknown';
  /** Provider-level message ID (e.g. WhatsApp inbound message ID). */
  providerMessageId?: string;
}

/** Top-level interpretation result for a single turn. */
export interface TurnInterpretation {
  /**
   * Stable correlation ID for this turn.
   * Threads through classification, interpretation, execution plan,
   * and clarification log events so a single turn can be traced end-to-end.
   */
  turnId: string;
  /** Which classifier produced the final DetectedAction[] for this turn. */
  classificationSource: ClassificationSource;
  /** Original (pre-normalization) text as received from the user. */
  originalText: string;
  /** Trimmed, whitespace-collapsed, shorthand-expanded text used for all classification. */
  normalizedText: string;
  /**
   * Segments as split by brainDumpParser (same segmentation used by parseDump).
   * Useful for UI display of what was parsed.
   */
  segments: string[];
  /** All actions detected from this turn, in priority order. */
  detectedActions: DetectedAction[];
  /** Named entities extracted (task titles, list names, entity items). */
  entities: {
    taskTitles: string[];
    listNames: string[];
    entityTexts: string[];
  };
  /** Domain reference resolution results for pronouns and explicit names. */
  references: {
    taskRef: TaskReferenceResult;
    listRef: ListReferenceResult;
    entityRef: EntityReferenceResult;
  };
  /** Text-level ambiguity flags. DB-level ambiguity is not covered here. */
  ambiguityFlags: {
    hasUnresolvedPronoun: boolean;
    hasDangerousDeleteNoTarget: boolean;
  };
  /** True when text-level analysis indicates clarification is needed. */
  needsClarification: boolean;
  /** Present when needsClarification is true. */
  clarificationPayload?: ClarificationPayload;
  /**
   * Ordered steps to execute. Steps with kind 'clarify' indicate actions that
   * could not be resolved from text alone and need user input.
   * Steps with kind 'execute' contain a concrete action ready for dispatch.
   */
  executionPlan: ExecutionStep[];
  /** Observability log for this turn. Written by logInterpretation() in logger.ts. */
  log: InterpretationLog;
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Extract a short entity name from detected actions for use in clarification hints.
 * Returns the first meaningful name (task term, list name, etc.) or undefined.
 */
function extractEntityNameForClarification(actions: DetectedAction[]): string | undefined {
  for (const action of actions) {
    if (action.type === 'update_task' && action.taskTerm) return action.taskTerm;
    if (action.type === 'create_list' && action.listName) return action.listName;
    if (action.type === 'add_list_items' && action.listName) return action.listName;
    if (action.type === 'entity_to_list' && action.listName) return action.listName;
    if (action.type === 'task_follow_up_patch' && action.taskTitle) return action.taskTitle;
    if (action.type === 'task_follow_up_delete' && action.taskTitle) return action.taskTitle;
  }
  return undefined;
}

// ============================================
// MAIN EXPORTED FUNCTION
// ============================================

/**
 * Interpret a single task/list turn.
 *
 * When USE_LLM_CLASSIFICATION=true, the compound classification step uses an
 * LLM call (gpt-4o-mini) with automatic fallback to rules on any error.
 * When the flag is false (default), runs fully deterministic rules parsers.
 *
 * All other steps (normalization, follow-up detection, reference resolution,
 * clarification policy, sufficiency validation, execution plan building) are
 * always deterministic regardless of LLM flag.
 *
 * @param text      - Raw incoming message text
 * @param convState - Optional durable conversation state. Pass null for
 *                    stateless contexts (web capture, tests without state).
 * @param context   - Optional traceability context (turnId, channel, providerMessageId).
 *                    A turnId is generated if not provided.
 */
export async function interpretTurn(
  text: string,
  convState: WaConversationState | null = null,
  context?: InterpretationContext
): Promise<TurnInterpretation> {
  // ── Step 0: Domain normalization pre-pass ─────────────────────────────────
  // Expands shorthand (tmrw → tomorrow, groc → groceries, eb → electricity bill, etc.),
  // cleans punctuation, normalizes whitespace. Preserves originalText separately.
  //
  // IMPORTANT: detect newlines BEFORE normalization — the normalizer collapses \n → " "
  // which destroys multi-item structure. We stash this flag so classifyIntent can
  // route multiline inputs directly to the LLM with the raw (pre-normalization) text.
  const isMultiline = text.includes('\n');
  const normResult = normalizeDomainText(text);
  const originalText = normResult.originalText;
  const normalizedText = normResult.normalizedText;

  const segments = splitBrainDump(normalizedText);

  const detectedActions: DetectedAction[] = [];
  const log: InterpretationLog = {
    normalizedText,
    normalizationMeta: normResult.meta,
    compoundListActions: 0,
    compoundTasks: 0,
    followUpFired: false,
    listFollowUpFired: false,
    entityToListFired: false,
    referenceResolutions: [],
    clarificationReason: null,
    stepKinds: [],
    classification: null,
    sufficiencyResults: [],
    semanticConstraintResults: [],
  };

  // ── Step 1: Follow-up detection ────────────────────────────────────────────
  // Priority mirrors the WhatsApp processor: task follow-up → list item follow-up
  // → entity-to-list. Each sub-step only fires if earlier ones did not match.
  //
  // Fix G: mark-done detection runs REGARDLESS of convState so that web/no-state
  // calls also produce a clarification ("Which task did you want to mark done?")
  // instead of silently creating a broken task.
  //
  // Fix F: list-item removal detection runs REGARDLESS of convState so that
  // "remove bananas" produces a clarification instead of falling into delete-task
  // or producing no action.

  // Fix G: "mark it done" / "complete it" (with or without active task)
  if (detectedActions.length === 0) {
    const markDone = detectMarkDoneIntent(normalizedText);
    if (markDone !== null) {
      log.followUpFired = true;
      // Use active task id from state if available; empty string → sufficiency asks clarification
      const taskId = convState?.active_task_id ?? '';
      const taskTitle = convState?.last_task_title ?? markDone.taskTerm ?? null;
      detectedActions.push({ type: 'task_follow_up_done', taskId, taskTitle });
    }
  }

  // Fix F: "remove bananas" / "remove bananas from shopping" — list-item removal
  if (detectedActions.length === 0) {
    const listRemoval = detectListItemRemovalIntent(normalizedText);
    if (listRemoval !== null) {
      detectedActions.push({
        type: 'remove_list_item',
        item: listRemoval.item,
        listName: listRemoval.listName,
        listId: null,
      });
    }
  }

  if (convState) {
    // Task follow-up with state: "make it Friday", "delete it"
    // (mark_done is already handled above; skip re-detection to avoid duplicate)
    if (detectedActions.length === 0) {
      const taskFollowUp = detectTaskFollowUpIntent(normalizedText);
      if (taskFollowUp && convState.active_task_id) {
        log.followUpFired = true;
        if (taskFollowUp.type === 'patch') {
          detectedActions.push({
            type: 'task_follow_up_patch',
            patch: taskFollowUp.patch,
            taskId: convState.active_task_id,
            taskTitle: convState.last_task_title,
          });
        } else if (taskFollowUp.type === 'delete') {
          detectedActions.push({
            type: 'task_follow_up_delete',
            taskId: convState.active_task_id,
            taskTitle: convState.last_task_title,
          });
        }
        // mark_done is already handled above
      }
    }

    // List item follow-up: "add curd too", "also add paneer"
    if (detectedActions.length === 0) {
      const listItemFollowUp = detectListItemFollowUpIntent(normalizedText, !!convState.active_list_id);
      if (listItemFollowUp && convState.active_list_id) {
        log.listFollowUpFired = true;
        detectedActions.push({
          type: 'list_item_follow_up',
          items: listItemFollowUp.items,
          listId: convState.active_list_id,
          listName: convState.last_list_name,
        });
      }
    }

    // Entity-to-list follow-up: "add it to shopping", "put it in grocery"
    if (detectedActions.length === 0) {
      const entityToListResult = detectEntityToListIntent(normalizedText);
      if (entityToListResult !== null) {
        log.entityToListFired = true;
        const entityRef = resolveEntityReference(normalizedText, convState);
        if (entityRef.entityText) {
          log.referenceResolutions.push({
            pattern: 'entity_it',
            source: entityRef.resolutionSource,
            confidence: entityRef.confidence,
          });
          detectedActions.push({
            type: 'entity_to_list',
            entityText: entityRef.entityText,
            listName: entityToListResult.listName,
          });
        }
        // If entityRef has no text: don't push the action — assessClarification
        // will fire below and produce a 'clarify' step via the entity check.
      }
    }
  }

  // ── Step 2: Single-turn edit/move detection ───────────────────────────────
  // Detects: "Move dentist to Friday", "Reschedule plumber to next week".
  // Uses the existing edit verb parser + patch parser from waEditParser.
  // Only fires when no follow-up action was detected (same guard as compound).
  // Guard: only when edit verb produces a non-empty term AND a non-empty patch
  // (i.e. there is actually something to update, not just a bare "move" verb).
  if (detectedActions.length === 0) {
    const editIntent = parseEditSelectionIntent(normalizedText);
    if (editIntent && editIntent.kind === 'edit_term' && editIntent.term.length > 0) {
      // TODO(timezone): pass user timezone from getUserTimezoneByAuthUserId() here
      // and in waFollowUpParser.ts so both paths use the same tz. Currently 'UTC'
      // is a no-op since parseEditPatch ignores _tz. See: timezone.regression.test.ts
      const patch = parseEditPatch(normalizedText, 'UTC');
      if (Object.keys(patch).length > 0) {
        detectedActions.push({ type: 'update_task', taskTerm: editIntent.term, patch });
      }
    }
  }

  // ── Step 3: Compound classification (fresh messages with no follow-up) ──────
  // When USE_LLM_CLASSIFICATION=true: calls gpt-4o-mini with structured output,
  // falls back to rules on any error.
  // When false (default): runs parseCompoundIntent (fully deterministic rules).
  //
  // Guard: skip for delete commands and already-detected update_task actions.
  if (detectedActions.length === 0) {
    const deleteCheck = parseDeleteIntent(normalizedText);
    const isDeleteCommand = deleteCheck !== null && deleteCheck.kind !== 'undo';

    if (!isDeleteCommand) {
      const classificationResult = await classifyIntent(normalizedText, {
        turnId: context?.turnId,
        channel: context?.channel,
        providerMessageId: context?.providerMessageId,
        isMultiline,
        rawText: text,
      });
      for (const action of classificationResult.actions) {
        detectedActions.push(action);
      }
      log.classification = classificationResult.meta;
      // Update log counts from classified actions
      log.compoundListActions = classificationResult.actions.filter(
        a => a.type === 'create_list' || a.type === 'add_list_items'
      ).length;
      log.compoundTasks = classificationResult.actions.filter(a => a.type === 'create_task').length;
    }
    // If isDeleteCommand: no actions pushed; assessClarification handles pronoun case.
  }

  // ── Step 3b: A5 — Conv-state resolution for LLM-produced follow-up actions ──
  // When the LLM emits task_follow_up_done / task_follow_up_delete with taskId='' or
  // update_task with a taskTerm that fuzzy-matches convState.last_task_title, upgrade
  // to the concrete follow-up action with the real taskId so the processor can act.
  if (convState) {
    const lastTitle = convState.last_task_title?.toLowerCase().trim() ?? null;
    const activeTaskId = convState.active_task_id ?? '';

    function termMatchesActive(term: string | null): boolean {
      if (!term || !lastTitle) return false;
      return term.toLowerCase().trim() === lastTitle;
    }

    for (let i = 0; i < detectedActions.length; i++) {
      const a = detectedActions[i]!;

      if (a.type === 'task_follow_up_done' && a.taskId === '' && termMatchesActive(a.taskTitle)) {
        detectedActions[i] = { ...a, taskId: activeTaskId };
      }

      if (a.type === 'task_follow_up_delete' && a.taskId === '' && termMatchesActive(a.taskTitle)) {
        detectedActions[i] = { ...a, taskId: activeTaskId };
      }

      if (a.type === 'update_task' && termMatchesActive(a.taskTerm)) {
        detectedActions[i] = {
          type: 'task_follow_up_patch',
          patch: a.patch,
          taskId: activeTaskId,
          taskTitle: convState.last_task_title,
        };
      }
    }
  }

  // ── Step 4: Reference resolution ──────────────────────────────────────────
  const taskRef = resolveTaskReference(normalizedText, convState);
  const listRef = resolveListReference(normalizedText, convState);
  const entityRef = resolveEntityReference(normalizedText, convState);

  if (taskRef.resolutionSource !== 'none') {
    log.referenceResolutions.push({
      pattern: 'task_ref',
      source: taskRef.resolutionSource,
      confidence: taskRef.confidence,
    });
  }
  if (listRef.resolutionSource !== 'none') {
    log.referenceResolutions.push({
      pattern: 'list_ref',
      source: listRef.resolutionSource,
      confidence: listRef.confidence,
    });
  }
  if (entityRef.resolutionSource !== 'none') {
    log.referenceResolutions.push({
      pattern: 'entity_ref',
      source: entityRef.resolutionSource,
      confidence: entityRef.confidence,
    });
  }

  // ── Step 5: Clarification assessment ──────────────────────────────────────
  // Extract entity name from actions to produce pointed hints
  const entityNameForHint = extractEntityNameForClarification(detectedActions);

  const actionTypes = detectedActions.map((a) => a.type);
  const clarification = assessClarification(
    normalizedText,
    actionTypes,
    { task: taskRef, list: listRef, entity: entityRef },
    entityNameForHint
  );

  if (clarification.needsClarification) {
    log.clarificationReason = clarification.reason;
  }

  // ── Step 6: Per-action sufficiency validation ─────────────────────────────
  // Validates each detected action for structural completeness.
  // Actions that fail become 'clarify' steps with pointed messages.
  // Actions that are totally broken (invalid_fallback) are dropped with a log entry.
  const sufficiencyResults = validateAllActions(detectedActions);
  log.sufficiencyResults = sufficiencyResults;

  // ── Step 6b: Semantic constraint validation ────────────────────────────────
  // Validates date/time values (no inferred past dates, business hours).
  // Only runs on actions that passed sufficiency (executable ones).
  const semanticConstraintResults = validateAllSemanticConstraints(detectedActions);
  log.semanticConstraintResults = semanticConstraintResults;

  // ── Step 7: Build execution plan ──────────────────────────────────────────
  // Priority:
  //   1. Text-level clarification (unresolved pronoun, dangerous delete) → clarify step first
  //   2. Per-action sufficiency:
  //      - executable → check semantic constraints
  //      - needs_clarification → clarify step with pointed message
  //      - invalid_fallback → dropped (logged)
  //   3. Semantic constraints (past date, business hours) → clarify step

  const executionPlan: ExecutionStep[] = [];

  if (clarification.needsClarification) {
    executionPlan.push({
      kind: 'clarify',
      clarificationReason: clarification.reason,
      clarificationMessage: clarification.payload.hint,
    });
  }

  for (let i = 0; i < sufficiencyResults.length; i++) {
    const sr = sufficiencyResults[i]!;
    const scr = semanticConstraintResults[i];

    if (sr.decision === 'invalid_fallback') {
      // Dropped — logged in sufficiencyResults for observability, not in executionPlan
      continue;
    }

    if (sr.decision === 'needs_clarification') {
      executionPlan.push({
        kind: 'clarify',
        action: sr.action,
        clarificationReason: sr.reason as ClarificationReason | undefined,
        clarificationMessage: sr.clarificationMessage,
      });
      continue;
    }

    // decision === 'executable' — check semantic constraints
    if (scr && scr.decision === 'needs_clarification') {
      executionPlan.push({
        kind: 'clarify',
        action: scr.action,
        clarificationMessage: scr.clarificationMessage,
      });
      continue;
    }

    // All checks passed — check for missing taskId (defensive guard)
    const action = sr.action;
    const missingTarget =
      (action.type === 'task_follow_up_patch' ||
        action.type === 'task_follow_up_delete' ||
        action.type === 'task_follow_up_done') &&
      !action.taskId;

    if (missingTarget) {
      executionPlan.push({
        kind: 'clarify',
        action,
        clarificationReason: 'unresolved_pronoun',
        clarificationMessage: 'Which task did you mean? Reply with the task name.',
      });
    } else if (action.type === 'task_follow_up_delete') {
      // Destructive: confirm before deleting a named task
      const label = action.taskTitle ?? 'this task';
      executionPlan.push({
        kind: 'confirm',
        action,
        confirmationMessage: `Delete "${label}"? Reply YES to confirm, NO to cancel.`,
      });
    } else if (action.type === 'remove_list_item') {
      // Destructive: confirm before removing a list item
      const listLabel = action.listName ? ` from ${action.listName}` : '';
      executionPlan.push({
        kind: 'confirm',
        action,
        confirmationMessage: `Remove "${action.item}"${listLabel}? Reply YES to confirm, NO to cancel.`,
      });
    } else {
      executionPlan.push({ kind: 'execute', action });
    }
  }

  log.stepKinds = executionPlan.map((s) => s.kind);

  // ── Step 8: Extract named entities for observability ──────────────────────
  const taskTitles: string[] = [];
  const listNames: string[] = [];
  const entityTexts: string[] = [];

  for (const action of detectedActions) {
    if (action.type === 'create_task') taskTitles.push(action.task.title);
    if (action.type === 'create_list') listNames.push(action.listName);
    if (action.type === 'add_list_items' && action.listName) listNames.push(action.listName);
    if (action.type === 'entity_to_list') entityTexts.push(action.entityText);
    if (action.type === 'list_item_follow_up' && action.listName) listNames.push(action.listName);
  }

  // ── Step 9: Ambiguity flags ────────────────────────────────────────────────
  const hasUnresolvedPronoun =
    /\b(it|that|that\s+one)\b/i.test(normalizedText) &&
    taskRef.confidence === 'none' &&
    entityRef.confidence === 'none';

  const hasDangerousDeleteNoTarget =
    clarification.needsClarification &&
    clarification.reason === 'dangerous_delete_no_target';

  const resolvedTurnId = log.classification?.turnId ?? context?.turnId ?? `turn-${Date.now()}`;
  const classificationSource = log.classification?.classificationSource ?? 'rules';

  // needsClarification is true if ANY step is a clarify or confirm step
  const hasClarifyStep = executionPlan.some((s) => s.kind === 'clarify' || s.kind === 'confirm');
  const firstClarifyStep = executionPlan.find((s) => s.kind === 'clarify' || s.kind === 'confirm');

  return {
    turnId: resolvedTurnId,
    classificationSource,
    originalText,
    normalizedText,
    segments,
    detectedActions,
    entities: { taskTitles, listNames, entityTexts },
    references: { taskRef, listRef, entityRef },
    ambiguityFlags: { hasUnresolvedPronoun, hasDangerousDeleteNoTarget },
    needsClarification: hasClarifyStep,
    clarificationPayload: hasClarifyStep
      ? {
          questionType: firstClarifyStep?.clarificationReason
            ? (firstClarifyStep.clarificationReason.startsWith('missing_list') ? 'which_list' :
               firstClarifyStep.clarificationReason === 'missing_entity_text' ? 'which_entity' :
               'which_task')
            : 'which_task',
          hint: firstClarifyStep?.clarificationMessage ?? 'Which task or list did you mean?',
        }
      : undefined,
    executionPlan,
    log,
  };
}
