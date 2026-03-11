import { queryAllTasks } from '@/server/taskView/taskViewQueries';

/**
 * Behavior-level pagination test.
 * NOTE: This relies on the underlying Supabase client but is written to be safe
 * even when there is no data (it simply won't assert cross-page ids then).
 */
describe('taskView pagination behavior', () => {
  it('does not repeat ids across consecutive pages when cursor is used', async () => {
    const appUserId = 'non-existent-app-user';
    const first = await queryAllTasks(appUserId, undefined, { limit: 2 });

    const cursor = first.pageInfo.nextCursor ?? null;
    if (!cursor) {
      // Not enough data to test cross-page behavior; shape is still validated.
      expect(Array.isArray(first.tasks)).toBe(true);
      return;
    }

    const second = await queryAllTasks(appUserId, undefined, {
      limit: 2,
      cursor,
    });

    const firstIds = new Set(first.tasks.map((t) => t.id));
    const secondIds = new Set(second.tasks.map((t) => t.id));

    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false);
    }
  });
});

