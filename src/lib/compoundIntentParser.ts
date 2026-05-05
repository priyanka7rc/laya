/**
 * Compound intent parser — shared between WhatsApp and the web Brain Dump / capture flow.
 *
 * Philosophy: same split → classify → dispatch model as /api/parseDump/route.ts, extended
 * with two new classifiers:
 *   1. detectCreateListWithItemsIntent — "create list X and add Y, Z"
 *   2. detectColonListIntent (from brainDumpParser) — "Groceries: milk, eggs"
 *
 * All underlying parsers are reused as-is:
 *   - splitBrainDump (brainDumpParser) — segmentation with sentence-boundary awareness
 *   - detectListIntent (brainDumpParser) — "add X to Y list" single-item patterns
 *   - detectColonListIntent (brainDumpParser) — colon-formatted list sections
 *   - textToProposedTasksFromSegments (task_intake) — task parsing pipeline
 *   - splitItemPhrase (waAddToListParser) — item tokenisation for inline "and add" lists
 *
 * Result shape:
 *   listActions — ordered list of list operations to execute (create / add_to_existing)
 *   tasks       — ProposedTask[] for all task-classified segments
 *   hasContent  — true when at least one list action or task was extracted
 */

import {
  splitIntoSentences,
  splitBrainDump,
  detectListIntent,
  detectColonListIntent,
  detectPreambleColonTaskDump,
} from '@/lib/brainDumpParser';
import { textToProposedTasksFromSegments, type ProposedTask } from '@/lib/task_intake';
import { splitItemPhrase } from '@/lib/waAddToListParser';
import { detectExplicitListFollowUpIntent } from '@/lib/waFollowUpParser';

// ============================================
// TYPES
// ============================================

export type CompoundListAction =
  | {
      /** Create a new list with optional seed items. items may be empty when only creating. */
      type: 'create_with_items';
      listName: string;
      items: string[];
    }
  | {
      /** Add items to an existing list (resolved by name at dispatch time). */
      type: 'add_to_existing';
      listName: string | null;
      items: string[];
    };

export interface CompoundIntentResult {
  listActions: CompoundListAction[];
  tasks: ProposedTask[];
  /** True when at least one list action or task was extracted from the text. */
  hasContent: boolean;
}

// ============================================
// PRIVATE HELPERS
// ============================================

/**
 * Detect "create list X", "make a list called X", "new list X", and their variants
 * that include inline items after "and add": "create list called X and add Y, Z".
 *
 * The regex intentionally captures the list name loosely — everything after the
 * list keyword up to an optional "and add" suffix. The "and add" detection is done
 * as a simple string split to avoid regex complexity.
 *
 * Returns { listName, items } or null.
 */
function detectCreateListWithItemsIntent(
  segment: string
): { listName: string; items: string[] } | null {
  const trimmed = segment.trim();

  // Primary pattern: create/make/new [a] [<modifier words>] list [called|named|for|with] <name/items>
  // Allow up to 4 words before "list" to handle "school snacks list", "return gifts list", etc.
  const m = trimmed.match(
    /^(?:create|make|new)\s+(?:a\s+)?(?:(?:[\w]+\s+){1,4})?list(?:\s+(?:called|named|for))?\s+(.+)$/i
  );
  if (!m) return null;

  let rest = m[1]!.trim();
  let items: string[] = [];

  // Fix C + existing: handle all item-delimiter patterns.
  // Case A: rest starts with "with " — the qualifier consumed "list" but not "with"
  // e.g. "Create a return gifts list with crayons, sticker books, puzzles"
  //      → m[1] = "with crayons, sticker books, puzzles, ..."
  if (/^with\s+/i.test(rest)) {
    // Recover the descriptor words (list name) from the original segment
    const nameMatch = trimmed.match(
      /^(?:create|make|new)\s+(?:a\s+)?([\w\s]+?)\s+list\s+with\s+/i
    );
    const descriptorWords = nameMatch?.[1]?.trim() ?? '';
    items = splitItemPhrase(rest.replace(/^with\s+/i, '').trim());
    rest = descriptorWords;
  } else {
    // Case B: split on " and add " or " with " (with leading space)
    // "create school snacks list with bananas and cheese cubes" → items: [bananas, cheese cubes]
    const andAddIdx = rest.toLowerCase().indexOf(' and add ');
    const withIdx = rest.toLowerCase().indexOf(' with ');
    const splitIdx = andAddIdx !== -1 ? andAddIdx : withIdx;
    const splitPhrase = andAddIdx !== -1 ? ' and add ' : ' with ';

    if (splitIdx !== -1) {
      const itemsPart = rest.slice(splitIdx + splitPhrase.length).trim();
      rest = rest.slice(0, splitIdx).trim();
      items = splitItemPhrase(itemsPart);
    } else {
      // Fix B: also treat ":" as an item separator
      // e.g. "Make a packing list for Goa: sunscreen, hats"
      const colonSplitIdx = rest.indexOf(':');
      if (colonSplitIdx !== -1) {
        const colonItemsPart = rest.slice(colonSplitIdx + 1).trim();
        rest = rest.slice(0, colonSplitIdx).trim();
        if (colonItemsPart) {
          items = splitItemPhrase(colonItemsPart);
        }
      }
    }
  }

  const listName = rest.trim();
  if (!listName) return null;

  return { listName, items };
}

// ============================================
// TASK CLAUSE EXTRACTION (Fix C)
// ============================================

/**
 * Patterns that mark the start of a task clause embedded in a list-item phrase.
 * e.g. "remind me to order cake tomorrow" inside ["crayons", "sticker books", "remind me to order cake"]
 */
const TASK_CLAUSE_PREFIXES = [
  /^(?:and\s+)?remind(?:\s+me)?\s+to\s+/i,
  /^(?:and\s+)?don'?t\s+forget\s+to\s+/i,
  /^(?:and\s+)?i\s+need\s+to\s+/i,
  /^(?:and\s+)?need\s+to\s+/i,
];

/**
 * Given a list of items from detectCreateListWithItemsIntent, separate genuine list
 * items from task clauses that accidentally got split into the item list.
 *
 * Returns { cleanItems, taskClauses } where taskClauses are ready for task parsing.
 */
function separateTaskClausesFromItems(items: string[]): {
  cleanItems: string[];
  taskClauses: string[];
} {
  const cleanItems: string[] = [];
  const taskClauses: string[] = [];
  for (const item of items) {
    let matched = false;
    for (const pat of TASK_CLAUSE_PREFIXES) {
      const stripped = item.replace(pat, '').trim();
      if (stripped.length > 0 && stripped !== item) {
        taskClauses.push(stripped);
        matched = true;
        break;
      }
    }
    if (!matched) cleanItems.push(item);
  }
  return { cleanItems, taskClauses };
}

// ============================================
// MAIN EXPORTED FUNCTION
// ============================================

/**
 * Parse arbitrary text into a compound intent result containing zero or more list
 * actions and zero or more tasks. All classifiers run in a single deterministic pass.
 *
 * Pipeline:
 *   1. splitBrainDump (with sentence-boundary splitting) → sentence-level segments
 *   2. For each sentence segment:
 *      a. Try detectCreateListWithItemsIntent → create_with_items, skip sub-split
 *      b. Try detectColonListIntent → create_with_items, skip sub-split
 *      c. Otherwise: re-apply splitBrainDump within the sentence for comma/semicolon sub-split
 *         i.  Try detectListIntent per sub-segment → add_to_existing
 *         ii. Else: collect as task segment
 *   3. textToProposedTasksFromSegments(taskSegments) → ProposedTask[]
 *
 * This mirrors the web parseDump/route.ts model and can be called from both the
 * WhatsApp processor and the web Brain Dump API route.
 */
export function parseCompoundIntent(text: string): CompoundIntentResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { listActions: [], tasks: [], hasContent: false };
  }

  // Step 1: sentence-level split only (no comma-splitting yet).
  // This ensures create-list and colon-list patterns are tried on the full sentence
  // before the inner comma-split pass fires.
  const topSegments = splitIntoSentences(trimmed);
  const rawSegments = topSegments.length > 0 ? topSegments : [trimmed];

  const listActions: CompoundListAction[] = [];
  const taskSegments: string[] = [];

  for (const seg of rawSegments) {
    const s = seg.trim();
    if (!s) continue;

    // Step 2a: explicit create-list command (handles "and add" / "with" / colon inline items)
    const createIntent = detectCreateListWithItemsIntent(s);
    if (createIntent) {
      // Fix C: strip task clauses ("remind me to ...", "don't forget to ...") from item list
      const { cleanItems, taskClauses } = separateTaskClausesFromItems(createIntent.items);
      listActions.push({ type: 'create_with_items', listName: createIntent.listName, items: cleanItems });
      if (taskClauses.length > 0) taskSegments.push(...taskClauses);
      continue;
    }

    // Step 2b: colon-list pattern ("Groceries: milk, eggs" / "list for X: items")
    const colonIntent = detectColonListIntent(s);
    if (colonIntent) {
      listActions.push({ type: 'create_with_items', ...colonIntent });
      continue;
    }

    // Step 2b-alt: Fix A — preamble-colon task dump
    // "Need to do these today: call the bank, buy fruits, clean the study"
    const preambleItems = detectPreambleColonTaskDump(s);
    if (preambleItems) {
      taskSegments.push(...preambleItems);
      continue;
    }

    // Step 2c: sub-split on commas/semicolons, then classify each sub-segment
    const subSegments = splitBrainDump(s);
    const rawSubs = subSegments.length > 0 ? subSegments : [s];

    for (const sub of rawSubs) {
      const t = sub.trim();
      if (!t) continue;

      // Step 2c-i: "add X to Y list" style — existing detectListIntent
      const listIntent = detectListIntent(t);
      if (listIntent) {
        // Split compound items ("glue sticks and chart paper" → ["Glue Sticks", "Chart Paper"])
        const items = splitItemPhrase(listIntent.item);
        listActions.push({
          type: 'add_to_existing',
          listName: listIntent.listName,
          items: items.length > 0 ? items : [listIntent.item],
        });
        continue;
      }

      // Step 2c-ii: colon-list on sub-segment (catches "groceries: milk, eggs" when
      // it appears after a comma in a longer sentence)
      const subColonIntent = detectColonListIntent(t);
      if (subColonIntent) {
        listActions.push({ type: 'create_with_items', ...subColonIntent });
        continue;
      }

      // Step 2c-iii: Fix E — explicit list follow-up patterns without list target
      // "add curd too", "also add paneer" → add_to_existing with null listName
      // Uses the STRICT variant (no general short-phrase fallback) to avoid false
      // positives on task sub-segments like "Buy milk tomorrow".
      // Sufficiency validator will ask "Add X to which list?"
      const followUpItems = detectExplicitListFollowUpIntent(t);
      if (followUpItems) {
        listActions.push({ type: 'add_to_existing', listName: null, items: followUpItems.items });
        continue;
      }

      // Step 2c-iv: task
      taskSegments.push(t);
    }
  }

  const tasks = textToProposedTasksFromSegments(taskSegments, { maxCandidates: 50 });

  return {
    listActions,
    tasks,
    hasContent: listActions.length > 0 || tasks.length > 0,
  };
}
