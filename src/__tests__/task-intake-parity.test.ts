/**
 * Parity checks for canonical task intake pipeline.
 * Run: npx tsx src/__tests__/task-intake-parity.test.ts
 *
 * Ensures: non-null schedule, inference flags, idempotency, Brain Dump vs OCR path consistency.
 */

import { segmentToProposedTask, textToProposedTasksFromSegments } from '@/lib/task_intake';
import { splitBrainDump } from '@/lib/brainDumpParser';
import { ocrTextToProposedTasks } from '@/lib/ocrCandidates';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runTests() {
  console.log('1. segmentToProposedTask: non-null schedule...');
  const t1 = segmentToProposedTask('Buy milk tomorrow at 3pm');
  assert(t1.due_date != null && t1.due_date.length === 10, 'due_date YYYY-MM-DD');
  assert(t1.due_time != null && t1.due_time.length >= 5, 'due_time at least HH:MM');
  assert(typeof t1.inferred_date === 'boolean', 'inferred_date boolean');
  assert(typeof t1.inferred_time === 'boolean', 'inferred_time boolean');
  assert(t1.rawCandidate === 'Buy milk tomorrow at 3pm', 'rawCandidate preserved');
  console.log('   OK');

  console.log('2. Same segment → same task...');
  const t2 = segmentToProposedTask('Buy milk tomorrow at 3pm');
  assert(t1.due_date === t2.due_date && t1.due_time === t2.due_time && t1.title === t2.title, 'idempotent');
  console.log('   OK');

  console.log('3. textToProposedTasksFromSegments...');
  const segments = ['Task one', 'Task two today'];
  const proposed = textToProposedTasksFromSegments(segments);
  assert(proposed.length === 2, 'length preserved');
  proposed.forEach((p, i) => {
    assert(p.due_date != null && p.due_time != null, `task ${i} has schedule`);
    assert(typeof p.inferred_date === 'boolean' && typeof p.inferred_time === 'boolean', `task ${i} has inference flags`);
  });
  console.log('   OK');

  console.log('4. Brain Dump path: splitBrainDump → textToProposedTasksFromSegments...');
  const brainDumpText = 'Buy milk\nCall mom tomorrow';
  const brainSegments = splitBrainDump(brainDumpText);
  const brainProposed = textToProposedTasksFromSegments(brainSegments);
  assert(brainProposed.length >= 1 && brainProposed.length <= 2, 'brain dump produces 1–2 tasks');
  brainProposed.forEach((p) => {
    assert(p.due_date != null && p.due_time != null, 'each has schedule');
  });
  console.log('   OK');

  console.log('5. OCR path: ocrTextToProposedTasks...');
  const ocrText = '• Buy milk tomorrow at 3pm';
  const { tasks: ocrProposed, truncated: ocrTruncated } = ocrTextToProposedTasks(ocrText);
  assert(ocrProposed.length >= 1, 'at least one task');
  assert(!ocrTruncated, 'no truncation for simple OCR text');
  const single = segmentToProposedTask('Buy milk tomorrow at 3pm');
  assert(ocrProposed[0].due_date === single.due_date && ocrProposed[0].due_time === single.due_time, 'OCR segment matches direct segmentToProposedTask for same content');
  console.log('   OK');

  console.log('6. Cap: OCR caps at 25 candidates (no throw)...');
  const longText = Array(30)
    .fill(0)
    .map((_, i) => `${i + 1}. Do thing ${i + 1}`)
    .join('\n');
  const { tasks: cappedTasks, truncated: capTruncated } = ocrTextToProposedTasks(longText);
  assert(capTruncated, 'cap reports truncation');
  assert(cappedTasks.length === 25, 'only first 25 candidates are used');
  console.log('   OK');

  console.log('7. Keyboard path: single segment → one ProposedTask (matches create API logic)...');
  const keyboardInput = 'Dinner with Sam tomorrow at 6pm';
  const keyboardProposed = textToProposedTasksFromSegments([keyboardInput], { maxCandidates: 1 });
  assert(keyboardProposed.length === 1, 'keyboard yields exactly one task');
  const direct = segmentToProposedTask(keyboardInput);
  assert(
    keyboardProposed[0].due_date === direct.due_date &&
      keyboardProposed[0].due_time === direct.due_time &&
      keyboardProposed[0].title === direct.title &&
      keyboardProposed[0].inferred_date === direct.inferred_date &&
      keyboardProposed[0].inferred_time === direct.inferred_time,
    'keyboard single-segment matches segmentToProposedTask (canonical create API parity)'
  );
  console.log('   OK');

  console.log('\nAll parity checks passed.');
}

runTests();
