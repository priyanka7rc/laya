/**
 * LLM-based intent classifier for task/list capture.
 *
 * Replaces the rules-based parseCompoundIntent call inside interpretTurn when
 * the USE_LLM_CLASSIFICATION env var is set to "true".
 *
 * Returns the same DetectedAction[] shape so the rest of the pipeline
 * (clarification policy, reference resolution, execution plan, execution helpers)
 * is completely unchanged.
 *
 * Graceful fallback: if the API key is missing, the call fails, or the response
 * fails Zod validation, parseCompoundIntent (rules) is used instead.
 *
 * Cost: ~$0.00008 per call on gpt-4o-mini (300–500 input + 150–300 output tokens).
 * Latency: ~500–1500ms.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import { parseCompoundIntent } from '@/lib/compoundIntentParser';
import { splitBrainDump } from '@/lib/brainDumpParser';
import { getCategoryListForPrompt } from '@/lib/categories';
import type { DetectedAction } from '@/lib/turnInterpreter';

// ─── Feature flag ──────────────────────────────────────────────────────────

export function isLLMClassificationEnabled(): boolean {
  return process.env.USE_LLM_CLASSIFICATION === 'true';
}

// ─── Observability types ───────────────────────────────────────────────────

/**
 * Structured reason code explaining which classification path ran and why.
 * Emitted with every ClassificationMeta event.
 */
export type ClassificationReasonCode =
  | 'rules_only_mode'            // USE_LLM_CLASSIFICATION is false
  | 'rules_matched'              // Rules returned actions; LLM not needed
  | 'llm_gap_fill'               // Rules returned 0 actions; LLM used to fill the gap
  | 'llm_partial_fill'           // Rules returned actions but coverage ratio < 0.5; LLM merged in
  | 'llm_multiline_routing'      // Input had newlines; rules skipped, LLM called with raw text
  | 'llm_missing_api_key'        // key not configured; rules used
  | 'llm_empty_response'         // API returned empty content; rules result kept
  | 'llm_schema_validation_failed' // Zod parse failed; rules result kept
  | 'llm_runtime_error';         // Any other exception; rules result kept

/**
 * Which classifier was selected for this turn.
 * - rules: ran rules only (flag off, or rules matched)
 * - llm: LLM ran as gap-filler (rules returned 0 actions)
 * - llm_with_rules_fallback: LLM was attempted but failed; rules (empty) used instead
 */
export type ClassifierMode = 'rules' | 'llm' | 'llm_with_rules_fallback';

/** Which source produced the final DetectedAction[] for this turn. */
export type ClassificationSource = 'llm' | 'rules' | 'llm_failed_rules_used';

/** Optional per-call context for traceability. */
export interface ClassificationContext {
  /** Correlation ID for the full request lifecycle. */
  turnId?: string;
  /** Channel that originated this turn. */
  channel?: 'web' | 'whatsapp' | 'unknown';
  /** Provider-level message ID (e.g. WhatsApp message ID). */
  providerMessageId?: string;
  /**
   * True when the original input (before normalization) contained newlines.
   * When true, the LLM is invoked directly with rawText (skipping rules) so
   * the LLM can see the newline structure that normalization would destroy.
   */
  isMultiline?: boolean;
  /**
   * Original text before domain normalization.
   * Used as the LLM input when isMultiline is true so structure is preserved.
   */
  rawText?: string;
}

/** Full observability record emitted for every classification call. */
export interface ClassificationMeta {
  turnId: string;
  channel: 'web' | 'whatsapp' | 'unknown';
  llmEnabled: boolean;
  classifierMode: ClassifierMode;
  classificationSource: ClassificationSource;
  reasonCode: ClassificationReasonCode;
  fallbackUsed: boolean;
  timings: {
    totalMs: number;
    llmMs?: number;
    rulesMs?: number;
  };
  textLengthChars: number;
  segmentCount?: number;
  actionCount: number;
  actionTypes: string[];
  tokenCount?: number;
  /** Only populated when LOG_INTENT_CLASSIFICATION_VERBOSE=true (dev/staging). */
  textPreview?: string;
}

/** Return type of classifyIntent — actions plus full observability meta. */
export interface ClassificationResult {
  actions: DetectedAction[];
  meta: ClassificationMeta;
}

// ─── Output schema (mirrors DetectedAction union, JSON-serialisable) ───────

const CreateTaskSchema = z.object({
  type: z.literal('create_task'),
  title: z.string().min(1),
  due_date: z.string().nullable(),
  due_time: z.string().nullable(),
  category: z.string().nullable(),
  /** True when the LLM inferred the date (not explicitly stated by user). */
  inferred_date: z.boolean().optional(),
  /** True when the LLM inferred the time (not explicitly stated by user). */
  inferred_time: z.boolean().optional(),
  /**
   * True when the task is a booking/arrangement for a future event
   * (e.g. "book restaurant for Friday") — due_date should be today,
   * the event date belongs in the title.
   */
  is_booking: z.boolean().optional(),
});

const CreateListSchema = z.object({
  type: z.literal('create_list'),
  listName: z.string().min(1),
  items: z.array(z.string()),
});

const AddListItemsSchema = z.object({
  type: z.literal('add_list_items'),
  listName: z.string().min(1),
  items: z.array(z.string().min(1)),
});

const DeleteTaskSchema = z.object({
  type: z.literal('delete_task'),
  taskTerm: z.string().min(1),
});

const MarkDoneSchema = z.object({
  type: z.literal('mark_done'),
  taskTerm: z.string().nullable(),
});

const UpdateTaskSchema = z.object({
  type: z.literal('update_task'),
  taskTerm: z.string().nullable(),
  due_date: z.string().nullable(),
  due_time: z.string().nullable(),
  new_title: z.string().nullable(),
});

/** LLM signals that the input is ambiguous and clarification is needed. */
const NeedsClarificationSchema = z.object({
  type: z.literal('needs_clarification'),
  /** Plain English question to ask the user. Specific, never generic. */
  question: z.string(),
  reason: z.enum(['ambiguous_reference', 'missing_title', 'ambiguous_date', 'ambiguous_time']),
});

/** Conversational filler with no actionable content. */
const FillerSchema = z.object({
  type: z.literal('filler'),
});

const LLMActionSchema = z.discriminatedUnion('type', [
  CreateTaskSchema,
  CreateListSchema,
  AddListItemsSchema,
  DeleteTaskSchema,
  MarkDoneSchema,
  UpdateTaskSchema,
  NeedsClarificationSchema,
  FillerSchema,
]);

const LLMResponseSchema = z.object({
  actions: z.array(LLMActionSchema),
});

type LLMAction = z.infer<typeof LLMActionSchema>;

// ─── Prompt ────────────────────────────────────────────────────────────────

function buildPrompt(text: string): string {
  const categories = getCategoryListForPrompt();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const todayDayName = dayNames[now.getDay()];

  // Compute this week's Saturday for "end of week"
  const dow = now.getDay();
  const thisSat = new Date(now);
  thisSat.setDate(now.getDate() + (dow === 6 ? 0 : 6 - dow));
  const thisSatStr = thisSat.toISOString().slice(0, 10);

  return `You extract tasks and list items from natural language input.
Today is ${today} (${todayDayName}). Tomorrow is ${tomorrow}.
This Saturday (end of week) is ${thisSatStr}.

Return a JSON object: { "actions": [ ... ] }

Each action must be one of:

1. CREATE TASK — something the person needs to do
{
  "type": "create_task",
  "title": "Descriptive title preserving booking context (e.g. 'Book restaurant for Friday')",
  "due_date": "YYYY-MM-DD or null if completely unknown",
  "due_time": "HH:MM (24h) or null if completely unknown",
  "category": one of [${categories}] or null,
  "inferred_date": true if you inferred the date (user did not state it explicitly),
  "inferred_time": true if you inferred the time (user did not state it explicitly),
  "is_booking": true ONLY when task is to arrange/book/schedule something FOR a future event
}

2. ADD TO LIST — items being added to an existing list
{
  "type": "add_list_items",
  "listName": "Name of the list",
  "items": ["item1", "item2"]
}

3. CREATE LIST — creating a new named list, optionally with seed items
{
  "type": "create_list",
  "listName": "Name of the list",
  "items": ["item1", "item2"]
}

4. DELETE TASK — user explicitly wants to remove a task
{
  "type": "delete_task",
  "taskTerm": "Short phrase identifying the task (required)"
}

5. MARK DONE — user says a task is complete
{
  "type": "mark_done",
  "taskTerm": "Short phrase identifying the task, or null for implicit 'it'/'that' references"
}

6. UPDATE TASK — reschedule, move, rename, or shift a task
{
  "type": "update_task",
  "taskTerm": "Short phrase identifying the task, or null for implicit references",
  "due_date": "YYYY-MM-DD or null",
  "due_time": "HH:MM (24h) or null",
  "new_title": "New title for rename (e.g. 'Reschedule plumber' → new_title: 'Plumber appointment'), or null"
}

7. NEEDS CLARIFICATION — input is ambiguous; ask before acting
{
  "type": "needs_clarification",
  "question": "Specific plain-English question for the user",
  "reason": "ambiguous_reference" | "missing_title" | "ambiguous_date" | "ambiguous_time"
}

8. FILLER — conversational statement with no task or list action
{
  "type": "filler"
}

DATE RESOLUTION RULES:
- "ASAP" / "as soon as possible" / "urgently" → due_date: today (${today}), inferred_date: false
- "end of week" / "eow" / "this week" → due_date: ${thisSatStr} (this Saturday)
- "end of day" / "eod" / "by end of day" → due_date: today, due_time: "23:59"
- "close of business" / "COB" → due_date: today, due_time: "18:00"
- "first thing" / "first thing in the morning" → due_time: "09:00"
- "last thing" → due_time: "21:00"
- "next [weekday]" → the named day of NEXT calendar week (not this week)
- "this [weekday]" → the named day of THIS calendar week
- bare "[weekday]" with no qualifier → next occurrence of that day (may be today if today is that day)
- "by [weekday]" → due_date: that day, due_time: "23:59"
- "in X hours" → due_date + due_time = now + X hours
- "in X days" → due_date = today + X days
- "couple of days" → due_date = today + 2 days
- "a few days" → due_date = today + 3 days
- "tonight" → due_time: "20:00"
- "morning" → due_time: "08:00"
- "afternoon" → due_time: "14:00"
- "evening" → due_time: "18:00"

BOOKING TASK RULES (is_booking = true):
- "Book/reserve/arrange/schedule/organise/plan X for [day]" → is_booking: true, due_date: today, title includes "for [day]"
- "Get/order/pick up X for [day/person]" → is_booking: true, due_date: today, title includes "for [day/person]"
- "Buy flowers for Sunday" → due_date: today, title: "Buy flowers for Sunday"
- NEVER set due_date to the event date for booking tasks

TITLE RULES:
- For is_booking tasks: KEEP "for [day/person]" in the title — do NOT strip it
- "remind me to X" / "need to X" / "don't forget to X" → strip the prefix, keep the rest
- Titles should be clean and actionable but MUST preserve booking/purpose context

CLARIFICATION RULES (use needs_clarification):
- Input contains "it", "this", "that", "that one" with no clear prior task context → ambiguous_reference
- Task title cannot be determined at all → missing_title
- "at 3" or "around 8" with no AM/PM indicator → ambiguous_time: ask "Is that 3am or 3pm?"
- "sometime next week", "one of these days", no specific day → ambiguous_date: ask which day
- NEVER guess an action when input is fundamentally unclear — ask instead

FILLER RULES (use filler type):
- "This week is busy", "It's been hectic", "I'm tired", "Had a great day" → filler
- General emotional statements, chitchat, observations → filler
- Do NOT create a task for filler

DELETE / DONE / UPDATE RULES:
- "delete X" / "remove X task" / "cancel X" → delete_task with taskTerm="X"
- "done" / "finished" / "mark X done" / "X is done" → mark_done with taskTerm="X" (or null for "it"/"that")
- "reschedule X to Y" / "move X to Y" / "shift X to Y" / "push X to Y" → update_task with taskTerm="X", due_date=Y
- "rename X to Y" / "change X to Y" → update_task with taskTerm="X", new_title="Y"
- When referring to a task by "it" / "that" / "this", set taskTerm=null

OTHER RULES:
- "groceries: milk, eggs" or "shopping: tomatoes, curd" → add_list_items (word before colon is list name)
- "create a school snacks list with bananas and cheese" → create_list with items
- "add X to Y list" → add_list_items
- One segment can produce multiple actions (tasks + lists in same message)
- Never invent tasks or items not mentioned in the input
- If input contains no actionable content, return { "actions": [] }

INPUT:
${text}`;
}

// ─── LLM → DetectedAction[] converter ─────────────────────────────────────

import { nudgePastTime } from '@/lib/taskRulesParser';

function TODAY_ISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Convert a raw LLM action to a DetectedAction.
 * Returns null for filler/needs_clarification (handled separately).
 */
function llmActionToDetectedAction(action: LLMAction): DetectedAction | null {
  if (action.type === 'create_task') {
    const inferredDate = action.inferred_date ?? !action.due_date;
    const inferredTime = action.inferred_time ?? !action.due_time;
    const due_date = action.due_date ?? TODAY_ISO();
    // Apply nudgePastTime on the LLM path too (mirrors rules path behaviour)
    const rawTime = action.due_time ?? '20:00';
    const due_time = nudgePastTime(due_date, rawTime, inferredTime);
    return {
      type: 'create_task',
      task: {
        title: action.title,
        due_date,
        due_time,
        category: action.category ?? 'Tasks',
        inferred_date: inferredDate,
        inferred_time: inferredTime,
        rawCandidate: action.title,
      },
    };
  }

  if (action.type === 'create_list') {
    return {
      type: 'create_list',
      listName: action.listName,
      items: action.items,
    };
  }

  if (action.type === 'add_list_items') {
    return {
      type: 'add_list_items',
      listName: action.listName,
      listId: null,
      items: action.items,
    };
  }

  if (action.type === 'delete_task') {
    return {
      type: 'task_follow_up_delete',
      taskId: '',
      taskTitle: action.taskTerm,
    };
  }

  if (action.type === 'mark_done') {
    return {
      type: 'task_follow_up_done',
      taskId: '',
      taskTitle: action.taskTerm,
    };
  }

  if (action.type === 'update_task') {
    const patch: import('@/lib/waEditParser').EditPatch = {};
    if (action.due_date !== null && action.due_date !== undefined) patch.due_date = action.due_date;
    if (action.due_time !== null && action.due_time !== undefined) patch.due_time = action.due_time;
    if (action.new_title !== null && action.new_title !== undefined) patch.title = action.new_title;
    if (Object.keys(patch).length === 0) return null;
    return {
      type: 'update_task',
      taskTerm: action.taskTerm ?? '',
      patch,
    };
  }

  // filler and needs_clarification are handled in the main classifyIntent loop
  return null;
}

// ─── Rules fallback ────────────────────────────────────────────────────────

function rulesClassify(text: string): DetectedAction[] {
  const compound = parseCompoundIntent(text);
  const actions: DetectedAction[] = [];

  for (const la of compound.listActions) {
    if (la.type === 'create_with_items') {
      actions.push({ type: 'create_list', listName: la.listName, items: la.items });
    } else if (la.type === 'add_to_existing') {
      actions.push({ type: 'add_list_items', listName: la.listName, listId: null, items: la.items });
    }
  }
  for (const task of compound.tasks) {
    actions.push({ type: 'create_task', task });
  }
  return actions;
}

// ─── Turn ID generation ────────────────────────────────────────────────────

function generateTurnId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Verbose preview helper ────────────────────────────────────────────────

function isVerboseClassificationLogging(): boolean {
  return process.env.LOG_INTENT_CLASSIFICATION_VERBOSE === 'true';
}

function textPreview(text: string): string {
  const raw = text.slice(0, 40);
  return raw.length < text.length ? `${raw}…` : raw;
}

// ─── Testing seam ──────────────────────────────────────────────────────────

let _testOpenAIClient: OpenAI | null = null;

/**
 * Inject a mock OpenAI client for unit tests.
 * Pass null to restore default behaviour (real client from env key).
 */
export function _setOpenAIClientForTest(client: OpenAI | null): void {
  _testOpenAIClient = client;
}

// ─── Main exported function ────────────────────────────────────────────────

/**
 * Classify text into DetectedAction[] using LLM when enabled, rules otherwise.
 *
 * Always returns a ClassificationResult. Never throws — falls back to rules on
 * any error. Full observability in ClassificationResult.meta.
 */
export async function classifyIntent(
  text: string,
  context?: ClassificationContext
): Promise<ClassificationResult> {
  const turnId = context?.turnId ?? generateTurnId();
  const channel = context?.channel ?? 'unknown';
  const llmEnabled = isLLMClassificationEnabled();
  const verbose = isVerboseClassificationLogging();
  const basePreview = verbose ? textPreview(text) : undefined;

  const totalStart = Date.now();

  // ── Step 0: Multiline routing guard ───────────────────────────────────────
  // When the original input contained newlines, the domain normalizer collapses
  // them to spaces, which destroys structure (12 tasks become 1 garbled string).
  // Bypass rules entirely and send rawText (pre-normalization) straight to the LLM.
  if (context?.isMultiline && llmEnabled) {
    const rawText = context.rawText ?? text;
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey || _testOpenAIClient) {
      const openai = _testOpenAIClient ?? new OpenAI({ apiKey: apiKey! });
      const llmStart = Date.now();
      let llmMs: number | undefined;
      let reasonCode: ClassificationReasonCode = 'llm_multiline_routing';

      try {
        const prompt = buildPrompt(rawText);
        const response = await openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You output only valid JSON. No markdown, no explanation.' },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 1200,
        });
        llmMs = Date.now() - llmStart;

        const content = response.choices[0]?.message?.content;
        if (!content) {
          reasonCode = 'llm_empty_response';
          throw new Error('Empty LLM response');
        }

        let raw: unknown;
        try { raw = JSON.parse(content); } catch {
          reasonCode = 'llm_schema_validation_failed';
          throw new Error('LLM response was not valid JSON');
        }

        let parsed: z.infer<typeof LLMResponseSchema>;
        try { parsed = LLMResponseSchema.parse(raw); } catch (zodErr) {
          reasonCode = 'llm_schema_validation_failed';
          throw zodErr;
        }

        const llmActions: DetectedAction[] = [];
        let needsClarification: { question: string; reason: string } | null = null;
        let isFiller = false;

        for (const a of parsed.actions) {
          if (a.type === 'needs_clarification') { needsClarification = { question: a.question, reason: a.reason }; continue; }
          if (a.type === 'filler') { isFiller = true; continue; }
          const converted = llmActionToDetectedAction(a);
          if (converted) llmActions.push(converted);
        }

        if (isFiller && llmActions.length === 0 && !needsClarification) {
          const meta: ClassificationMeta = {
            turnId, channel, llmEnabled: true, classifierMode: 'llm', classificationSource: 'llm',
            reasonCode, fallbackUsed: false,
            timings: { totalMs: Date.now() - totalStart, llmMs },
            textLengthChars: text.length, actionCount: 0, actionTypes: ['filler'],
            tokenCount: response.usage?.total_tokens,
            ...(basePreview !== undefined && { textPreview: basePreview }),
          };
          return { actions: [{ type: 'filler' as const }], meta };
        }

        if (needsClarification && llmActions.length === 0) {
          const meta: ClassificationMeta = {
            turnId, channel, llmEnabled: true, classifierMode: 'llm', classificationSource: 'llm',
            reasonCode, fallbackUsed: false,
            timings: { totalMs: Date.now() - totalStart, llmMs },
            textLengthChars: text.length, actionCount: 0, actionTypes: ['needs_clarification'],
            tokenCount: response.usage?.total_tokens,
            ...(basePreview !== undefined && { textPreview: basePreview }),
          };
          return { actions: [{ type: 'needs_clarification' as const, question: needsClarification.question, reason: needsClarification.reason }], meta };
        }

        const meta: ClassificationMeta = {
          turnId, channel, llmEnabled: true, classifierMode: 'llm', classificationSource: 'llm',
          reasonCode, fallbackUsed: false,
          timings: { totalMs: Date.now() - totalStart, llmMs },
          textLengthChars: text.length,
          actionCount: llmActions.length,
          actionTypes: llmActions.map(a => a.type),
          tokenCount: response.usage?.total_tokens,
          ...(basePreview !== undefined && { textPreview: basePreview }),
        };
        return { actions: llmActions, meta };
      } catch (err) {
        if (llmMs === undefined) llmMs = Date.now() - llmStart;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[intentClassifier] Multiline LLM routing failed (${reasonCode}) turnId=${turnId} reason="${errMsg}" — falling through to rules`);
        // Fall through to normal rules path below
      }
    }
  }

  // ── Step 1a: Introspective filler pre-check ───────────────────────────────
  // Certain sentence patterns are conversational self-reflection that would
  // be garbled by the rules path into spurious create_task actions.
  // Intercept them here before rulesClassify runs so we never emit a task.
  const INTROSPECTIVE_FILLER = /^(i\s+need\s+to\s+get\s+better|i\s+need\s+to\s+be\s+better|this\s+week\s+is|this\s+month\s+is|it'?s?\s+been\s+(a\s+)?(busy|tough|crazy|rough|hectic|long)|life\s+is|things\s+are|man[,\s]|ugh[,!\s]|argh[,!\s]|sigh[,!\s]|smh\b|so\s+tired|feeling\s+overwhelmed|overwhelmed\s+(today|right\s+now)|just\s+wanted\s+to\s+say|had\s+a\s+(great|bad|long|rough)\s+day)\b/i;

  if (INTROSPECTIVE_FILLER.test(text.trim())) {
    const meta: ClassificationMeta = {
      turnId,
      channel,
      llmEnabled,
      classifierMode: 'rules',
      classificationSource: 'rules',
      reasonCode: llmEnabled ? 'rules_matched' : 'rules_only_mode',
      fallbackUsed: false,
      timings: { totalMs: Date.now() - totalStart, rulesMs: 0 },
      textLengthChars: text.length,
      actionCount: 0,
      actionTypes: ['filler'],
      ...(basePreview !== undefined && { textPreview: basePreview }),
    };
    return { actions: [{ type: 'filler' as const }], meta };
  }

  // ── Step 1b: always run rules first ───────────────────────────────────────
  const rulesStart = Date.now();
  const rulesActions = rulesClassify(text);
  const rulesMs = Date.now() - rulesStart;

  // ── Step 2: if rules matched, check coverage ratio before returning ────────
  // Phase 5: if rules found some actions but segment count is much larger,
  // rules may have missed items in a long dump. Invoke LLM in parallel to fill
  // the gap when: LLM is enabled AND segments >= 3 AND actionCount/segments < 0.5.
  if (rulesActions.length > 0) {
    const segments = splitBrainDump(text);
    const segmentCount = segments.length;
    const coverageRatio = segmentCount > 0 ? rulesActions.length / segmentCount : 1;
    const isLowCoverage = llmEnabled && segmentCount >= 3 && coverageRatio < 0.5;

    if (!isLowCoverage) {
      // Rules matched with sufficient coverage — no LLM needed
      const meta: ClassificationMeta = {
        turnId,
        channel,
        llmEnabled,
        classifierMode: 'rules',
        classificationSource: 'rules',
        reasonCode: llmEnabled ? 'rules_matched' : 'rules_only_mode',
        fallbackUsed: false,
        timings: { totalMs: Date.now() - totalStart, rulesMs },
        textLengthChars: text.length,
        segmentCount,
        actionCount: rulesActions.length,
        actionTypes: rulesActions.map(a => a.type),
        ...(basePreview !== undefined && { textPreview: basePreview }),
      };
      return { actions: rulesActions, meta };
    }

    // Low coverage: fall through to LLM partial fill (below).
    // We'll merge LLM results with rules results and deduplicate.
    console.warn(
      `[PARTIAL_FILL] Rules found ${rulesActions.length}/${segmentCount} segments ` +
      `(coverage=${Math.round(coverageRatio * 100)}%). Running LLM partial fill.\n` +
      `  input: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`
    );
  }

  // ── Step 3: rules returned nothing — try LLM if enabled ───────────────────
  if (!llmEnabled) {
    const meta: ClassificationMeta = {
      turnId,
      channel,
      llmEnabled: false,
      classifierMode: 'rules',
      classificationSource: 'rules',
      reasonCode: 'rules_only_mode',
      fallbackUsed: false,
      timings: { totalMs: Date.now() - totalStart, rulesMs },
      textLengthChars: text.length,
      actionCount: 0,
      actionTypes: [],
      ...(basePreview !== undefined && { textPreview: basePreview }),
    };
    return { actions: [], meta };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey && !_testOpenAIClient) {
    const meta: ClassificationMeta = {
      turnId,
      channel,
      llmEnabled: true,
      classifierMode: 'llm_with_rules_fallback',
      classificationSource: 'llm_failed_rules_used',
      reasonCode: 'llm_missing_api_key',
      fallbackUsed: true,
      timings: { totalMs: Date.now() - totalStart, rulesMs },
      textLengthChars: text.length,
      actionCount: 0,
      actionTypes: [],
      ...(basePreview !== undefined && { textPreview: basePreview }),
    };
    return { actions: [], meta };
  }

  // Rules returned 0 actions — call LLM as gap-filler
  const openai = _testOpenAIClient ?? new OpenAI({ apiKey: apiKey! });
  const llmStart = Date.now();
  let llmMs: number | undefined;
  let reasonCode: ClassificationReasonCode = 'llm_gap_fill';

  try {
    const prompt = buildPrompt(text);
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You output only valid JSON. No markdown, no explanation.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 800,
    });
    llmMs = Date.now() - llmStart;

    const content = response.choices[0]?.message?.content;
    if (!content) {
      reasonCode = 'llm_empty_response';
      throw new Error('Empty LLM response');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      reasonCode = 'llm_schema_validation_failed';
      throw new Error('LLM response was not valid JSON');
    }

    let parsed: z.infer<typeof LLMResponseSchema>;
    try {
      parsed = LLMResponseSchema.parse(raw);
    } catch (zodErr) {
      reasonCode = 'llm_schema_validation_failed';
      throw zodErr;
    }

    // ── Separate special action types from regular actions ────────────────────
    const llmActions: DetectedAction[] = [];
    let needsClarification: { question: string; reason: string } | null = null;
    let isFiller = false;

    for (const a of parsed.actions) {
      if (a.type === 'needs_clarification') {
        needsClarification = { question: a.question, reason: a.reason };
        continue;
      }
      if (a.type === 'filler') {
        isFiller = true;
        continue;
      }
      const converted = llmActionToDetectedAction(a);
      if (converted) llmActions.push(converted);
    }

    // ── If filler and no other actions, return filler signal via special action ─
    if (isFiller && llmActions.length === 0 && !needsClarification) {
      const meta: ClassificationMeta = {
        turnId,
        channel,
        llmEnabled: true,
        classifierMode: 'llm',
        classificationSource: 'llm',
        reasonCode: 'llm_gap_fill',
        fallbackUsed: false,
        timings: { totalMs: Date.now() - totalStart, rulesMs, llmMs },
        textLengthChars: text.length,
        actionCount: 0,
        actionTypes: ['filler'],
        tokenCount: response.usage?.total_tokens,
        ...(basePreview !== undefined && { textPreview: basePreview }),
      };
      return { actions: [{ type: 'filler' as const }], meta };
    }

    // ── If needs_clarification and no other actions, return clarification signal ─
    if (needsClarification && llmActions.length === 0) {
      const meta: ClassificationMeta = {
        turnId,
        channel,
        llmEnabled: true,
        classifierMode: 'llm',
        classificationSource: 'llm',
        reasonCode: 'llm_gap_fill',
        fallbackUsed: false,
        timings: { totalMs: Date.now() - totalStart, rulesMs, llmMs },
        textLengthChars: text.length,
        actionCount: 0,
        actionTypes: ['needs_clarification'],
        tokenCount: response.usage?.total_tokens,
        ...(basePreview !== undefined && { textPreview: basePreview }),
      };
      return {
        actions: [{ type: 'needs_clarification' as const, question: needsClarification.question, reason: needsClarification.reason }],
        meta,
      };
    }

    const isPartialFill = rulesActions.length > 0;

    let finalActions: DetectedAction[];
    let finalReasonCode: ClassificationReasonCode;

    if (isPartialFill) {
      // ── PARTIAL FILL: merge LLM results with rules, deduplicate by title ──
      // Rules results are authoritative; LLM results fill in what rules missed.
      const rulesTitles = new Set(
        rulesActions
          .filter((a): a is Extract<DetectedAction, { type: 'create_task' }> => a.type === 'create_task')
          .map(a => a.task.title.toLowerCase().trim())
      );
      const newFromLLM = llmActions.filter(a => {
        if (a.type !== 'create_task') return false;
        return !rulesTitles.has(a.task.title.toLowerCase().trim());
      });
      finalActions = [...rulesActions, ...newFromLLM];
      finalReasonCode = 'llm_partial_fill';

      if (newFromLLM.length > 0) {
        console.warn(
          `[PARTIAL_FILL] LLM added ${newFromLLM.length} action(s) missed by rules.\n` +
          `  new: [${newFromLLM.map(a => a.type === 'create_task' ? `"${a.task.title}"` : a.type).join(', ')}]\n` +
          `  → Add rules to compoundIntentParser/brainDumpParser for these patterns.`
        );
      }
    } else {
      // ── GAP FILL: rules found nothing, LLM fills the entire gap ──
      finalActions = llmActions;
      finalReasonCode = 'llm_gap_fill';

      const actionSummary = llmActions.map(a => {
        if (a.type === 'create_task') return `create_task("${a.task.title}")`;
        if (a.type === 'create_list') return `create_list("${a.listName}", items=${JSON.stringify(a.items)})`;
        if (a.type === 'add_list_items') return `add_list_items("${a.listName}", items=${JSON.stringify(a.items)})`;
        return a.type;
      }).join(', ');

      console.warn(
        `[INTENT_GAP] Rules returned 0 actions — LLM used as gap-filler.\n` +
        `  input:   "${text}"\n` +
        `  actions: [${actionSummary}]\n` +
        `  → Consider adding a rule to cover this pattern.`
      );
    }

    const meta: ClassificationMeta = {
      turnId,
      channel,
      llmEnabled: true,
      classifierMode: 'llm',
      classificationSource: 'llm',
      reasonCode: finalReasonCode,
      fallbackUsed: false,
      timings: { totalMs: Date.now() - totalStart, rulesMs, llmMs },
      textLengthChars: text.length,
      actionCount: finalActions.length,
      actionTypes: finalActions.map(a => a.type),
      tokenCount: response.usage?.total_tokens,
      ...(basePreview !== undefined && { textPreview: basePreview }),
    };
    return { actions: finalActions, meta };
  } catch (err) {
    if (llmMs === undefined) llmMs = Date.now() - llmStart;
    if (reasonCode === 'llm_gap_fill') reasonCode = 'llm_runtime_error';

    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[intentClassifier] LLM gap-fill failed (${reasonCode}) turnId=${turnId} reason="${errMsg}"`
    );

    // For partial fill: LLM failed but rules already found some actions — return those.
    // For gap fill: LLM failed and rules found nothing — return empty.
    const fallbackActions = rulesActions.length > 0 ? rulesActions : [];

    const meta: ClassificationMeta = {
      turnId,
      channel,
      llmEnabled: true,
      classifierMode: 'llm_with_rules_fallback',
      classificationSource: rulesActions.length > 0 ? 'rules' : 'llm_failed_rules_used',
      reasonCode,
      fallbackUsed: true,
      timings: { totalMs: Date.now() - totalStart, rulesMs, llmMs },
      textLengthChars: text.length,
      actionCount: fallbackActions.length,
      actionTypes: fallbackActions.map(a => a.type),
      ...(basePreview !== undefined && { textPreview: basePreview }),
    };
    return { actions: fallbackActions, meta };
  }
}
