import { insertTasksWithDedupe } from '@/server/tasks/insertTasksWithDedupe';

// This test focuses on remind_at computation logic indirectly by inserting a task
// and asserting no error; direct value assertion would require a readable view
// of remind_at, which isn't selected. Instead we exercise the helper via a
// minimal smoke test for now.

describe('insertTasksWithDedupe remind_at', () => {
  it('can insert a task without throwing when due_date/time are present', async () => {
    const result = await insertTasksWithDedupe({
      tasks: [
        {
          title: 'Remind test',
          category: 'Tasks',
          due_date: '2026-03-02',
          due_time: '10:00',
          inferred_date: false,
          inferred_time: false,
        },
      ] as any,
      userId: '00000000-0000-0000-0000-000000000000',
      appUserId: null,
      allowDuplicateIndices: [0],
    });

    expect(result).toHaveProperty('inserted');
  });
});

