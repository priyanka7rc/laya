import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { TASK_CATEGORIES_SET, getCategoryListForPrompt } from '@/lib/categories';
import { toHHMM } from '@/lib/taskRulesParser';

const REFINE_LOG = '[refineTasks]';

const ALLOWED_CATEGORIES = TASK_CATEGORIES_SET;

const RequestTaskSchema = z.object({
  id: z.string().uuid(),
  rawSegmentText: z.string(),
  title: z.string(),
  due_date: z.string(),
  due_time: z.string(),
  category: z.string().nullable(),
  dueDateWasDefaulted: z.boolean(),
  dueTimeWasDefaulted: z.boolean(),
});

const RequestSchema = z.object({
  tasks: z.array(RequestTaskSchema).min(1).max(50),
  fullDumpText: z.string().optional(),
});

const RefinedItemSchema = z.object({
  title: z.string().min(1).max(200),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_time: z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/),
  category: z.string().refine((c) => ALLOWED_CATEGORIES.has(c), { message: 'Category not in allowed list' }),
});

const AIResponseSchema = z.object({
  tasks: z.array(RefinedItemSchema),
});

type RequestTask = z.infer<typeof RequestTaskSchema>;
type RefinedItem = z.infer<typeof RefinedItemSchema>;

function hasExplicitDateTokens(text: string): boolean {
  const lower = text.toLowerCase();
  const datePatterns = [
    /\btoday\b/, /\btomorrow\b/, /\btonight\b/,
    /\bmonday\b/, /\btuesday\b/, /\bwednesday\b/, /\bthursday\b/, /\bfriday\b/, /\bsaturday\b/, /\bsunday\b/,
    /\bnext week\b/, /\bthis week\b/, /\bweekend\b/,
    /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/, /\b\d{4}-\d{2}-\d{2}\b/,
  ];
  return datePatterns.some((p) => p.test(lower));
}

function hasExplicitTimeTokens(text: string): boolean {
  const lower = text.toLowerCase();
  const timePatterns = [
    /\b(at|@|by)\s*\d{1,2}(:\d{2})?\s*(am|pm)?\b/i,
    /\b\d{1,2}\s*(am|pm)\b/i,
    /\b\d{1,2}:\d{2}\b/,
    /\bmorning\b/, /\bafternoon\b/, /\bevening\b/, /\bnight\b/, /\bnoon\b/, /\bmidnight\b/,
    /\bbreakfast\b/, /\blunch\b/, /\bdinner\b/,
  ];
  return timePatterns.some((p) => p.test(lower));
}

function buildRefinePrompt(tasks: RequestTask[], fullDumpText?: string): string {
  const taskList = tasks.map((t, i) => ({
    index: i,
    rawSegmentText: t.rawSegmentText,
    currentTitle: t.title,
    due_date: t.due_date,
    due_time: t.due_time,
    category: t.category,
    dueDateWasDefaulted: t.dueDateWasDefaulted,
    dueTimeWasDefaulted: t.dueTimeWasDefaulted,
  }));
  return `You refine rule-parsed tasks. Return a JSON object with a "tasks" array: one object per input task, in the same order.

Allowed categories only: ${getCategoryListForPrompt()}.

Rules:
1. Always improve title: clean formatting, remove date/time phrases, keep actionable.
2. Always set category from the allowed list based on content.
3. Only change due_date if dueDateWasDefaulted is true AND rawSegmentText contains explicit date words (today, tomorrow, weekday, next week, etc.). Otherwise return the current due_date unchanged.
4. Only change due_time if dueTimeWasDefaulted is true AND rawSegmentText contains explicit time words (at 3pm, morning, afternoon, etc.). Otherwise return the current due_time unchanged.
5. due_date format: YYYY-MM-DD. due_time format: HH:MM only (24-hour).

Input tasks (same order as output):
${JSON.stringify(taskList, null, 2)}
${fullDumpText ? `\nFull brain dump context (optional):\n${fullDumpText.slice(0, 500)}` : ''}

Return JSON: { "tasks": [ { "title", "due_date", "due_time", "category" }, ... ] }`;
}

function mergeRefined(
  original: RequestTask,
  refined: RefinedItem,
): { title: string; due_date: string; due_time: string; category: string } {
  let due_date = original.due_date;
  let due_time = original.due_time;
  if (original.dueDateWasDefaulted && hasExplicitDateTokens(original.rawSegmentText)) {
    due_date = refined.due_date;
  }
  if (original.dueTimeWasDefaulted && hasExplicitTimeTokens(original.rawSegmentText)) {
    const normalized = toHHMM(refined.due_time);
    if (normalized != null) due_time = normalized;
  } else {
    due_time = toHHMM(original.due_time) ?? due_time;
  }
  return {
    title: refined.title,
    due_date,
    due_time,
    category: refined.category,
  };
}

function createSupabaseClientWithAuth(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      console.warn(REFINE_LOG, 'invalid request', parsed.error.flatten());
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }
    const { tasks: inputTasks, fullDumpText } = parsed.data;

    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
    }

    if (!process.env.OPENAI_API_KEY) {
      console.log(REFINE_LOG, 'no OPENAI_API_KEY, skipping refine');
      return NextResponse.json({ refined: false, message: 'Refine skipped (no API key)', tasks: inputTasks });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = buildRefinePrompt(inputTasks, fullDumpText);

    let aiResult: z.infer<typeof AIResponseSchema>;
    try {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You output only valid JSON. No markdown, no explanation.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      });
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty AI response');
      const raw = JSON.parse(content);
      aiResult = AIResponseSchema.parse(raw);
    } catch (aiErr: unknown) {
      console.error(REFINE_LOG, 'AI failed, keeping rules tasks', aiErr);
      return NextResponse.json({
        refined: false,
        message: 'Refine failed; rules tasks unchanged',
        tasks: inputTasks.map((t) => ({
          id: t.id,
          title: t.title,
          due_date: t.due_date,
          due_time: t.due_time,
          category: t.category,
        })),
      });
    }

    if (aiResult.tasks.length !== inputTasks.length) {
      console.warn(REFINE_LOG, 'AI returned wrong count', { expected: inputTasks.length, got: aiResult.tasks.length });
      return NextResponse.json({
        refined: false,
        message: 'Refine response count mismatch',
        tasks: inputTasks.map((t) => ({ id: t.id, title: t.title, due_date: t.due_date, due_time: t.due_time, category: t.category })),
      });
    }

    const supabase = createSupabaseClientWithAuth(token);
    const updates: { id: string; title: string; due_date: string; due_time: string; category: string }[] = [];

    for (let i = 0; i < inputTasks.length; i++) {
      const original = inputTasks[i];
      const refined = aiResult.tasks[i];
      const merged = mergeRefined(original, refined);
      const changed =
        merged.title !== original.title ||
        merged.due_date !== original.due_date ||
        merged.due_time !== original.due_time ||
        (merged.category || '') !== (original.category || '');
      if (changed) {
        updates.push({ id: original.id, ...merged });
      }
    }

    for (const u of updates) {
      const { error } = await supabase
        .from('tasks')
        .update({
          title: u.title,
          due_date: u.due_date,
          due_time: u.due_time,
          category: u.category,
        })
        .eq('id', u.id);
      if (error) {
        console.error(REFINE_LOG, 'update failed', { id: u.id, error: error.message });
      }
    }

    console.log(REFINE_LOG, 'done', { total: inputTasks.length, updated: updates.length });
    return NextResponse.json({
      refined: true,
      updatedCount: updates.length,
      tasks: inputTasks.map((t, i) => {
        const merged = mergeRefined(t, aiResult.tasks[i]);
        return { id: t.id, title: merged.title, due_date: merged.due_date, due_time: merged.due_time, category: merged.category };
      }),
    });
  } catch (err: unknown) {
    console.error(REFINE_LOG, err);
    return NextResponse.json({ error: 'Refine failed' }, { status: 500 });
  }
}
