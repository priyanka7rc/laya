import { querySearchTasks } from '@/server/taskView/taskViewQueries';

describe('Task View search', () => {
  it('accepts status filter and term', async () => {
    // This is a shape-level smoke test: it should run without throwing,
    // even though it depends on Supabase configuration at runtime.
    const result = await querySearchTasks('non-existent-app-user', 'milk', { status: 'active' });
    expect(result).toHaveProperty('tasks');
    expect(Array.isArray(result.tasks)).toBe(true);
  });
});

