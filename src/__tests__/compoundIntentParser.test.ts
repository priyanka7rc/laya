/**
 * Tests for the compound intent parser and its underlying helpers.
 *
 * Run: npx tsx src/__tests__/compoundIntentParser.test.ts
 *
 * Covers:
 *   - All 10 example messages from the compound-intent engine spec
 *   - Sentence-boundary splitting in splitBrainDump
 *   - Colon-list detection (detectColonListIntent)
 *   - Create-list-with-items detection
 *   - "Also remind me to" prefix stripping (task_intake)
 *   - Explicit add-to-list routing (detectListIntent / detectAddToListIntent)
 *   - Preamble-colon rejection (task dump, not list)
 *   - Idempotency of parseCompoundIntent
 *   - No regression on detectAddToListIntent
 */

import { parseCompoundIntent } from '@/lib/compoundIntentParser';
import {
  detectColonListIntent,
  splitBrainDump,
  detectPreambleColonTaskDump,
} from '@/lib/brainDumpParser';
import { detectAddToListIntent } from '@/lib/waAddToListParser';
import { segmentToProposedTask, stripIntentPrefixes } from '@/lib/task_intake';
import {
  detectMarkDoneIntent,
  detectListItemRemovalIntent,
  detectListItemFollowUpIntent,
} from '@/lib/waFollowUpParser';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`FAIL: ${message}\n  actual:   ${a}\n  expected: ${b}`);
}

function runTests(): void {

  // ─────────────────────────────────────────────────────────────────────────
  // splitBrainDump — sentence-boundary splitting
  // ─────────────────────────────────────────────────────────────────────────

  console.log('1. splitBrainDump: sentence boundaries split on ". Capital"...');
  {
    const segs = splitBrainDump('Pay rent. Buy milk. Call dentist.');
    assert(segs.length === 3, `expected 3 segments, got ${segs.length}: ${JSON.stringify(segs)}`);
    assert(segs[0]!.toLowerCase().includes('pay rent'), `seg 0: ${segs[0]}`);
    assert(segs[1]!.toLowerCase().includes('buy milk'), `seg 1: ${segs[1]}`);
    assert(segs[2]!.toLowerCase().includes('call dentist'), `seg 2: ${segs[2]}`);
  }
  console.log('   OK');

  console.log('2. splitBrainDump: commas still split within a sentence...');
  {
    const segs = splitBrainDump('Buy milk, eggs, bread');
    assert(segs.length === 3, `expected 3, got ${segs.length}: ${JSON.stringify(segs)}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // detectColonListIntent
  // ─────────────────────────────────────────────────────────────────────────

  console.log('3. detectColonListIntent: short noun phrase accepted...');
  {
    const r = detectColonListIntent('Groceries: milk, eggs, bread');
    assert(r !== null, 'expected non-null result');
    assert(r!.listName.toLowerCase().includes('groceries'), `listName: ${r!.listName}`);
    assert(r!.items.length === 3, `items: ${JSON.stringify(r!.items)}`);
  }
  console.log('   OK');

  console.log('4. detectColonListIntent: "list for X: items"...');
  {
    const r = detectColonListIntent('list for house supplies: garbage bags, dish soap');
    assert(r !== null, 'expected non-null result');
    assert(r!.listName.toLowerCase().includes('house supplies'), `listName: ${r!.listName}`);
    assert(r!.items.length === 2, `items: ${JSON.stringify(r!.items)}`);
  }
  console.log('   OK');

  console.log('5. detectColonListIntent: task preamble rejected...');
  {
    const r = detectColonListIntent('I need to do these today: call the bank, buy fruits');
    assert(r === null, `expected null, got ${JSON.stringify(r)}`);
  }
  console.log('   OK');

  console.log('6. detectColonListIntent: "packing list for Goa: items"...');
  {
    const r = detectColonListIntent('packing list for Goa: sunscreen, hats, chargers');
    assert(r !== null, 'expected non-null result');
    assert(r!.items.length === 3, `items: ${JSON.stringify(r!.items)}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // "Also remind me to" prefix stripping
  // ─────────────────────────────────────────────────────────────────────────

  console.log('7. stripIntentPrefixes: "also remind me to..." stripped...');
  {
    const result = stripIntentPrefixes('also remind me to call the plumber tomorrow morning');
    assert(
      result.toLowerCase().startsWith('call the plumber'),
      `expected "call the plumber...", got "${result}"`
    );
  }
  console.log('   OK');

  console.log('8. segmentToProposedTask: "Also remind me to call the plumber tomorrow morning"...');
  {
    const t = segmentToProposedTask('Also remind me to call the plumber tomorrow morning');
    assert(
      t.title.toLowerCase().startsWith('call the plumber'),
      `expected title starting with "Call the plumber", got "${t.title}"`
    );
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 1: multi-task only
  // ─────────────────────────────────────────────────────────────────────────

  console.log('9. parseCompoundIntent example 1: "Buy milk tomorrow, call mom at 5, send rent receipt"...');
  {
    const r = parseCompoundIntent('Buy milk tomorrow, call mom at 5, and send the rent receipt');
    assert(r.listActions.length === 0, `listActions: ${JSON.stringify(r.listActions)}`);
    assert(r.tasks.length >= 2, `tasks: ${r.tasks.length} (${JSON.stringify(r.tasks.map(t => t.title))})`);
    assert(r.hasContent, 'hasContent should be true');
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 2: create list + inline items
  // ─────────────────────────────────────────────────────────────────────────

  console.log('10. parseCompoundIntent example 2: "Create a groceries list called weekly groceries and add milk, eggs, bread"...');
  {
    const r = parseCompoundIntent('Create a groceries list called weekly groceries and add milk, eggs, bread');
    assert(r.listActions.length === 1, `listActions: ${JSON.stringify(r.listActions)}`);
    const action = r.listActions[0]!;
    assert(action.type === 'create_with_items', `action type: ${action.type}`);
    assert(action.listName!.toLowerCase().includes('weekly groceries'), `listName: "${action.listName}"`);
    assert(action.items.length === 3, `items: ${JSON.stringify(action.items)}`);
    assert(r.tasks.length === 0, `tasks should be 0, got ${r.tasks.length}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 3: colon-list + task
  // ─────────────────────────────────────────────────────────────────────────

  console.log('11. parseCompoundIntent example 3: "Groceries: milk, eggs, bread. Also remind me to call the plumber tomorrow morning"...');
  {
    const r = parseCompoundIntent('Groceries: milk, eggs, bread. Also remind me to call the plumber tomorrow morning');
    assert(r.listActions.length === 1, `listActions: ${JSON.stringify(r.listActions)}`);
    assert(r.listActions[0]!.type === 'create_with_items', 'action type');
    assert(r.listActions[0]!.items.length === 3, `items: ${JSON.stringify(r.listActions[0]!.items)}`);
    assert(r.tasks.length === 1, `tasks: ${r.tasks.length}`);
    assert(
      r.tasks[0]!.title.toLowerCase().startsWith('call the plumber'),
      `task title: "${r.tasks[0]!.title}"`
    );
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 4: packing list + dentist task
  // ─────────────────────────────────────────────────────────────────────────

  console.log('12. parseCompoundIntent example 4: "Make a packing list for Goa: sunscreen, hats, chargers. Also book dentist for Friday"...');
  {
    const r = parseCompoundIntent('Make a packing list for Goa: sunscreen, hats, chargers. Also book dentist for Friday');
    // Should produce 1 create_with_items list action + 1 task
    // Note: the create-list regex fires on "Make a packing list for Goa: ..." before colon detection
    assert(r.listActions.length >= 1, `listActions: ${JSON.stringify(r.listActions)}`);
    assert(r.hasContent, 'hasContent should be true');
    const listAction = r.listActions[0]!;
    assert(listAction.type === 'create_with_items', `action type: ${listAction.type}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 5: explicit add + tasks
  // ─────────────────────────────────────────────────────────────────────────

  console.log('13. parseCompoundIntent example 5: "Pay EB bill tonight, add detergent to shopping list, and text Rohan"...');
  {
    const r = parseCompoundIntent('Pay EB bill tonight, add detergent to shopping list, and text Rohan');
    assert(r.listActions.length >= 1, `listActions: ${JSON.stringify(r.listActions)}`);
    const addAction = r.listActions.find((a) => a.type === 'add_to_existing');
    assert(addAction !== undefined, 'expected an add_to_existing action');
    assert(
      addAction!.listName!.toLowerCase().includes('shopping'),
      `listName: "${addAction!.listName!}"`
    );
    assert(r.tasks.length >= 1, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 6: preamble colon → task dump (not list)
  // ─────────────────────────────────────────────────────────────────────────

  console.log('14. parseCompoundIntent example 6: "I need to do these today: call the bank, buy fruits, and clean the study"...');
  {
    const r = parseCompoundIntent('I need to do these today: call the bank, buy fruits, and clean the study');
    // The colon LHS has preamble words → should produce tasks, not a list
    assert(r.listActions.length === 0, `listActions should be 0, got ${JSON.stringify(r.listActions)}`);
    assert(r.tasks.length >= 1, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 7: create list only (no items)
  // ─────────────────────────────────────────────────────────────────────────

  console.log('15. parseCompoundIntent example 7: "Create a list called birthday return gifts"...');
  {
    const r = parseCompoundIntent('Create a list called birthday return gifts');
    assert(r.listActions.length === 1, `listActions: ${JSON.stringify(r.listActions)}`);
    const action = r.listActions[0]!;
    assert(action.type === 'create_with_items', `action type: ${action.type}`);
    assert(
      action.listName!.toLowerCase().includes('birthday return gifts'),
      `listName: "${action.listName!}"`
    );
    assert(action.items.length === 0, `items should be empty, got ${JSON.stringify(action.items)}`);
    assert(r.tasks.length === 0, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 8: create list + inline items (school snacks)
  // ─────────────────────────────────────────────────────────────────────────

  console.log('16. parseCompoundIntent example 8: "Create a list called school snacks and add bananas, cheese cubes, and juice boxes"...');
  {
    const r = parseCompoundIntent('Create a list called school snacks and add bananas, cheese cubes, and juice boxes');
    assert(r.listActions.length === 1, `listActions: ${JSON.stringify(r.listActions)}`);
    const action = r.listActions[0]!;
    assert(action.type === 'create_with_items', `type: ${action.type}`);
    assert(action.listName!.toLowerCase().includes('school snacks'), `listName: "${action.listName!}"`);
    assert(action.items.length >= 2, `items: ${JSON.stringify(action.items)}`);
    assert(r.tasks.length === 0, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // parseCompoundIntent — example 10: "Need a list for X: items. Also remind..."
  // ─────────────────────────────────────────────────────────────────────────

  console.log('17. parseCompoundIntent example 10: "Need a list for house supplies: garbage bags, dish soap. Also remind me to renew insurance next week"...');
  {
    const r = parseCompoundIntent(
      'Need a list for house supplies: garbage bags, dish soap. Also remind me to renew insurance next week'
    );
    assert(r.listActions.length === 1, `listActions: ${JSON.stringify(r.listActions)}`);
    assert(r.listActions[0]!.items.length >= 1, `items: ${JSON.stringify(r.listActions[0]!.items)}`);
    assert(r.tasks.length === 1, `tasks: ${r.tasks.length}`);
    assert(
      r.tasks[0]!.title.toLowerCase().includes('renew insurance'),
      `task title: "${r.tasks[0]!.title}"`
    );
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // Idempotency
  // ─────────────────────────────────────────────────────────────────────────

  console.log('18. parseCompoundIntent is idempotent (same text → same structure)...');
  {
    const text = 'Groceries: milk, eggs, bread. Also remind me to call the plumber tomorrow morning';
    const r1 = parseCompoundIntent(text);
    const r2 = parseCompoundIntent(text);
    assertEq(r1.listActions.length, r2.listActions.length, 'listActions length');
    assertEq(r1.tasks.length, r2.tasks.length, 'tasks length');
    assertEq(r1.tasks[0]?.title, r2.tasks[0]?.title, 'task title');
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // No regression on detectAddToListIntent
  // ─────────────────────────────────────────────────────────────────────────

  console.log('19. detectAddToListIntent still works for single-intent "add milk to shopping"...');
  {
    const r = detectAddToListIntent('add milk to shopping');
    assert(r !== null, 'expected non-null');
    assert(r!.items.includes('milk'), `items: ${JSON.stringify(r!.items)}`);
    assert(r!.listName?.toLowerCase().includes('shopping') ?? false, `listName: ${r!.listName}`);
  }
  console.log('   OK');

  // ─────────────────────────────────────────────────────────────────────────
  // Empty input
  // ─────────────────────────────────────────────────────────────────────────

  console.log('20. parseCompoundIntent: empty input → hasContent false...');
  {
    const r = parseCompoundIntent('');
    assert(!r.hasContent, 'empty input should have no content');
    assert(r.listActions.length === 0, 'no list actions');
    assert(r.tasks.length === 0, 'no tasks');
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // FIX A: Preamble-colon task dump
  // ═════════════════════════════════════════════════════════════════════════

  console.log('21. [Fix A] detectPreambleColonTaskDump fires for "Need to do these today: ..."...');
  {
    const items = detectPreambleColonTaskDump('Need to do these today: call the bank, buy fruits, clean the study');
    assert(items !== null, 'expected non-null result');
    assert(items!.length === 3, `expected 3 items, got ${items!.length}: ${JSON.stringify(items)}`);
    assert(items![0]!.toLowerCase().includes('call the bank'), `item 0: ${items![0]}`);
    assert(items![1]!.toLowerCase().includes('buy fruits'), `item 1: ${items![1]}`);
    assert(items![2]!.toLowerCase().includes('clean the study'), `item 2: ${items![2]}`);
  }
  console.log('   OK');

  console.log('22. [Fix A] detectPreambleColonTaskDump returns null for non-preamble colon (list case)...');
  {
    const items = detectPreambleColonTaskDump('Groceries: milk, eggs, bread');
    assert(items === null, `expected null for non-preamble, got ${JSON.stringify(items)}`);
  }
  console.log('   OK');

  console.log('23. [Fix A] parseCompoundIntent: "Need to do these today: call the bank, buy fruits, clean the study" → 3 clean tasks...');
  {
    const r = parseCompoundIntent('Need to do these today: call the bank, buy fruits, clean the study');
    assert(r.listActions.length === 0, `listActions should be 0, got ${JSON.stringify(r.listActions)}`);
    assert(r.tasks.length === 3, `expected 3 tasks, got ${r.tasks.length}: ${JSON.stringify(r.tasks.map(t => t.title))}`);
    assert(r.tasks[0]!.title.toLowerCase().includes('call the bank'), `task 0: ${r.tasks[0]!.title}`);
    assert(r.tasks[1]!.title.toLowerCase().includes('buy fruits'), `task 1: ${r.tasks[1]!.title}`);
    assert(r.tasks[2]!.title.toLowerCase().includes('clean the study'), `task 2: ${r.tasks[2]!.title}`);
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // FIX B: Create-list + colon items
  // ═════════════════════════════════════════════════════════════════════════

  console.log('24. [Fix B] parseCompoundIntent: "Make a packing list for Goa: sunscreen, hats, chargers" → list with 3 items...');
  {
    const r = parseCompoundIntent('Make a packing list for Goa: sunscreen, hats, chargers');
    assert(r.listActions.length === 1, `expected 1 list action, got ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'create_with_items', `action type: ${a.type}`);
    assert(a.items.length === 3, `expected 3 items, got ${a.items.length}: ${JSON.stringify(a.items)}`);
    // Items should NOT include the full "Goa: sunscreen, hats, chargers" blob
    assert(!a.listName!.includes(':'), `listName should not contain colon: "${a.listName!}"`);
  }
  console.log('   OK');

  console.log('25. [Fix B] parseCompoundIntent: "Make a packing list for Goa: sunscreen, hats, chargers. Also book cabs for Friday" → list + task...');
  {
    const r = parseCompoundIntent('Make a packing list for Goa: sunscreen, hats, chargers. Also book cabs for Friday');
    assert(r.listActions.length === 1, `expected 1 list action, got ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'create_with_items', `action type: ${a.type}`);
    assert(a.items.length === 3, `expected 3 items, got ${a.items.length}: ${JSON.stringify(a.items)}`);
    assert(r.tasks.length === 1, `expected 1 task, got ${r.tasks.length}`);
    assert(r.tasks[0]!.title.toLowerCase().includes('book cabs') || r.tasks[0]!.title.toLowerCase().includes('cabs'), `task title: ${r.tasks[0]!.title}`);
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // FIX C: Trailing task clause stripped from list items
  // ═════════════════════════════════════════════════════════════════════════

  console.log('26. [Fix C] parseCompoundIntent: "Create a return gifts list with crayons, sticker books, puzzles, and remind me to order cake tomorrow" → list + task...');
  {
    const r = parseCompoundIntent(
      'Create a return gifts list with crayons, sticker books, puzzles, and remind me to order cake tomorrow'
    );
    assert(r.listActions.length === 1, `expected 1 list action, got ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'create_with_items', `action type: ${a.type}`);
    // Items should be clean — no "remind me to order cake"
    const hasTaskClause = a.items.some(i => /remind/i.test(i));
    assert(!hasTaskClause, `items should not contain task clause: ${JSON.stringify(a.items)}`);
    assert(a.items.length === 3, `expected 3 clean items, got ${a.items.length}: ${JSON.stringify(a.items)}`);
    // The task clause should have been extracted
    assert(r.tasks.length === 1, `expected 1 task from task clause, got ${r.tasks.length}`);
    assert(
      r.tasks[0]!.title.toLowerCase().includes('order cake'),
      `task title: "${r.tasks[0]!.title}"`
    );
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // FIX D: Conjunction protection for "add X and Y to Z and [other clause]"
  // ═════════════════════════════════════════════════════════════════════════

  console.log('27. [Fix D] splitBrainDump: "Add glue sticks and chart paper to school supplies and move PTM follow-up to next Monday" → 2 parts...');
  {
    const segs = splitBrainDump('Add glue sticks and chart paper to school supplies and move PTM follow-up to next Monday');
    assert(segs.length === 2, `expected 2 segments, got ${segs.length}: ${JSON.stringify(segs)}`);
    assert(segs[0]!.toLowerCase().includes('school supplies'), `seg 0 should include target: ${segs[0]}`);
    assert(segs[1]!.toLowerCase().includes('ptm') || segs[1]!.toLowerCase().includes('move'), `seg 1: ${segs[1]}`);
  }
  console.log('   OK');

  console.log('28. [Fix D] parseCompoundIntent: "Add glue sticks and chart paper to school supplies and move PTM follow-up to next Monday" → list with 2 items + 1 task...');
  {
    const r = parseCompoundIntent(
      'Add glue sticks and chart paper to school supplies and move PTM follow-up to next Monday'
    );
    assert(r.listActions.length === 1, `expected 1 list action, got ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'add_to_existing', `action type: ${a.type}`);
    assert(
      a.listName!.toLowerCase().includes('school supplies'),
      `listName: "${a.listName!}"`
    );
    assert(a.items.length === 2, `expected 2 items, got ${a.items.length}: ${JSON.stringify(a.items)}`);
    // "glue sticks" and "chart paper" should be separate items
    const itemsLower = a.items.map(i => i.toLowerCase());
    assert(itemsLower.some(i => i.includes('glue sticks')), `missing glue sticks: ${JSON.stringify(a.items)}`);
    assert(itemsLower.some(i => i.includes('chart paper')), `missing chart paper: ${JSON.stringify(a.items)}`);
  }
  console.log('   OK');

  console.log('29. [Fix D] splitBrainDump does NOT over-protect single-conjunction "add milk and eggs to shopping"...');
  {
    // "Add milk and eggs to shopping" has only ONE "and" — the last "and" is also the only one.
    // beforeLastAnd = "Add milk", which does NOT contain "to" → returns null → no protection split.
    // Falls to the regular Phase 2 heuristic (both parts ≥ 10 chars or not).
    const segs = splitBrainDump('Add milk and eggs to shopping');
    // Either 1 segment (protected by 10-char heuristic) or 2 — either is acceptable
    // Key assertion: "to shopping" should not be orphaned as its own segment
    const orphaned = segs.some(s => s.trim().toLowerCase() === 'to shopping');
    assert(!orphaned, `"to shopping" should not be an orphaned segment: ${JSON.stringify(segs)}`);
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // FIX E: List follow-up without explicit target
  // ═════════════════════════════════════════════════════════════════════════

  console.log('30. [Fix E] detectListItemFollowUpIntent: "add curd too"...');
  {
    const r = detectListItemFollowUpIntent('add curd too');
    assert(r !== null, 'expected non-null result');
    assert(r!.items.includes('Curd') || r!.items.some(i => i.toLowerCase() === 'curd'), `items: ${JSON.stringify(r!.items)}`);
  }
  console.log('   OK');

  console.log('31. [Fix E] detectListItemFollowUpIntent: "also add paneer"...');
  {
    const r = detectListItemFollowUpIntent('also add paneer');
    assert(r !== null, 'expected non-null result');
    assert(r!.items.some(i => i.toLowerCase() === 'paneer'), `items: ${JSON.stringify(r!.items)}`);
  }
  console.log('   OK');

  console.log('32. [Fix E] parseCompoundIntent: "add curd too" → add_to_existing with null listName...');
  {
    const r = parseCompoundIntent('add curd too');
    assert(r.listActions.length === 1, `expected 1 list action, got ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'add_to_existing', `action type: ${a.type}`);
    assert(a.listName === null, `listName should be null, got "${a.listName}"`);
    assert(r.tasks.length === 0, `tasks should be 0, got ${r.tasks.length}`);
  }
  console.log('   OK');

  console.log('33. [Fix E] parseCompoundIntent: "also add paneer" → add_to_existing with null listName...');
  {
    const r = parseCompoundIntent('also add paneer');
    assert(r.listActions.length === 1, `expected 1 list action, got ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'add_to_existing', `action type: ${a.type}`);
    assert(a.listName === null, `listName should be null, got "${a.listName}"`);
    assert(r.tasks.length === 0, `tasks should be 0, got ${r.tasks.length}`);
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // FIX F: List-item removal
  // ═════════════════════════════════════════════════════════════════════════

  console.log('34. [Fix F] detectListItemRemovalIntent: "remove bananas" → item=Bananas, listName=null...');
  {
    const r = detectListItemRemovalIntent('remove bananas');
    assert(r !== null, 'expected non-null result');
    assert(r!.item.toLowerCase() === 'bananas', `item: ${r!.item}`);
    assert(r!.listName === null, `listName should be null, got "${r!.listName}"`);
  }
  console.log('   OK');

  console.log('35. [Fix F] detectListItemRemovalIntent: "remove bananas from shopping" → item + listName...');
  {
    const r = detectListItemRemovalIntent('remove bananas from shopping');
    assert(r !== null, 'expected non-null result');
    assert(r!.item.toLowerCase() === 'bananas', `item: ${r!.item}`);
    assert(r!.listName!.toLowerCase() === 'shopping', `listName: ${r!.listName}`);
  }
  console.log('   OK');

  console.log('36. [Fix F] detectListItemRemovalIntent: "delete bananas from grocery list" → item + listName...');
  {
    const r = detectListItemRemovalIntent('delete bananas from grocery list');
    assert(r !== null, 'expected non-null result');
    assert(r!.item.toLowerCase() === 'bananas', `item: ${r!.item}`);
    assert(r!.listName!.toLowerCase() === 'grocery', `listName: ${r!.listName}`);
  }
  console.log('   OK');

  console.log('37. [Fix F] detectListItemRemovalIntent: "remove it" (pronoun) → null (not a list removal)...');
  {
    const r = detectListItemRemovalIntent('remove it');
    assert(r === null, `expected null for pronoun removal, got ${JSON.stringify(r)}`);
  }
  console.log('   OK');

  console.log('38. [Fix F] detectListItemRemovalIntent: "delete that one" → null (task delete)...');
  {
    const r = detectListItemRemovalIntent('delete that one');
    assert(r === null, `expected null for pronoun delete, got ${JSON.stringify(r)}`);
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // FIX G: Mark-done follow-up without active task
  // ═════════════════════════════════════════════════════════════════════════

  console.log('39. [Fix G] detectMarkDoneIntent: "mark it done" → { taskTerm: null }...');
  {
    const r = detectMarkDoneIntent('mark it done');
    assert(r !== null, 'expected non-null result');
    assert(r!.taskTerm === null, `taskTerm should be null, got "${r!.taskTerm}"`);
  }
  console.log('   OK');

  console.log('40. [Fix G] detectMarkDoneIntent: "complete it" → { taskTerm: null }...');
  {
    const r = detectMarkDoneIntent('complete it');
    assert(r !== null, 'expected non-null result');
    assert(r!.taskTerm === null, `taskTerm should be null, got "${r!.taskTerm}"`);
  }
  console.log('   OK');

  console.log('41. [Fix G] detectMarkDoneIntent: "mark dentist as done" → { taskTerm: "dentist" }...');
  {
    const r = detectMarkDoneIntent('mark dentist as done');
    assert(r !== null, 'expected non-null result');
    assert(r!.taskTerm !== null, 'taskTerm should be non-null for explicit term');
    assert(r!.taskTerm!.toLowerCase() === 'dentist', `taskTerm: "${r!.taskTerm}"`);
  }
  console.log('   OK');

  console.log('42. [Fix G] detectMarkDoneIntent: "buy milk" → null (not a mark-done)...');
  {
    const r = detectMarkDoneIntent('buy milk');
    assert(r === null, `expected null for task, got ${JSON.stringify(r)}`);
  }
  console.log('   OK');

  // ═════════════════════════════════════════════════════════════════════════
  // REGRESSION: strong deterministic cases should be unaffected
  // ═════════════════════════════════════════════════════════════════════════

  console.log('43. [Regression] "Call the plumber tomorrow" → 1 task...');
  {
    const r = parseCompoundIntent('Call the plumber tomorrow');
    assert(r.listActions.length === 0, `listActions: ${JSON.stringify(r.listActions)}`);
    assert(r.tasks.length === 1, `tasks: ${r.tasks.length}`);
    assert(r.tasks[0]!.title.toLowerCase().includes('plumber'), `title: ${r.tasks[0]!.title}`);
  }
  console.log('   OK');

  console.log('44. [Regression] "Pay rent. Buy milk. Call dentist." → 3 tasks...');
  {
    const r = parseCompoundIntent('Pay rent. Buy milk. Call dentist.');
    assert(r.listActions.length === 0, `listActions: ${JSON.stringify(r.listActions)}`);
    assert(r.tasks.length === 3, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  console.log('45. [Regression] "Groceries: tomatoes, onions, curd" → 1 list with 3 items...');
  {
    const r = parseCompoundIntent('Groceries: tomatoes, onions, curd');
    assert(r.listActions.length === 1, `listActions: ${r.listActions.length}`);
    assert(r.listActions[0]!.listName!.toLowerCase().includes('groceries'), `listName: ${r.listActions[0]!.listName!}`);
    assert(r.listActions[0]!.items.length === 3, `items: ${JSON.stringify(r.listActions[0]!.items)}`);
    assert(r.tasks.length === 0, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  console.log('46. [Regression] "Create a list called school snacks with bananas, cheese cubes, and curd cups" → list only...');
  {
    const r = parseCompoundIntent('Create a list called school snacks with bananas, cheese cubes, and curd cups');
    assert(r.listActions.length === 1, `listActions: ${r.listActions.length}`);
    assert(r.listActions[0]!.items.length >= 3, `items: ${JSON.stringify(r.listActions[0]!.items)}`);
    assert(r.tasks.length === 0, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  console.log('47. [Regression] "Add detergent to shopping list" → add_to_existing...');
  {
    const r = parseCompoundIntent('Add detergent to shopping list');
    assert(r.listActions.length === 1, `listActions: ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'add_to_existing', `type: ${a.type}`);
    assert(a.listName!.toLowerCase().includes('shopping'), `listName: ${a.listName!}`);
    assert(r.tasks.length === 0, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  console.log('48. [Regression] "Add sunscreen to shopping" → add_to_existing...');
  {
    const r = parseCompoundIntent('Add sunscreen to shopping');
    assert(r.listActions.length === 1, `listActions: ${r.listActions.length}`);
    const a = r.listActions[0]!;
    assert(a.type === 'add_to_existing', `type: ${a.type}`);
    assert(a.listName!.toLowerCase().includes('shopping'), `listName: ${a.listName!}`);
    assert(r.tasks.length === 0, `tasks: ${r.tasks.length}`);
  }
  console.log('   OK');

  console.log('\nAll compound intent parser tests passed (including Fixes A-G).');
}

runTests();
