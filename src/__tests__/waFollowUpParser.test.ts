/**
 * Unit tests for src/lib/waFollowUpParser.ts
 *
 * Run with:
 *   npx tsx src/__tests__/waFollowUpParser.test.ts
 */

import {
  detectTaskFollowUpIntent,
  detectListItemFollowUpIntent,
  detectEntityToListIntent,
} from '../lib/waFollowUpParser';

// ============================================================
// Simple assertion helpers (no test framework dependency)
// ============================================================

let passed = 0;
let failed = 0;

function expect<T>(value: T, description: string) {
  return {
    toBe(expected: T) {
      if (value === expected) {
        console.log(`  ✅ ${description}`);
        passed++;
      } else {
        console.error(`  ❌ ${description}`);
        console.error(`     Expected: ${JSON.stringify(expected)}`);
        console.error(`     Received: ${JSON.stringify(value)}`);
        failed++;
      }
    },
    toBeNull() {
      if (value === null) {
        console.log(`  ✅ ${description}`);
        passed++;
      } else {
        console.error(`  ❌ ${description}`);
        console.error(`     Expected: null`);
        console.error(`     Received: ${JSON.stringify(value)}`);
        failed++;
      }
    },
    notToBeNull() {
      if (value !== null) {
        console.log(`  ✅ ${description}`);
        passed++;
      } else {
        console.error(`  ❌ ${description}`);
        console.error(`     Expected: non-null`);
        console.error(`     Received: null`);
        failed++;
      }
    },
  };
}

// ============================================================
// detectTaskFollowUpIntent
// ============================================================

console.log('\n── detectTaskFollowUpIntent ──────────────────────────');

{
  const result = detectTaskFollowUpIntent('make it Friday instead');
  expect(result?.type ?? null, '"make it Friday instead" → patch').toBe('patch');
  // The patch should contain a due_date for the coming Friday
  const dueDate = result?.type === 'patch' ? result.patch.due_date : undefined;
  expect(typeof dueDate === 'string' && dueDate.length === 10, '"make it Friday" → due_date is a YYYY-MM-DD string').toBe(true);
}

{
  const result = detectTaskFollowUpIntent('move it to tomorrow');
  expect(result?.type ?? null, '"move it to tomorrow" → patch').toBe('patch');
  const dueDate = result?.type === 'patch' ? result.patch.due_date : undefined;
  // tomorrow = today + 1
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  expect(dueDate, '"move it to tomorrow" → correct tomorrow date').toBe(tomorrow.toISOString().slice(0, 10));
}

{
  const result = detectTaskFollowUpIntent('change it to 5pm');
  expect(result?.type ?? null, '"change it to 5pm" → patch').toBe('patch');
  const dueTime = result?.type === 'patch' ? result.patch.due_time : undefined;
  expect(dueTime, '"change it to 5pm" → due_time = 17:00').toBe('17:00');
}

{
  const result = detectTaskFollowUpIntent('delete it');
  expect(result?.type ?? null, '"delete it" → delete').toBe('delete');
}

{
  const result = detectTaskFollowUpIntent('delete that one');
  expect(result?.type ?? null, '"delete that one" → delete').toBe('delete');
}

{
  const result = detectTaskFollowUpIntent('mark it done');
  expect(result?.type ?? null, '"mark it done" → mark_done').toBe('mark_done');
}

{
  const result = detectTaskFollowUpIntent('buy milk');
  expect(result, '"buy milk" → null (not a follow-up)').toBeNull();
}

{
  const result = detectTaskFollowUpIntent('edit milk task');
  expect(result, '"edit milk task" → null (edit-select, not follow-up)').toBeNull();
}

{
  const result = detectTaskFollowUpIntent('reschedule dentist appointment');
  expect(result, '"reschedule dentist" → null (explicit, not implicit "it")').toBeNull();
}

// ============================================================
// detectListItemFollowUpIntent
// ============================================================

console.log('\n── detectListItemFollowUpIntent ──────────────────────');

{
  const result = detectListItemFollowUpIntent('add curd too');
  expect(result !== null, '"add curd too" → non-null').toBe(true);
  expect(result?.items?.[0], '"add curd too" → items[0] = curd').toBe('curd');
}

{
  const result = detectListItemFollowUpIntent('also add paneer');
  expect(result !== null, '"also add paneer" → non-null').toBe(true);
  expect(result?.items?.[0], '"also add paneer" → items[0] = paneer').toBe('paneer');
}

{
  const result = detectListItemFollowUpIntent('also add turmeric and ginger');
  expect(result !== null, '"also add turmeric and ginger" → non-null').toBe(true);
  expect((result?.items?.length ?? 0) >= 1, '"also add turmeric and ginger" → at least 1 item').toBe(true);
}

{
  const result = detectListItemFollowUpIntent('delete all tasks');
  expect(result, '"delete all tasks" → null (has command verb)').toBeNull();
}

{
  // Explicit "add X to Y" should NOT fire here (handled by detectAddToListIntent)
  const result = detectListItemFollowUpIntent('add milk to shopping list');
  expect(result, '"add milk to shopping list" → null (has explicit target)').toBeNull();
}

{
  const result = detectListItemFollowUpIntent('and also add coconut milk');
  expect(result !== null, '"and also add coconut milk" → non-null').toBe(true);
}

// ============================================================
// detectEntityToListIntent
// ============================================================

console.log('\n── detectEntityToListIntent ──────────────────────────');

{
  const result = detectEntityToListIntent('add it to shopping');
  expect(result !== null, '"add it to shopping" → non-null').toBe(true);
  expect(result?.listName, '"add it to shopping" → listName = shopping').toBe('shopping');
}

{
  const result = detectEntityToListIntent('put it in the grocery list');
  expect(result !== null, '"put it in the grocery list" → non-null').toBe(true);
  expect(result?.listName, '"put it in the grocery list" → listName = grocery').toBe('grocery');
}

{
  const result = detectEntityToListIntent('add it');
  expect(result !== null, '"add it" → non-null (ambiguous, listName null)').toBe(true);
  expect(result?.listName, '"add it" → listName is null').toBeNull();
}

{
  const result = detectEntityToListIntent('add milk to shopping');
  expect(result, '"add milk to shopping" → null (no "it", handled by explicit path)').toBeNull();
}

{
  const result = detectEntityToListIntent('buy milk');
  expect(result, '"buy milk" → null (not "add/put it")').toBeNull();
}

{
  const result = detectEntityToListIntent('put it in my packing list');
  expect(result !== null, '"put it in my packing list" → non-null').toBe(true);
  expect(result?.listName, '"put it in my packing list" → listName = packing').toBe('packing');
}

// ============================================================
// SUMMARY
// ============================================================

console.log(`\n══════════════════════════════════════════`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
