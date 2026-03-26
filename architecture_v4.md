## Laya Architecture v4

This document describes the **current implementation** in the `laya` repository (Next.js App Router, React 19, Next 16). It supersedes `architecture_v3.md` with corrections for navigation, list schema/APIs, message kinds, jobs, testing, and layout.

Where behavior is **client-guarded** (auth) or **optional** (signature validation), that is noted.

---

## 1. High-Level System Overview

### 1.1 Entry Points — Web (Next.js App Router)

**Routing**

- **`/`** (`src/app/page.tsx`): client redirect — signed-in → `/home`, signed-out → `/signin`.
- **Auth:** `src/app/signin/page.tsx`, `src/app/login/page.tsx`, `src/app/auth/callback/page.tsx`.
- **Onboarding:** `src/app/onboarding/page.tsx`, `src/app/onboarding/first-task/page.tsx`.
- **App “tabs” (route group `(tabs)`):**
  - **Home:** `src/app/(tabs)/home/page.tsx` — Today / Upcoming (TaskView-backed).
  - **Tasks:** `src/app/(tabs)/tasks/page.tsx` — search, pagination, quick add, edit, delete, OCR import modal.
  - **Lists:** `src/app/(tabs)/lists/page.tsx` — index, create, import, star/unstar; `src/app/(tabs)/lists/[listId]/page.tsx` — items, add/toggle/delete.
  - **Unload (capture):** `src/app/(tabs)/capture/page.tsx` — brain dump / unload flow.
  - **Profile:** `src/app/(tabs)/profile/page.tsx`.
  - **Activity:** `src/app/(tabs)/activity/page.tsx` — present in repo; **not** linked from bottom or desktop primary nav (reachable by URL if used elsewhere).

**Alternate home**

- **`/app`** — `src/app/app/page.tsx` (TaskView-backed; root layout treats `/app` like main shell routes).

**WhatsApp linking**

- **Web:** `src/app/link-whatsapp/page.tsx`
- **API:** `src/app/api/link-whatsapp/route.ts`

**Floating Brain Dump**

- `src/components/FloatingBrainDump.tsx` — typically `POST /api/parseDump` → `POST /api/tasks/import/confirm` → `insertTasksWithDedupe`; optional `POST /api/refineTasks` after insert.

**Import from media (OCR) — Tasks**

- UI: `src/components/ImportTasksModal.tsx`
- APIs: `src/app/api/media/upload/route.ts`, `src/app/api/media/[mediaId]/ocr/route.ts`, `src/app/api/tasks/import/preview/route.ts`, `src/app/api/tasks/import/confirm/route.ts`

**Import from media (OCR) — Lists**

- UI: `src/components/ImportListsModal.tsx`
- Same upload/OCR routes; list routes: `src/app/api/lists/import/preview/route.ts`, `src/app/api/lists/import/confirm/route.ts`, `src/app/api/lists/import/save-inbox/route.ts`

**Task APIs**

- `src/app/api/tasks/create/route.ts`, `update/route.ts`, `delete/route.ts`, `undo-delete/route.ts`
- `src/app/api/parseDump/route.ts` — rules-only multi-task parse
- `src/app/api/refineTasks/route.ts` — background refine (e.g. after brain dump)

**Operational / misc APIs**

- `src/app/api/log/route.ts` — client error logging
- `src/app/api/generate-category/route.ts` — category helper (if used by UI)

**WhatsApp webhook**

- `POST` **`/api/whatsapp-webhook`** → `src/app/api/whatsapp-webhook/route.ts` → `processWhatsAppMessage` in `src/lib/whatsapp-processor.ts`
- **Formats:** POST accepts **Gupshup** (`type === 'message'` + `payload`). Configure the callback URL in Gupshup; there is no Meta `hub.*` verification handler in this app.

**Scheduled jobs (cron)**

- `POST /api/jobs/whatsapp-reminder` → `runReminderJob` in `src/lib/whatsapp-reminder.ts` — requires header `x-cron-secret` matching `process.env.CRON_SECRET`.
- `POST /api/jobs/whatsapp-digest` → `runDailyDigestJob` in `src/lib/whatsapp-digest.ts` — same auth.

---

## 2. Canonical Task Intake (Text → ProposedTasks → Insert)

All flows that turn **text into tasks** converge on:

- `src/lib/task_intake.ts` (`segmentToProposedTask`, `textToProposedTasksFromSegments`)
- Parsing: `src/lib/taskRulesParser.ts`, `src/lib/categories.ts`
- **Insert:** `src/server/tasks/insertTasksWithDedupe.ts`

**Surfaces using `insertTasksWithDedupe`**

- `/api/tasks/create` (web keyboard)
- `/api/tasks/import/confirm` (web OCR, brain dump, WhatsApp OCR → tasks)
- WhatsApp rules-first paths (text/audio, media OCR → tasks)

**`tasks.source` (database)**

- Enforced by `tasks_source_check` (`supabase/migrations/20260319000000_tasks_expand_source_check.sql`). Allowed values include:  
  `web`, `whatsapp`, `web_keyboard`, `web_brain_dump`, `web_media`, `whatsapp_text`, `whatsapp_media`.

---

## 3. Task View Engine (Read Path)

- **Contracts:** `src/lib/taskView/contracts.ts`
- **Queries:** `src/server/taskView/taskViewQueries.ts`
- **Engine:** `src/server/taskView/taskViewEngine.ts` → `executeTaskView(request)`
- **Consumers:** web Tasks/Home, `handleTaskQuery` (WhatsApp), reminder and digest jobs

---

## 4. Lists Feature

### 4.1 Schema

**`lists`** (base: `20260304000000_lists.sql`; extensions in later migrations)

- Core: `id`, `app_user_id`, `name`, `source`, `source_message_id`, `created_at`, `updated_at`, `deleted_at`, `deleted_source`, `deleted_by_auth_user_id`, `import_candidates`
- **System lists:** `is_system`, `system_key` (e.g. inbox) — `20260305030000_lists_system_inbox.sql`
- **Starred:** `is_starred` (boolean, default false) — `20260318000000_lists_is_starred.sql`

**`list_items`** (`20260306000000_list_items.sql`)

- `id`, `app_user_id`, `list_id`, `text`, `normalized_text`, `is_done`, `source`, `created_at`, `updated_at`, `deleted_at`

**`messages.list_ids`** (`20260307000000_messages_list_ids.sql`)

- JSONB array of list IDs for reply-anchored list flows

**`app_users.display_name`** (`20260312000000_app_users_display_name.sql`)

- Used for onboarding / profile display name

### 4.2 List View Engine

- **Contracts:** `src/lib/listView/contracts.ts`
- **Queries:** `src/server/listView/listViewQueries.ts` (includes `is_starred` / `isStarred`)
- **Engine:** `src/server/listView/listViewEngine.ts` → `executeListView`

### 4.3 List CRUD and APIs

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/lists/view` | GET | Paginated lists (`executeListView`) |
| `/api/lists/create` | POST | Create list |
| `/api/lists/[listId]` | PATCH | Update list `name` and/or `is_starred` |
| `/api/lists/[listId]/items` | GET, POST | List items; add items |
| `/api/list-items/[itemId]` | PATCH, DELETE | Update item or soft-delete |
| `/api/lists/find-or-create-and-add` | POST | Resolve list by name rules and add items (product-specific) |

### 4.4 List Import (OCR)

1. `POST /api/media/upload` → `mediaId`
2. `POST /api/media/[mediaId]/ocr` → OCR text on `media_uploads`
3. `POST /api/lists/import/preview` → e.g. `buildOcrImportPreview` (`src/lib/ocr_import_preview.ts`)
4. `POST /api/lists/import/confirm` → `insertListWithIdempotency` (`src/server/lists/insertListWithIdempotency.ts`)
5. Optional: `POST /api/lists/import/save-inbox` → `getOrCreateSystemList` (`src/server/lists/getOrCreateSystemList.ts`)

**Modules:** `src/lib/listImportCandidates.ts`, `src/lib/list_intake.ts`; idempotency via `source` + `source_message_id` where applicable.

### 4.5 List item operations

- **`src/lib/listItems.ts`:** `insertListItems`, `findListItemByText`, `findListItemByTextAcrossLists`, `updateListItem`, `softDeleteListItem`
- **`src/server/listQueries.ts`:** `getUserLists`, `getListByName`, `getListItems`, `deleteCompletedItems`, etc.

---

## 5. WhatsApp — List Handlers and Parsers

### 5.1 Handlers in `whatsapp-processor.ts` (representative)

| Handler | Purpose |
|--------|---------|
| `handleWhatsAppMedia` | Inbound media (transcription, OCR, routing) |
| `handleOcrImportPending` | OCR import (`ocr_import_list_name`, `ocr_import_confirm_tasks`) |
| `handleListRead` | Lists summary, specific list, reply-anchored open |
| `handleAddToList` | Add items (reply `list_ids` or by name) |
| `handleListItemDoneRemove` | Done / remove lines |
| `handleTaskDelete` | Reply-anchored delete |
| `handleTaskQuery` | “Show tasks” / search / today |
| `handleTaskEdit` / `handleEditSelect` / `handleEditClarification` | Edit flows |

### 5.2 Parser helpers

- **`waListReadParser.ts`:** e.g. show-lists / specific-list / clear-completed detection, `formatListSummary`, `formatListPreview`
- **`waAddToListParser.ts`:** add-to-list, done/remove parsing, `splitItemPhrase`

### 5.3 Product intents (summary)

- List read, add-to-list, disambiguation (`add_to_list_choose`), quick-add (plain text after open list), done/remove, clear completed — as implemented in processor + parsers.

### 5.4 List action counter

- **In-memory:** `listActionCounterStore` (`userId:listId` → counter + name)
- **`maybeSendListPreviewAfterAction`:** after several actions, may send a preview and reset behavior
- **`resetListActionCounter`:** e.g. when user opens a list in `handleListRead`

### 5.5 Quick Add (`wa_pending_actions`)

- **Type:** `quick_add` with payload including `listId`, `listName`, etc.
- **Expiry:** short window (e.g. ~5 minutes) with exit phrases as implemented in processor

---

## 6. WhatsApp Anchoring — `messages` Table

### 6.1 Columns (conceptual)

- **`provider_message_id`** — Gupshup / provider message id for reply anchoring
- **`task_ids`** — JSONB for task-list anchoring (delete, edit, task lists)
- **`list_ids`** — JSONB for list anchoring (add-to-list, previews)

### 6.2 Outbound `kind` values (non-exhaustive)

The processor sets various `kind` values when persisting outbound context, including for example:  
`task_list`, `search_results`, `digest`, `delete_confirm`, `list_preview`, `list_summary`, `list_add_confirm`, `ocr_import_prompt`, `ocr_import_confirm`.  
Exact set evolves with `src/lib/whatsapp-processor.ts`.

---

## 7. `wa_pending_actions` — Action Types

| Action type | Purpose |
|-------------|---------|
| `edit` | Task edit (reply-anchored; time-bounded session) |
| `ocr_import_list_name` | OCR import: list name step |
| `ocr_import_confirm_tasks` | OCR import: confirm tasks step |
| `add_to_list_choose` | Multiple list matches — pick 1, 2, … |
| `quick_add` | Quick add to an opened list |

---

## 8. Scheduling, Delete, Edit

- **Schedule:** local `due_date` / `due_time` → helpers such as `computeDueAtFromLocal`, `computeRemindAtFromDueAt` (see server task utilities)
- **Updates:** `src/server/tasks/updateTaskFields.ts`
- **Soft delete + undo:** `deleteTasks`, `undoDelete` (see `src/server/tasks/`); WhatsApp delete uses `messages.task_ids` where applicable
- **Edit:** `wa_pending_actions` + idempotency patterns (e.g. `last_inbound_provider_message_id` where used)

---

## 9. OCR Provider (Swappable)

- **Env:** `OCR_PROVIDER` — `openai` (default) or `google`
- **Types:** `src/server/ocr/types.ts` (`OcrClient`)
- **Implementations:** `src/server/ocr/providers/openai.ts`, `src/server/ocr/providers/google.ts`
- **Factory:** `src/server/ocr/index.ts` → `getOcrClient()`
- **Used by:** task import, list import, WhatsApp media pipelines

---

## 10. UI Structure and Navigation

### 10.1 Root layout (`src/app/layout.tsx`)

Nesting (outer → inner): `ThemeProvider` → `PostHogProvider` → `AuthProvider` → `ToastProvider` → `GlobalErrorHandler`, `ThemeToggle`, `ShellWrapper` (children), `ConditionalNav`, `FloatingBrainDump`, `ToastViewport`.

### 10.2 Shell padding (`src/components/ShellWrapper.tsx`)

For **signed-in** users on **main app routes** (`/`, `/home`, `/app`, `/tasks`, `/lists`, `/lists/...`, `/capture`, `/profile`), the shell adds bottom padding on small screens and top padding on large screens (desktop header).

### 10.3 Navigation

**Mobile bottom nav** (`src/components/BottomNavigation.tsx`): **Home**, **Tasks**, **Lists**, **Unload** (`/capture`), **Profile** (`/profile`).

**Desktop top nav** (`src/components/DesktopTopNav.tsx`): logo → `/home`; links **Tasks**, **Lists**, **Unload**, **Profile** (no duplicate Home tab — logo covers home).

**When nav renders** (`src/components/ConditionalNav.tsx`): same route allowlist as shell; user must be loaded and signed in. **Activity** (`/activity`) is **not** in this allowlist, so standard nav does not show on that path unless changed.

### 10.4 Key components

- **FloatingBrainDump**, **ImportTasksModal**, **ImportListsModal**, **TaskForm**, **TaskView**-driven pages

---

## 11. HTTP API Surface (Active)

| Area | Method | Path |
|------|--------|------|
| Tasks | POST | `/api/tasks/create`, `/update`, `/delete`, `/undo-delete` |
| Tasks | POST | `/api/tasks/import/preview`, `/import/confirm` |
| Parse / refine | POST | `/api/parseDump`, `/api/refineTasks` |
| Lists | GET | `/api/lists/view` |
| Lists | POST | `/api/lists/create`, `/find-or-create-and-add` |
| Lists | PATCH | `/api/lists/[listId]` |
| Lists | GET, POST | `/api/lists/[listId]/items` |
| List items | PATCH, DELETE | `/api/list-items/[itemId]` |
| Lists import | POST | `/api/lists/import/preview`, `/import/confirm`, `/import/save-inbox` |
| Media | POST | `/api/media/upload`, `/api/media/[mediaId]/ocr` |
| WhatsApp | POST | `/api/whatsapp-webhook` |
| Link | POST | `/api/link-whatsapp` |
| Jobs | POST | `/api/jobs/whatsapp-reminder`, `/api/jobs/whatsapp-digest` |
| Misc | POST | `/api/log`, `/api/generate-category` |

**Disabled / legacy** API routes under `src/app/api/_disabled_*` exist for older product areas; not part of the current task/lists MVP unless re-enabled.

---

## 12. Middleware (`src/middleware.ts`)

- Runs for `/api/*` and selected app paths (see `config.matcher`).
- **Development:** sets no-cache headers for fresher local iteration.
- **API logging:** logs method + path for `/api/*`.
- **Auth:** comment notes client-side `AuthProvider` / protected routes; no server session gate in middleware yet.

---

## 13. Testing and Build

- **Unit tests:** `src/__tests__/**/*.test.ts` — runner: **Vitest** (`npm test` / `npm run test:watch` per `package.json`).
- **Build:** `npm run build` (Next production build).
- **Types:** `npm run type-check`

---

## 14. Environment Variables (Reference)

Not exhaustive; set per environment (local `.env.local`, hosting dashboard).

| Area | Variables |
|------|-----------|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Cron jobs | `CRON_SECRET` (must match `x-cron-secret` on job requests) |
| WhatsApp | `WHATSAPP_ENABLED`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, … (see `whatsapp-webhook` and `whatsapp-client`) |
| OCR | `OCR_PROVIDER`, provider-specific keys as required by `src/server/ocr/` |

---

## 15. Summary

- **Tasks:** Single insert path (`insertTasksWithDedupe`), Task View for reads, `updateTaskFields`, soft delete + undo, constrained `tasks.source`, brain dump via parse + import confirm.
- **Lists:** Full schema including `is_starred` and system lists; List View engine; REST CRUD + import + find-or-create-and-add; WhatsApp list flows with parsers and pending actions.
- **WhatsApp:** Gupshup-only inbound POST; outbound via Gupshup API in `whatsapp-client.ts`; anchoring via `messages.task_ids` / `list_ids`; jobs secured with `CRON_SECRET`.
- **UI:** Responsive shell + bottom nav (five items) + desktop top nav; floating brain dump and OCR modals.
- **Ops:** Vitest for unit tests; middleware for dev cache and API logging.

---

*Aligned with the `laya` repo structure and routes under `src/app`. Update this file when adding routes, migrations, or major processor behaviors.*
