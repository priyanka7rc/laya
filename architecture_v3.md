## Laya Architecture v3

This document reflects the **current implementation** in the `laya` repo as of the inspected codebase. It extends `architecture_v2` with **Features #16–#19** (Lists, List Import, WhatsApp List-Read, Add-to-List, Quick Add, Clear Completed).

Where something is **not found in code**, it is called out explicitly.

---

## 1. High-Level System Overview

### 1.1 Entry Points

- **Web app (Next.js App Router)**
  - Home / App views:
    - `src/app/app/page.tsx` (App home, TaskView-backed)
    - `src/app/(tabs)/home/page.tsx` (Today / Upcoming chips, TaskView-backed)
  - Tasks tab:
    - `src/app/(tabs)/tasks/page.tsx` (search, pagination, quick add, edit, delete)
  - **Lists tab:**
    - `src/app/(tabs)/lists/page.tsx` (lists index, create, import)
    - `src/app/(tabs)/lists/[listId]/page.tsx` (list detail, items, add/toggle/delete)
  - Activity tab:
    - `src/app/(tabs)/activity/page.tsx`
  - Task edit form:
    - `src/components/TaskForm.tsx` (create + edit)
  - Floating Brain Dump:
    - `src/components/FloatingBrainDump.tsx` (parseDump → `/api/tasks/import/confirm` → `insertTasksWithDedupe`)
  - Import from media (OCR) – **Tasks**:
    - `src/components/ImportTasksModal.tsx`
    - `src/app/api/media/upload/route.ts`
    - `src/app/api/media/[mediaId]/ocr/route.ts`
    - `src/app/api/tasks/import/preview/route.ts`
    - `src/app/api/tasks/import/confirm/route.ts`
  - **Import from media (OCR) – Lists:**
    - `src/components/ImportListsModal.tsx`
    - Same upload/OCR APIs; list-specific:
    - `src/app/api/lists/import/preview/route.ts`
    - `src/app/api/lists/import/confirm/route.ts`
    - `src/app/api/lists/import/save-inbox/route.ts`
  - Task creation API (keyboard):
    - `src/app/api/tasks/create/route.ts`
  - Task update API (edit):
    - `src/app/api/tasks/update/route.ts`
  - Task delete / undo APIs:
    - `src/app/api/tasks/delete/route.ts`
    - `src/app/api/tasks/undo-delete/route.ts`

- **Brain Dump API (rules-only, text → multiple tasks)**
  - `POST /api/parseDump` → `src/app/api/parseDump/route.ts`

- **Brain Dump insert**
  - `FloatingBrainDump` → `POST /api/parseDump` → `POST /api/tasks/import/confirm` → `insertTasksWithDedupe`
  - Optional background: `POST /api/refineTasks` after insert.

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
  - Daily digest job: `runDailyDigestJob` in `src/lib/whatsapp-digest.ts` (uses Task View, sends via template/fallback).

---

## 2. Canonical Task Intake (Text → ProposedTasks → Insert)

*(Unchanged from v2.)*

All flows that turn **text into tasks** converge on:
- `src/lib/task_intake.ts` (`segmentToProposedTask`, `textToProposedTasksFromSegments`)
- Parsing helpers: `taskRulesParser.ts`, `categories.ts`
- **Insert**: `src/server/tasks/insertTasksWithDedupe.ts`

**Surfaces using `insertTasksWithDedupe`:**
- `/api/tasks/create` (Web keyboard)
- `/api/tasks/import/confirm` (Web OCR, **Brain Dump**, WhatsApp OCR tasks)
- WhatsApp rules-first create flows (text/audio, media OCR → tasks)

---

## 3. Task View Engine (Read Path)

*(Unchanged from v2.)*

- **Contracts:** `src/lib/taskView/contracts.ts`
- **Queries:** `src/server/taskView/taskViewQueries.ts`
- **Engine:** `src/server/taskView/taskViewEngine.ts` → `executeTaskView(request)`
- **Adapters:** Web Tasks/Home tabs, `handleTaskQuery` (WhatsApp), digest/reminder jobs

---

## 4. Lists Feature (Features #16–#19)

### 4.1 Schema

- **`lists`** (`supabase/migrations/20260304000000_lists.sql`):
  - `id`, `app_user_id`, `name`, `source`, `source_message_id`, `created_at`, `updated_at`, `deleted_at`, `deleted_source`, `deleted_by_auth_user_id`, `import_candidates`
  - System lists: `is_system`, `system_key` (e.g. `inbox`) — `20260305030000_lists_system_inbox.sql`

- **`list_items`** (`20260306000000_list_items.sql`):
  - `id`, `app_user_id`, `list_id`, `text`, `normalized_text`, `is_done`, `source`, `created_at`, `updated_at`, `deleted_at`

- **`messages.list_ids`** (`20260307000000_messages_list_ids.sql`):
  - JSONB array of list IDs for reply-anchored add-to-list.

### 4.2 List View Engine

- **Contracts:** `src/lib/listView/contracts.ts` (e.g. `ListViewList`, `ListViewResult`)
- **Queries:** `src/server/listView/listViewQueries.ts` → `queryAllLists`
- **Engine:** `src/server/listView/listViewEngine.ts` → `executeListView`

### 4.3 List CRUD and APIs

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/lists/view` | GET | Paginated lists (`executeListView`) |
| `/api/lists/create` | POST | Create list |
| `/api/lists/[listId]/items` | GET, POST | Get or add items |
| `/api/list-items/[itemId]` | PATCH, DELETE | Update or soft-delete item |

### 4.4 List Import (OCR)

- **Flow:**
  1. Upload: `POST /api/media/upload` → `mediaId`
  2. OCR: `POST /api/media/[mediaId]/ocr` → `ocr_text` in `media_uploads`
  3. Preview: `POST /api/lists/import/preview` → `buildOcrImportPreview` (`src/lib/ocr_import_preview.ts`)
  4. Confirm: `POST /api/lists/import/confirm` → `insertListWithIdempotency` (`src/server/lists/insertListWithIdempotency.ts`)
  5. Optional: `POST /api/lists/import/save-inbox` → `getOrCreateSystemList` for inbox

- **Key modules:**
  - `src/lib/listImportCandidates.ts`, `src/lib/list_intake.ts` (OCR → proposed lists)
  - `insertListWithIdempotency` enforces idempotency via `source` + `source_message_id`

### 4.5 List item operations

- **Server/lib:** `src/lib/listItems.ts`
  - `insertListItems`, `findListItemByText`, `findListItemByTextAcrossLists`, `updateListItem`, `softDeleteListItem`
- **Server:** `src/server/listQueries.ts`
  - `getUserLists`, `getListByName`, `getListItems`, `deleteCompletedItems`

---

## 5. WhatsApp List Handlers

### 5.1 Handlers in `whatsapp-processor.ts`

| Handler | Purpose |
|--------|---------|
| `handleListRead` | Show lists, show specific list, reply-anchored open list |
| `handleAddToList` | Add items (reply-anchored via `list_ids`, or by list name) |
| `handleListItemDoneRemove` | Done/remove items ("done 1", "remove milk") |
| `handleOcrImportPending` | OCR import flows (`ocr_import_list_name`, `ocr_import_confirm_tasks`) |

### 5.2 Parser helpers

- **`waListReadParser.ts`**: `detectShowListsIntent`, `detectShowSpecificListIntent`, `detectClearCompletedIntent`, `formatListSummary`, `formatListPreview`
- **`waAddToListParser.ts`**: `detectAddToListIntent`, `parseDoneRemoveIntent`, `splitItemPhrase`

### 5.3 WhatsApp list intents

- **list-read**: "show lists", "my lists", specific list name
- **add-to-list**: "add X to grocery", reply to list preview
- **add-to-list-choose**: Disambiguation when multiple lists match (1, 2, …)
- **quick-add**: Plain text → add to list (after opening list; 5 min expiry)
- **done/remove**: "done 1", "done milk", "remove bread"
- **clear-completed**: "clear completed", "remove completed", "delete completed"

### 5.4 List action counter and preview

- **In-memory:** `listActionCounterStore` (Map: `userId:listId` → `{ counter, listName }`)
- **`maybeSendListPreviewAfterAction`**: After 3 add/done/remove actions on a list, sends a list preview and resets counter.
- **`resetListActionCounter`**: Called when user opens a list (e.g. in `handleListRead`).

### 5.5 Quick Add Mode (`wa_pending_actions`)

- **Action type:** `quick_add`
- **Payload:** `{ listId, listName, addCount }`
- **Expiry:** 5 minutes
- **Flow:** User opens list → `upsertQuickAdd`; subsequent plain text → intercepted as add-to-list until expiry or exit phrase ("done", "exit", "cancel", etc.)

---

## 6. WhatsApp Anchoring: `messages.provider_message_id` + `task_ids` + `list_ids`

### 6.1 Schema

- `messages.provider_message_id` — Gupshup message ID
- `messages.task_ids` — JSONB array for task list anchoring (delete, edit)
- `messages.list_ids` — JSONB array for list anchoring (add-to-list, open list)

### 6.2 Persistence coverage

- **Task lists:** `kind: 'task_list' | 'search_results' | 'digest' | 'delete_confirm'` → `task_ids`, `providerMessageId`
- **List previews:** `kind: 'list_preview' | 'list_summary'` → `list_ids`, `providerMessageId`

---

## 7. `wa_pending_actions` — All Action Types

| Action type | Purpose |
|-------------|---------|
| `edit` | Task edit (reply-anchored, 2h expiry) |
| `ocr_import_list_name` | OCR import: choosing list name |
| `ocr_import_confirm_tasks` | OCR import: confirming tasks |
| `add_to_list_choose` | List disambiguation (1, 2, …) |
| `quick_add` | Quick add to list (5 min expiry) |

---

## 8. Scheduling, Delete, Edit (unchanged from v2)

- **Canonical schedule:** `due_date`/`due_time` → `computeDueAtFromLocal`, `computeRemindAtFromDueAt`
- **Updates:** `updateTaskFields`
- **Soft delete + undo:** `deleteTasks`, `undoDelete`; reply-anchored delete via `messages.task_ids`
- **Edit:** Pending sessions in `wa_pending_actions`, idempotency via `last_inbound_provider_message_id`

---

## 9. OCR Provider (swappable)

- **Env:** `OCR_PROVIDER` — `openai` (default) or `google`
- **Interface:** `OcrClient` in `src/server/ocr/types.ts`
- **Providers:** `src/server/ocr/providers/openai.ts`, `providers/google.ts`
- **Registration:** `src/server/ocr/index.ts` → `getOcrClient()`
- **Used by:** Task import, List import, WhatsApp media (image/document)

---

## 10. UI Structure

### 10.1 Layout

- **Root layout:** `src/app/layout.tsx`
  - Providers: AuthProvider, PostHogProvider, ThemeProvider, ToastProvider
  - Global: ThemeToggle, ConditionalNav, FloatingBrainDump, ToastViewport

### 10.2 Navigation

- **Bottom nav:** `src/components/BottomNavigation.tsx` — Home, Tasks, Activity (Lists not in nav; reachable via `/lists`)

### 10.3 Key components

- **FloatingBrainDump:** Parse → `/api/tasks/import/confirm` → insert; optional `/api/refineTasks` in background
- **ImportTasksModal**, **ImportListsModal** — OCR import flows
- **TaskForm** — Create/edit tasks

---

## 11. Summary

`architecture_v3` captures the current model:

- **Tasks:** Single insert path (`insertTasksWithDedupe`), single update path (`updateTaskFields`), Task View engine, canonical schedule, soft delete + undo, reply anchoring for delete/edit.
- **Lists:** Lists + list_items schema, List View engine, OCR list import, web CRUD, WhatsApp list-read/add/done/remove/clear-completed/quick-add.
- **WhatsApp:** Reply anchoring for tasks (`task_ids`) and lists (`list_ids`); `wa_pending_actions` for edit, OCR import, add-to-list disambiguation, quick-add.
- **Brain Dump:** Uses `insertTasksWithDedupe` via `/api/tasks/import/confirm` (no direct client insert).
