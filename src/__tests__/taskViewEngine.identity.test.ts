import { executeTaskView } from '@/server/taskView/taskViewEngine';

describe('TaskViewEngine identity resolution', () => {
  it('marks identityResolved=false when authUserId has no app_user', async () => {
    const result = await executeTaskView({
      identity: { kind: 'authUserId', authUserId: '00000000-0000-0000-0000-000000000000' },
      view: 'all',
    });

    expect(result).toHaveProperty('identityResolved');
    expect(result.identityResolved).toBe(false);
    expect(Array.isArray(result.tasks)).toBe(true);
  });
});

