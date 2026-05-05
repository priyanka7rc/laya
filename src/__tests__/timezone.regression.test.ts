/**
 * Timezone consistency regression tests.
 *
 * Documents and guards against the UTC vs IST inconsistency between:
 *   - turnInterpreter.ts line 363: parseEditPatch(normalizedText, 'UTC')
 *   - waFollowUpParser.ts line 70:  parseEditPatch(rest, 'Asia/Kolkata')
 *
 * Current state: parseEditPatch ignores its _tz parameter (prefixed with _),
 * so both calls produce the same result. This test ensures they remain consistent
 * if/when actual timezone-aware date resolution is implemented.
 *
 * Run with: npm test timezone.regression
 */

import { describe, it, expect } from 'vitest';
import { parseEditPatch } from '@/lib/waEditParser';
import { interpretTurn } from '@/lib/turnInterpreter';
import type { WaConversationState } from '@/lib/waConversationState';

const FUTURE_EXPIRY = new Date(Date.now() + 3_600_000).toISOString();
const NOW = new Date().toISOString();

const stateWithTask: WaConversationState = {
  auth_user_id: 'user-1',
  active_task_id: 'task-abc',
  active_list_id: null,
  last_task_title: 'Call the bank',
  last_list_name: null,
  last_entity_text: 'Call the bank',
  pending_confirmation: null,
  updated_at: NOW,
  expires_at: FUTURE_EXPIRY,
};

describe('timezone consistency — parseEditPatch UTC vs Asia/Kolkata', () => {
  const temporalInputs = [
    'tomorrow at 9am',
    'friday at 3pm',
    'next monday',
    '5pm',
    'morning',
    'tonight',
  ];

  for (const input of temporalInputs) {
    it(`produces identical output for "${input}" regardless of tz param`, () => {
      const utcPatch = parseEditPatch(input, 'UTC');
      const istPatch = parseEditPatch(input, 'Asia/Kolkata');

      expect(utcPatch.due_date).toBe(istPatch.due_date);
      expect(utcPatch.due_time).toBe(istPatch.due_time);
      expect(utcPatch.title).toBe(istPatch.title);
    });
  }
});

describe('timezone consistency — single-turn edit vs follow-up patch produce same result', () => {
  it('single-turn edit "Move dentist to Friday" and follow-up "make it Friday" produce same due_date', async () => {
    // Single-turn edit path (turnInterpreter step 2, uses 'UTC')
    const singleTurnResult = await interpretTurn('Move dentist to Friday', null, {
      channel: 'web',
    });
    const singleTurnEditAction = singleTurnResult.detectedActions.find(
      (a) => a.type === 'update_task'
    );
    const singleTurnDate = singleTurnEditAction && 'patch' in singleTurnEditAction
      ? singleTurnEditAction.patch.due_date
      : null;

    // Follow-up patch path (waFollowUpParser, uses 'Asia/Kolkata')
    const followUpResult = await interpretTurn('make it Friday', stateWithTask, {
      channel: 'whatsapp',
    });
    const followUpPatchAction = followUpResult.detectedActions.find(
      (a) => a.type === 'task_follow_up_patch'
    );
    const followUpDate = followUpPatchAction && 'patch' in followUpPatchAction
      ? followUpPatchAction.patch.due_date
      : null;

    // Both should resolve to the same Friday date
    if (singleTurnDate !== null && followUpDate !== null) {
      expect(followUpDate).toBe(singleTurnDate);
    } else {
      // At least one path produced a date — document which one
      expect({ singleTurnDate, followUpDate }).toMatchObject({
        singleTurnDate: expect.anything(),
        followUpDate: expect.anything(),
      });
    }
  });

  it('time expressions produce consistent due_time across both paths', () => {
    const timeExpressions = ['9am', '5pm', '3:30pm', '20:00'];

    for (const expr of timeExpressions) {
      const utcPatch = parseEditPatch(expr, 'UTC');
      const istPatch = parseEditPatch(expr, 'Asia/Kolkata');
      expect(utcPatch.due_time).toBe(istPatch.due_time);
    }
  });
});

describe('timezone consistency — guard for future tz-aware implementation', () => {
  it('parseEditPatch parameter _tz is documented as intentionally ignored', () => {
    // This test exists to document that _tz is currently a no-op.
    // When proper timezone support is implemented, update both call sites
    // in turnInterpreter.ts and waFollowUpParser.ts to pass the user timezone
    // from getUserTimezoneByAuthUserId(), and remove this test.
    const patch1 = parseEditPatch('tomorrow', 'UTC');
    const patch2 = parseEditPatch('tomorrow', 'Pacific/Auckland'); // UTC+13
    const patch3 = parseEditPatch('tomorrow', 'America/New_York'); // UTC-5

    // All should be identical because _tz is currently unused
    expect(patch1.due_date).toBe(patch2.due_date);
    expect(patch1.due_date).toBe(patch3.due_date);
  });
});
