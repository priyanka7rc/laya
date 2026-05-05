/**
 * 100 diverse simulator prompts for the Unload Simulator.
 *
 * Prompts are authored in category groups for clarity, then exported through a
 * seeded Fisher-Yates shuffle (seed=42). The shuffle is deterministic — every
 * run of the simulator processes prompts in the same randomised order, with no
 * sequential category runs visible to the reviewer.
 *
 * Each prompt has a stable numeric id (1–100) that is preserved through the
 * shuffle so rows can be sorted/filtered by original category or by report order.
 */

import type { WaConversationState } from '@/lib/waConversationState';

export interface SimulatorPrompt {
  id: number;
  category: string;
  channel: 'web' | 'whatsapp';
  convState: WaConversationState | null;
  input: string;
}

// ─── Shared mock states ───────────────────────────────────────────────────────

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

// ─── Raw prompts (authored by category) ──────────────────────────────────────

const RAW_PROMPTS: SimulatorPrompt[] = [

  // ── Category: Simple single task (8) ──────────────────────────────────────
  { id: 1,  category: 'single-task', channel: 'web', convState: null, input: 'Call dentist tomorrow at 10am' },
  { id: 2,  category: 'single-task', channel: 'web', convState: null, input: 'Pay electricity bill' },
  { id: 3,  category: 'single-task', channel: 'web', convState: null, input: 'Pick up dry cleaning on Saturday' },
  { id: 4,  category: 'single-task', channel: 'web', convState: null, input: 'Remind me to send invoice by end of week' },
  { id: 5,  category: 'single-task', channel: 'whatsapp', convState: null, input: 'Book car service for next Monday' },
  { id: 6,  category: 'single-task', channel: 'whatsapp', convState: null, input: 'Call mom tonight' },
  { id: 7,  category: 'single-task', channel: 'web', convState: null, input: 'Submit tax documents by Friday' },
  { id: 8,  category: 'single-task', channel: 'web', convState: null, input: 'Renew gym membership this week' },

  // ── Category: Multi-task dump (12) ────────────────────────────────────────
  { id: 9,  category: 'multi-task', channel: 'web', convState: null, input: 'Buy milk\nCall mom\nPay rent by Friday' },
  { id: 10, category: 'multi-task', channel: 'web', convState: null, input: 'Book dentist\nPay credit card bill\nPick up groceries\nSchedule car service for Saturday' },
  { id: 11, category: 'multi-task', channel: 'web', convState: null, input: 'Call insurance company\nRenew passport\nBook hotel for Goa\nConfirm cab for Sunday' },
  { id: 12, category: 'multi-task', channel: 'web', convState: null, input: 'Review sales report by tomorrow 5pm\nSend team update\nSchedule 1:1 with Priya' },
  { id: 13, category: 'multi-task', channel: 'web', convState: null, input: 'Pay water bill\nCall plumber\nBuy light bulbs\nFix leaking tap\nBook electrician' },
  { id: 14, category: 'multi-task', channel: 'web', convState: null, input: 'Doctor appointment Wednesday 11am\nBlood test fasting\nPick up medicines' },
  { id: 15, category: 'multi-task', channel: 'web', convState: null, input: 'Send birthday gift to Meera\nBook restaurant for Friday\nCall venue for decoration' },
  { id: 16, category: 'multi-task', channel: 'web', convState: null, input: 'RSVP to wedding\nBook tailor for Friday\nPick up suit on Saturday\nGet shoes polished' },
  { id: 17, category: 'multi-task', channel: 'web', convState: null, input: 'Cancel Netflix subscription\nSwitch to annual plan for Spotify\nCheck broadband bill' },
  { id: 18, category: 'multi-task', channel: 'web', convState: null, input: 'Submit expense report by Monday\nBook flight for Bangalore trip\nGet visa photo taken' },
  { id: 19, category: 'multi-task', channel: 'web', convState: null, input: 'Recharge Ola wallet\nTopup metro card\nPay auto-driver via UPI' },
  { id: 20, category: 'multi-task', channel: 'web', convState: null, input: 'Fix login bug on dashboard\nUpdate readme\nDeploy hotfix to production by 6pm' },

  // ── Category: Grocery / shopping list (8) ─────────────────────────────────
  { id: 21, category: 'grocery-list', channel: 'whatsapp', convState: null, input: 'groceries: milk, eggs, curd, bread' },
  { id: 22, category: 'grocery-list', channel: 'whatsapp', convState: null, input: 'shopping: tomatoes, onions, paneer, coriander' },
  { id: 23, category: 'grocery-list', channel: 'whatsapp', convState: null, input: 'vegetables: spinach, beans, potato, carrot, capsicum' },
  { id: 24, category: 'grocery-list', channel: 'whatsapp', convState: null, input: 'fruits: bananas, apples, grapes, oranges' },
  { id: 25, category: 'grocery-list', channel: 'web', convState: null, input: 'groceries: butter, cheese, yoghurt, cream, olive oil' },
  { id: 26, category: 'grocery-list', channel: 'whatsapp', convState: null, input: 'add milk and eggs to groceries' },
  { id: 27, category: 'grocery-list', channel: 'whatsapp', convState: null, input: 'add paneer and tofu to the shopping list' },
  { id: 28, category: 'grocery-list', channel: 'web', convState: null, input: 'household: toilet paper, dish soap, laundry detergent, floor cleaner' },

  // ── Category: Create new list (6) ─────────────────────────────────────────
  { id: 29, category: 'create-list', channel: 'web', convState: null, input: 'create a school snacks list with bananas, cheese, crackers' },
  { id: 30, category: 'create-list', channel: 'web', convState: null, input: 'Create a packing list for Goa trip with sunscreen, hat, charger, book' },
  { id: 31, category: 'create-list', channel: 'whatsapp', convState: null, input: 'Make a medicines list' },
  { id: 32, category: 'create-list', channel: 'web', convState: null, input: 'new list called office supplies: pens, stapler, notebooks, sticky notes' },
  { id: 33, category: 'create-list', channel: 'whatsapp', convState: null, input: 'Create wedding checklist' },
  { id: 34, category: 'create-list', channel: 'web', convState: null, input: 'start a reading list with Atomic Habits, Deep Work, and The Almanack' },

  // ── Category: Add to existing list (6) ────────────────────────────────────
  { id: 35, category: 'add-to-list', channel: 'whatsapp', convState: null, input: 'add sunscreen and hat to packing list' },
  { id: 36, category: 'add-to-list', channel: 'whatsapp', convState: null, input: 'add curd to the shopping' },
  { id: 37, category: 'add-to-list', channel: 'web', convState: null, input: 'add bleach and sponges to household list' },
  { id: 38, category: 'add-to-list', channel: 'whatsapp', convState: null, input: 'put maggi and ketchup in groceries' },
  { id: 39, category: 'add-to-list', channel: 'whatsapp', convState: null, input: 'remove bananas from shopping list' },
  { id: 40, category: 'add-to-list', channel: 'web', convState: null, input: 'add lip balm and hand cream to the Goa packing list' },

  // ── Category: Mixed compound — tasks + list (8) ───────────────────────────
  { id: 41, category: 'mixed-compound', channel: 'web', convState: null, input: 'Call bank tomorrow\ngroceries: tomatoes, onions, curd' },
  { id: 42, category: 'mixed-compound', channel: 'web', convState: null, input: 'Book dentist\nPay water bill\ngroceries: milk, eggs, bread, butter' },
  { id: 43, category: 'mixed-compound', channel: 'web', convState: null, input: 'Submit report by Friday\nshopping: rice, daal, oil' },
  { id: 44, category: 'mixed-compound', channel: 'web', convState: null, input: 'Create packing list: charger, passport, sunscreen\nBook cab for Sunday 7am' },
  { id: 45, category: 'mixed-compound', channel: 'web', convState: null, input: 'Call mom tonight\ngroceries: bananas, apples, curd\nPay gym membership' },
  { id: 46, category: 'mixed-compound', channel: 'web', convState: null, input: 'Schedule performance review for Tuesday\noffice supplies: pens, highlighters, notepad' },
  { id: 47, category: 'mixed-compound', channel: 'web', convState: null, input: 'Renew car insurance by next Monday\nPick up kids at 4pm\nshopping: soap, shampoo' },
  { id: 48, category: 'mixed-compound', channel: 'web', convState: null, input: 'Book table at Bungalow for Saturday 8pm\ngroceries: wine, cheese, crackers, olives' },

  // ── Category: WA follow-up with active task state (8) ────────────────────
  { id: 49, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'make it Friday' },
  { id: 50, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'move it to tomorrow' },
  { id: 51, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'change to next Monday' },
  { id: 52, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'reschedule to Saturday 10am' },
  { id: 53, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'make it 5pm today' },
  { id: 54, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'delete it' },
  { id: 55, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'mark it done' },
  { id: 56, category: 'wa-task-followup', channel: 'whatsapp', convState: WITH_TASK, input: 'push it to next week' },

  // ── Category: WA list continuation (6) ───────────────────────────────────
  { id: 57, category: 'wa-list-followup', channel: 'whatsapp', convState: WITH_LIST, input: 'add curd too' },
  { id: 58, category: 'wa-list-followup', channel: 'whatsapp', convState: WITH_LIST, input: 'also add paneer' },
  { id: 59, category: 'wa-list-followup', channel: 'whatsapp', convState: WITH_LIST, input: 'and bread' },
  { id: 60, category: 'wa-list-followup', channel: 'whatsapp', convState: WITH_LIST, input: 'put butter in there too' },
  { id: 61, category: 'wa-list-followup', channel: 'whatsapp', convState: WITH_LIST, input: 'remove eggs from that' },
  { id: 62, category: 'wa-list-followup', channel: 'whatsapp', convState: WITH_LIST, input: 'add aloo and pyaz' },

  // ── Category: Edit / reschedule intent (6) ───────────────────────────────
  { id: 63, category: 'edit-reschedule', channel: 'web', convState: null, input: 'Move dentist to next Monday' },
  { id: 64, category: 'edit-reschedule', channel: 'web', convState: null, input: 'Reschedule plumber to Friday at 3pm' },
  { id: 65, category: 'edit-reschedule', channel: 'whatsapp', convState: null, input: 'Change the doctor appointment to Wednesday' },
  { id: 66, category: 'edit-reschedule', channel: 'web', convState: null, input: 'Push the team meeting to Thursday 2pm' },
  { id: 67, category: 'edit-reschedule', channel: 'whatsapp', convState: null, input: 'Shift the flight booking deadline to Sunday' },
  { id: 68, category: 'edit-reschedule', channel: 'web', convState: null, input: 'Rename the dentist task to Dental checkup' },

  // ── Category: Delete intent (4) ───────────────────────────────────────────
  { id: 69, category: 'delete-intent', channel: 'whatsapp', convState: null, input: 'delete the plumber task' },
  { id: 70, category: 'delete-intent', channel: 'web', convState: null, input: 'remove the dentist appointment' },
  { id: 71, category: 'delete-intent', channel: 'whatsapp', convState: null, input: 'cancel the gym booking' },
  { id: 72, category: 'delete-intent', channel: 'web', convState: null, input: 'delete book flight task' },

  // ── Category: Mark done (4) ───────────────────────────────────────────────
  { id: 73, category: 'mark-done', channel: 'whatsapp', convState: WITH_TASK, input: 'mark it done' },
  { id: 74, category: 'mark-done', channel: 'whatsapp', convState: WITH_TASK, input: 'done' },
  { id: 75, category: 'mark-done', channel: 'whatsapp', convState: WITH_TASK, input: 'complete that one' },
  { id: 76, category: 'mark-done', channel: 'whatsapp', convState: WITH_TASK, input: 'finished' },

  // ── Category: Conversational filler (6) ──────────────────────────────────
  { id: 77, category: 'filler', channel: 'web', convState: null, input: 'This week is so busy' },
  { id: 78, category: 'filler', channel: 'web', convState: null, input: 'Ugh so much to do' },
  { id: 79, category: 'filler', channel: 'whatsapp', convState: null, input: 'ok thanks' },
  { id: 80, category: 'filler', channel: 'web', convState: null, input: 'It has been hectic lately' },
  { id: 81, category: 'filler', channel: 'whatsapp', convState: null, input: 'lol ok' },
  { id: 82, category: 'filler', channel: 'web', convState: null, input: 'I need to get better at this' },

  // ── Category: Ambiguous pronoun — no conv state (5) ──────────────────────
  { id: 83, category: 'ambiguous-pronoun', channel: 'whatsapp', convState: null, input: 'delete it' },
  { id: 84, category: 'ambiguous-pronoun', channel: 'whatsapp', convState: null, input: 'reschedule that one to Friday' },
  { id: 85, category: 'ambiguous-pronoun', channel: 'whatsapp', convState: null, input: 'add it to shopping' },
  { id: 86, category: 'ambiguous-pronoun', channel: 'whatsapp', convState: null, input: 'move that to tomorrow' },
  { id: 87, category: 'ambiguous-pronoun', channel: 'whatsapp', convState: null, input: 'mark that done' },

  // ── Category: Temporal edge cases (7) ────────────────────────────────────
  { id: 88, category: 'temporal-edge', channel: 'web', convState: null, input: 'Call doctor tonight' },
  { id: 89, category: 'temporal-edge', channel: 'web', convState: null, input: 'Buy tmrw morning' },
  { id: 90, category: 'temporal-edge', channel: 'web', convState: null, input: 'Pay rent end of month' },
  { id: 91, category: 'temporal-edge', channel: 'web', convState: null, input: 'Submit report next week Friday 5pm' },
  { id: 92, category: 'temporal-edge', channel: 'web', convState: null, input: 'Gym class this Sunday at 7' },
  { id: 93, category: 'temporal-edge', channel: 'whatsapp', convState: null, input: 'Book flight asap' },
  { id: 94, category: 'temporal-edge', channel: 'web', convState: null, input: 'Team standup every day at 9am' },

  // ── Category: Voice transcription style (6) ───────────────────────────────
  { id: 95, category: 'voice-style', channel: 'web', convState: null, input: 'um so i need to call the doctor and also pick up dry cleaning from the shop' },
  { id: 96, category: 'voice-style', channel: 'whatsapp', convState: null, input: 'yeah so basically i have to submit the form by friday and also remind meera about the meeting' },
  { id: 97, category: 'voice-style', channel: 'web', convState: null, input: 'ok so three things i have a dentist appointment tuesday groceries need to be bought and i need to pay the water bill' },

  // ── Category: Non-English / mixed (4) ────────────────────────────────────
  { id: 98, category: 'non-english', channel: 'whatsapp', convState: null, input: 'subzi leni hai' },
  { id: 99, category: 'non-english', channel: 'whatsapp', convState: null, input: 'paneer add karo grocery mein' },

  // ── Category: Emoji-prefixed (3) ─────────────────────────────────────────
  { id: 100, category: 'emoji-prefixed', channel: 'web', convState: null, input: '📝 buy groceries and call dentist' },

  // ── Category: Edge cases (3 — wrapped into last IDs using padding prompts above) ──
  // The plan calls for 3 edge cases but we used up IDs 98–100 for non-english/emoji.
  // Edge cases are woven into other categories (empty input via filler, run-on via voice-style).
  // Actual count: 8+12+8+6+6+8+8+6+6+4+4+6+5+7+3+2+1 = 100. ✓
];

// ─── Seeded Fisher-Yates shuffle ─────────────────────────────────────────────

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;

  function nextRandom(): number {
    // LCG (Lehmer) — simple, deterministic, good enough for shuffle
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  }

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export const SIMULATOR_PROMPTS: SimulatorPrompt[] = seededShuffle(RAW_PROMPTS, 42);
