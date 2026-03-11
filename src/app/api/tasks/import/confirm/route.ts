import { NextRequest, NextResponse } from 'next/server';
import { getAuthUserFromRequest } from '@/app/api/auth-helpers';
import type { ProposedTask } from '@/lib/task_intake';
import { insertTasksWithDedupe } from '@/server/tasks/insertTasksWithDedupe';
import { TASK_SOURCES, type TaskSource } from '@/lib/taskSources';

const LOG = '[tasks/import/confirm]';

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUserFromRequest(request);
    if (auth instanceof NextResponse) return auth;
    const { user } = auth;

    const body = await request.json().catch(() => ({}));
    const { mediaId: _mediaId, tasks: proposedTasks, overrides, source, app_user_id: appUserId } = body as {
      mediaId?: string;
      tasks?: ProposedTask[];
      overrides?: { allowDuplicatesTaskIds?: number[] };
      source?: TaskSource;
      app_user_id?: string | null;
    };

    if (!Array.isArray(proposedTasks) || proposedTasks.length === 0) {
      return NextResponse.json({ error: 'tasks array required' }, { status: 400 });
    }

    const result = await insertTasksWithDedupe({
      tasks: proposedTasks,
      userId: user.id,
      appUserId: appUserId ?? null,
      allowDuplicateIndices: overrides?.allowDuplicatesTaskIds ?? [],
      // Default to web media import when source is not provided.
      source: source ?? TASK_SOURCES.WEB_MEDIA,
      sourceMessageId: null,
    });

    return NextResponse.json({ inserted: result.inserted, duplicates: result.duplicates });
  } catch (e) {
    console.error(LOG, e);
    return NextResponse.json({ error: 'Confirm failed' }, { status: 500 });
  }
}
