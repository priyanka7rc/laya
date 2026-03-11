# Duplication Audit: Text → Tasks & Insert with Dedupe

## A) Text normalization for intake

| Location | Function / behavior | Canonical? | Differences |
|----------|---------------------|------------|-------------|
| `src/lib/brainDumpParser.ts` | Inline in `splitBrainDump`: `\r\n`→`\n`, bullets/numbered→`\n`, split on `[,;\n]` | Brain Dump path | No separate normalize; no `\t` or `\n{3,}` collapse |
| `src/lib/ocrCandidates.ts` | `normalizeText()`: `\r\n`→`\n`, `\r`→`\n`, `\t`→space, `\n{3,}`→`\n\n`, trim | Feature #2 path | Standalone; more aggressive collapse |

**Risk:** Unifying to a single `normalizeIntakeText()` (e.g. OCR-style) may change Brain Dump behavior slightly (e.g. tab handling). Prefer one shared function used by both; optional `mode` if needed.

---

## B) Candidate splitting / multi-task parsing

| Location | Function / behavior | Canonical? | Differences |
|----------|---------------------|------------|-------------|
| `src/lib/brainDumpParser.ts` | `splitBrainDump()`: split on comma/semicolon/newline; "and" split when both parts ≥10 chars; no cap | Brain Dump | No line-merge, no junk filter, no hard boundaries (bullet/checkbox/number) |
| `src/lib/ocrCandidates.ts` | `splitCandidates()`: line-based; hard boundaries (bullet/checkbox/number); continuation merge; junk filter; cap 25 | Feature #2 | Stricter for OCR noise |

**Risk:** Merging into one splitter with `mode: 'brain_dump' | 'ocr'` preserves both behaviors; cap applied in one place.

---

## C) Segment → ProposedTask (Feature #1 parsers)

| Location | Function / behavior | Canonical? | Differences |
|----------|---------------------|------------|-------------|
| `src/lib/brainDumpParser.ts` | `parseOneSegmentWithRules()` | **Not canonical** | Uses **own** `extractDateFromText`, `extractTimeFromText`, `getTodayDate()`, `DEFAULT_TIME`; custom title strip; `guessCategory(segment)`. Returns `ParsedTaskWithFlags` (dueDateWasDefaulted, dueTimeWasDefaulted). **Does not use** parseDate/parseTime/stripTemporalPhrases/getSmartDefaultTime from taskRulesParser. |
| `src/lib/ocrCandidates.ts` | `candidateToProposedTask()` | **Canonical** | Uses **Feature #1 only**: parseDate, parseTime, getSmartDefaultTime, stripTemporalPhrases, detectCategory. Returns `ProposedTask` (inferred_date, inferred_time, rawCandidate). |

**Risk:** Brain Dump date/time logic differs from Feature #1 (e.g. weekday handling, 24h vs AM/PM). Unifying on Feature #1 may change Brain Dump output; we accept that for a single canonical pipeline.

---

## D) Duplicate detection (5s window; normalized title + due_date + due_time)

| Location | Implementation | Canonical? | Differences |
|----------|----------------|------------|-------------|
| `src/app/(tabs)/tasks/page.tsx` | `handleQuickAdd`: `now - createdAtMs <= DUPLICATE_WINDOW_MS`; compare normalized title, due_date, due_time (slice 0,5) | Feature #1 | In-memory (`tasks` state) |
| `src/app/api/tasks/import/confirm/route.ts` | Same window and comparison; `recentTasks` from DB | Feature #2 | Server; fetches last 200 then filters by 5s |

**Risk:** Extracting to `insertTasksWithDedupe` with one comparison and one window constant keeps behavior identical.

---

## E) Insert logic (payload shape: inferred_date, inferred_time, source, etc.)

| Location | Implementation | Canonical? | Differences |
|----------|----------------|------------|-------------|
| `src/app/(tabs)/tasks/page.tsx` | Single insert: user_id, app_user_id, source: 'web', source_message_id: null, title, due_date, due_time, category, inferred_date, inferred_time, is_done, reminder_sent | Feature #1 | Has app_user_id from getCurrentAppUser() |
| `src/app/api/tasks/import/confirm/route.ts` | Loop insert; same shape; app_user_id null | Feature #2 | — |
| `src/components/FloatingBrainDump.tsx` | Batch insert; **omits** inferred_date, inferred_time (DB defaults to false) | Brain Dump | Uses dueDateWasDefaulted/dueTimeWasDefaulted only for refine, not for DB |

**Risk:** Brain Dump currently never sets inferred_* in DB. After merge, Brain Dump will send inferred_date/inferred_time from ProposedTask so behavior aligns.

---

## F) “Add anyway” / override

| Location | Implementation | Canonical? |
|----------|----------------|------------|
| `src/app/(tabs)/tasks/page.tsx` | `bypassDuplicateCheckRef.current = true`; `handleAddAnyway()` calls `handleQuickAdd()` again | Feature #1 |
| `src/app/api/tasks/import/confirm/route.ts` | `overrides.allowDuplicatesTaskIds` (indices); skip duplicate check for those indices | Feature #2 |

**Risk:** Single shared `insertTasksWithDedupe(..., { allowDuplicateIndices })` covers both.

---

## Canonical modules (target)

1. **`src/lib/task_intake.ts`** (or `src/server/task_intake/textToProposedTasks.ts`)
   - `normalizeIntakeText(text: string): string`
   - `splitIntakeCandidates(text: string, options?: { mode: 'brain_dump' | 'ocr', maxCandidates?: number }): string[]`
   - `segmentToProposedTask(segment: string): ProposedTask` — **Feature #1 parsers only**
   - `textToProposedTasks(text: string, options: { mode: 'brain_dump' | 'ocr' }): ProposedTask[]`
   - Export type `ProposedTask` (title, due_date, due_time, category, inferred_date, inferred_time, rawCandidate).

2. **`src/server/tasks/insertTasksWithDedupe.ts`**
   - `insertTasksWithDedupe(params: { tasks: ProposedTask[], userId: string, appUserId?: string | null, allowDuplicateIndices?: number[] }): Promise<{ inserted: InsertedTask[], duplicates: { index: number, reason: string }[] }>`
   - One 5s-window duplicate check; same comparison; single place for insert payload.

---

## Keyboard flow now routed through canonical modules

- Client-side parsing (parseDate, parseTime, detectCategory, stripTemporalPhrases) and inlined 5-second duplicate check have been removed from `tasks/page.tsx`.
- **POST /api/tasks/create** is the single server path for keyboard create: it uses `task_intake.textToProposedTasksFromSegments` and `insertTasksWithDedupe`. Optional `due_date`/`due_time` from UI pickers override the proposed task; "Add anyway" is implemented via `allowDuplicate` → `allowDuplicateIndices: [0]`.

## What was removed / rewired (implemented)

- **src/lib/task_intake.ts** (new): Canonical `ProposedTask` type, `segmentToProposedTask(segment)` (Feature #1 parsers only), `textToProposedTasksFromSegments(segments, options?)`. No splitting logic here; callers pass segments.
- **src/server/tasks/insertTasksWithDedupe.ts** (new): Single place for 5s duplicate window and task insert. Used by `/api/tasks/import/confirm`.
- **src/lib/ocrCandidates.ts**: Removed duplicate `candidateToProposedTask`; now imports `segmentToProposedTask` and `ProposedTask` from `task_intake`. Re-exports `candidateToProposedTask = segmentToProposedTask`. `ocrTextToProposedTasks` unchanged in shape but uses `segmentToProposedTask`.
- **src/app/api/parseDump/route.ts**: Uses `splitBrainDump(text)` then `textToProposedTasksFromSegments(segments)` instead of `parseOneSegmentWithRules`. Maps result to existing API shape (rawSegmentText, dueDateWasDefaulted, dueTimeWasDefaulted, inferred_date, inferred_time). Brain Dump now uses Feature #1 for segment→task.
- **src/app/api/tasks/import/confirm/route.ts**: Replaced inline dedupe + insert with `insertTasksWithDedupe(...)`. No behavior change.
- **Keyboard flow (tasks/page.tsx)**: Now routed through canonical modules. **POST /api/tasks/create** uses `textToProposedTasksFromSegments([text])` and `insertTasksWithDedupe`; client-side parsing and 5s dedupe removed. UI POSTs with optional `due_date`/`due_time` overrides and `allowDuplicate` for "Add anyway".
- **refineTasks**: Unchanged; still expects dueDateWasDefaulted/dueTimeWasDefaulted/rawSegmentText; parseDump response includes both naming conventions.

## Running parity tests

```bash
npx tsx src/__tests__/task-intake-parity.test.ts
```

Verifies: non-null due_date/due_time, inference flags, idempotency of segmentToProposedTask, Brain Dump and OCR paths, OCR cap (throws when > 25 candidates), and keyboard path (single segment → one ProposedTask matching segmentToProposedTask).

---

