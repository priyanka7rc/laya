import { executeTaskView } from '@/server/taskView/taskViewEngine';

describe('taskView search term floor', () => {
  it('returns empty result for too-short search terms', async () => {
    const result = await executeTaskView({
      identity: { kind: 'appUserId', appUserId: 'non-existent' },
      view: 'search',
      filters: { term: 'a' },
    });

    expect(result.tasks.length).toBe(0);
    expect(result.pageInfo.hasMore).toBe(false);
  });
});

