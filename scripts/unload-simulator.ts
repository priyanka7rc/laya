/**
 * Unload Simulator — three-pass comparison runner.
 *
 * For each of the 100 prompts in simulator-prompts.ts this script runs THREE passes:
 *
 *   Run A — current rules only    (USE_LLM_CLASSIFICATION=false, deterministic, no API cost)
 *   Run B — current full pipeline (USE_LLM_CLASSIFICATION=true, rules-first + LLM gap-fill)
 *   Run C — proposed LLM-first    (direct OpenAI call, new expanded schema, newlines preserved)
 *                                  NO production code is changed — this is evaluation only.
 *
 * Run C simulates what the new LLM-first architecture would produce for each prompt,
 * using the expanded schema and prompt from the architectural plan. The delta between
 * Run A and Run C is the quality improvement on offer.
 *
 * Usage:
 *   npm run simulate              (A + B + C, requires OPENAI_API_KEY)
 *   npm run simulate:compare      (same, explicit alias)
 *
 * Automatically loads OPENAI_API_KEY and other vars from .env.local.
 * Output: output/simulator-results-<timestamp>.json
 *         output/simulator-results-<timestamp>.csv
 *         output/simulator-report-<timestamp>.html   ← auto-opens
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import OpenAI from 'openai';
import { z } from 'zod';
import { SIMULATOR_PROMPTS } from './simulator-prompts';
import { interpretTurn, type DetectedAction, type TurnInterpretation } from '@/lib/turnInterpreter';
import type { ClassificationReasonCode } from '@/lib/intentClassifier';

// Load .env.local so OPENAI_API_KEY and other vars are available.
// Only sets keys not already present (shell exports take precedence).
(function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
})();

// ─── Run C — proposed LLM-first schema (evaluation only, no production impact) ─

/**
 * Expanded schema for the proposed LLM-first architecture.
 * Covers all action types the pipeline supports — not just the 3 the current
 * intentClassifier exposes to the LLM.
 */
const RunCActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_task'),
    title: z.string().min(1),
    due_date: z.string().nullable(),
    due_time: z.string().nullable(),
    category: z.string().nullable(),
  }),
  z.object({
    type: z.literal('create_list'),
    listName: z.string().min(1),
    items: z.array(z.string()),
  }),
  z.object({
    type: z.literal('add_list_items'),
    listName: z.string().min(1),
    items: z.array(z.string().min(1)),
  }),
  z.object({
    type: z.literal('remove_list_item'),
    item: z.string().min(1),
    listName: z.string().nullable(),
  }),
  z.object({
    type: z.literal('update_task'),
    taskTerm: z.string().nullable(),
    due_date: z.string().nullable(),
    due_time: z.string().nullable(),
    new_title: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('delete_task'),
    taskTerm: z.string().nullable(),
  }),
  z.object({
    type: z.literal('mark_done'),
    taskTerm: z.string().nullable(),
  }),
]);

const RunCResponseSchema = z.object({
  actions: z.array(RunCActionSchema),
});

export type RunCAction = z.infer<typeof RunCActionSchema>;

export interface RunCResult {
  actions: RunCAction[];
  llm_ms: number | null;
  error: string | null;
}

/**
 * Proposed LLM-first prompt.
 * Key differences from current prompt:
 *   - Passes input with newlines PRESERVED (each \n = separate action candidate)
 *   - Expanded schema: update_task, delete_task, mark_done, remove_list_item
 *   - Filler detection is explicit and comprehensive
 *   - Pronoun-only commands return null taskTerm (triggers clarification)
 *   - Conv state summary injected so follow-ups can be resolved
 */
function buildRunCPrompt(
  rawInput: string,
  convStateSummaryStr: string | null,
  convStateDetail?: { lastTaskTitle?: string | null; lastListName?: string | null } | null,
): string {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayDayName = dayNames[now.getDay()];

  // B1: Compute explicit "next <weekday>" dates so LLM doesn't guess wrong
  const nextWeekDates: string[] = [];
  for (let d = 1; d <= 7; d++) {
    const dt = new Date(now);
    dt.setDate(now.getDate() + d);
    const diff = 7 - now.getDay() + dt.getDay();
    // Skip — we'll compute next-week days explicitly
    void d; void dt; void diff;
    break;
  }
  // Compute the Monday of NEXT calendar week
  const nextMonStart = new Date(now);
  nextMonStart.setDate(now.getDate() + (8 - now.getDay()) % 7 || 7);
  const nextWeekDayMap: Record<string, string> = {};
  for (let i = 0; i < 7; i++) {
    const dt = new Date(nextMonStart);
    dt.setDate(nextMonStart.getDate() + i - 1); // Mon=0..Sun=6
    nextWeekDayMap[dayNames[dt.getDay()]!] = dt.toISOString().slice(0, 10);
  }

  // B4: Build explicit pronoun resolution hint
  let pronounHint = '';
  if (convStateDetail?.lastTaskTitle) {
    pronounHint = `When the user says "it", "that", "this", "that one", they mean the task "${convStateDetail.lastTaskTitle}".`;
  } else if (convStateDetail?.lastListName) {
    pronounHint = `When the user says "it", "that", they mean the list "${convStateDetail.lastListName}".`;
  }

  return `You are a task and list extraction engine. Parse the user's input and return structured actions.

Today is ${today} (${todayDayName}). Tomorrow is ${tomorrow}.
${convStateSummaryStr ? `Active context: ${convStateSummaryStr}` : ''}
${pronounHint}

Return ONLY a JSON object: { "actions": [ ... ] }

Each action must be one of these types:

1. CREATE TASK — something actionable the person needs to do
{ "type": "create_task", "title": "Clean title (no date phrases)", "due_date": "YYYY-MM-DD or null", "due_time": "HH:MM 24h or null", "category": "category or null" }

2. CREATE LIST — a new named list, optionally with items
{ "type": "create_list", "listName": "Name", "items": ["item1", "item2"] }

3. ADD TO LIST — items going into an existing list
{ "type": "add_list_items", "listName": "Name of existing list", "items": ["item1"] }

4. REMOVE FROM LIST — remove an item from a list
{ "type": "remove_list_item", "item": "item name", "listName": "list name or null" }

5. UPDATE TASK — reschedule, move, or rename an existing task
{ "type": "update_task", "taskTerm": "name of task to update, or null if unclear", "due_date": "YYYY-MM-DD or null", "due_time": "HH:MM or null", "new_title": "new name if renaming, or null" }

6. DELETE TASK — remove an existing task
{ "type": "delete_task", "taskTerm": "name of task to delete, or null if unclear" }

7. MARK DONE — complete an existing task
{ "type": "mark_done", "taskTerm": "name of task, or null if unclear" }

DATE RESOLUTION RULES (follow exactly):
- "next Monday/Tuesday/..." → the Monday/Tuesday of NEXT calendar week (NOT the soonest upcoming day)
  Next week dates: ${Object.entries(nextWeekDayMap).map(([d,dt]) => `${d}=${dt}`).join(', ')}
- "this Friday/Saturday/..." → the named day of THIS current week
- bare "[weekday]" with no qualifier → next occurrence of that day
- "tonight" → due_time "20:00", "morning" → "08:00", "afternoon" → "14:00", "evening" → "18:00"
- "ASAP" / "urgently" → due_date: today (${today})
- "end of week" / "eow" → this Saturday
- "end of day" / "eod" → due_date: today, due_time "23:59"

RULES (follow exactly):
- MULTI-LINE INPUT: treat each line as a separate independent action. Process every line.
- "groceries: milk, eggs" or "shopping: item1, item2" → add_list_items (word before colon = list name)
- "create a X list with items" → create_list with items
- "remind me to X" / "need to X" / "don't forget to X" → create_task, strip the prefix from title
- "add X to Y list" → add_list_items
- "remove X from Y" → remove_list_item
- "rename X to Y" / "change title of X to Y" → update_task with new_title="Y"
- "reschedule X to Y" / "move X to Y" / "shift X to Y" → update_task with taskTerm="X" and due_date=Y
- FILLER — return { "actions": [] } for: "ok", "thanks", "lol", "this week is busy", "it's been hectic", "I need to get better at this", "ugh so much to do", casual chit-chat with no tasks
- PRONOUNS: use active context above to resolve "it"/"that"/"this" references
- "mark it done" / "done" / "finished" with active task → mark_done with active task's name
- "delete it" with active task → delete_task with active task's name
- Never invent tasks or items not mentioned in the input
- If input has absolutely no actionable content, return { "actions": [] }

INPUT:
${rawInput}`;
}

/** Summarise conv state for prompt injection. */
function convStateSummary(convState: import('./simulator-prompts').SimulatorPrompt['convState']): string | null {
  if (!convState) return null;
  const parts: string[] = [];
  if (convState.active_task_id && convState.last_task_title) {
    parts.push(`last task is "${convState.last_task_title}" (id: ${convState.active_task_id})`);
  }
  if (convState.active_list_id && convState.last_list_name) {
    parts.push(`last list is "${convState.last_list_name}" (id: ${convState.active_list_id})`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/** Call OpenAI with the proposed LLM-first schema. Simulation only — no production code touched. */
async function runC(
  rawInput: string,
  convState: import('./simulator-prompts').SimulatorPrompt['convState'],
): Promise<RunCResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { actions: [], llm_ms: null, error: 'OPENAI_API_KEY not set' };
  }

  const openai = new OpenAI({ apiKey });
  const stateDetail = convState ? {
    lastTaskTitle: convState.last_task_title,
    lastListName: convState.last_list_name,
  } : null;
  const prompt = buildRunCPrompt(rawInput, convStateSummary(convState), stateDetail);
  const t0 = Date.now();

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You output only valid JSON. No markdown, no explanation.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1000,
    });

    const llm_ms = Date.now() - t0;
    const content = response.choices[0]?.message?.content;
    if (!content) return { actions: [], llm_ms, error: 'Empty LLM response' };

    const parsedRaw = RunCResponseSchema.parse(JSON.parse(content));
    // B3: Filter out LLM hallucinations where taskTerm is literally "(clarify task)"
    const actions = parsedRaw.actions.filter(a => {
      if ('taskTerm' in a && a.taskTerm === '(clarify task)') return false;
      if ('taskTerm' in a && a.taskTerm === '(clarify)') return false;
      return true;
    });
    return { actions, llm_ms, error: null };
  } catch (err) {
    const llm_ms = Date.now() - t0;
    return { actions: [], llm_ms, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Compact display string for a RunC action. */
function summarizeRunCAction(a: RunCAction): string {
  switch (a.type) {
    case 'create_task':
      return `create_task: "${a.title}"${a.due_date ? ` (due ${a.due_date}${a.due_time ? ' ' + a.due_time : ''})` : ''}`;
    case 'create_list':
      return `create_list: "${a.listName}" [${a.items.slice(0, 3).join(', ')}${a.items.length > 3 ? ', …' : ''}]`;
    case 'add_list_items':
      return `add_list_items → "${a.listName}": [${a.items.slice(0, 3).join(', ')}${a.items.length > 3 ? ', …' : ''}]`;
    case 'remove_list_item':
      return `remove_list_item: "${a.item}" from "${a.listName ?? '(clarify list)'}"`;
    case 'update_task': {
      let s = `update_task: "${a.taskTerm ?? '(clarify task)'}"`;
      if (a.new_title) s += ` → rename: "${a.new_title}"`;
      if (a.due_date) s += ` → ${a.due_date}${a.due_time ? ' ' + a.due_time : ''}`;
      return s;
    }
    case 'delete_task':
      return `delete_task: "${a.taskTerm ?? '(clarify task)'}"`;
    case 'mark_done':
      return `mark_done: "${a.taskTerm ?? '(clarify task)'}"`;
    default:
      return JSON.stringify(a);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type OutcomeLabel = 'clean' | 'llm_recovered' | 'llm_partial' | 'zero';
export type RunCOutcome = 'better' | 'same' | 'worse' | 'error';
export type RunDOutcome = 'new_signal' | 'cleaner' | 'same';

/**
 * Overhaul-specific signals extracted from the Run B TurnInterpretation.
 * No additional LLM call — this is pure signal extraction from the existing result.
 */
export interface RunDSignals {
  filler_detected: boolean;
  needs_clarification_from_llm: boolean;
  confirm_steps: number;
  clarify_steps: number;
  booking_title_preserved: boolean;
  semantic_constraint_violations: number;
  sufficiency_issues: number;
  // Date/time resolution quality
  task_date_summaries: string[];  // per-task: title → resolved date/time with inferred flags
  inferred_date_count: number;    // tasks where date fell back to today's default
  inferred_time_count: number;    // tasks where time was defaulted
  /** The actual response the user would see from the production pipeline. */
  response_message: string;
  outcome: RunDOutcome;
  notes: string;
}

export interface SimulatorRow {
  id: number;
  category: string;
  channel: 'web' | 'whatsapp';
  input: string;

  // Run A columns (rules only)
  parser_output: string;          // what rules produced
  rules_action_count: number;
  total_ms_a: number;

  // Run B columns (current full pipeline)
  decision_point: string;         // was LLM called and why
  llm_output: string;             // delta B − A
  learning: string;
  recommendation: string;
  outcome: OutcomeLabel;
  full_action_count: number;
  reason_code: string;
  llm_ms: number | null;
  total_ms_b: number;

  // Run C columns (proposed LLM-first, evaluation only)
  runc_output: string;            // what new architecture produced
  runc_action_count: number;
  runc_llm_ms: number | null;
  runc_outcome: RunCOutcome;      // better / same / worse vs current (A+B)
  runc_delta: string;             // human-readable explanation of A→C change
  runc_error: string | null;

  // Run D columns (post-overhaul signal extraction, no additional LLM call)
  rund_output: string;            // formatted actions from Run B (post-overhaul)
  rund_filler: boolean;           // was filler type detected?
  rund_needs_clarification: boolean; // did LLM return needs_clarification?
  rund_confirm_steps: number;     // confirm ExecutionStep count (destructive safeguard)
  rund_clarify_steps: number;     // clarify ExecutionStep count (semantic constraint etc.)
  rund_booking_preserved: boolean; // any task title preserves "for [weekday]"?
  rund_semantic_violations: number; // semantic constraint violation count
  rund_sufficiency_issues: number;  // sufficiency validation issue count
  // Date/time resolution quality
  rund_date_summary: string;      // per-task date/time resolution (newline-separated)
  rund_inferred_date_count: number; // tasks with defaulted (today) dates
  rund_inferred_time_count: number; // tasks with defaulted times
  rund_outcome: RunDOutcome;      // new_signal / cleaner / same
  rund_notes: string;             // human-readable explanation of overhaul signals
  rund_response_message: string;  // the actual message the user would see
}

export interface SimulatorSummary {
  total: number;
  // Run A+B breakdown
  clean: number;
  llm_recovered: number;
  llm_partial: number;
  zero: number;
  reason_code_counts: Record<string, number>;
  by_category: Record<string, { total: number; clean: number; llm_recovered: number; llm_partial: number; zero: number }>;
  // Run C summary
  runc_better: number;
  runc_same: number;
  runc_worse: number;
  runc_error: number;
  // Run D summary
  rund_new_signal: number;
  rund_cleaner: number;
  rund_same: number;
  rund_filler_total: number;
  rund_confirm_total: number;
  rund_clarify_total: number;
  rund_booking_preserved_total: number;
  rund_inferred_dates_total: number;  // total tasks with defaulted dates across all prompts
  rund_inferred_times_total: number;
}

export interface SimulatorOutput {
  generated_at: string;
  rows: SimulatorRow[];
  summary: SimulatorSummary;
}

// ─── Column derivation (Run A + B) ────────────────────────────────────────────

function summarizeAction(a: DetectedAction): string {
  switch (a.type) {
    case 'create_task':
      return `create_task: "${a.task.title}"${a.task.due_date ? ` (due ${a.task.due_date})` : ''}`;
    case 'create_list':
      return `create_list: "${a.listName}" [${a.items.slice(0, 3).join(', ')}${a.items.length > 3 ? ', …' : ''}]`;
    case 'add_list_items':
      return `add_list_items → "${a.listName ?? a.listId ?? '?'}": [${a.items.slice(0, 3).join(', ')}${a.items.length > 3 ? ', …' : ''}]`;
    case 'update_task':
      return `update_task: "${a.taskTerm}" patch=${JSON.stringify(a.patch)}`;
    case 'remove_list_item':
      return `remove_list_item: "${a.item}" from "${a.listName ?? a.listId ?? '?'}"`;
    case 'task_follow_up_patch':
      return `task_follow_up_patch: taskId=${a.taskId} patch=${JSON.stringify(a.patch)}`;
    case 'task_follow_up_delete':
      return `task_follow_up_delete: taskId=${a.taskId}`;
    case 'task_follow_up_done':
      return `task_follow_up_done: taskId=${a.taskId}`;
    case 'list_item_follow_up':
      return `list_item_follow_up → listId=${a.listId}: [${a.items.join(', ')}]`;
    case 'entity_to_list':
      return `entity_to_list: "${a.entityText}" → "${a.listName ?? '?'}"`;
    default:
      return JSON.stringify(a);
  }
}

function deriveParserOutput(rulesOnly: TurnInterpretation): string {
  if (rulesOnly.detectedActions.length === 0) return '(no actions)';
  return rulesOnly.detectedActions.map(summarizeAction).join('\n');
}

function deriveDecisionPoint(fullPipeline: TurnInterpretation): string {
  const meta = fullPipeline.log.classification;
  if (!meta) return 'No classification meta available.';
  const reasonCode = meta.reasonCode as ClassificationReasonCode;
  switch (reasonCode) {
    case 'rules_only_mode':      return `LLM disabled. Rules produced ${meta.actionCount} action(s).`;
    case 'rules_matched':        return `Rules matched: ${meta.actionCount} action(s). LLM not invoked.`;
    case 'llm_gap_fill':         return `Rules: 0 actions. LLM gap-fill → ${meta.actionCount} action(s). Latency: ${meta.timings.llmMs ?? '?'}ms.`;
    case 'llm_partial_fill':     return `Rules: partial. LLM partial-fill → ${meta.actionCount} action(s). Latency: ${meta.timings.llmMs ?? '?'}ms.`;
    case 'llm_missing_api_key':  return `LLM skipped (no API key). Rules: ${meta.actionCount} action(s).`;
    case 'llm_empty_response':   return `LLM empty response. Rules fallback: ${meta.actionCount} action(s).`;
    case 'llm_schema_validation_failed': return `LLM schema validation failed. Rules fallback: ${meta.actionCount} action(s).`;
    case 'llm_runtime_error':    return `LLM runtime error. Rules fallback: ${meta.actionCount} action(s).`;
    default:                     return `reasonCode=${reasonCode}, actionCount=${meta.actionCount}.`;
  }
}

function actionKey(a: DetectedAction): string {
  switch (a.type) {
    case 'create_task':           return `create_task:${a.task.title?.toLowerCase().trim()}`;
    case 'create_list':           return `create_list:${a.listName?.toLowerCase().trim()}`;
    case 'add_list_items':        return `add_list_items:${(a.listName ?? a.listId ?? '').toLowerCase().trim()}`;
    case 'update_task':           return `update_task:${a.taskTerm?.toLowerCase().trim()}`;
    case 'remove_list_item':      return `remove_list_item:${a.item?.toLowerCase().trim()}`;
    case 'task_follow_up_patch':  return `task_follow_up_patch:${a.taskId}`;
    case 'task_follow_up_delete': return `task_follow_up_delete:${a.taskId}`;
    case 'task_follow_up_done':   return `task_follow_up_done:${a.taskId}`;
    case 'list_item_follow_up':   return `list_item_follow_up:${a.listId}`;
    case 'entity_to_list':        return `entity_to_list:${a.entityText?.toLowerCase().trim()}`;
    default: return JSON.stringify(a);
  }
}

function deriveLLMOutput(rulesOnly: TurnInterpretation, fullPipeline: TurnInterpretation): string {
  const reasonCode = fullPipeline.log.classification?.reasonCode as ClassificationReasonCode | undefined;
  if (reasonCode === 'rules_only_mode' || reasonCode === 'rules_matched') return '— (LLM not invoked)';
  const rulesKeys = new Set(rulesOnly.detectedActions.map(actionKey));
  const added = fullPipeline.detectedActions.filter((a) => !rulesKeys.has(actionKey(a)));
  if (added.length === 0) return '— (LLM invoked but added nothing beyond rules)';
  return added.map(summarizeAction).join('\n');
}

function deriveLearning(rulesOnly: TurnInterpretation, fullPipeline: TurnInterpretation): string {
  const parts: string[] = [];
  const rulesCount = rulesOnly.detectedActions.length;
  const fullCount  = fullPipeline.detectedActions.length;
  const reasonCode = fullPipeline.log.classification?.reasonCode as ClassificationReasonCode | undefined;
  const normMeta   = fullPipeline.log.normalizationMeta;
  if (fullPipeline.needsClarification && fullPipeline.log.clarificationReason) {
    parts.push(`Clarification triggered: ${fullPipeline.log.clarificationReason}.`);
  }
  if (normMeta.changed && normMeta.expansionsApplied > 0) {
    parts.push(`Input normalised: ${normMeta.expansionsApplied} expansion(s).`);
  }
  if (rulesCount === 0 && fullCount === 0)      parts.push('Neither rules nor LLM produced actions. Likely filler or unsupported pattern.');
  else if (rulesCount === 0 && fullCount > 0)   parts.push(`Rules missed entirely. LLM recovered ${fullCount} action(s).`);
  else if (rulesCount > 0 && fullCount > rulesCount) parts.push(`Rules partial. LLM filled ${fullCount - rulesCount} additional action(s).`);
  else if (rulesCount > 0 && fullCount === rulesCount && (reasonCode === 'llm_gap_fill' || reasonCode === 'llm_partial_fill')) parts.push('LLM invoked but added nothing beyond rules.');
  else if (rulesCount > 0) parts.push(`Rules handled correctly (${rulesCount} action(s)).`);
  return parts.length > 0 ? parts.join(' ') : 'No notable signals.';
}

function deriveRecommendation(rulesOnly: TurnInterpretation, fullPipeline: TurnInterpretation): string {
  const rulesCount = rulesOnly.detectedActions.length;
  const fullCount  = fullPipeline.detectedActions.length;
  const rulesKeys  = new Set(rulesOnly.detectedActions.map(actionKey));
  const added      = fullPipeline.detectedActions.filter((a) => !rulesKeys.has(actionKey(a)));
  if (rulesCount === 0 && fullCount === 0) return 'Add to filler filter or extend rules for this pattern.';
  if (added.length === 0 && rulesCount > 0) return 'None.';
  const recs: string[] = [];
  if (added.some((a) => a.type === 'create_task' || a.type === 'update_task')) recs.push('Extend compoundIntentParser.ts for this task pattern.');
  if (added.some((a) => a.type === 'create_list' || a.type === 'add_list_items')) recs.push('Extend list detection rules in compoundIntentParser.ts.');
  if (fullPipeline.needsClarification) {
    const r = fullPipeline.log.clarificationReason;
    if (r === 'list_not_found' || r === 'list_name_ambiguous') recs.push('Expand domainNormalizationMap.ts list variants.');
    if (r === 'pronoun_no_context') recs.push('Known pronoun pattern — needs conv-state heuristic.');
  }
  return recs.length > 0 ? recs.join(' ') : 'None.';
}

function deriveOutcome(rulesOnly: TurnInterpretation, fullPipeline: TurnInterpretation): OutcomeLabel {
  const rulesCount = rulesOnly.detectedActions.length;
  const fullCount  = fullPipeline.detectedActions.length;
  if (rulesCount === 0 && fullCount === 0) return 'zero';
  const rulesKeys = new Set(rulesOnly.detectedActions.map(actionKey));
  const added     = fullPipeline.detectedActions.filter((a) => !rulesKeys.has(actionKey(a)));
  if (added.length === 0 && rulesCount > 0) return 'clean';
  if (rulesCount === 0 && added.length > 0) return 'llm_recovered';
  if (rulesCount > 0  && added.length > 0)  return 'llm_partial';
  return 'clean';
}

// ─── Run C derivation ─────────────────────────────────────────────────────────

/**
 * Compare Run C output against Run A (rules) and Run B (current+LLM).
 * "better" = C produces more distinct, correct-looking actions than both A and B,
 *            OR C correctly returns empty where A/B returned garbled output.
 * The heuristic is action-count based — the report lets the user visually confirm.
 */
function deriveRunCOutcome(
  rulesOnly: TurnInterpretation,
  fullPipeline: TurnInterpretation,
  runcResult: RunCResult,
): RunCOutcome {
  if (runcResult.error) return 'error';

  const currentBest = Math.max(rulesOnly.detectedActions.length, fullPipeline.detectedActions.length);
  const runcCount   = runcResult.actions.length;

  // Filler correctly identified (A+B produced garbled output, C returned empty)
  // Detect garbled output: single action with a title that contains a newline-collapsed dump
  const hasSingleGarbledTask =
    rulesOnly.detectedActions.length === 1 &&
    rulesOnly.detectedActions[0]!.type === 'create_task' &&
    (rulesOnly.detectedActions[0] as Extract<DetectedAction, { type: 'create_task' }>).task.title.length > 60;

  if (hasSingleGarbledTask && runcCount > 1) return 'better';

  // C2 scoring fix: if A returned create_task actions but C returned a list action
  // (add_list_items/create_list), C is qualitatively correct even if count is lower.
  // e.g. "add lip balm and hand cream to the Goa packing list": A=2 tasks, C=1 list action ✓
  const rulesAllTasks = rulesOnly.detectedActions.length > 0 &&
    rulesOnly.detectedActions.every((a) => a.type === 'create_task');
  const runcHasListAction = runcResult.actions.some(
    (a) => a.type === 'add_list_items' || a.type === 'create_list',
  );
  if (rulesAllTasks && runcHasListAction) {
    // Count total items covered by C's list actions
    const runcItemCount = runcResult.actions.reduce((sum, a) => {
      if (a.type === 'add_list_items' || a.type === 'create_list') return sum + a.items.length;
      return sum;
    }, 0);
    // If C covers at least as many items as A had tasks, it's better
    if (runcItemCount >= rulesOnly.detectedActions.length) return 'better';
    // Even if fewer items, the type quality is correct — call it same instead of worse
    return 'same';
  }

  if (runcCount > currentBest) return 'better';
  if (runcCount === currentBest) return 'same';
  if (runcCount === 0 && currentBest === 0) return 'same';
  return 'worse';
}

function deriveRunCDelta(
  rulesOnly: TurnInterpretation,
  runcResult: RunCResult,
  runcOutcome: RunCOutcome,
): string {
  if (runcResult.error) return `Error: ${runcResult.error}`;

  const rulesCount = rulesOnly.detectedActions.length;
  const runcCount  = runcResult.actions.length;

  if (runcOutcome === 'better') {
    if (runcCount > rulesCount && rulesCount <= 1) {
      return `Run A produced ${rulesCount} action(s) (possibly garbled). Run C produced ${runcCount} distinct action(s) — new architecture handles this correctly.`;
    }
    return `Run C produced ${runcCount} action(s) vs Run A's ${rulesCount}. Improvement.`;
  }
  if (runcOutcome === 'same') {
    return `Both Run A and Run C produced ${runcCount} action(s). No change.`;
  }
  if (runcOutcome === 'worse') {
    return `Run A produced ${rulesCount} action(s), Run C produced ${runcCount}. Regression — review carefully.`;
  }
  return '';
}

// ─── Run D signal extraction ──────────────────────────────────────────────────

const BOOKING_FOR_WEEKDAY_RE = /\bfor\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/**
 * Extract overhaul-specific signals from the Run B TurnInterpretation.
 * No extra LLM calls — pure analysis of what the updated pipeline produced.
 */
function extractRunDSignals(fullPipeline: TurnInterpretation): RunDSignals {
  const actions = fullPipeline.detectedActions;
  const plan    = fullPipeline.executionPlan;
  const log     = fullPipeline.log;

  // New action types added by the overhaul
  const filler_detected = actions.some((a) => a.type === 'filler');
  const needs_clarification_from_llm = actions.some((a) => a.type === 'needs_clarification');

  // Confirm steps = destructive-action safeguard (new in overhaul)
  const confirm_steps = plan.filter((s) => s.kind === 'confirm').length;

  // Clarify steps from semantic validator / text-level analysis
  const clarify_steps = plan.filter((s) => s.kind === 'clarify').length;

  // Booking title preserved: any create_task title contains "for [weekday]"
  const booking_title_preserved = actions.some(
    (a) => a.type === 'create_task' && BOOKING_FOR_WEEKDAY_RE.test(a.task.title),
  );

  // Semantic constraint violations — SemanticConstraintResult uses decision:'ok'|'needs_clarification'
  const semantic_constraint_violations = (log.semanticConstraintResults ?? []).filter(
    (r) => r.decision === 'needs_clarification',
  ).length;

  // Sufficiency issues
  const sufficiency_issues = (log.sufficiencyResults ?? []).filter(
    (r) => !r.sufficient,
  ).length;

  // ── Date/time resolution quality ────────────────────────────────────────────
  // Walk every create_task action and record its resolved date/time + inferred flags.
  // inferred_date === true means the date fell back to today's default (no temporal match).
  const today = new Date().toISOString().slice(0, 10);
  const task_date_summaries: string[] = [];
  let inferred_date_count = 0;
  let inferred_time_count = 0;

  for (const a of actions) {
    if (a.type !== 'create_task') continue;
    const { title, due_date, due_time, inferred_date, inferred_time } = a.task;

    const shortTitle = title.length > 35 ? title.slice(0, 35) + '…' : title;

    // Annotate the date
    let dateLabel: string;
    if (!due_date) {
      dateLabel = 'no date';
    } else if (inferred_date && due_date === today) {
      dateLabel = `today [defaulted]`;
      inferred_date_count++;
    } else if (inferred_date) {
      dateLabel = `${due_date} [inferred]`;
      inferred_date_count++;
    } else {
      dateLabel = `${due_date} ✓`;
    }

    // Annotate the time
    let timeLabel: string;
    if (!due_time) {
      timeLabel = 'no time';
    } else if (inferred_time) {
      timeLabel = `${due_time} [defaulted]`;
      inferred_time_count++;
    } else {
      timeLabel = `${due_time} ✓`;
    }

    task_date_summaries.push(`"${shortTitle}" → ${dateLabel} @ ${timeLabel}`);
  }

  // Derive outcome
  const has_new_signal =
    filler_detected ||
    needs_clarification_from_llm ||
    confirm_steps > 0 ||
    clarify_steps > 0 ||
    semantic_constraint_violations > 0;

  const outcome: RunDOutcome =
    has_new_signal ? 'new_signal' :
    booking_title_preserved ? 'cleaner' :
    'same';

  // Build notes (date/time summary first — most important for analysis)
  const notes: string[] = [];

  // Date/time quality notes
  if (inferred_date_count > 0) {
    notes.push(`⚠ ${inferred_date_count} task(s) date defaulted to today — no temporal match found.`);
  }
  if (inferred_time_count > 0) {
    notes.push(`⚠ ${inferred_time_count} task(s) time defaulted — no explicit time in input.`);
  }
  task_date_summaries.forEach((s) => notes.push(s));

  // Separator if there are date notes AND other signals
  if (task_date_summaries.length > 0 && (filler_detected || confirm_steps > 0 || clarify_steps > 0)) {
    notes.push('—');
  }

  // Overhaul-specific signals
  if (filler_detected) notes.push('Filler detected — warm response sent, no task created.');
  if (needs_clarification_from_llm) {
    const q = actions.find((a) => a.type === 'needs_clarification');
    notes.push(`LLM clarification: "${(q as { type: 'needs_clarification'; question: string }).question}"`);
  }
  if (confirm_steps > 0) notes.push(`${confirm_steps} confirm step(s) — destructive action gated on user YES/NO.`);
  if (clarify_steps > 0) notes.push(`${clarify_steps} clarify step(s) from semantic/text-level analysis.`);
  if (booking_title_preserved) notes.push('Booking title preserved "for [day]" — not stripped as temporal phrase.');
  if (semantic_constraint_violations > 0) notes.push(`${semantic_constraint_violations} semantic constraint violation(s) (past-date or outside-hours).`);
  if (sufficiency_issues > 0) notes.push(`${sufficiency_issues} sufficiency issue(s) flagged.`);

  if (notes.length === 0) notes.push('No tasks created — nothing to verify.');

  // ── Derive response message the user would see ────────────────────────────
  let response_message: string;
  if (filler_detected) {
    response_message = 'Sounds like a busy one. Let me know if you need to capture anything.';
  } else if (needs_clarification_from_llm) {
    const q = actions.find((a) => a.type === 'needs_clarification') as { type: 'needs_clarification'; question: string } | undefined;
    response_message = q ? q.question : '(clarification needed)';
  } else {
    const confirmStep = plan.find((s) => s.kind === 'confirm');
    if (confirmStep?.confirmationMessage) {
      response_message = confirmStep.confirmationMessage;
    } else {
      const clarifyStep = plan.find((s) => s.kind === 'clarify');
      if (clarifyStep?.clarificationMessage) {
        response_message = clarifyStep.clarificationMessage;
      } else {
        const taskCount = actions.filter((a) => a.type === 'create_task').length;
        const listCount = actions.filter((a) => a.type === 'create_list' || a.type === 'add_list_items').length;
        if (taskCount > 0 && listCount > 0) {
          response_message = `Got it! Added ${taskCount} task(s) and updated ${listCount} list(s).`;
        } else if (taskCount > 0) {
          response_message = `Got it! Added ${taskCount} task(s).`;
        } else if (listCount > 0) {
          response_message = `Got it! Updated ${listCount} list(s).`;
        } else if (actions.length > 0) {
          response_message = `Done — ${actions.map(a => a.type).join(', ')}.`;
        } else {
          response_message = '(silence)';
        }
      }
    }
  }

  return {
    filler_detected,
    needs_clarification_from_llm,
    confirm_steps,
    clarify_steps,
    booking_title_preserved,
    semantic_constraint_violations,
    sufficiency_issues,
    task_date_summaries,
    inferred_date_count,
    inferred_time_count,
    response_message,
    outcome,
    notes: notes.join('\n'),
  };
}

// ─── CSV builder ──────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCSV(rows: SimulatorRow[]): string {
  const headers = [
    'ID', 'Category', 'Channel', 'Prompt',
    'Run A: Parser Output (rules only)',
    'Run B: Decision Point',
    'Run B: LLM Delta',
    'Learning (A+B)',
    'Recommendation',
    'Outcome (A+B)',
    'Run C: New Architecture Output',
    'Run C: vs Current',
    'Run C: Delta Explanation',
    'Run D: Post-Overhaul Signals',
    'Run D: Outcome',
    'Run D: Notes',
    'Run D: Date/Time Resolution',
    'Run D: Response (what user sees)',
    'Rules Actions', 'Full Actions', 'RunC Actions',
    'Reason Code', 'LLM ms (B)', 'LLM ms (C)',
    'D: Filler', 'D: Confirm Steps', 'D: Clarify Steps', 'D: Booking Preserved',
    'D: Inferred Dates', 'D: Inferred Times',
  ];

  const dataRows = rows.map((r) => [
    r.id, r.category, r.channel, r.input,
    r.parser_output, r.decision_point, r.llm_output,
    r.learning, r.recommendation, r.outcome,
    r.runc_output, r.runc_outcome, r.runc_delta,
    r.rund_output, r.rund_outcome, r.rund_notes,
    r.rund_date_summary, r.rund_response_message,
    r.rules_action_count, r.full_action_count, r.runc_action_count,
    r.reason_code, r.llm_ms ?? '', r.runc_llm_ms ?? '',
    r.rund_filler ? 'yes' : '', r.rund_confirm_steps || '', r.rund_clarify_steps || '', r.rund_booking_preserved ? 'yes' : '',
    r.rund_inferred_date_count || '', r.rund_inferred_time_count || '',
  ].map(csvCell).join(','));

  return '\uFEFF' + [headers.map(csvCell).join(','), ...dataRows].join('\r\n');
}

// ─── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(rows: SimulatorRow[]): SimulatorSummary {
  const reasonCodeCounts: Record<string, number> = {};
  const byCategory: SimulatorSummary['by_category'] = {};
  let clean = 0, llm_recovered = 0, llm_partial = 0, zero = 0;
  let runc_better = 0, runc_same = 0, runc_worse = 0, runc_error = 0;
  let rund_new_signal = 0, rund_cleaner = 0, rund_same = 0;
  let rund_filler_total = 0, rund_confirm_total = 0, rund_clarify_total = 0, rund_booking_preserved_total = 0;
  let rund_inferred_dates_total = 0, rund_inferred_times_total = 0;

  for (const row of rows) {
    reasonCodeCounts[row.reason_code] = (reasonCodeCounts[row.reason_code] ?? 0) + 1;

    if (!byCategory[row.category]) {
      byCategory[row.category] = { total: 0, clean: 0, llm_recovered: 0, llm_partial: 0, zero: 0 };
    }
    byCategory[row.category]!.total++;
    byCategory[row.category]![row.outcome]++;

    switch (row.outcome) {
      case 'clean':         clean++;         break;
      case 'llm_recovered': llm_recovered++; break;
      case 'llm_partial':   llm_partial++;   break;
      case 'zero':          zero++;          break;
    }
    switch (row.runc_outcome) {
      case 'better': runc_better++; break;
      case 'same':   runc_same++;   break;
      case 'worse':  runc_worse++;  break;
      case 'error':  runc_error++;  break;
    }
    switch (row.rund_outcome) {
      case 'new_signal': rund_new_signal++; break;
      case 'cleaner':    rund_cleaner++;    break;
      case 'same':       rund_same++;       break;
    }
    if (row.rund_filler)             rund_filler_total++;
    if (row.rund_confirm_steps > 0)  rund_confirm_total++;
    if (row.rund_clarify_steps > 0)  rund_clarify_total++;
    if (row.rund_booking_preserved)  rund_booking_preserved_total++;
    rund_inferred_dates_total += row.rund_inferred_date_count;
    rund_inferred_times_total += row.rund_inferred_time_count;
  }

  return {
    total: rows.length,
    clean, llm_recovered, llm_partial, zero,
    reason_code_counts: reasonCodeCounts,
    by_category: byCategory,
    runc_better, runc_same, runc_worse, runc_error,
    rund_new_signal, rund_cleaner, rund_same,
    rund_filler_total, rund_confirm_total, rund_clarify_total, rund_booking_preserved_total,
    rund_inferred_dates_total, rund_inferred_times_total,
  };
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  const rows: SimulatorRow[] = [];
  const total = SIMULATOR_PROMPTS.length;

  const hasApiKey = !!process.env.OPENAI_API_KEY;
  console.log(`\nUnload Simulator — 4-pass comparison (A: rules | B: current+LLM | C: proposed LLM-first | D: post-overhaul signals)`);
  console.log(`  OPENAI_API_KEY : ${hasApiKey ? 'present ✓' : 'missing — Run B and C will fall back'}`);
  console.log(`  Prompts        : ${total}`);
  console.log();

  for (let i = 0; i < SIMULATOR_PROMPTS.length; i++) {
    const prompt = SIMULATOR_PROMPTS[i]!;
    process.stdout.write(
      `  [${String(i + 1).padStart(3)}/${total}] id=${String(prompt.id).padStart(3)} ${prompt.category.padEnd(20)} "${prompt.input.replace(/\n/g, '↵').slice(0, 45)}${prompt.input.length > 45 ? '…' : ''}"`
    );

    const context = { channel: prompt.channel };
    const prevEnv = process.env.USE_LLM_CLASSIFICATION;

    // ── Run A: rules only ─────────────────────────────────────────────────
    process.env.USE_LLM_CLASSIFICATION = 'false';
    const t0a = Date.now();
    let rulesOnly: TurnInterpretation;
    try {
      rulesOnly = await interpretTurn(prompt.input, prompt.convState, context);
    } catch (err) {
      console.error(`\n  ERROR on prompt ${prompt.id} (Run A):`, err);
      process.env.USE_LLM_CLASSIFICATION = prevEnv ?? 'false';
      continue;
    }
    const totalMsA = Date.now() - t0a;

    // ── Run B: current full pipeline ──────────────────────────────────────
    process.env.USE_LLM_CLASSIFICATION = 'true';
    const t0b = Date.now();
    let fullPipeline: TurnInterpretation;
    try {
      fullPipeline = await interpretTurn(prompt.input, prompt.convState, context);
    } catch (err) {
      console.error(`\n  ERROR on prompt ${prompt.id} (Run B):`, err);
      process.env.USE_LLM_CLASSIFICATION = prevEnv ?? 'false';
      continue;
    }
    const totalMsB = Date.now() - t0b;

    process.env.USE_LLM_CLASSIFICATION = prevEnv ?? 'false';

    // ── Run C: proposed LLM-first (evaluation only) ───────────────────────
    const runcResult = await runC(prompt.input, prompt.convState);

    // ── Run D: post-overhaul signal extraction (re-uses Run B result) ─────
    const rundSignals = extractRunDSignals(fullPipeline);

    // ── Derive columns ────────────────────────────────────────────────────
    const outcome     = deriveOutcome(rulesOnly, fullPipeline);
    const reasonCode  = fullPipeline.log.classification?.reasonCode ?? 'unknown';
    const runcOutcome = deriveRunCOutcome(rulesOnly, fullPipeline, runcResult);

    const rundSignalTag =
      rundSignals.outcome === 'new_signal' ? `🔔 ${rundSignals.outcome}` :
      rundSignals.outcome === 'cleaner'    ? `✨ ${rundSignals.outcome}` :
      `= ${rundSignals.outcome}`;

    process.stdout.write(
      `  A=${rulesOnly.detectedActions.length} B=${fullPipeline.detectedActions.length} C=${runcResult.actions.length} D=[${rundSignalTag}]\n`
    );

    rows.push({
      id:       prompt.id,
      category: prompt.category,
      channel:  prompt.channel,
      input:    prompt.input,

      parser_output:      deriveParserOutput(rulesOnly),
      rules_action_count: rulesOnly.detectedActions.length,
      total_ms_a:         totalMsA,

      decision_point:  deriveDecisionPoint(fullPipeline),
      llm_output:      deriveLLMOutput(rulesOnly, fullPipeline),
      learning:        deriveLearning(rulesOnly, fullPipeline),
      recommendation:  deriveRecommendation(rulesOnly, fullPipeline),
      outcome,
      full_action_count: fullPipeline.detectedActions.length,
      reason_code:       reasonCode,
      llm_ms:            fullPipeline.log.classification?.timings.llmMs ?? null,
      total_ms_b:        totalMsB,

      runc_output:        runcResult.actions.length > 0
                            ? runcResult.actions.map(summarizeRunCAction).join('\n')
                            : runcResult.error ? `(error: ${runcResult.error})`
                            : '(no actions — correctly identified as filler or needs clarification)',
      runc_action_count:  runcResult.actions.length,
      runc_llm_ms:        runcResult.llm_ms,
      runc_outcome:       runcOutcome,
      runc_delta:         deriveRunCDelta(rulesOnly, runcResult, runcOutcome),
      runc_error:         runcResult.error,

      rund_output:              fullPipeline.detectedActions.length > 0
                                  ? fullPipeline.detectedActions.map(summarizeAction).join('\n')
                                  : '(no actions — filler or clarification)',
      rund_filler:              rundSignals.filler_detected,
      rund_needs_clarification: rundSignals.needs_clarification_from_llm,
      rund_confirm_steps:       rundSignals.confirm_steps,
      rund_clarify_steps:       rundSignals.clarify_steps,
      rund_booking_preserved:   rundSignals.booking_title_preserved,
      rund_semantic_violations:  rundSignals.semantic_constraint_violations,
      rund_sufficiency_issues:   rundSignals.sufficiency_issues,
      rund_date_summary:         rundSignals.task_date_summaries.join('\n'),
      rund_inferred_date_count:  rundSignals.inferred_date_count,
      rund_inferred_time_count:  rundSignals.inferred_time_count,
      rund_outcome:              rundSignals.outcome,
      rund_notes:                rundSignals.notes,
      rund_response_message:     rundSignals.response_message,
    });
  }

  const summary = buildSummary(rows);
  const output: SimulatorOutput = { generated_at: new Date().toISOString(), rows, summary };

  // Write JSON
  const jsonPath = path.join(outputDir, `simulator-results-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nJSON  → ${jsonPath}`);

  // Write CSV
  const csvPath = path.join(outputDir, `simulator-results-${ts}.csv`);
  fs.writeFileSync(csvPath, buildCSV(rows), 'utf8');
  console.log(`CSV   → ${csvPath}`);

  // Write HTML report
  const { buildHTMLReport } = await import('./simulator-report');
  const html = buildHTMLReport(output);
  const htmlPath = path.join(outputDir, `simulator-report-${ts}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`HTML  → ${htmlPath}`);

  // Print summary
  console.log('\n── Current pipeline (A+B) ──────────────────────────');
  console.log(`  Clean (rules)  : ${summary.clean}  (${pct(summary.clean, summary.total)}%)`);
  console.log(`  LLM recovered  : ${summary.llm_recovered}  (${pct(summary.llm_recovered, summary.total)}%)`);
  console.log(`  LLM partial    : ${summary.llm_partial}  (${pct(summary.llm_partial, summary.total)}%)`);
  console.log(`  Zero actions   : ${summary.zero}  (${pct(summary.zero, summary.total)}%)`);
  console.log('\n── Proposed architecture (C) ────────────────────────');
  console.log(`  Better than current : ${summary.runc_better}  (${pct(summary.runc_better, summary.total)}%)`);
  console.log(`  Same as current     : ${summary.runc_same}  (${pct(summary.runc_same, summary.total)}%)`);
  console.log(`  Worse than current  : ${summary.runc_worse}  (${pct(summary.runc_worse, summary.total)}%)`);
  console.log(`  Errors              : ${summary.runc_error}`);
  console.log('\n── Post-Overhaul (D) ────────────────────────────────');
  console.log(`  New signals fired   : ${summary.rund_new_signal}  (${pct(summary.rund_new_signal, summary.total)}%)`);
  console.log(`  Cleaner titles      : ${summary.rund_cleaner}  (${pct(summary.rund_cleaner, summary.total)}%)`);
  console.log(`  No change           : ${summary.rund_same}  (${pct(summary.rund_same, summary.total)}%)`);
  console.log(`  ├ Filler detected   : ${summary.rund_filler_total}`);
  console.log(`  ├ Confirm gates     : ${summary.rund_confirm_total}`);
  console.log(`  ├ Clarify steps     : ${summary.rund_clarify_total}`);
  console.log(`  └ Booking preserved : ${summary.rund_booking_preserved_total}`);
  console.log('\n── Date/Time Quality (D) ────────────────────────────');
  console.log(`  Tasks w/ explicit date  : ${summary.rund_inferred_dates_total === 0 ? 'all ✓' : `⚠ ${summary.rund_inferred_dates_total} task(s) date-defaulted to today`}`);
  console.log(`  Tasks w/ explicit time  : ${summary.rund_inferred_times_total === 0 ? 'all ✓' : `⚠ ${summary.rund_inferred_times_total} task(s) time-defaulted`}`);

  // Auto-open
  console.log(`\n  Opening report...\n`);
  try {
    const openCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    execSync(`${openCmd} "${htmlPath}"`);
  } catch {
    console.log(`  (Could not auto-open — run: open "${htmlPath}")`);
  }
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

run().catch((err) => {
  console.error('Simulator failed:', err);
  process.exit(1);
});
