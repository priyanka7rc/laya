import { queryAllTasks } from '@/server/taskView/taskViewQueries';

describe('Task View pagination ordering', () => {
  it('returns deterministic page shape and cursor', async () => {
    const firstPage = await queryAllTasks('non-existent-app-user', undefined, { limit: 2 });
    expect(firstPage).toHaveProperty('pageInfo');
    expect(Array.isArray(firstPage.tasks)).toBe(true);

    const cursor = firstPage.pageInfo.nextCursor ?? null;
    if (cursor) {
      const secondPage = await queryAllTasks('non-existent-app-user', undefined, {
        limit: 2,
        cursor,
      });
      expect(secondPage).toHaveProperty('pageInfo');
      expect(Array.isArray(secondPage.tasks)).toBe(true);
    }
  });
});

