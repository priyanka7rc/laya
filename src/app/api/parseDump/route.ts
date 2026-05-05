import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { interpretTurn } from '@/lib/turnInterpreter';
import type { DetectedAction } from '@/lib/turnInterpreter';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { supabaseAdmin } from '@/lib/supabaseClient';
import { logClassification, logInterpretation, logExecutionPlan } from '@/lib/logger';
import { auditTurn } from '@/lib/auditLog';

// ─── Response types ────────────────────────────────────────────────────────

const TaskSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().optional().nullable(),
  due_date: z.string(),
  due_time: z.string(),
  category: z.string().nullable(),
  dueDateWasDefaulted: z.boolean(),
  dueTimeWasDefaulted: z.boolean(),
  rawSegmentText: z.string(),
  inferred_date: z.boolean().optional(),
  inferred_time: z.boolean().optional(),
});

const ListItemSchema = z.object({
  item: z.string().min(1),
  listName: z.string().min(1),
});

const ExecutionStepSchema = z.object({
  kind: z.enum(['execute', 'clarify']),
  actionType: z.string().optional(),
  clarificationReason: z.string().optional(),
  clarificationMessage: z.string().optional(),
});

const CandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const NeedsInputSchema = z.object({
  question: z.string(),
  candidates: z.array(CandidateSchema),
});

// Execution data shapes (raw values needed by Apply all on the frontend)
const TaskDataSchema = z.object({
  title: z.string(),
  due_date: z.string(),
  due_time: z.string(),
  category: z.string().nullable(),
  inferred_date: z.boolean(),
  inferred_time: z.boolean(),
  dueDateWasDefaulted: z.boolean(),
  dueTimeWasDefaulted: z.boolean(),
  rawSegmentText: z.string(),
});

const PatchSchema = z.object({
  title: z.string().optional(),
  due_date: z.string().optional().nullable(),
  due_time: z.string().optional().nullable(),
  category: z.string().optional(),
});

const ActionRowSchema = z.object({
  id: z.string(),
  actionType: z.enum(['create_task', 'add_list_items', 'create_list', 'update_task', 'remove_list_item']),
  label: z.string(),
  primaryText: z.string(),
  secondaryText: z.string().optional(),
  status: z.enum(['ready', 'needs_input']),
  needsInput: NeedsInputSchema.optional(),
  // Raw execution data kept alongside so the frontend can call the right API
  task: TaskDataSchema.optional(),
  items: z.array(z.string()).optional(),
  listName: z.string().optional(),
  taskTerm: z.string().optional(),
  patch: PatchSchema.optional(),
});

const ParsedDumpSchema = z.object({
  tasks: z.array(TaskSchema),
  listItems: z.array(ListItemSchema),
  summary: z.string().optional(),
  executionPlan: z.array(ExecutionStepSchema).optional(),
  actions: z.array(ActionRowSchema),
});

// ─── Rate limiting ─────────────────────────────────────────────────────────

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const requestStore = new Map<string, number[]>();

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of requestStore.entries()) {
    const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
    if (recent.length === 0) requestStore.delete(key);
    else requestStore.set(key, recent);
  }
}, 5 * 60 * 1000);

function getRateLimitKey(request: NextRequest): string {
  const authHeader = request.headers.get('authorization');
  if (authHeader) return `user:${authHeader}`;
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
  return `ip:${ip}`;
}

async function checkRateLimit(key: string): Promise<boolean> {
  const now = Date.now();
  const timestamps = requestStore.get(key) || [];
  const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) return false;
  recent.push(now);
  requestStore.set(key, recent);
  return true;
}

// ─── DB lookup helpers ─────────────────────────────────────────────────────

type Candidate = { id: string; label: string };

/**
 * Tokenize a list name for overlap scoring:
 * - strip anything in brackets (e.g. [seed], [seed-v2])
 * - strip punctuation
 * - lowercase, split on whitespace
 * - drop single-char tokens
 * - stem: ies→y, then trailing es/ing/s
 */
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/\[.*?\]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .map((w) =>
        w.endsWith('ies') ? w.slice(0, -3) + 'y'
        : w.endsWith('es') ? w.slice(0, -2)
        : w.endsWith('ing') ? w.slice(0, -3)
        : w.endsWith('s') ? w.slice(0, -1)
        : w
      )
  );
}

/**
 * Token overlap score in [0, 1].
 * Score = |intersection| / max(|tokens_a|, |tokens_b|).
 * A score of 1.0 means all meaningful tokens match (handles prefixes, plurals, word order).
 */
function tokenOverlap(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const intersection = [...ta].filter((t) => tb.has(t)).length;
  return intersection / Math.max(ta.size, tb.size);
}

export type ListMatchResult =
  | { kind: 'none' }
  | { kind: 'auto'; candidate: Candidate }
  | { kind: 'ambiguous'; candidates: Candidate[] };

/**
 * Token-overlap list resolution.
 *
 * - Score = 1.0 (all tokens match) → auto-resolve as add_list_items.
 * - Score > 0 on multiple lists → ambiguous, show candidates.
 * - Score = 0 everywhere → none (create new list).
 *
 * This handles any bracket prefix pattern, plurals, word reordering, and
 * extra descriptor words without needing per-pattern rules.
 */
async function resolveListFuzzy(appUserId: string, parsedName: string): Promise<ListMatchResult> {
  if (!supabaseAdmin || !parsedName.trim()) return { kind: 'none' };

  const { data } = await supabaseAdmin
    .from('lists')
    .select('id, name')
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(50);

  if (!data || data.length === 0) return { kind: 'none' };

  type Scored = { id: string; label: string; score: number };
  const scored: Scored[] = (data as { id: string; name: string }[]).map((r) => ({
    id: r.id,
    label: r.name,
    score: tokenOverlap(parsedName, r.name),
  }));

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  // Perfect token match with a clear winner → auto-resolve
  if (best.score === 1.0 && (!second || second.score < 1.0)) {
    return { kind: 'auto', candidate: { id: best.id, label: best.label } };
  }

  // Multiple lists share the same top score → ask user
  const shortlist = scored.filter((s) => s.score > 0);
  if (shortlist.length >= 2 && best.score === (second?.score ?? 0)) {
    return { kind: 'ambiguous', candidates: shortlist.slice(0, 5).map((s) => ({ id: s.id, label: s.label })) };
  }

  // Single partial match → auto-resolve if it's the only non-zero scorer
  if (best.score > 0 && (!second || second.score === 0)) {
    return { kind: 'auto', candidate: { id: best.id, label: best.label } };
  }

  return { kind: 'none' };
}

/**
 * Fetch all (non-deleted) lists for a user — used when we need to present
 * a full list picker (e.g. "add curd too" or "remove bananas" with no target).
 */
async function getAllUserLists(appUserId: string): Promise<Candidate[]> {
  if (!supabaseAdmin) return [];
  const { data } = await supabaseAdmin
    .from('lists')
    .select('id, name')
    .eq('app_user_id', appUserId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(30);
  return (data ?? []).map((r: { id: string; name: string }) => ({ id: r.id, label: r.name }));
}

async function findTaskCandidates(appUserId: string, taskTerm: string): Promise<Candidate[]> {
  if (!supabaseAdmin) return [];
  // Strip date/time noise from the term before searching (e.g. "to friday", "by tomorrow")
  const cleanedTerm = taskTerm
    .replace(/\b(to|by|on|for|until|from|at)\s+(friday|saturday|sunday|monday|tuesday|wednesday|thursday|today|tomorrow|next\s+\w+|\d{1,2}[:/]\d{2}|\d{1,2}\s*(?:am|pm))\b/gi, '')
    .replace(/\b(friday|saturday|sunday|monday|tuesday|wednesday|thursday|today|tomorrow)\b/gi, '')
    .replace(/\b(next|this)\s+\w+\b/gi, '')
    .replace(/\bthe\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const searchTerm = cleanedTerm.length >= 2 ? cleanedTerm : taskTerm;

  const { data } = await supabaseAdmin
    .from('tasks')
    .select('id, title')
    .eq('app_user_id', appUserId)
    .ilike('title', `%${searchTerm}%`)
    .eq('is_done', false)
    .is('deleted_at', null)
    .order('title')
    .limit(5);
  return (data ?? []).map((r: { id: string; title: string }) => ({ id: r.id, label: r.title }));
}

// ─── Action row builders ───────────────────────────────────────────────────

function formatDate(due_date: string, inferred_date: boolean, dueDateWasDefaulted: boolean): string | undefined {
  if (dueDateWasDefaulted && !inferred_date) return undefined;
  const d = new Date(due_date);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const API_LOG = '[parseDump API]';

// ─── Main handler ──────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  console.log(API_LOG, 'POST start');
  try {
    const rateLimitKey = getRateLimitKey(request);
    if (!(await checkRateLimit(rateLimitKey))) {
      console.warn(API_LOG, 'rate limit exceeded');
      return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });
    }

    const { text } = await request.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    // Resolve auth + app user for DB lookups and logging (graceful fallback if unauthenticated)
    let appUserId: string | null = null;
    let authUserId: string | null = null;
    try {
      const auth = await getAuthUserFromRequest(request);
      if (!(auth instanceof NextResponse)) {
        authUserId = auth.user.id;
        const { data: appUser } = await supabaseAdmin!
          .from('app_users')
          .select('id')
          .eq('auth_user_id', auth.user.id)
          .maybeSingle<{ id: string }>();
        appUserId = appUser?.id ?? null;
      }
    } catch {
      // Non-fatal: proceed without candidates
    }

    const trimmedText = text.trim().slice(0, 2000) || '';
    console.log(API_LOG, 'interpreting, length', trimmedText.length);

    const userId = authUserId ?? 'anonymous';
    const interpretation = await interpretTurn(trimmedText, null, { channel: 'web' });

    if (interpretation.log.classification) {
      logClassification(interpretation.log.classification);
    }
    logInterpretation(userId, interpretation);
    logExecutionPlan(userId, interpretation.executionPlan, interpretation.turnId);

    // Persist audit log row (fire-and-forget — never blocks the response)
    void auditTurn({ appUserId, interpretation });

    // ── Build legacy tasks[] + listItems[] (backwards compat) ───────────────
    const listItems: { item: string; listName: string }[] = [];
    for (const action of interpretation.detectedActions) {
      if (action.type === 'create_list') {
        for (const item of action.items) {
          listItems.push({ item, listName: action.listName });
        }
      } else if (action.type === 'add_list_items' && action.listName) {
        for (const item of action.items) {
          listItems.push({ item, listName: action.listName });
        }
      }
    }
    const validListItems = listItems.filter(li => li.item.length > 0);

    const tasks = interpretation.detectedActions
      .filter((a): a is Extract<DetectedAction, { type: 'create_task' }> => a.type === 'create_task')
      .map(a => ({
        title: a.task.title,
        notes: null,
        due_date: a.task.due_date,
        due_time: a.task.due_time,
        category: a.task.category,
        dueDateWasDefaulted: a.task.inferred_date,
        dueTimeWasDefaulted: a.task.inferred_time,
        rawSegmentText: a.task.rawCandidate,
        inferred_date: a.task.inferred_date,
        inferred_time: a.task.inferred_time,
      }));

    const executionPlan = interpretation.executionPlan.map(step => ({
      kind: step.kind,
      actionType: step.action?.type,
      clarificationReason: step.clarificationReason,
      clarificationMessage: step.clarificationMessage,
    }));

    // ── Build enriched actions[] with DB-level candidate lookups ─────────────
    const actions: z.infer<typeof ActionRowSchema>[] = [];
    let rowIndex = 0;

    for (const action of interpretation.detectedActions) {
      const id = `action-${rowIndex++}`;

      if (action.type === 'create_task') {
        const dateLabel = formatDate(action.task.due_date, action.task.inferred_date, action.task.inferred_date);
        const secondary = [dateLabel, action.task.category].filter(Boolean).join(' · ') || undefined;
        actions.push({
          id,
          actionType: 'create_task',
          label: 'Create task',
          primaryText: action.task.title,
          secondaryText: secondary,
          status: 'ready',
          task: {
            title: action.task.title,
            due_date: action.task.due_date,
            due_time: action.task.due_time,
            category: action.task.category,
            inferred_date: action.task.inferred_date,
            inferred_time: action.task.inferred_time,
            dueDateWasDefaulted: action.task.inferred_date,
            dueTimeWasDefaulted: action.task.inferred_time,
            rawSegmentText: action.task.rawCandidate,
          },
        });

      } else if (action.type === 'create_list' || action.type === 'add_list_items') {
        const parsedListName = action.listName ?? '';
        const items = action.items;
        let isCreate = action.type === 'create_list';

        // Fix E: add_list_items with no list name — show as needs_input with all user lists
        if (!parsedListName && action.type === 'add_list_items') {
          const allLists = appUserId ? await getAllUserLists(appUserId) : [];
          const itemLabel = items.slice(0, 2).join(' and ');
          actions.push({
            id,
            actionType: 'add_list_items',
            label: 'Add to list',
            primaryText: items.join(', '),
            status: 'needs_input',
            needsInput: {
              question: `Add ${itemLabel} to which list?`,
              candidates: allLists,
            },
            items,
          });
          continue;
        }

        let resolvedListName = parsedListName;
        let status: 'ready' | 'needs_input' = 'ready';
        let needsInput: z.infer<typeof NeedsInputSchema> | undefined;

        if (appUserId && parsedListName) {
          const fuzzy = await resolveListFuzzy(appUserId, parsedListName);

          if (fuzzy.kind === 'auto') {
            // High-confidence single match — flip to add_list_items using matched name
            isCreate = false;
            resolvedListName = fuzzy.candidate.label;
          } else if (fuzzy.kind === 'ambiguous') {
            status = 'needs_input';
            needsInput = {
              question: 'Which list did you mean?',
              candidates: [
                ...fuzzy.candidates,
                { id: '__create_new__', label: `Create new: "${parsedListName}"` },
              ],
            };
          }
          // fuzzy.kind === 'none' → keep isCreate as-is, no candidates
        }

        const primaryText = isCreate
          ? items.length > 0
            ? `${resolvedListName} (new) · ${items.join(', ')}`
            : `${resolvedListName} (new)`
          : items.length > 0
            ? `${items.join(', ')} → ${resolvedListName}`
            : resolvedListName;

        actions.push({
          id,
          actionType: isCreate ? 'create_list' : 'add_list_items',
          label: isCreate ? 'Create list' : 'Add to list',
          primaryText,
          status,
          needsInput,
          items,
          listName: resolvedListName || undefined,
        });

      } else if (action.type === 'remove_list_item') {
        // Fix F: "remove bananas" — show as needs_input with list picker
        const allLists = appUserId ? await getAllUserLists(appUserId) : [];
        const hasTarget = !!(action.listName || action.listId);
        const resolvedListName = action.listName ?? '';

        if (hasTarget) {
          actions.push({
            id,
            actionType: 'remove_list_item',
            label: 'Remove from list',
            primaryText: `${action.item} ← ${resolvedListName}`,
            status: 'ready',
            items: [action.item],
            listName: resolvedListName || undefined,
          });
        } else {
          actions.push({
            id,
            actionType: 'remove_list_item',
            label: 'Remove from list',
            primaryText: action.item,
            status: 'needs_input',
            needsInput: {
              question: `Remove "${action.item}" from which list?`,
              candidates: allLists,
            },
            items: [action.item],
          });
        }

      } else if (action.type === 'update_task') {
        let status: 'ready' | 'needs_input' = 'needs_input';
        let needsInput: z.infer<typeof NeedsInputSchema> | undefined;
        let resolvedTaskId: string | undefined;

        if (appUserId && action.taskTerm) {
          const candidates = await findTaskCandidates(appUserId, action.taskTerm);
          if (candidates.length === 1 && candidates[0]) {
            status = 'ready';
            resolvedTaskId = candidates[0].id;
          } else if (candidates.length >= 2) {
            status = 'needs_input';
            needsInput = { question: 'Which task did you mean?', candidates };
          } else {
            // No matches found — still needs input so user can confirm
            status = 'needs_input';
            needsInput = { question: 'Which task did you mean?', candidates: [] };
          }
        }

        const patchParts: string[] = [];
        if (action.patch.due_date) patchParts.push(`→ ${action.patch.due_date}`);
        if (action.patch.due_time) patchParts.push(`at ${action.patch.due_time}`);
        if (action.patch.title) patchParts.push(`rename to "${action.patch.title}"`);

        actions.push({
          id,
          actionType: 'update_task',
          label: 'Move task',
          primaryText: resolvedTaskId
            ? `Task found`
            : action.taskTerm,
          secondaryText: patchParts.join(' ') || undefined,
          status,
          needsInput,
          taskTerm: action.taskTerm,
          patch: action.patch,
        });
      }
    }

    const totalItems = tasks.length + validListItems.length;
    const parsedDump = {
      tasks,
      listItems: validListItems,
      summary: totalItems === 1
        ? 'Extracted 1 item'
        : `Extracted ${totalItems} items from your brain dump`,
      executionPlan,
      actions,
    };

    const validated = ParsedDumpSchema.parse(parsedDump);
    console.log(API_LOG, 'done', {
      taskCount: validated.tasks.length,
      listItemCount: validated.listItems.length,
      actionCount: validated.actions.length,
      needsInput: validated.actions.filter(a => a.status === 'needs_input').length,
    });
    // Include turnId in response so the client can send feedback
    return NextResponse.json({ ...validated, turnId: interpretation.turnId });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(API_LOG, 'Error', msg);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid response format', details: error.issues }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to parse brain dump' }, { status: 500 });
  }
}
