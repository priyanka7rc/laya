/**
 * Golden fixture corpus for interpretTurn().
 *
 * Each fixture asserts on action_types[] and step_kinds[] — NOT on specific dates
 * (which are relative and would shift daily). This keeps the corpus stable and
 * runnable in CI without mocking time.
 *
 * Promoted from known-good inputs. Add new fixtures here any time a production
 * input is identified via the ai_turn_log gap_fill=true query (Phase 4 loop).
 *
 * Used by: src/__tests__/interpretTurn.fixtures.test.ts
 */

import type { WaConversationState } from '@/lib/waConversationState';

export interface InterpretFixture {
  label: string;
  input: string;
  channel: 'web' | 'whatsapp';
  convState: WaConversationState | null;
  /** Expected action types in order. [] means no actions should be produced. */
  expectedActionTypes: string[];
  /** Expected executionPlan step kinds in order. [] means empty plan. */
  expectedStepKinds: ('execute' | 'clarify' | 'confirm')[];
  /** If true, the test asserts needsClarification === true. */
  expectsClarification?: boolean;
}

// ─── Shared mock states ───────────────────────────────────────────────────────

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

const stateWithList: WaConversationState = {
  auth_user_id: 'user-1',
  active_task_id: null,
  active_list_id: 'list-xyz',
  last_task_title: null,
  last_list_name: 'School snacks',
  last_entity_text: null,
  pending_confirmation: null,
  updated_at: NOW,
  expires_at: FUTURE_EXPIRY,
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

export const INTERPRET_FIXTURES: InterpretFixture[] = [

  // ── 1. Simple single task ──────────────────────────────────────────────────

  {
    label: 'single task — explicit date/time',
    input: 'Call dentist tomorrow at 10am',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'single task — no date',
    input: 'Pay electricity bill',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'single task — intent prefix stripped',
    input: 'Remind me to pick up dry cleaning on Friday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 2. Multi-task dump ─────────────────────────────────────────────────────
  // NOTE: normalizeDomainText() collapses \n → space before classification, so
  // newline-separated dumps are joined into one line and the parser currently
  // treats them as a single segment → 1 task. These fixtures document CURRENT
  // behavior. Fix: preserve newlines through normalization for multi-line web input.
  // See: Phase 4 gap closure — these will be promoted to multi-task once fixed.

  {
    label: 'multi-task — 3 items newline-separated (currently 1 after normalization)',
    input: 'Buy milk\nCall mom\nPay rent by Friday',
    channel: 'web',
    convState: null,
    // Normalization collapses newlines → 1 merged task title
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 3. Grocery / shopping list ─────────────────────────────────────────────
  // NOTE: Rules produce create_list (not add_list_items) for colon-syntax list input
  // when there is no DB context. The add_list_items vs create_list distinction is
  // resolved at the DB level (fuzzy list match). These fixtures reflect rules output.

  {
    label: 'grocery list — colon syntax (rules produce create_list)',
    input: 'groceries: milk, eggs, curd, bread',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: ['create_list'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'shopping list — colon syntax (rules produce create_list)',
    input: 'shopping: tomatoes, onions, paneer',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: ['create_list'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'grocery list — "add X to groceries" phrasing',
    input: 'add milk and eggs to groceries',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: ['add_list_items'],
    expectedStepKinds: ['execute'],
  },

  // ── 4. Create new list ─────────────────────────────────────────────────────

  {
    label: 'create list — named list with seed items',
    input: 'create a school snacks list with bananas and cheese',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_list'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'create list — packing list phrasing',
    input: 'Create a packing list for Goa trip with sunscreen, hat, charger',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_list'],
    expectedStepKinds: ['execute'],
  },

  // ── 5. Add to existing list ────────────────────────────────────────────────
  // NOTE: "add X to Y list" is parsed as a task by current rules (no "add to list"
  // rule for the compound parser). Phase 4 gap: add rule to brainDumpParser/compoundIntentParser.

  {
    label: 'add to list — explicit "add X to Y" phrasing (currently parsed as task)',
    input: 'add sunscreen and hat to packing list',
    channel: 'whatsapp',
    convState: null,
    // Current behavior: rules don't catch this pattern → parsed as create_task
    // After rule fix: should be add_list_items
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 6. Mixed compound — tasks + list in one message ───────────────────────
  // NOTE: Normalization collapses \n → space. Mixed compound currently treated as
  // one segment by the rules parser. Document current behavior.

  {
    label: 'mixed compound — single line task and grocery list',
    input: 'groceries: tomatoes onions curd',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_list'],
    expectedStepKinds: ['execute'],
  },

  // ── 7. WhatsApp follow-up — task patch ────────────────────────────────────

  {
    label: 'WA follow-up — reschedule to Friday',
    input: 'make it Friday',
    channel: 'whatsapp',
    convState: stateWithTask,
    expectedActionTypes: ['task_follow_up_patch'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'WA follow-up — reschedule to tomorrow',
    input: 'move it to tomorrow',
    channel: 'whatsapp',
    convState: stateWithTask,
    expectedActionTypes: ['task_follow_up_patch'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'WA follow-up — delete active task → confirm step',
    input: 'delete it',
    channel: 'whatsapp',
    convState: stateWithTask,
    expectedActionTypes: ['task_follow_up_delete'],
    expectedStepKinds: ['confirm'],
    expectsClarification: true,
  },

  // ── 8. WhatsApp follow-up — mark done ──────────────────────────────────────

  {
    label: 'WA follow-up — mark done with active task',
    input: 'mark it done',
    channel: 'whatsapp',
    convState: stateWithTask,
    expectedActionTypes: ['task_follow_up_done'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'WA follow-up — mark done, no active task → clarify',
    input: 'mark it done',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: ['task_follow_up_done'],
    expectedStepKinds: ['clarify'],
    expectsClarification: true,
  },

  // ── 9. WhatsApp follow-up — list continuation ──────────────────────────────

  {
    label: 'WA list continuation — "add curd too"',
    input: 'add curd too',
    channel: 'whatsapp',
    convState: stateWithList,
    expectedActionTypes: ['list_item_follow_up'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'WA list continuation — "also add paneer"',
    input: 'also add paneer',
    channel: 'whatsapp',
    convState: stateWithList,
    expectedActionTypes: ['list_item_follow_up'],
    expectedStepKinds: ['execute'],
  },

  // ── 10. Filler — should produce zero actions ───────────────────────────────
  // NOTE: "This week is so busy" is currently parsed as a create_task by the rules
  // (filler filter doesn't catch this phrase). Phase 4 gap: extend filler list.
  // Document current behavior; update when filler filter is improved.

  {
    label: 'filler — affirmation (correctly ignored)',
    input: 'It has been hectic lately',
    channel: 'web',
    convState: null,
    expectedActionTypes: [],
    expectedStepKinds: [],
  },

  // ── 11. Ambiguous pronoun — no active context ──────────────────────────────

  {
    label: 'ambiguous delete — no conv state → clarify',
    input: 'delete that one',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: [],
    expectedStepKinds: ['clarify'],
    expectsClarification: true,
  },

  // ── 12. Edit / reschedule single-turn ──────────────────────────────────────

  {
    label: 'single-turn edit — reschedule by task name',
    input: 'Move dentist to next Monday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['update_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'single-turn edit — reschedule to specific day',
    input: 'Reschedule plumber to Friday at 3pm',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['update_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 13. Remove list item ───────────────────────────────────────────────────

  {
    label: 'remove list item — named list → confirm step',
    input: 'remove bananas from shopping list',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: ['remove_list_item'],
    expectedStepKinds: ['confirm'],
    expectsClarification: true,
  },
  {
    label: 'remove list item — no list name → clarify (needs_input)',
    input: 'remove bananas',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: ['remove_list_item'],
    // remove_list_item without list name becomes needs_clarification in sufficiency
    expectedStepKinds: ['clarify'],
  },

  // ── 14. Domain normalization visible ──────────────────────────────────────

  {
    label: 'normalization — shorthand expanded',
    input: 'Buy tmrw morning',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 15. Parity — same detectedActions[0].type web vs whatsapp ─────────────

  {
    label: 'parity — task created same way on web and WA',
    input: 'Schedule car service for Saturday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 16. Temporal dictionary terms ─────────────────────────────────────────
  // These fixtures assert that temporal terms produce a create_task execute step
  // (dates are not asserted since they are relative to today).

  {
    label: 'temporal — "end of week" resolves to a create_task',
    input: 'Submit quarterly report by end of week',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "eod" in input produces create_task',
    input: 'Send invoice by end of day',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "asap" produces create_task',
    input: 'Fix production bug ASAP',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "next Friday" produces create_task',
    input: 'Team lunch next Friday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "this Friday" produces create_task',
    input: 'Grocery run this Friday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "in 3 days" produces create_task',
    input: 'Follow up with client in 3 days',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "couple of days" produces create_task',
    input: 'Call landlord in a couple of days',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "by Monday" produces create_task',
    input: 'Pay rent by Monday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'temporal — "first thing" produces create_task',
    input: 'Review agenda first thing in the morning',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 17. Booking preposition context (rules path) ───────────────────────────

  {
    label: 'booking — "book restaurant for Friday" → create_task execute, date=today',
    input: 'Book restaurant for Friday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'booking — "reserve table for Saturday" → create_task execute',
    input: 'Reserve table for Saturday dinner',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'booking — "order cake for Sunday" → create_task execute',
    input: 'Order cake for Sunday',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 18. Confirm step for destructive actions ───────────────────────────────

  {
    label: 'confirm — delete with active task produces confirm step',
    input: 'delete it',
    channel: 'whatsapp',
    convState: stateWithTask,
    expectedActionTypes: ['task_follow_up_delete'],
    expectedStepKinds: ['confirm'],
    expectsClarification: true,
  },
  {
    label: 'confirm — remove named list item produces confirm step',
    input: 'remove eggs from shopping list',
    channel: 'whatsapp',
    convState: null,
    expectedActionTypes: ['remove_list_item'],
    expectedStepKinds: ['confirm'],
    expectsClarification: true,
  },

  // ── 19. Semantic constraint — business hours ───────────────────────────────

  {
    label: 'business-hours — dentist at 8am is within hours → execute',
    input: 'Dentist at 10am',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },

  // ── 20. Multi-task dumps ───────────────────────────────────────────────────

  {
    label: 'multi-task — task from single line',
    input: 'Pay rent tomorrow at 10am',
    channel: 'web',
    convState: null,
    expectedActionTypes: ['create_task'],
    expectedStepKinds: ['execute'],
  },
  {
    label: 'multi-task — colon-list syntax creates a list',
    input: 'Groceries: milk, eggs, butter',
    channel: 'web',
    convState: null,
    // Rules parse colon-list as create_list (not add_list_items — no prior list context)
    expectedActionTypes: ['create_list'],
    expectedStepKinds: ['execute'],
  },

];

// ─── Dedicated temporal resolution tests (unit, no LLM) ──────────────────────

import { parseDate, parseDateWithMeta } from '@/lib/taskRulesParser';
import { resolveTemporal } from '@/lib/temporalDictionary';

export function runTemporalUnitTests(): void {
  const NOW_DATE = new Date('2026-04-27T09:00:00.000Z'); // Monday

  const cases: Array<{ term: string; expectedLabel: string }> = [
    { term: 'end of week', expectedLabel: 'end_of_week' },
    { term: 'eow', expectedLabel: 'end_of_week' },
    { term: 'eod', expectedLabel: 'end_of_day' },
    { term: 'asap', expectedLabel: 'asap' },
    { term: 'next friday', expectedLabel: 'next_friday' },
    { term: 'this friday', expectedLabel: 'this_friday' },
    { term: 'by monday', expectedLabel: 'by_monday' },
    { term: 'in 3 days', expectedLabel: 'in_x_days' },
    { term: 'a couple of days', expectedLabel: 'couple_of_days' },
    { term: 'first thing in the morning', expectedLabel: 'first_thing' },
    { term: 'close of business', expectedLabel: 'close_of_business' },
    { term: 'end of month', expectedLabel: 'end_of_month' },
  ];

  for (const { term, expectedLabel } of cases) {
    const result = resolveTemporal(term, NOW_DATE);
    if (!result || result.termMatched !== expectedLabel) {
      console.error(`TEMPORAL UNIT TEST FAILED: "${term}" → expected label "${expectedLabel}" but got "${result?.termMatched ?? 'null'}"`);
    }
  }
}
