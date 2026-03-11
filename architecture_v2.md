## Laya Tasks-Only MVP Architecture (v2)

This document reflects the **updated implementation** in the `laya` repo after Features **#1–7** (task creation), **#8–#11** (Task View), **#12–#13** (Task Edit), and **#14–#15** (Task Delete).

Where something is **not found in code**, it is called out explicitly.

---

## 1. High-Level System Overview

### 1.1 Entry points

- **Web app (Next.js App Router)**
  - Home / App views:
    - `src/app/app/page.tsx` (App home, TaskView-backed)
    - `src/app/(tabs)/home/page.tsx` (Today / Upcoming chips, TaskView-backed)
  - Tasks tab:
    - `src/app/(tabs)/tasks/page.tsx` (search, pagination, quick add, edit, delete)
  - Task edit form:
    - `src/components/TaskForm.tsx` (create + edit)
  - Floating Brain Dump:
    - `src/components/FloatingBrainDump.tsx`
  - Import from media (OCR):
    - `src/components/ImportTasksModal.tsx`
    - `src/app/api/media/upload/route.ts`
    - `src/app/api/media/[mediaId]/ocr/route.ts`
    - `src/app/api/tasks/import/preview/route.ts`
    - `src/app/api/tasks/import/confirm/route.ts`
  - Task creation API (keyboard):
    - `src/app/api/tasks/create/route.ts`
  - Task update API (edit):
    - `src/app/api/tasks/update/route.ts`
  - Task delete / undo APIs:
    - `src/app/api/tasks/delete/route.ts`
    - `src/app/api/tasks/undo-delete/route.ts`

- **Brain Dump API (rules-only, text → multiple tasks)**
  - `POST /api/parseDump` → `src/app/api/parseDump/route.ts`

- **Brain Dump refinement (AI, background)**
  - `POST /api/refineTasks` → `src/app/api/refineTasks/route.ts`  
    (Used by `FloatingBrainDump` after initial rules-first insert.)

- **WhatsApp webhook (Gupshup / Meta)**
  - `GET /api/whatsapp-webhook` (verification)
  - `POST /api/whatsapp-webhook`  
    → `src/app/api/whatsapp-webhook/route.ts`  
    → `processWhatsAppMessage` in `src/lib/whatsapp-processor.ts`.

- **WhatsApp account linking**
  - Web: `src/app/link-whatsapp/page.tsx`
  - API: `src/app/api/link-whatsapp/route.ts`

- **Reminder and digest jobs**
  - Reminder job: `runReminderJob` in `src/lib/whatsapp-reminder.ts` (uses Task View).
  - Daily digest job (scheduled Mode B): `runDailyDigestJob` in `src/lib/whatsapp-digest.ts` (uses Task View, sends via template/fallback).

---

## 2. Canonical Task Intake (Text → ProposedTasks → Insert)

### 2.1 Shared intake pipeline

All flows that turn **text into tasks** (Web keyboard, Web brain dump, Web OCR, WhatsApp text/audio/media) converge on:

- `src/lib/task_intake.ts`
  - `segmentToProposedTask`
  - `textToProposedTasksFromSegments`
- Parsing helpers:
  - `src/lib/taskRulesParser.ts`: `parseDate`, `parseTime`, `getSmartDefaultTime`, `stripTemporalPhrases`
  - `src/lib/categories.ts`: `detectCategory` and canonical category set

Guarantees:
- **Rules-first parsing**, no AI in hot path.
- Every `ProposedTask` has **non-null schedule**:
  - `due_date` (`YYYY-MM-DD`)
  - `due_time` (`HH:MM`)
- Inference flags:
  - `inferred_date`, `inferred_time` (for Confirm schedule/time/date badges).

### 2.2 Canonical insert-with-dedupe

- `src/server/tasks/insertTasksWithDedupe.ts`

Responsibilities:
- Accepts `ProposedTask[]` + `allowDuplicateIndices` + `source` + `source_message_id`.
- Enforces:
  - **Non-null schedule invariants** (fills defaults if necessary).
  - **5-second duplicate window**:
    - Key: `normalized title + due_date + due_time + user_id`.
    - Filters duplicates; returns both inserted and duplicate entries.
  - **Strong idempotency** for external sources:
    - First checks `tasks.source_message_id = provided` (O(1) index) before window dedupe.
- Writes via service-role Supabase client to `public.tasks`.

Used by:
- `/api/tasks/create` (Web keyboard)
- `/api/tasks/import/confirm` (Web OCR / Import)
- WhatsApp rules-first create flows:
  - Text/audio → `createTasksFromTextRules` → `insertTasksWithDedupe`
  - Media (image/PDF) → OCR → `ocrTextToProposedTasks` → `insertTasksWithDedupe`

---

## 3. Task View Engine (Read Path)

### 3.1 Contracts + queries + engine

- **Contracts:** `src/lib/taskView/contracts.ts`
  - `TaskViewTask`: normalized view type (camelCase, `dueAt`, `remindAt`, plus legacy fields like `due_date`, `due_time`, `created_at?` for UI/back-compat).
  - `TaskViewRequest`, `TaskViewFilters`, `TaskViewPagination`, `TaskViewResult`.

- **Queries:** `src/server/taskView/taskViewQueries.ts`
  - `queryAllTasks`, `queryTodayTasksInWindow`, `queryUpcomingDaysTasks`, `querySearchTasks`, `queryReminderWindowTasks`, etc.
  - All queries:
    - Filter by `app_user_id`.
    - Exclude soft-deleted tasks: `deleted_at IS NULL`.
    - Use **deterministic ordering** (`created_at`, `due_at`, `remind_at`) + cursor pagination helpers.

- **Engine:** `src/server/taskView/taskViewEngine.ts`
  - `executeTaskView(request: TaskViewRequest)`:
    - Resolves identity (authUserId/phone → `app_user_id`) via `app_users` / `whatsapp_users`.
    - Computes **timezone-aware windows** via `src/lib/taskView/time.ts`:
      - `getLocalDayWindow`, `getUpcomingWindow`, `getStartOfDayInTz`, `getEndOfDayInTz`.
    - Delegates to the appropriate query and returns `TaskViewResult`.

### 3.2 Adapters (Web + WhatsApp)

- **Web Tasks tab:** `src/app/(tabs)/tasks/page.tsx`
  - Uses `executeTaskView` with:
    - `view: 'all'` for normal list.
    - `view: 'search'` when search term non-empty.
  - Paginates via `pageInfo.nextCursor`.

- **Web Home tab:** `src/app/(tabs)/home/page.tsx`
  - Chips: Today / Upcoming
  - Today: `view: 'today'`.
  - Upcoming: `view: 'upcomingDays'` with “next 2 calendar days” semantics.

- **WhatsApp query:** `handleTaskQuery` in `src/lib/whatsapp-processor.ts`
  - Parses `queryText` into filters (`category`, `date`, `term`).
  - Uses `view: 'today' | 'all' | 'search'`.
  - Formats via `formatTaskListForQuery`.

- **WhatsApp digest:**
  - On-demand (Mode A): `handleTaskQuery` detects “what do I have today”-style intents and uses:
    - `view: 'digest'` + `formatDigestFromResult`.
    - Persists the digest list in `messages` with `task_ids`, `kind: 'digest'`, and `provider_message_id`.
  - Scheduled (Mode B): `runDailyDigestJob` uses `view: 'digest'` and `formatDigestFromResult`, but currently **does not** persist `messages` rows.

---

## 4. Scheduling Model and Reminder Windows

### 4.1 Canonical schedule

- **Canonical fields:**
  - `due_date` (`YYYY-MM-DD`)
  - `due_time` (`HH:MM`)
- Derived server-side:
  - `src/lib/tasks/schedule.ts`:
    - `computeDueAtFromLocal(tz, dueDate, dueTime)` → UTC ISO `due_at`.
    - `computeRemindAtFromDueAt(dueAt)` → UTC ISO `remind_at = due_at - 15m`.
  - All writes (create + update) use these helpers so `due_at` / `remind_at` are **derived**, not directly edited arbitrarily.

### 4.2 Updates

- **Shared update mutation:** `src/server/tasks/updateTaskFields.ts`
  - Single source of truth for task edits:
    - Ownership, non-null schedule, `due_at`/`remind_at` recompute, and patch-only updates.
- **Web edit path:**
  - `TaskForm` (edit mode) → `POST /api/tasks/update` → `updateTaskFields`.

- **WhatsApp edit path:**
  - Pending session Stage 2 (see below) calls `updateTaskFields` with patch derived from text.

---

## 5. Delete & Undo (Web + WhatsApp) – Features #14–15

### 5.1 Soft delete + schema

- `supabase/migrations/20260301000000_tasks_soft_delete_and_anchoring.sql`:
  - `tasks.deleted_at`, `deleted_source`, `deleted_by_auth_user_id`.
  - `messages.task_ids jsonb`, `messages.kind text`.
  - `whatsapp_users.last_deleted_task_ids jsonb`, `last_deleted_at timestamptz`.

### 5.2 Web delete + undo

- API routes:
  - `POST /api/tasks/delete` → `deleteTasks` server mutation.
  - `POST /api/tasks/undo-delete` → `undoDelete` server mutation.
- UI:
  - Tasks tab shows delete icon.
  - On delete:
    - Optimistically removes from list.
    - Calls `/api/tasks/delete`.
    - Shows toast with **Undo** action; Undo hits `/api/tasks/undo-delete` and refreshes.

### 5.3 WhatsApp delete + UNDO

- Core logic in `src/lib/whatsapp-processor.ts`:
  - `parseDeleteIntent` / `waDeleteParser.ts`.
  - `handleTaskDelete`:
    - Reply-anchored via `messages.provider_message_id` and `task_ids` (see Section 6).
    - Search fallback with confirm (single) or list (multi).
  - Undo:
    - `whatsapp_users.last_deleted_task_ids` + `last_deleted_at`.
    - `UNDO` keyword within 5 minutes uses `undoDelete` and returns friendly copy.

---

## 6. WhatsApp Edit (Features #12–13, WA-side)

### 6.1 Pending edit sessions: `wa_pending_actions`

- Migration: `supabase/migrations/20260303000000_wa_pending_actions.sql`:
  - `id`, `auth_user_id`, `app_user_id`, `action_type='edit'`, `task_id`, `source_provider_message_id`, `created_at`, `expires_at`, `last_inbound_provider_message_id`.
- Accessed only from `whatsapp-processor.ts` using a **service-role** Supabase client.
- Helpers:
  - `getActivePendingEdit(authUserId)` – returns latest active edit session.
  - `upsertPendingEdit(authUserId, appUserId, taskId, sourceProviderMessageId, expiresAt)` – clears and inserts an edit row.

### 6.2 Edit selection (Stage 1)

- Parsing:
  - `src/lib/waEditParser.ts`:
    - `parseEditSelectionIntent` → `edit_bare` / `edit_index` / `edit_term`.
- Handler:
  - In `processWhatsAppMessage`:
    - If `editSelectionIntent` present:
      - **Reply-anchored**:
        - Use `replyToMessage` (Gupshup provider id) to find `messages` row by `provider_message_id`.
        - Read `task_ids[]`; single → pending; multi + `edit N` → pick index; multi bare → show numbered list and persist it.
      - **Search fallback**:
        - `edit milk` → Task View search (view: `search`).
        - 0/1/many results: no matches, direct pending, or numbered list + persisted message respectively.
      - Always creates/refreshes `wa_pending_actions` row with `expires_at ≈ now + 2h`.

### 6.3 Edit apply (Stage 2)

- Same `processWhatsAppMessage` branch when:
  - An `editSelectionIntent` is **not** present, but `getActivePendingEdit` returns a row.

Flow:

1. **Expiry check**:
   - If `expires_at <= now`:
     - Delete row.
     - Send: “That edit session expired — reply to the task again with EDIT.”
2. **Idempotency gate**:
   - If `last_inbound_provider_message_id === inboundMessageId`:
     - Send: **“Already updated ✅ You’re all set.”**
     - Return (no further DB writes).
3. **Patch parsing**:
   - `parseEditPatch(text, tz)`:
     - May set `title`, `due_date`, `due_time`, `category`.
   - If patch is empty:
     - Ask: “What do you want to change? Try: tomorrow 5pm, or rename to …”
4. **Claim inbound id**:
   - Update `wa_pending_actions.last_inbound_provider_message_id = inboundMessageId`.
5. **Apply update**:
   - Build `patch` for `updateTaskFields` from the parsed fields.
   - Call `updateTaskFields({ appUserId, taskId, patch, timezone, source:'whatsapp', authUserId })`.
   - If this throws:
     - Keep pending row (with claimed inbound id).
     - Send: “I couldn’t update that—can you try again?”
     - Return.
6. **Send confirmation + cleanup**:
   - Build summary via `formatEditConfirmation(updatedTask, patch)` (high-level bullets like “Due: …”, “Title: …”).
   - Call `sendWhatsAppMessage(phoneNumber, summary)`:
     - If **send succeeds**:
       - Delete `wa_pending_actions` row (edit session complete).
     - If **send fails**:
       - Log error and **keep** the pending row; idempotency guard prevents double-apply if the same inbound id is retried.

---

## 7. WhatsApp Anchoring: `messages.provider_message_id` + `task_ids`

### 7.1 Schema & migration

- `supabase/migrations/20260302000000_messages_provider_message_id.sql`:
  - `messages.provider_message_id TEXT`
  - Index: `idx_messages_provider_message_id` (filtered non-null).

### 7.2 Persistence coverage

Every **user-initiated** task list whose replies we want to anchor now:

- **Sends first**, capturing the Gupshup `messageId`.
- Calls `saveOutboundMessage({ userId, content, taskIds, kind, providerMessageId })`.

These include:

- Query lists and search results (`kind: 'task_list'` / `'search_results'`).
- On-demand digest lists (`kind: 'digest'`).
- Delete search confirmations and ambiguity lists (`'delete_confirm'`, `'task_list'`).
- Edit selection lists (`'task_list'`, `'search_results'`).
- Web-text-like WA confirmations:
  - WA text rules-first create confirmations (`kind: 'create_confirm'`).
  - WA media OCR confirmations (`kind: 'brain_dump'`).

**Delete** and **Edit** both:

- Look-up `messages` by `provider_message_id = replyToMessageId`.
- Use `task_ids[]` to resolve which tasks are addressed.

---

## 8. Summary

`architecture_v2` captures the **unified** model:

- **Single insert path** (`insertTasksWithDedupe`) and **single update path** (`updateTaskFields`).
- **Task View engine** as the read-side source of truth across Web and WhatsApp.
- **Canonical schedule** from `due_date`/`due_time` → `due_at`/`remind_at`.
- **Soft delete and undo** integrated into all read queries.
- **WhatsApp reply anchoring** for delete + edit via `messages.provider_message_id` + `task_ids`.
- **WhatsApp edit** hardened with:
  - server-backed pending sessions (`wa_pending_actions`),
  - strict idempotency (`last_inbound_provider_message_id`),
  - and “delete only after send succeeds” semantics.
