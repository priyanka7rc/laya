## Laya Architecture v6

This document reflects the **current implementation** in the `laya` repo as of May 2026. It extends `architecture_v5` with:

- **Unload Intelligence Overhaul** — two-phase pipeline upgrade covering temporal intelligence, semantic constraints, booking context, LLM-first classification, filler detection, confirmation/clarification flows, and list follow-up improvements
- **Adaptive Routing + Memory** — forward-looking architecture for continuous improvement via correctness signals, a golden examples repository, few-shot injection, and confidence-based model routing
- **Simulator** — four-pass evaluation framework (Runs A/B/C/D) for measuring pipeline quality and preventing regressions
- **New DB tables and columns** — `wa_conversation_state.pending_confirmation`, `ai_turn_log` temporal columns, `wa_pending_actions` clarification type
- **Golden test suite** — 29 pinned regression tests in `src/__tests__/simulator-golden.test.ts`

Sections unchanged from v5 are noted with *(unchanged from v5)*.

Where something is **planned but not yet implemented**, it is explicitly marked as **[PLANNED]**.

---

## 1. High-Level System Overview *(unchanged from v5)*

See `architecture_v5.md` Section 1 for entry points, APIs, cron jobs, and nav tabs. All unchanged.

---

## 2. Auth + Onboarding *(unchanged from v5)*

See `architecture_v5.md` Sections 2–3. Phone OTP, 4-state onboarding machine, `app_users` profile schema — all unchanged.

---

## 3. Unload Pipeline — Post-Overhaul Architecture

### 3.1 Overview

The Unload pipeline is the core intelligence layer for capturing tasks and list items from natural language text. It is shared across **web (Unload tab, `/capture`)** and **WhatsApp** channels via the `interpretTurn()` function in `src/lib/turnInterpreter.ts`.

The pipeline has two major modes controlled by the `USE_LLM_CLASSIFICATION` environment variable:

| Mode | Flag | Behaviour |
|------|------|-----------|
| Rules-only | `false` | Fully deterministic, < 5ms, no API cost |
| Hybrid (default for prod) | `true` | Rules for simple inputs; LLM for multiline, gaps, and ambiguity |

### 3.2 `interpretTurn()` — Step-by-step pipeline

**File:** `src/lib/turnInterpreter.ts`

```
Input text (raw)
  ?
  ?? Step 0: Domain normalization pre-pass
  ?    normalizeDomainText() ? expands shorthand (tmrw?tomorrow, groc?groceries)
  ?    cleans punctuation, normalises whitespace
  ?    IMPORTANT: isMultiline = text.includes('\n') captured BEFORE normalization
  ?    (normalizer collapses \n ? space, destroying multiline structure)
  ?
  ?? Step 1: Follow-up detection (only if convState provided)
  ?    Priority order — first match wins:
  ?    ?? detectMarkDoneIntent() — "mark it done", "mark dentist as done"
  ?    ?? detectListItemRemovalIntent() — "remove bananas from shopping"
  ?    ?? detectTaskFollowUpIntent() — "make it Friday", "move it to tomorrow"
  ?    ?? detectListItemFollowUpIntent(text, hasActiveList=true)
  ?    ?    A4b: hasActiveList relaxes command-verb gate for "add X and Y"
  ?    ?    A4a: items cleaned of prefixes (and/put/also) and suffixes (too/as well)
  ?    ?? detectEntityToListIntent() — "add it to shopping"
  ?
  ?? Step 2: Single-turn edit/move detection
  ?    parseEditSelectionIntent() + parseEditPatch()
  ?    Fires for: "Move dentist to next Monday", "Reschedule plumber to Friday 3pm"
  ?
  ?? Step 3: Compound classification (fresh messages, no follow-up detected)
  ?    classifyIntent(normalizedText, { isMultiline, rawText, turnId, channel })
  ?    (see Section 3.3 for full classifyIntent routing logic)
  ?
  ?? Step 3b: A5 conv-state resolution (post-classification)
  ?    If LLM returned task_follow_up_done/delete with taskId='' or update_task
  ?    with taskTerm matching convState.last_task_title ? upgrade to concrete
  ?    follow-up action with real taskId from convState.active_task_id
  ?
  ?? Step 4: Reference resolution
  ?    resolveTaskReference(), resolveListReference(), resolveEntityReference()
  ?    Resolves pronouns ("it", "that") and explicit names against convState
  ?
  ?? Step 5: Clarification assessment
  ?    assessClarification() — text-level ambiguity, missing fields
  ?    extractEntityNameForClarification() for pointed clarification hints
  ?
  ?? Step 6: Sufficiency validation
  ?    validateAllActions() — structural completeness check
  ?    Catches empty task titles, missing list names, zero-item lists
  ?
  ?? Step 7: Semantic constraint validation
  ?    validateAllSemanticConstraints() — date/time sanity
  ?    - Past-date guard (due_date < today)
  ?    - Business-hours guard (appointments outside 06:00–22:00)
  ?
  ?? Step 8: Execution plan
       buildExecutionPlan() ? ExecutionStep[]
       kind: 'execute' | 'clarify' | 'confirm'
       'confirm' added for destructive actions (delete, remove)
```

**Output:** `TurnInterpretation` containing:
- `detectedActions: DetectedAction[]`
- `executionPlan: ExecutionStep[]`
- `log: InterpretationLog` (full observability record)
- `references`, `entities`, `segments`, `classificationSource`

### 3.3 `classifyIntent()` — Routing logic

**File:** `src/lib/intentClassifier.ts`

```
classifyIntent(text, context)
  ?
  ?? Step 0: Multiline routing guard (A1 — new)
  ?    if context.isMultiline && llmEnabled:
  ?      ? Skip rules entirely
  ?      ? Call LLM with rawText (pre-normalization, newlines preserved)
  ?      ? reason_code: 'llm_multiline_routing'
  ?    This fixes the root cause of all multiline dump failures where
  ?    normalizeDomainText() collapsed \n ? space before the rules ran,
  ?    producing 1 garbled task instead of N distinct tasks.
  ?
  ?? Step 1a: Introspective filler pre-check (A3 — new)
  ?    INTROSPECTIVE_FILLER regex fires before rulesClassify:
  ?    "I need to get better at this", "This week is so busy", "ugh", etc.
  ?    ? Returns { type: 'filler' } immediately
  ?    ? Prevents these from creating garbled tasks via rules
  ?
  ?? Step 1b: Rules classification
  ?    rulesClassify(text) ? parseCompoundIntent() ? DetectedAction[]
  ?
  ?? Step 2: Coverage check (if rules returned actions)
  ?    segments = splitBrainDump(text)
  ?    coverageRatio = actionCount / segmentCount
  ?    if llmEnabled && segments >= 3 && coverageRatio < 0.5:
  ?      ? Fall through to LLM partial fill
  ?    else:
  ?      ? Return rules result (reason_code: 'rules_matched')
  ?
  ?? Step 3: LLM call (gap-fill or partial-fill)
       if rules returned 0 actions ? 'llm_gap_fill'
       if low coverage             ? 'llm_partial_fill'
       Calls OpenAI with buildPrompt(text)
       Parses response via LLMResponseSchema (Zod)
       Handles: filler, needs_clarification, create_task, create_list,
                add_list_items, delete_task, mark_done, update_task (A2 — new)
```

### 3.4 LLM Action Schema (`LLMActionSchema`) — v6 additions

**File:** `src/lib/intentClassifier.ts`

Three new action types added in the Unload Intelligence Overhaul (A2):

```typescript
// Delete a task by name
{ type: 'delete_task', taskTerm: string }
  ? Converts to: task_follow_up_delete { taskId: '', taskTitle: taskTerm }

// Mark a task as done
{ type: 'mark_done', taskTerm: string | null }
  ? Converts to: task_follow_up_done { taskId: '', taskTitle: taskTerm }

// Reschedule, move, or rename a task
{ type: 'update_task', taskTerm: string | null,
  due_date: string | null, due_time: string | null, new_title: string | null }
  ? Converts to: update_task { taskTerm, patch: { due_date, due_time, title } }
```

After A5 conv-state resolution in `interpretTurn()`, LLM-produced actions with `taskId=''` are upgraded to concrete follow-up actions when `taskTerm` matches `convState.last_task_title`.

### 3.5 Temporal intelligence

**File:** `src/lib/temporalDictionary.ts`

Data-driven map of colloquial temporal terms to resolution functions:

| Term | Resolution |
|------|-----------|
| `ASAP`, `urgently` | Today |
| `end of week`, `eow` | This Saturday |
| `end of day`, `eod` | Today at 23:59 |
| `COB`, `close of business` | Today at 18:00 |
| `next [weekday]` | Named day of NEXT calendar week |
| `this [weekday]` | Named day of THIS calendar week |
| `tonight` | 20:00 |
| `morning` / `afternoon` / `evening` | 08:00 / 14:00 / 18:00 |
| `in X hours` / `in X days` | Now + delta |
| `couple of days` / `a few days` | +2 / +3 days |

Used in `taskRulesParser.ts` `parseDate()`. Also injected into the LLM prompt in `buildPrompt()` so both paths resolve the same way.

### 3.6 Semantic constraint validation

**File:** `src/lib/semanticConstraintValidator.ts`

Validates `create_task` actions after parsing:

```typescript
interface SemanticConstraintResult {
  action: DetectedAction;
  decision: 'ok' | 'needs_clarification';
  reason?: 'past_date' | 'outside_business_hours';
  message?: string;
}
```

- **Past-date guard:** `due_date < today` ? decision: `needs_clarification`
- **Business-hours guard:** `due_time` outside 06:00–22:00 for appointment-style tasks ? decision: `needs_clarification`

Results stored in `log.semanticConstraintResults` and surfaced in the execution plan as `clarify` steps.

### 3.7 Booking task detection

**File:** `src/lib/brainDumpParser.ts`

A task is flagged as a **booking** when the title matches booking verbs + future-event context:
`book / reserve / arrange / schedule / organise / plan X for [day]`
`get / order / pick up X for [day/person]`

For booking tasks:
- `due_date` = **today** (the task to do is the booking action itself)
- `title` **preserves** `"for [weekday]"` — never stripped as a temporal phrase
- LLM prompt rule: `is_booking: true` ? `due_date: today`, title includes "for [day]"

### 3.8 Unsupported feature detection

**File:** `src/lib/unsupportedFeatureDetector.ts`

Regex map of inputs that request features Laya doesn't support (recurring tasks, reminders to contacts, shared task assignment). Returns a graceful fallback message explaining the limitation instead of creating a malformed task.

### 3.9 `WaConversationState` — `pending_confirmation` (new in v6)

**File:** `src/lib/waConversationState.ts`

```typescript
export type PendingConfirmation =
  | { type: 'task_delete';      taskId, taskTitle, message }
  | { type: 'list_item_remove'; item, listId, listName, message }
  | { type: 'list_disambig';    existingListId, existingListName, newListName, items, message }
  | { type: 'translation';      originalText, translatedText, message };

export interface WaConversationState {
  auth_user_id: string;
  active_task_id: string | null;
  active_list_id: string | null;
  last_task_title: string | null;
  last_list_name: string | null;
  last_entity_text: string | null;
  pending_confirmation: PendingConfirmation | null;  // ? new in v6
  updated_at: string;
  expires_at: string;
}
```

`pending_confirmation` stores the state of a destructive or ambiguous action waiting for user YES/NO. On the next turn, `whatsapp-processor.ts` checks this field first, before any other routing. If the user responds YES/NO, the pending action is executed or cancelled and the field is cleared.

**DB:** `wa_conversation_state.pending_confirmation JSONB` — added by migration `20260503000000`.

---

## 4. DetectedAction Union — Complete (v6)

**File:** `src/lib/turnInterpreter.ts`

```typescript
export type DetectedAction =
  // Fresh capture
  | { type: 'create_task';          task: ProposedTask }
  | { type: 'create_list';          listName: string; items: string[] }
  | { type: 'add_list_items';       listName: string | null; listId: string | null; items: string[] }
  // Edit/move (single-turn)
  | { type: 'update_task';          taskTerm: string; patch: EditPatch }
  // List maintenance
  | { type: 'remove_list_item';     item: string; listName: string | null; listId: string | null }
  // Follow-ups (require active convState)
  | { type: 'task_follow_up_patch'; patch: EditPatch; taskId: string; taskTitle: string | null }
  | { type: 'task_follow_up_delete';taskId: string; taskTitle: string | null }
  | { type: 'task_follow_up_done';  taskId: string; taskTitle: string | null }
  | { type: 'list_item_follow_up';  items: string[]; listId: string; listName: string | null }
  | { type: 'entity_to_list';       entityText: string; listName: string | null }
  // LLM-signalled special states
  | { type: 'filler' }
  | { type: 'needs_clarification';  question: string; reason: string };
```

---

## 5. Classification Observability

**File:** `src/lib/intentClassifier.ts`

Every `classifyIntent()` call emits a `ClassificationMeta` record logged in `TurnInterpretation.log.classification`:

| Field | Values | Meaning |
|-------|--------|---------|
| `reasonCode` | `rules_only_mode` | Flag off; rules used |
| | `rules_matched` | Rules found actions with sufficient coverage |
| | `llm_multiline_routing` | **New** — input had newlines; LLM called with raw text |
| | `llm_gap_fill` | Rules found 0 actions; LLM filled the gap |
| | `llm_partial_fill` | Rules found some actions; LLM added missed ones |
| | `llm_missing_api_key` | No API key; rules fallback |
| | `llm_empty_response` | LLM returned empty content; rules kept |
| | `llm_schema_validation_failed` | Zod parse failed; rules kept |
| | `llm_runtime_error` | Any other exception; rules kept |
| `classifierMode` | `rules` / `llm` / `llm_with_rules_fallback` | Which path ran |
| `classificationSource` | `rules` / `llm` / `llm_failed_rules_used` | Which produced the result |
| `fallbackUsed` | bool | Whether LLM failed and rules were used instead |
| `timings` | `{ totalMs, llmMs?, rulesMs? }` | Per-phase latency |

Stored in `ai_turn_log` table. New columns added in v6:
- `temporal_term_original` — the raw temporal phrase the user used
- `temporal_term_resolved` — the resolved date/time

---

## 6. List Follow-up Improvements (v6)

**File:** `src/lib/waFollowUpParser.ts`

### 6.1 Item prefix/suffix cleanup (A4a)

Items extracted from follow-up messages are cleaned before storage:

```
ITEM_PREFIX_RE: /^(and\s+|put\s+|also\s+|just\s+|please\s+|maybe\s+)/i
ITEM_SUFFIX_RE: /\s+(too|as\s+well|also|please|in\s+there)$/i
```

So "and bread" ? "bread", "put butter in there too" ? "butter".

### 6.2 "add X and Y" with active list (A4b)

`detectListItemFollowUpIntent(text, hasActiveList?)` accepts an optional flag. When `hasActiveList=true` (passed by both `turnInterpreter.ts` and `whatsapp-processor.ts` when `convState.active_list_id` is set):

- "add aloo and pyaz" ? `list_item_follow_up { items: ['aloo', 'pyaz'] }`
- Without the flag, "add" triggers the `hasCommandVerb` guard and the message falls through to the rules/LLM path

---

## 7. Simulator Architecture

The simulator is a developer tool for measuring pipeline quality. It runs offline with no production impact.

**Files:**
- `scripts/unload-simulator.ts` — main runner
- `scripts/simulator-prompts.ts` — 100 diverse test inputs with stable IDs
- `scripts/simulator-report.ts` — HTML report generator

### 7.1 Four passes per prompt

| Pass | What it calls | Purpose |
|------|--------------|---------|
| **Run A** | `interpretTurn()` with `USE_LLM_CLASSIFICATION=false` | Rules-only baseline |
| **Run B** | `interpretTurn()` with `USE_LLM_CLASSIFICATION=true` | **Current production pipeline** |
| **Run C** | Direct OpenAI call with expanded `buildRunCPrompt()` | Ideal LLM-first benchmark |
| **Run D** | Signal extraction from Run B's `TurnInterpretation` | Quality measurement of Run B |

**Run D is not a separate execution** — it re-uses Run B's output to extract quality signals: filler detected, confirm/clarify steps, booking title preserved, semantic constraint violations, date/time resolution quality, and the actual response message the user would see.

### 7.2 Run C prompt improvements (v6)

`buildRunCPrompt()` now includes:
- **Explicit next-week dates** for all 7 days — fixes "next Monday" being resolved to wrong week (B1)
- **`new_title` in `update_task` schema** — supports rename detection (B2)
- **Hallucination filter** — removes LLM outputs where `taskTerm === "(clarify task)"` (B3)
- **Explicit pronoun resolution hint** — "When the user says 'it', they mean the task 'Call the bank'" (B4)

### 7.3 Run C vs Run B scoring

`deriveRunCOutcome()` compares Run C action count against `max(Run A, Run B)`:

| Condition | Score |
|-----------|-------|
| Run C count > currentBest | `better` |
| Run C count = currentBest | `same` |
| Run C count < currentBest | `worse` |
| Run A produced 1 garbled task (title > 60 chars) AND Run C produced > 1 | `better` |
| Run A produced only `create_task` AND Run C produced `add_list_items`/`create_list` with ? same item count | `better` (C2 fix) |

**Known limitation:** Scoring is count-based, not type-accuracy-based. A case where both A and C produce 2 actions of different types scores `same` even if A's types are wrong. Adding expected outputs to `SimulatorPrompt` would enable true precision/recall scoring — this is **[PLANNED]**.

### 7.4 SimulatorRow — Run D columns

| Column | Type | Meaning |
|--------|------|---------|
| `rund_filler` | bool | Filler action detected (A3 fires) |
| `rund_needs_clarification` | bool | LLM returned `needs_clarification` |
| `rund_confirm_steps` | int | Destructive action gated on YES/NO |
| `rund_clarify_steps` | int | Semantic/text-level clarification steps |
| `rund_booking_preserved` | bool | Any task title contains "for [weekday]" |
| `rund_semantic_violations` | int | Past-date or outside-hours violations |
| `rund_sufficiency_issues` | int | Empty title / missing required field |
| `rund_date_summary` | string | Per-task date/time resolution with inferred flags |
| `rund_inferred_date_count` | int | Tasks where date defaulted to today |
| `rund_inferred_time_count` | int | Tasks where time was defaulted |
| `rund_response_message` | string | **New in v6** — the actual message the user would see |
| `rund_outcome` | `new_signal` / `cleaner` / `same` | Overall signal quality label |

### 7.5 Golden test suite

**File:** `src/__tests__/simulator-golden.test.ts`

29 pinned regression tests covering all major rule-handled categories:
- Simple single tasks (dates, times, day-of-week)
- Colon-separated grocery/shopping lists
- Named-list additions
- Create-list patterns
- WA task follow-ups (patch, delete, mark done)
- WA list follow-ups (add X too, also add X, add X and Y with active list)
- Edit/reschedule (update_task via edit-select)

All run with `USE_LLM_CLASSIFICATION=false` — deterministic, no API calls, fast.
**Purpose:** If any case changes action type or drops below expected action count, CI fails.

---

## 8. Adaptive Routing + Memory — [PLANNED]

This section describes the forward-looking architecture for continuous improvement. Nothing here is implemented yet.

### 8.1 Why

- Rules are brittle — every new edge case requires a developer to write a new rule
- gpt-4o-mini handles common patterns well but fails on implicit references without examples
- gpt-4o is reliable but ~37× more expensive per token than mini
- Neither model "learns" — without a feedback loop, quality does not improve over time

The goal: the app learns from every correctly-handled interaction, routes cheaper and faster over time, and escalates genuinely novel inputs to the most capable model.

### 8.2 Phase 1 — Correctness signal [PLANNED]

Capture whether the pipeline got each turn right. Sources (in order of reliability):
1. **User edits the created task within 60 seconds** — likely wrong title, date, or type
2. **User immediately sends a correction** — "no, I meant Saturday not Friday"
3. **Sufficiency check failed** — structural error caught by `validateAllActions()`
4. **Explicit thumbs up/down** — optional UI element post-creation (WhatsApp: ??/?? reply)

Stored as `correct: boolean | null` on `ai_turn_log` rows.

### 8.3 Phase 2 — Golden examples repository [PLANNED]

A Supabase table `golden_examples` storing verified correct `(input ? action)` pairs:

```sql
CREATE TABLE golden_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input text NOT NULL,
  category text NOT NULL,
  canonical_actions jsonb NOT NULL,  -- DetectedAction[]
  source text NOT NULL,              -- 'human_verified' | 'auto_confirmed' | 'simulator'
  confidence float NOT NULL DEFAULT 1.0,
  embedding vector(1536),            -- text-embedding-3-small for similarity search
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX ON golden_examples USING ivfflat (embedding vector_cosine_ops);
```

Seeded from the simulator's 29 golden tests. Grows over time from Phase 1 signals.

### 8.4 Phase 3 — Few-shot injection [PLANNED]

On every LLM call:
1. Embed the input (OpenAI `text-embedding-3-small`, ~1ms, ~$0.00000002/call)
2. Retrieve 3–5 most similar `golden_examples` via `pgvector` cosine similarity
3. Inject them into the LLM prompt as concrete input?output demonstrations

This dramatically improves gpt-4o-mini's accuracy on patterns it has seen before, particularly for implicit references ("make it Friday" when the active task is "Call the bank").

### 8.5 Phase 4 — Confidence-based model routing [PLANNED]

Use the similarity score from Phase 3 to select the model and path:

| Similarity | Route | Latency | Cost/call |
|------------|-------|---------|-----------|
| > 0.95 | Return cached action, skip LLM | < 10ms | Free |
| 0.80–0.95 | gpt-4o-mini + few-shot examples | ~400ms | ~$0.00008 |
| 0.60–0.80 | gpt-4o-mini, more examples | ~600ms | ~$0.00015 |
| < 0.60 | gpt-4o, full prompt | ~1200ms | ~$0.003 |

Controlled by the existing `USE_LLM_CLASSIFICATION` flag, extended with a `LLM_ROUTING_MODE` flag:
- `hybrid` (current) — rules + LLM gap-fill
- `llm_first` — LLM for all inputs, routing by confidence
- `rules_only` — no LLM, fully deterministic

### 8.6 Phase 5 — Auto-promotion loop [PLANNED]

A background job (runs nightly or on-demand):
1. Reviews inputs that hit the low-confidence gpt-4o path
2. If the output was confirmed correct (Phase 1 signal), promotes to `golden_examples`
3. Re-embeds and indexes the new example
4. Next time a similar input arrives, it routes to mini or cache instead of gpt-4o

Over time, the expensive path shrinks. The app converges on mini + cache for the majority of inputs.

---

## 9. DB Schema Changes (v6)

### 9.1 `wa_conversation_state`

```sql
-- Added by: supabase/migrations/20260503000000_wa_conversation_state_pending_confirmation.sql
ALTER TABLE wa_conversation_state
  ADD COLUMN pending_confirmation JSONB;
```

### 9.2 `ai_turn_log`

```sql
-- Added by: supabase/migrations/20260502000000_ai_turn_log_temporal.sql
ALTER TABLE ai_turn_log
  ADD COLUMN temporal_term_original TEXT,
  ADD COLUMN temporal_term_resolved  TEXT;
```

### 9.3 [PLANNED] `golden_examples`

```sql
-- Not yet created. See Section 8.3 for schema.
```

---

## 10. Key Files — v6 additions

| File | Purpose |
|------|---------|
| `src/lib/intentClassifier.ts` | LLM classification, routing logic, observability. v6: A1 multiline routing, A2 expanded schema (delete/mark_done/update), A3 filler gate |
| `src/lib/turnInterpreter.ts` | 8-step interpretation pipeline. v6: isMultiline detection before normalization, A5 conv-state resolution post-classification |
| `src/lib/waFollowUpParser.ts` | Follow-up intent detectors. v6: A4a item prefix/suffix cleanup, A4b hasActiveList parameter |
| `src/lib/temporalDictionary.ts` | Colloquial temporal term resolution map |
| `src/lib/semanticConstraintValidator.ts` | Past-date and business-hours validation |
| `src/lib/unsupportedFeatureDetector.ts` | Graceful rejection of unsupported feature requests |
| `src/lib/waConversationState.ts` | Durable per-user WA state. v6: `PendingConfirmation` type + `pending_confirmation` field |
| `src/lib/clarificationPolicy.ts` | Text-level ambiguity detection |
| `src/lib/sufficiencyValidator.ts` | Structural completeness validation |
| `src/lib/domainNormalizer.ts` | Shorthand expansion + text cleanup |
| `src/lib/domainNormalizationMap.ts` | Data-driven shorthand ? expansion map |
| `src/lib/domainReferenceResolver.ts` | Pronoun and named-reference resolution |
| `scripts/unload-simulator.ts` | 4-pass simulator runner. v6: B1–B4 Run C fixes, C1 response message, C2 scoring fix |
| `scripts/simulator-prompts.ts` | 100 test inputs with stable IDs and conv state |
| `scripts/simulator-report.ts` | HTML report generator. v6: Run D response message column + CSS |
| `src/__tests__/simulator-golden.test.ts` | **New** — 29 pinned regression tests, rules-only mode |

---

## 11. Environment Variables (v6)

| Variable | Values | Effect |
|----------|--------|--------|
| `USE_LLM_CLASSIFICATION` | `false` (default) / `true` | Enables LLM gap-fill and multiline routing |
| `OPENAI_MODEL` | `gpt-4o-mini` (default) / `gpt-4o` | Model used for all LLM classification calls |
| `OPENAI_API_KEY` | — | Required for LLM path; missing = silent rules fallback |
| `LOG_INTENT_CLASSIFICATION_VERBOSE` | `false` / `true` | Enables extended classification logs (dev/staging only) |

**[PLANNED]:**

| Variable | Values | Effect |
|----------|--------|--------|
| `LLM_ROUTING_MODE` | `hybrid` / `llm_first` / `rules_only` | Controls routing strategy when USE_LLM_CLASSIFICATION=true |

---

## 12. Summary: What's New in v6

| Area | Change |
|------|--------|
| **Multiline routing (A1)** | `isMultiline` detected before normalization; multiline inputs bypass rules and go straight to LLM with raw text (`reason_code: llm_multiline_routing`) — fixes root cause of all multi-task dump failures |
| **Expanded LLM schema (A2)** | `LLMActionSchema` now includes `delete_task`, `mark_done`, `update_task` (with `new_title`); prompt updated with rules for each; `llmActionToDetectedAction` maps them to `task_follow_up_delete`, `task_follow_up_done`, `update_task` |
| **Filler pre-check gate (A3)** | `INTROSPECTIVE_FILLER` regex fires before `rulesClassify` — prevents "I need to get better at this" from creating garbled tasks |
| **List follow-up cleanup (A4)** | Item prefix/suffix cleanup (`and/put/also` ? stripped); `hasActiveList` parameter relaxes command-verb gate so "add X and Y" fires as list follow-up when active list exists |
| **Conv-state resolution (A5)** | Post-classification pass in `interpretTurn()` upgrades LLM-produced follow-up actions to concrete types with real `taskId` when `taskTerm` matches `convState.last_task_title` |
| **Run C: next-Monday fix (B1)** | `buildRunCPrompt()` computes and injects explicit next-week dates for all 7 days |
| **Run C: rename support (B2)** | `RunCActionSchema.update_task` includes `new_title`; `summarizeRunCAction` displays it |
| **Run C: hallucination filter (B3)** | Actions where `taskTerm === "(clarify task)"` filtered out before counting |
| **Run C: explicit pronouns (B4)** | Prompt injection now says "When the user says 'it', they mean the task 'X'" |
| **Response quality column (C1)** | `rund_response_message` added to `RunDSignals`, `SimulatorRow`, HTML report, CSV — shows what the user actually sees |
| **Scoring fix id=40 (C2)** | `deriveRunCOutcome()` scores C as `better` when C returns correct list action where A returned wrong task actions for same items |
| **Golden test suite (C3)** | `src/__tests__/simulator-golden.test.ts` — 29 deterministic regression tests, rules-only mode, no API cost |
| **`pending_confirmation` (new)** | `WaConversationState` now stores pending destructive/ambiguous actions; `whatsapp-processor.ts` checks this first on every turn |
| **Temporal dictionary** | `src/lib/temporalDictionary.ts` — colloquial term resolution; integrated into `taskRulesParser.ts` and LLM prompt |
| **Semantic constraint validation** | `src/lib/semanticConstraintValidator.ts` — past-date and business-hours guards post-parsing |
| **Booking task detection** | Rules and LLM prompt aligned: booking tasks get `due_date=today`, title preserves "for [weekday]" |
| **Adaptive Routing + Memory [PLANNED]** | 5-phase architecture: correctness signal ? golden examples ? few-shot injection ? confidence routing ? auto-promotion loop |
