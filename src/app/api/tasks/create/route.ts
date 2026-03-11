/**
 * Canonical keyboard task create: single text → ProposedTask via task_intake, insert via insertTasksWithDedupe.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import { textToProposedTasksFromSegments, type ProposedTask } from '@/lib/task_intake';
import { insertTasksWithDedupe } from '@/server/tasks/insertTasksWithDedupe';
import { TASK_SOURCES } from '@/lib/taskSources';

const TITLE_MAX_LENGTH = 120;
const LOG = '[tasks/create]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const {
      text,
      due_date: dueDateOverride,
      due_time: dueTimeOverride,
      allowDuplicate = false,
      app_user_id: appUserId = null,
    } = body as {
      text?: string;
      due_date?: string;
      due_time?: string;
      allowDuplicate?: boolean;
      app_user_id?: string | null;
    };

    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'Task title required' }, { status: 400 });
    }
    if (trimmed.length > TITLE_MAX_LENGTH) {
      return NextResponse.json(
        { error: `Task title must be ${TITLE_MAX_LENGTH} characters or less` },
        { status: 400 }
      );
    }
    if (/[\r\n]/.test(trimmed)) {
      return NextResponse.json(
        { error: 'Task title cannot contain line breaks' },
        { status: 400 }
      );
    }

    // Single segment → one ProposedTask (canonical task_intake)
    const proposed = textToProposedTasksFromSegments([trimmed], { maxCandidates: 1 });
    const task: ProposedTask = proposed[0];

    // Optional date/time overrides from UI pickers (preserve inferred flags)
    if (dueDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(dueDateOverride)) {
      task.due_date = dueDateOverride;
      task.inferred_date = false;
    }
    if (dueTimeOverride && /^\d{1,2}:\d{2}$/.test(dueTimeOverride)) {
      const [h, m] = dueTimeOverride.split(':').map(Number);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        task.due_time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        task.inferred_time = false;
      }
    }

    const result = await insertTasksWithDedupe({
      tasks: [task],
      userId: user.id,
      appUserId: appUserId ?? null,
      allowDuplicateIndices: allowDuplicate ? [0] : [],
      source: TASK_SOURCES.WEB_KEYBOARD,
      sourceMessageId: null,
    });

    return NextResponse.json({
      inserted: result.inserted,
      duplicates: result.duplicates,
      proposed: [task],
    });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Failed to add task' }, { status: 500 });
  }
}
