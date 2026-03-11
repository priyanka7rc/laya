import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { splitBrainDump } from '@/lib/brainDumpParser';
import { textToProposedTasksFromSegments } from '@/lib/task_intake';

// Zod schema for rules-parsed task (due_date/due_time always set; flags for refinement; rawSegmentText for refinement)
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

// Zod schema for the API response
const ParsedDumpSchema = z.object({
  tasks: z.array(TaskSchema),
  summary: z.string().optional(),
});

// Rate limiting: 5 requests per minute per user
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute in ms
const RATE_LIMIT_MAX_REQUESTS = 5;

// In-memory store: Map<userId, timestamp[]>
const requestStore = new Map<string, number[]>();

// Clean up old entries periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of requestStore.entries()) {
    const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
    if (recentTimestamps.length === 0) {
      requestStore.delete(key);
    } else {
      requestStore.set(key, recentTimestamps);
    }
  }
}, 5 * 60 * 1000);

function getRateLimitKey(request: NextRequest): string {
  // Try to get user ID from auth header or session
  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    // Extract user ID from JWT or session if available
    // For now, use the auth header as a simple identifier
    return `user:${authHeader}`;
  }
  
  // Fallback to IP address
  const ip = request.headers.get('x-forwarded-for') || 
              request.headers.get('x-real-ip') || 
              'unknown';
  return `ip:${ip}`;
}

async function checkRateLimit(key: string): Promise<boolean> {
  const now = Date.now();
  const timestamps = requestStore.get(key) || [];
  
  // Filter to only recent requests (sliding window)
  const recentTimestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
  
  // Check if limit exceeded
  if (recentTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  // Add current request timestamp
  recentTimestamps.push(now);
  requestStore.set(key, recentTimestamps);
  
  return true;
}

const API_LOG = '[parseDump API]';

export async function POST(request: NextRequest) {
  console.log(API_LOG, 'POST start');
  try {
    // Check rate limit
    const rateLimitKey = getRateLimitKey(request);
    const isAllowed = await checkRateLimit(rateLimitKey);

    if (!isAllowed) {
      console.warn(API_LOG, 'rate limit exceeded');
      return NextResponse.json(
        { error: "Too many requests. Try again in a minute." },
        { status: 429 }
      );
    }

    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      console.warn(API_LOG, 'missing or invalid text');
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }
    console.log(API_LOG, 'rules parse, text length', text.length);

    // Canonical pipeline: split then segmentToProposedTask (Feature #1 only). Map to API shape for refine + insert.
    const segments = splitBrainDump(text);
    const rawSegments = segments.length === 0 ? [text.trim().slice(0, 500) || 'Task'] : segments;
    const proposed = textToProposedTasksFromSegments(rawSegments);
    const tasks = proposed.map((t) => ({
      title: t.title,
      notes: null,
      due_date: t.due_date,
      due_time: t.due_time,
      category: t.category,
      dueDateWasDefaulted: t.inferred_date,
      dueTimeWasDefaulted: t.inferred_time,
      rawSegmentText: t.rawCandidate,
      inferred_date: t.inferred_date,
      inferred_time: t.inferred_time,
    }));
    const parsedDump = {
      tasks,
      summary: tasks.length === 1
        ? 'Extracted 1 task'
        : `Extracted ${tasks.length} tasks from your brain dump`,
    };
    const validatedResult = ParsedDumpSchema.parse(parsedDump);
    console.log(API_LOG, 'rules done', { taskCount: validatedResult.tasks.length });
    return NextResponse.json(validatedResult);
  } catch (error: any) {
    console.error(API_LOG, 'Error', error?.message ?? error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid response format', details: error.issues },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to parse brain dump' },
      { status: 500 }
    );
  }
}

