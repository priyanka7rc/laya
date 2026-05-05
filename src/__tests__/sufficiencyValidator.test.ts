/**
 * Tests for deterministic sufficiency validator.
 *
 * Run: npx tsx src/__tests__/sufficiencyValidator.test.ts
 *
 * Covers:
 *   1. create_task: valid title → executable
 *   2. create_task: empty/trivial title → needs_clarification
 *   3. create_task: stopword-only title → needs_clarification
 *   4. create_list: valid name → executable
 *   5. create_list: empty name → needs_clarification
 *   6. add_list_items: valid items + listName → executable
 *   7. add_list_items: empty items → needs_clarification with listName in message
 *   8. add_list_items: missing listName AND listId → needs_clarification with item in message
 *   9. update_task: valid term + patch → executable
 *  10. update_task: empty taskTerm → needs_clarification
 *  11. update_task: empty patch → needs_clarification with task name in message
 *  12. task_follow_up_delete: with taskId → executable
 *  13. task_follow_up_delete: without taskId → needs_clarification
 *  14. task_follow_up_patch: with taskId + patch → executable
 *  15. task_follow_up_patch: without taskId → needs_clarification
 *  16. task_follow_up_done: with taskId → executable
 *  17. task_follow_up_done: without taskId → needs_clarification
 *  18. list_item_follow_up: valid items + listId → executable
 *  19. list_item_follow_up: missing listId → needs_clarification
 *  20. list_item_follow_up: empty items → needs_clarification
 *  21. entity_to_list: valid entityText + listName → executable
 *  22. entity_to_list: empty entityText → needs_clarification
 *  23. entity_to_list: missing listName → needs_clarification with item referenced
 *  24. Mixed: one executable + one needs_clarification (partial success)
 *  25. No generic "What do you want to do?" — all messages reference the specific slot
 *  26. No junk task creation: stopword-only is blocked, not silently created
 *  27. validateAllActions: returns results in same order as input
 */

import {
  validateActionSufficiency,
  validateAllActions,
} from '@/lib/sufficiencyValidator';
import type { DetectedAction } from '@/lib/turnInterpreter';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function assertNoGenericMessage(message: string | undefined): void {
  const GENERIC_PHRASES = [
    'what do you want',
    'what would you like',
    'can you clarify',
    'please clarify',
    'do you want to create',
    'what type of',
  ];
  if (!message) return;
  const lower = message.toLowerCase();
  for (const phrase of GENERIC_PHRASES) {
    assert(!lower.includes(phrase), `Clarification message is generic (contains "${phrase}"): "${message}"`);
  }
}

const TODAY = new Date().toISOString().slice(0, 10);

function makeTask(title: string): Extract<DetectedAction, { type: 'create_task' }> {
  return {
    type: 'create_task',
    task: {
      title,
      due_date: TODAY,
      due_time: '20:00',
      category: 'Tasks',
      inferred_date: true,
      inferred_time: true,
      rawCandidate: title,
    },
  };
}

function runTests(): void {

  // ── 1–3: create_task ───────────────────────────────────────────────────────

  console.log('1. create_task: valid title → executable');
  {
    const r = validateActionSufficiency(makeTask('Call dentist'));
    assert(r.decision === 'executable', `got ${r.decision}`);
    assert(!r.clarificationMessage, 'no message when executable');
  }

  console.log('2. create_task: empty title → needs_clarification');
  {
    const r = validateActionSufficiency(makeTask(''));
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_task_title', `got reason ${r.reason}`);
    assert(!!r.clarificationMessage, 'clarificationMessage must be present');
    assertNoGenericMessage(r.clarificationMessage);
  }

  console.log('3. create_task: single char title → needs_clarification');
  {
    const r = validateActionSufficiency(makeTask('x'));
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
  }

  console.log('3b. create_task: stopword-only title ("ok") → needs_clarification');
  {
    const r = validateActionSufficiency(makeTask('ok'));
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'stopword_only_title', `got reason ${r.reason}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  console.log('3c. create_task: stopword phrase ("yes please") → needs_clarification');
  {
    const r = validateActionSufficiency(makeTask('yes please'));
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
  }

  // ── 4–5: create_list ──────────────────────────────────────────────────────

  console.log('4. create_list: valid name → executable');
  {
    const action: DetectedAction = { type: 'create_list', listName: 'Groceries', items: [] };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('5. create_list: empty name → needs_clarification');
  {
    const action: DetectedAction = { type: 'create_list', listName: '', items: [] };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_list_name', `got reason ${r.reason}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 6–8: add_list_items ───────────────────────────────────────────────────

  console.log('6. add_list_items: valid items + listName → executable');
  {
    const action: DetectedAction = {
      type: 'add_list_items',
      listName: 'Shopping',
      listId: null,
      items: ['milk', 'eggs'],
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('7. add_list_items: empty items → needs_clarification with listName in message');
  {
    const action: DetectedAction = {
      type: 'add_list_items',
      listName: 'Groceries',
      listId: null,
      items: [],
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_list_items', `got reason ${r.reason}`);
    assert(
      !!(r.clarificationMessage?.toLowerCase().includes('groceries')),
      `expected list name in message, got: "${r.clarificationMessage}"`
    );
    assertNoGenericMessage(r.clarificationMessage);
  }

  console.log('8. add_list_items: missing listName AND listId → needs_clarification with items referenced');
  {
    const action: DetectedAction = {
      type: 'add_list_items',
      listName: null,
      listId: null,
      items: ['milk', 'bread'],
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_list_target', `got reason ${r.reason}`);
    assert(
      !!(r.clarificationMessage?.toLowerCase().includes('milk')),
      `expected item name in message, got: "${r.clarificationMessage}"`
    );
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 9–11: update_task ─────────────────────────────────────────────────────

  console.log('9. update_task: valid term + patch → executable');
  {
    const action: DetectedAction = {
      type: 'update_task',
      taskTerm: 'dentist',
      patch: { due_date: '2026-04-20' },
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('10. update_task: empty taskTerm → needs_clarification');
  {
    const action: DetectedAction = {
      type: 'update_task',
      taskTerm: '',
      patch: { due_date: '2026-04-20' },
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_task_term', `got reason ${r.reason}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  console.log('11. update_task: empty patch → needs_clarification with task name referenced');
  {
    const action: DetectedAction = {
      type: 'update_task',
      taskTerm: 'plumber',
      patch: {},
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'empty_patch', `got reason ${r.reason}`);
    assert(
      !!(r.clarificationMessage?.toLowerCase().includes('plumber')),
      `expected task name in message, got: "${r.clarificationMessage}"`
    );
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 12–13: task_follow_up_delete ──────────────────────────────────────────

  console.log('12. task_follow_up_delete: with taskId → executable');
  {
    const action: DetectedAction = {
      type: 'task_follow_up_delete',
      taskId: 'uuid-123',
      taskTitle: 'Dentist appointment',
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('13. task_follow_up_delete: without taskId → needs_clarification');
  {
    const action: DetectedAction = {
      type: 'task_follow_up_delete',
      taskId: '',
      taskTitle: null,
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_task_id', `got reason ${r.reason}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 14–15: task_follow_up_patch ───────────────────────────────────────────

  console.log('14. task_follow_up_patch: with taskId + patch → executable');
  {
    const action: DetectedAction = {
      type: 'task_follow_up_patch',
      taskId: 'uuid-456',
      taskTitle: 'Call mom',
      patch: { due_date: '2026-04-20' },
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('15. task_follow_up_patch: without taskId → needs_clarification');
  {
    const action: DetectedAction = {
      type: 'task_follow_up_patch',
      taskId: '',
      taskTitle: null,
      patch: { due_date: '2026-04-20' },
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_task_id', `got reason ${r.reason}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 16–17: task_follow_up_done ────────────────────────────────────────────

  console.log('16. task_follow_up_done: with taskId → executable');
  {
    const action: DetectedAction = {
      type: 'task_follow_up_done',
      taskId: 'uuid-789',
      taskTitle: 'Pay rent',
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('17. task_follow_up_done: without taskId → needs_clarification');
  {
    const action: DetectedAction = {
      type: 'task_follow_up_done',
      taskId: '',
      taskTitle: null,
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 18–20: list_item_follow_up ────────────────────────────────────────────

  console.log('18. list_item_follow_up: valid items + listId → executable');
  {
    const action: DetectedAction = {
      type: 'list_item_follow_up',
      items: ['curd', 'butter'],
      listId: 'list-abc',
      listName: 'Shopping',
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('19. list_item_follow_up: missing listId → needs_clarification');
  {
    const action: DetectedAction = {
      type: 'list_item_follow_up',
      items: ['paneer'],
      listId: '',
      listName: 'Groceries',
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_list_id', `got reason ${r.reason}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  console.log('20. list_item_follow_up: empty items → needs_clarification');
  {
    const action: DetectedAction = {
      type: 'list_item_follow_up',
      items: [],
      listId: 'list-abc',
      listName: 'Groceries',
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_list_items', `got reason ${r.reason}`);
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 21–23: entity_to_list ─────────────────────────────────────────────────

  console.log('21. entity_to_list: valid entityText + listName → executable');
  {
    const action: DetectedAction = {
      type: 'entity_to_list',
      entityText: 'sunscreen',
      listName: 'Packing',
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'executable', `got ${r.decision}`);
  }

  console.log('22. entity_to_list: empty entityText → needs_clarification with listName referenced');
  {
    const action: DetectedAction = {
      type: 'entity_to_list',
      entityText: '',
      listName: 'Shopping',
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_entity_text', `got reason ${r.reason}`);
    assert(
      !!(r.clarificationMessage?.toLowerCase().includes('shopping')),
      `expected list name in message, got: "${r.clarificationMessage}"`
    );
    assertNoGenericMessage(r.clarificationMessage);
  }

  console.log('23. entity_to_list: missing listName → needs_clarification with item referenced');
  {
    const action: DetectedAction = {
      type: 'entity_to_list',
      entityText: 'sunscreen',
      listName: null,
    };
    const r = validateActionSufficiency(action);
    assert(r.decision === 'needs_clarification', `got ${r.decision}`);
    assert(r.reason === 'missing_entity_list_target', `got reason ${r.reason}`);
    assert(
      !!(r.clarificationMessage?.toLowerCase().includes('sunscreen')),
      `expected entity text in message, got: "${r.clarificationMessage}"`
    );
    assertNoGenericMessage(r.clarificationMessage);
  }

  // ── 24. Mixed: partial success ────────────────────────────────────────────

  console.log('24. Mixed actions: one executable, one needs_clarification');
  {
    const actions: DetectedAction[] = [
      makeTask('Call dentist'),
      { type: 'create_list', listName: '', items: [] },
    ];
    const results = validateAllActions(actions);
    assert(results.length === 2, `expected 2 results, got ${results.length}`);
    assert(results[0]!.decision === 'executable', `result[0] should be executable, got ${results[0]!.decision}`);
    assert(results[1]!.decision === 'needs_clarification', `result[1] should be needs_clarification, got ${results[1]!.decision}`);
  }

  // ── 25. No generic messages ────────────────────────────────────────────────

  console.log('25. All clarification messages are specific (no generic slots)');
  {
    const testCases: DetectedAction[] = [
      makeTask(''),
      { type: 'create_list', listName: '', items: [] },
      { type: 'add_list_items', listName: 'Groceries', listId: null, items: [] },
      { type: 'update_task', taskTerm: 'plumber', patch: {} },
      { type: 'task_follow_up_delete', taskId: '', taskTitle: null },
      { type: 'entity_to_list', entityText: '', listName: 'Shopping' },
    ];

    for (const action of testCases) {
      const r = validateActionSufficiency(action);
      if (r.decision !== 'executable') {
        assertNoGenericMessage(r.clarificationMessage);
        assert(!!r.clarificationMessage, `clarificationMessage missing for ${action.type} failure`);
      }
    }
  }

  // ── 26. No junk task creation ─────────────────────────────────────────────

  console.log('26. Stopword-only title is blocked (no silent junk task creation)');
  {
    const junkTasks = ['ok', 'hi', 'yes', 'sure', 'thanks', 'good'];
    for (const title of junkTasks) {
      const r = validateActionSufficiency(makeTask(title));
      assert(
        r.decision !== 'executable',
        `Task with title "${title}" should not be executable`
      );
    }
  }

  // ── 27. validateAllActions preserves order ─────────────────────────────────

  console.log('27. validateAllActions returns results in same order as input');
  {
    const actions: DetectedAction[] = [
      makeTask('Buy milk'),
      makeTask(''),
      { type: 'create_list', listName: 'Packing', items: ['sunscreen'] },
    ];
    const results = validateAllActions(actions);
    assert(results.length === 3, `expected 3 results, got ${results.length}`);
    assert(results[0]!.decision === 'executable', `result[0]: got ${results[0]!.decision}`);
    assert(results[1]!.decision === 'needs_clarification', `result[1]: got ${results[1]!.decision}`);
    assert(results[2]!.decision === 'executable', `result[2]: got ${results[2]!.decision}`);
    assert(results[0]!.action === actions[0], 'result[0] action reference preserved');
    assert(results[2]!.action === actions[2], 'result[2] action reference preserved');
  }

  console.log('\nAll sufficiencyValidator tests passed.');
}

runTests();
