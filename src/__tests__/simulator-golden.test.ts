/**
 * Simulator Golden Tests -- Regression Guard
 *
 * 28 pinned cases from the simulator's rule-covered set.
 * All run with USE_LLM_CLASSIFICATION=false (deterministic, no API cost).
 *
 * Purpose: if any case changes action type or drops below expected action count,
 * this test fails, preventing silent regressions.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { interpretTurn } from '@/lib/turnInterpreter';
import type { WaConversationState } from '@/lib/waConversationState';

// Mock conv states (mirrors simulator-prompts.ts)

const FUTURE_EXPIRY = new Date(Date.now() + 3_600_000).toISOString();
const NOW = new Date().toISOString();

const WITH_TASK: WaConversationState = {
  auth_user_id: 'sim-user',
  active_task_id: 'task-sim-1',
  active_list_id: null,
  last_task_title: 'Call the bank',
  last_list_name: null,
  last_entity_text: 'Call the bank',
  pending_confirmation: null,
  updated_at: NOW,
  expires_at: FUTURE_EXPIRY,
};

const WITH_LIST: WaConversationState = {
  auth_user_id: 'sim-user',
  active_task_id: null,
  active_list_id: 'list-sim-1',
  last_task_title: null,
  last_list_name: 'groceries',
  last_entity_text: null,
  pending_confirmation: null,
  updated_at: NOW,
  expires_at: FUTURE_EXPIRY,
};

beforeAll(() => {
  process.env.USE_LLM_CLASSIFICATION = 'false';
});

afterAll(() => {
  delete process.env.USE_LLM_CLASSIFICATION;
});

interface GoldenCase {
  id: number;
  input: string;
  convState?: WaConversationState | null;
  expectedActionType: string;
  expectedMinCount: number;
  description: string;
}

const GOLDEN_CASES: GoldenCase[] = [
  // Simple single task
  { id: 1,  input: 'Call dentist tomorrow at 10am',                                    expectedActionType: 'create_task',         expectedMinCount: 1, description: 'Simple task with date+time'              },
  { id: 2,  input: 'Pay electricity bill',                                              expectedActionType: 'create_task',         expectedMinCount: 1, description: 'Simple task no date'                    },
  { id: 3,  input: 'Pick up dry cleaning on Saturday',                                 expectedActionType: 'create_task',         expectedMinCount: 1, description: 'Task with day-of-week'                   },
  { id: 4,  input: 'Remind me to send invoice by end of week',                         expectedActionType: 'create_task',         expectedMinCount: 1, description: 'remind-me prefix'                        },
  { id: 7,  input: 'Submit tax documents by Friday',                                   expectedActionType: 'create_task',         expectedMinCount: 1, description: 'Task with by-day'                       },

  // Grocery / shopping lists (colon-separated)
  // Rules path: "groceries: milk, eggs" creates a list named "groceries" with items.
  { id: 21, input: 'groceries: milk, eggs, curd, bread',                               expectedActionType: 'create_list',         expectedMinCount: 1, description: 'Colon-separated grocery list'            },
  { id: 22, input: 'shopping: tomatoes, onions, paneer, coriander',                    expectedActionType: 'create_list',         expectedMinCount: 1, description: 'Colon-separated shopping list'           },
  { id: 23, input: 'vegetables: spinach, beans, potato, carrot, capsicum',             expectedActionType: 'create_list',         expectedMinCount: 1, description: 'Colon-separated vegetable list'          },
  { id: 24, input: 'fruits: bananas, apples, grapes, oranges',                         expectedActionType: 'create_list',         expectedMinCount: 1, description: 'Colon-separated fruit list'              },
  { id: 25, input: 'groceries: butter, cheese, yoghurt, cream, olive oil',             expectedActionType: 'create_list',         expectedMinCount: 1, description: 'Grocery list with olive oil'             },
  { id: 28, input: 'household: toilet paper, dish soap, laundry detergent, floor cleaner', expectedActionType: 'create_list',    expectedMinCount: 1, description: 'Household list'                          },

  // Add to explicitly-named list
  { id: 26, input: 'add milk and eggs to groceries',                                   expectedActionType: 'add_list_items',      expectedMinCount: 1, description: 'Add X and Y to list'                    },
  { id: 36, input: 'add curd to the shopping',                                         expectedActionType: 'add_list_items',      expectedMinCount: 1, description: 'Add single item to shopping'             },

  // Create new list
  { id: 29, input: 'create a school snacks list with bananas, cheese, crackers',       expectedActionType: 'create_list',         expectedMinCount: 1, description: 'Create list with seed items'             },
  { id: 30, input: 'Create a packing list for Goa trip with sunscreen, hat, charger, book', expectedActionType: 'create_list',   expectedMinCount: 1, description: 'Create packing list'                    },
  { id: 32, input: 'new list called office supplies: pens, stapler, notebooks, sticky notes', expectedActionType: 'create_list', expectedMinCount: 1, description: 'Create list with "new list called" prefix'  },

  // WA task follow-ups
  { id: 49, input: 'make it Friday',          convState: WITH_TASK, expectedActionType: 'task_follow_up_patch',  expectedMinCount: 1, description: 'Reschedule via make-it-day'                   },
  { id: 50, input: 'move it to tomorrow',     convState: WITH_TASK, expectedActionType: 'task_follow_up_patch',  expectedMinCount: 1, description: 'Reschedule via move-it-to'                    },
  // id=52: "reschedule to Saturday" has no "it" anchor; routes to update_task via edit-select
  { id: 52, input: 'reschedule to Saturday 10am', convState: WITH_TASK, expectedActionType: 'update_task',       expectedMinCount: 1, description: 'Reschedule to Saturday (edit-select path)'    },
  { id: 53, input: 'make it 5pm today',       convState: WITH_TASK, expectedActionType: 'task_follow_up_patch',  expectedMinCount: 1, description: 'Change to same-day time'                      },
  { id: 54, input: 'delete it',               convState: WITH_TASK, expectedActionType: 'task_follow_up_delete', expectedMinCount: 1, description: 'Delete active task via pronoun'               },
  { id: 55, input: 'mark it done',            convState: WITH_TASK, expectedActionType: 'task_follow_up_done',   expectedMinCount: 1, description: 'Mark active task done via pronoun'            },

  // WA list follow-ups
  { id: 57, input: 'add curd too',            convState: WITH_LIST, expectedActionType: 'list_item_follow_up',   expectedMinCount: 1, description: 'List follow-up: add X too'                    },
  { id: 58, input: 'also add paneer',         convState: WITH_LIST, expectedActionType: 'list_item_follow_up',   expectedMinCount: 1, description: 'List follow-up: also add X'                   },
  { id: 62, input: 'add aloo and pyaz',       convState: WITH_LIST, expectedActionType: 'list_item_follow_up',   expectedMinCount: 1, description: 'List follow-up: add X and Y (relaxed gate)'   },

  // Edit / reschedule
  { id: 63, input: 'Move dentist to next Monday',           expectedActionType: 'update_task', expectedMinCount: 1, description: 'Reschedule task by name'             },
  { id: 64, input: 'Reschedule plumber to Friday at 3pm',  expectedActionType: 'update_task', expectedMinCount: 1, description: 'Reschedule with specific time'        },
  { id: 65, input: 'Change the doctor appointment to Wednesday', expectedActionType: 'update_task', expectedMinCount: 1, description: 'Change task via edit-select'   },
  { id: 68, input: 'Rename the dentist task to Dental checkup', expectedActionType: 'update_task', expectedMinCount: 1, description: 'Rename task via edit-select'         },
];

describe('Simulator Golden Regression Suite', () => {
  for (const gc of GOLDEN_CASES) {
    it(`[id=${gc.id}] ${gc.description}: "${gc.input.slice(0, 50)}"`, async () => {
      const result = await interpretTurn(gc.input, gc.convState ?? null);

      const matchingActions = result.detectedActions.filter(a => a.type === gc.expectedActionType);

      expect(
        matchingActions.length,
        `Expected >=${gc.expectedMinCount} action(s) of type "${gc.expectedActionType}" ` +
        `but got [${result.detectedActions.map(a => a.type).join(', ')}]`,
      ).toBeGreaterThanOrEqual(gc.expectedMinCount);
    });
  }
});
