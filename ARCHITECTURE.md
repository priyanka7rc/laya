## Laya Tasks-Only MVP Architecture

This document reflects the **current implementation** in the `laya` repo as of the inspected code. Where something is **not found in code**, it is called out explicitly.

---

## 1. High-Level System Overview

### 1.1 Entry points

- **Web app (Next.js App Router)**
  - Tasks tab: `src/app/(tabs)/tasks/page.tsx`
  - Floating Brain Dump: `src/components/FloatingBrainDump.tsx` (mounted from layout)
  - Import from media (OCR):
    - `src/components/ImportTasksModal.tsx`
    - `src/app/api/media/upload/route.ts`
    - `src/app/api/media/[mediaId]/ocr/route.ts`
    - `src/app/api/tasks/import/preview/route.ts`
    - `src/app/api/tasks/import/confirm/route.ts`
  - Task creation API (keyboard): `src/app/api/tasks/create/route.ts`

- **Brain Dump API (rules-only)**
  - `POST /api/parseDump` → `src/app/api/parseDump/route.ts`

- **Brain Dump refinement (AI, background)**
  - `POST /api/refineTasks` → `src/app/api/refineTasks/route.ts`  
    Called only from `FloatingBrainDump.tsx` after insert.

- **WhatsApp webhook (Gupshup / Meta)**
  - `GET /api/whatsapp-webhook` (verification)
  - `POST /api/whatsapp-webhook` (messages)  
    Both implemented in `src/app/api/whatsapp-webhook/route.ts`, which delegates to `processWhatsAppMessage` in `src/lib/whatsapp-processor.ts`.

- **WhatsApp account linking**
  - Web page: `src/app/link-whatsapp/page.tsx`
  - API: `POST /api/link-whatsapp` → `src/app/api/link-whatsapp/route.ts`

- **Reminder and digest jobs**
  - Reminder job: `runReminderJob` in `src/lib/whatsapp-reminder.ts`
  - Daily digest job: `runDailyDigestJob` in `src/lib/whatsapp-digest.ts`  
  **Cron or scheduler wiring is not present** in the codebase; these are library functions.

- **Other AI endpoints (present but not wired into the main tasks UI)**
  - Category suggestion: `POST /api/generate-category` → `src/app/api/generate-category/route.ts`  
    (no callers found in TS/TSX; likely unused in current UI).

### 1.2 Data flow: inbound → DB write

#### Web keyboard quick-add (Tasks tab)

Sequence:

`User`  
→ `TasksPage` (`src/app/(tabs)/tasks/page.tsx`, `handleQuickAdd`)  
→ `POST /api/tasks/create` (`src/app/api/tasks/create/route.ts`)  
→ `textToProposedTasksFromSegments` → `segmentToProposedTask` (`src/lib/task_intake.ts`)  
→ `parseDate`, `parseTime`, `getSmartDefaultTime`, `stripTemporalPhrases`, `detectCategory` (`src/lib/taskRulesParser.ts`, `src/lib/categories.ts`)  
→ `insertTasksWithDedupe` (`src/server/tasks/insertTasksWithDedupe.ts`)  
→ `Supabase tasks` table insert (via service role client).

Notes:
- `TasksPage` then updates local React state with the returned `inserted` row from the API.
- Duplicate window & inferred flags are handled inside `insertTasksWithDedupe` (see sections 7 and 8).

#### Web Brain Dump

Sequence:

`User`  
→ `FloatingBrainDump` (`src/components/FloatingBrainDump.tsx`, `handleSubmit`)  
→ `POST /api/parseDump` (`src/app/api/parseDump/route.ts`)  
→ `splitBrainDump` (`src/lib/brainDumpParser.ts`)  
→ `textToProposedTasksFromSegments` → `segmentToProposedTask` (`src/lib/task_intake.ts`)  
→ Rules-only tasks returned to client  
→ `FloatingBrainDump` builds `payload` and calls `supabase.from('tasks').insert(payload)` directly from client  
→ `Supabase tasks` insert (no dedupe, no app-level server).

After successful insert, `FloatingBrainDump` optionally calls `POST /api/refineTasks` in the background to adjust title/date/time/category for newly inserted tasks.

#### Web OCR Import

Sequence:

`User`  
→ `ImportTasksModal` (`src/components/ImportTasksModal.tsx`)  
→ Upload: `POST /api/media/upload` (`src/app/api/media/upload/route.ts`)  
→ File stored in Supabase storage bucket `task-media`; metadata row in `media_uploads`  
→ `POST /api/media/:mediaId/ocr` (`src/app/api/media/[mediaId]/ocr/route.ts`)  
→ `getOcrClient` (`src/server/ocr/index.ts`) → `OpenAiOcrClient.extract` (`src/server/ocr/providers/openai.ts`)  
→ OCR text stored into `media_uploads.ocr_text`  
→ `POST /api/tasks/import/preview` (`src/app/api/tasks/import/preview/route.ts`)  
→ `ocrTextToProposedTasks` (`src/lib/ocrCandidates.ts`) → `segmentToProposedTask` (`src/lib/task_intake.ts`)  
→ UI preview in `ImportTasksModal` (user adjusts schedule/category)  
→ `POST /api/tasks/import/confirm` (`src/app/api/tasks/import/confirm/route.ts`)  
→ `insertTasksWithDedupe` (`src/server/tasks/insertTasksWithDedupe.ts`)  
→ `Supabase tasks` insert.

#### WhatsApp text / audio

Sequence:

`Gupshup WhatsApp`  
→ `POST /api/whatsapp-webhook` (`src/app/api/whatsapp-webhook/route.ts`)  
→ `processWhatsAppMessage` (`src/lib/whatsapp-processor.ts`)  
→ `getOrCreateUser` (reads/writes `whatsapp_users`, returns `auth_user_id` as `userId`)  
→ If unlinked: send link instructions via `sendWhatsAppMessage`, **no tasks written**  
→ If command (STOP/START/digest on/off): update `whatsapp_users` flags and exit  
→ If valid audio: `transcribeAudioFromWhatsApp` (`src/lib/openai.ts`, Whisper) → transcript used as text  
→ Save inbound: `saveInboundMessage` inserts row in `messages`  
→ Load context: `getConversationContext` reads `messages`  
→ Route:
  - If query: `handleTaskQuery` (reads `tasks`, no writes)  
  - If edit: `handleTaskEdit` and possibly `handleEditClarification` (update `tasks` due_date/due_time)  
  - Else (create): `processWithLaya` (`src/lib/laya-brain.ts`, OpenAI) → structured.tasks  
    → `saveStructuredData` inserts into `tasks` (and `groceries`, `moods`) with `user_id`, `source='whatsapp'`, `source_message_id`  
→ Save outbound: `saveOutboundMessage` inserts `messages` row  
→ Send WhatsApp reply via `sendWhatsAppMessage` or `sendWhatsAppMessageWithFallback` (Gupshup).

### 1.3 Outbound message flow

#### WhatsApp responses

`processWhatsAppMessage`  
→ build `finalResponse`  
→ `saveOutboundMessage` (insert into `messages`)  
→ `sendWhatsAppMessage(phoneNumber, finalResponse)` (Gupshup API).

#### Daily digest

`runDailyDigestJob` (`src/lib/whatsapp-digest.ts`)  
→ select eligible rows from `whatsapp_users`  
→ atomic claim (`last_digest_sent_at = today`) with conditions  
→ select today’s `tasks` for that `auth_user_id` (by `user_id`, `due_date = today`, `is_done = false`)  
→ format digest text and template params  
→ `sendWhatsAppMessageWithFallback` (free-form inside 24h, template otherwise)  
→ on failure: revert `last_digest_sent_at` to `null`.

#### Task reminders

`runReminderJob` (`src/lib/whatsapp-reminder.ts`)  
→ query `tasks` joined to `whatsapp_users`:
  - `is_done = false`  
  - `reminder_sent = false`  
  - `due_at IS NOT NULL`  
  - `due_at <= now()`  
→ skip if no linked WhatsApp user or `opted_out = true` or task has no `due_time`  
→ atomic claim: set `reminder_sent = true`, `reminder_sent_at = now()`  
→ build reminder message (`formatWhen`)  
→ `sendWhatsAppMessageWithFallback`  
→ on send failure: revert `reminder_sent` and `reminder_sent_at`.

---

## 2. Task Creation Pipeline (All Surfaces)

### 2.1 Web keyboard (Tasks tab)

- **UI and entry**
  - `src/app/(tabs)/tasks/page.tsx` → `handleQuickAdd`.

- **Parsing functions used**
  - `textToProposedTasksFromSegments` and `segmentToProposedTask` (`src/lib/task_intake.ts`).
  - `parseDate`, `parseTime`, `getSmartDefaultTime`, `stripTemporalPhrases`, `detectCategory` (`src/lib/taskRulesParser.ts`, `src/lib/categories.ts`).

- **AI usage**
  - **None**. Rules-based only.

- **Date/time determination**
  - `parseDate`:
    - Tokens: `today`, `tomorrow`, weekday names, `next week`, `weekend`.
    - Always returns `YYYY-MM-DD`. Default is today.
  - `parseTime`:
    - Explicit times (e.g. `at 3pm`, `3:30pm`, `15:00`).
    - If none: smart defaults from keywords (breakfast, lunch, dinner, morning, evening, etc.), else fallback `20:00`.
    - Always `HH:MM` (24-hour).

- **Category determination**
  - `detectCategory` uses `CATEGORY_KEYWORDS` against canonical `TASK_CATEGORIES`:
    - `Admin`, `Finance`, `Fitness`, `Health`, `Home`, `Learning`, `Meals`, `Personal`, `Shopping`, `Tasks`, `Work`.
    - Default `Tasks`.

- **Inferred flags**
  - `segmentToProposedTask`:
    - `inferred_date = true` always.
    - `inferred_time = true` when time falls back to `20:00` and `getSmartDefaultTime` returned `null`; else `false`.
  - `/api/tasks/create`:
    - Date/time picker overrides:
      - Valid `due_date` override → `inferred_date = false`.
      - Valid `due_time` override → `inferred_time = false`.

- **Duplicate detection**
  - `insertTasksWithDedupe` (`src/server/tasks/insertTasksWithDedupe.ts`):
    - `DUPLICATE_WINDOW_MS = 5000`ms.
    - Reads up to last 200 tasks for `user_id`; filters to last 5 seconds.
    - Duplicate if:
      - Same normalized title (trim/lower).
      - Same `due_date`.
      - Same `due_time` (first 5 chars).
    - Skips insertion if duplicate and index not in `allowDuplicateIndices`.
  - `/api/tasks/create` passes `allowDuplicateIndices: []` unless the client sets `allowDuplicate=true`.
  - `TasksPage.handleQuickAdd` uses API `duplicates` to decide whether to show an “add anyway” path.

- **Central insertion function**
  - **Yes**: `insertTasksWithDedupe`.

### 2.2 Web Brain Dump

- **UI and entry**
  - `FloatingBrainDump` (`src/components/FloatingBrainDump.tsx`) → `handleSubmit`.

- **Parsing functions used**
  - `splitBrainDump` and `parseBrainDumpWithRules` (`src/lib/brainDumpParser.ts`).
  - `textToProposedTasksFromSegments` / `segmentToProposedTask` (`src/lib/task_intake.ts`).

- **AI usage**
  - `/api/parseDump` (`src/app/api/parseDump/route.ts`) is **rules-only**.
  - Optional background refine:
    - `FloatingBrainDump` calls `/api/refineTasks` after DB insert.

- **Date/time determination**
  - `parseOneSegmentWithRules`:
    - `extractDateFromText` and `extractTimeFromText` (rules; similar but not identical to keyboard).
    - Defaults:
      - Date: today if none found.
      - Time: `20:00` if none found.
    - Flags:
      - `dueDateWasDefaulted = (dateInfo == null)`.
      - `dueTimeWasDefaulted = (timeInfo == null)`.

- **Category determination**
  - `guessCategory` (alias of `detectCategory`) applied to original segment.

- **Inferred flags**
  - `/api/parseDump` maps back to:
    - `inferred_date`, `inferred_time` from `ProposedTask`.
    - Also `dueDateWasDefaulted`, `dueTimeWasDefaulted` for refinement.
  - `FloatingBrainDump` forwards `inferred_*` into `tasks` insert payload.

- **Duplicate detection**
  - **Not applied**:
    - Direct client-side insert via Supabase; no call to `insertTasksWithDedupe`.

- **Central insertion**
  - **No**: direct `supabase.from('tasks').insert`.

### 2.3 Web OCR Import

- **UI and entry**
  - `ImportTasksModal` (`src/components/ImportTasksModal.tsx`) orchestrates:
    - `/api/media/upload`
    - `/api/media/:mediaId/ocr`
    - `/api/tasks/import/preview`
    - `/api/tasks/import/confirm`

- **Parsing functions used**
  - `ocrTextToProposedTasks` (`src/lib/ocrCandidates.ts`):
    - `normalizeText`, `splitCandidates` (rules for bullets, numbered lists, etc.).
    - `candidateToProposedTask = segmentToProposedTask` (`src/lib/task_intake.ts`).

- **AI usage**
  - OCR:
    - `getOcrClient` → `OpenAiOcrClient.extract` (`src/server/ocr/providers/openai.ts`).
    - Used in `/api/media/:mediaId/ocr`.
  - Task parsing:
    - **Rules-only** (`segmentToProposedTask`).

- **Date/time determination**
  - Same as keyboard (via `segmentToProposedTask`).

- **Category determination**
  - Same as keyboard (via `detectCategory`).

- **Inferred flags**
  - Same as keyboard for `ProposedTask`.
  - `insertTasksWithDedupe` persists them.

- **Duplicate detection**
  - Yes: `insertTasksWithDedupe` in `/api/tasks/import/confirm`.

- **Central insertion**
  - **Yes**: `insertTasksWithDedupe`.

### 2.4 WhatsApp text and audio

- **Entry**
  - `processWhatsAppMessage` (`src/lib/whatsapp-processor.ts`).

- **Parsing functions used**
  - AI path:
    - `processWithLaya` (`src/lib/laya-brain.ts`) for NLU and structuring.
  - Other rules inside processor:
    - `extractQueryFilters` uses `detectCategory` and relative date rules for queries.
    - `handleTaskEdit` and `handleEditClarification` use regex for dates and times.

- **AI usage**
  - Message text:
    - `processWithLaya` always called for non-command, non-query, non-edit messages.
  - Audio:
    - `transcribeAudioFromWhatsApp` (Whisper) first, then same as text.

- **Date/time determination**
  - From AI structured output: `task.due_date` and `task.due_time`.
  - `saveStructuredData` normalizes time via `toHHMM` before insert.

- **Category determination**
  - From AI structured output, constrained by prompt to canonical categories.
  - `saveStructuredData` uses `task.category || 'Tasks'`.

- **Inferred flags**
  - **Not set** here:
    - `saveStructuredData` does not write `inferred_date` or `inferred_time`.

- **Duplicate detection**
  - **None** for WhatsApp tasks:
    - Direct insert with Supabase client created from service role.

- **Central insertion**
  - For WhatsApp: `saveStructuredData`.

---

## 3. AI Usage Map

### 3.1 `src/lib/openai.ts`

- Functions:
  - `parseTaskWithAI` (unused in current `/api/parseDump`).
  - `transcribeAudioFromWhatsApp` — used by `processWhatsAppMessage`.
  - `checkTokenQuota`, `logUsage` — used in older parse flows, not in current `parseDump`.
- Trigger:
  - WhatsApp inbound audio messages call `transcribeAudioFromWhatsApp`.
- Blocking vs background:
  - **Blocking** on WhatsApp path: transcription is awaited.
- Data to AI:
  - Audio file (downloaded via Gupshup URL), passed to `openai.audio.transcriptions.create` with `model: 'whisper-1'`.
- Output:
  - Transcription text; optionally audio stored in Supabase.
- Validation:
  - Errors are caught; caller treats missing content as failure and sends a “did not add” message.

### 3.2 `src/lib/laya-brain.ts`

- Function:
  - `processWithLaya` used only by `processWhatsAppMessage`.
- Trigger:
  - Non-command, non-query, non-edit WhatsApp text (or transcribed audio).
- Blocking vs background:
  - **Blocking**.
- Data to AI:
  - System prompt `LAYA_SYSTEM_PROMPT`.
  - Up to 10 recent messages from `messages` table as context.
  - Current user message.
- Output:
  - `user_facing_response` string.
  - `structured` object (`tasks`, `groceries`, `reminders`, `mood_tag`).
- Validation:
  - Zod-validated; on error returns fallback with empty `structured`.

### 3.3 `src/app/api/refineTasks/route.ts`

- Trigger:
  - Only from `FloatingBrainDump.tsx` after brain dump tasks have been inserted.
- Blocking vs background:
  - **Background**; `fetch` is not awaited by UI for correctness of insert.
- Data to AI:
  - Array of tasks with:
    - `id`, `rawSegmentText`, `title`, `due_date`, `due_time`, `category`, `dueDateWasDefaulted`, `dueTimeWasDefaulted`.
  - Optional `fullDumpText` (truncated).
- Output:
  - `{ tasks: [ { title, due_date, due_time, category } ] }`.
- Validation:
  - Zod schema; enforces category in `TASK_CATEGORIES_SET`.
  - Merges with rules-only data using `mergeRefined`; updates DB via Supabase.

### 3.4 OCR (OpenAI-based)

- Files:
  - `src/server/ocr/providers/openai.ts`
  - `src/server/ocr/index.ts`
  - `src/app/api/media/[mediaId]/ocr/route.ts`
- Trigger:
  - `POST /api/media/:mediaId/ocr` after upload.
- Blocking vs background:
  - **Blocking** for each OCR request.
- Data to AI:
  - File bytes, mimeType, filename, up to `maxPages`.
- Output:
  - `fullText`, `pages`, and meta; stored into `media_uploads.ocr_text` and `ocr_meta`.

### 3.5 `src/app/api/generate-category/route.ts`

- Trigger:
  - No call sites found; appears unused.
- Behavior:
  - Given `title` and `notes`, asks GPT-3.5 for a category string.
  - Returns `{ category }`, with default `'General'` on error.
- Validation:
  - No category-list enforcement.

### 3.6 Meal/grocery AI (out of scope for Tasks-only UI)

- Files:
  - `src/lib/mealPlanGenerator.ts`
  - `src/lib/groceryListGenerator.ts`
  - `src/lib/dishCompiler.ts`
- These do call OpenAI but are tied to `_disabled` mealplan routes and are not used in the current tasks flows.

---

## 4. Time Handling Contract

### 4.1 Canonical formats

- **Task DB**
  - `due_date: TEXT` — `YYYY-MM-DD`, still actively written.
  - `due_time: TEXT` — `HH:MM` (legacy `HH:MM:SS` normalized by helpers).
  - `due_at: TIMESTAMPTZ` — unified timestamp introduced by migration; used by reminders and app-centric queries.

### 4.2 Locations writing `due_time`

- Keyboard:
  - `/api/tasks/create` sets `task.due_time` via `segmentToProposedTask` or UI override.
  - `insertTasksWithDedupe` persists `due_time` (default `'20:00'`).
- Brain Dump:
  - `/api/parseDump` returns `due_time` from rules.
  - `FloatingBrainDump` inserts this directly.
- OCR import:
  - `segmentToProposedTask` sets `due_time`.
  - `insertTasksWithDedupe` persists it.
- WhatsApp:
  - `saveStructuredData` uses `toHHMM` to normalize AI `due_time` strings before insert.
- Refinement:
  - `/api/refineTasks` uses `mergeRefined` + `toHHMM` to normalize and update `tasks.due_time`.

### 4.3 Locations writing `due_at`

- `20260205000000_create_tasks_table.sql`:
  - One-time migration from `due_date`+`due_time` to `due_at`.
- `src/lib/tasks/mutations.ts`:
  - `createTask`, `setTaskDueAt` write `due_at` explicitly.
- Reminder and digest jobs:
  - `whatsapp-reminder.ts` filters `tasks` with `due_at <= now()`.
  - `whatsapp-digest.ts` uses `due_date`/`due_time`, not `due_at`.

### 4.4 Normalization helpers

- `toHHMM(s)` (`src/lib/taskRulesParser.ts`):
  - Accepts `HH:MM` or `HH:MM:SS`.
  - Returns `HH:MM` or `null`.
- `parseTime(text)`:
  - Detects explicit time, then `getSmartDefaultTime`, else `'20:00'`.
- `extractTimeFromText` in `brainDumpParser`:
  - Similar but tailored to brain dump segments (may bias early hours to PM).

### 4.5 Legacy HH:MM:SS handling

- Normalized to `HH:MM` via `toHHMM` in:
  - `refineTasks` merging.
  - WhatsApp `saveStructuredData`.

---

## 5. Category System

### 5.1 Canonical category list and source of truth

- `src/lib/categories.ts`:
  - `TASK_CATEGORIES`:
    - `Admin`, `Finance`, `Fitness`, `Health`, `Home`, `Learning`, `Meals`, `Personal`, `Shopping`, `Tasks`, `Work`.
  - `DEFAULT_CATEGORY = 'Tasks'`.
  - `TASK_CATEGORIES_SET` and `getCategoryListForPrompt()`.

### 5.2 Where categories are inferred

- Keyboard:
  - `detectCategory` in `taskRulesParser` (re-export from `categories.ts`).
- Brain Dump:
  - `guessCategory` (alias of `detectCategory`) in `brainDumpParser`.
- OCR:
  - `segmentToProposedTask` uses `detectCategory`.
- WhatsApp:
  - `processWithLaya` system prompt instructs AI to set `category` from canonical list.
  - `saveStructuredData` defaults to `'Tasks'` when `null`.
- Refine:
  - `/api/refineTasks` enforces categories via `TASK_CATEGORIES_SET`.

### 5.3 Legacy category names

- `Bills`:
  - Mentioned as legacy in `categories.ts` comments.
  - WhatsApp processor maps `Finance` and `Bills` to the same emoji/action in `CATEGORY_EMOJI` and `CATEGORY_ACTION`.

### 5.4 Where categories are used in filters

- WhatsApp query:
  - `extractQueryFilters` in `whatsapp-processor.ts` uses `detectCategory` and relative date filters.
  - `handleTaskQuery` filters `tasks` by `category` when set.
- Refine:
  - Validates AI categories using `TASK_CATEGORIES_SET`.
- UI:
  - `TasksPage` renders `task.category` chips.

---

## 6. Identity Model

### 6.1 Entities and fields

- **Auth user**: `auth.users.id` (Supabase).
- **App user**: `public.app_users.id`, linked via `auth_user_id`.
- **User identities**: `public.user_identities` with `provider` (`whatsapp`, `app_phone`, `app_email`) and `identifier`.
- **WhatsApp users**: `whatsapp_users` with `phone_number`, `auth_user_id`, `opted_out`, `daily_digest_enabled`, `last_digest_sent_at`, `last_active`.
- **Tasks**:
  - `user_id` → `auth.users.id`.
  - `app_user_id` → `public.app_users.id`.
- **Messages**:
  - `user_id` → `auth.users.id` and `channel = 'whatsapp'`.

### 6.2 Where each is written

- `app_users`:
  - `linkAuthUserToAppUser` → RPC `link_auth_user`:
    - Creates/updates `app_users` by `phone_e164`.
    - Inserts `user_identities` for `app_phone`.
- `whatsapp_users`:
  - `getOrCreateUser`:
    - Inserts new row when phone unseen.
    - Updates `last_active` and returns `auth_user_id`.
  - `/api/link-whatsapp`:
    - Links `phone_number` to `auth_user_id`.
  - `processWhatsAppMessage`:
    - Updates `opted_out` and `daily_digest_enabled`.
  - `runDailyDigestJob`:
    - Sets / reverts `last_digest_sent_at`.
- `tasks.user_id` / `tasks.app_user_id`:
  - Keyboard:
    - `/api/tasks/create` → `insertTasksWithDedupe`: sets `user_id=user.id`, `app_user_id=appUserId`.
  - Brain Dump:
    - `FloatingBrainDump` writes `user_id=user.id`, `app_user_id=appUserId`.
  - OCR:
    - `/api/tasks/import/confirm` → `insertTasksWithDedupe`: `user_id=user.id`, `app_user_id=null`.
  - WhatsApp:
    - `saveStructuredData` writes `user_id=auth_user_id` and `source='whatsapp'`; does not set `app_user_id`.
- `messages.user_id`:
  - `saveInboundMessage` / `saveOutboundMessage`: always use `auth_user_id` from `getOrCreateUser`.

### 6.3 Where each is queried

- Web Tasks tab:
  - `TasksPage` selects tasks by `user_id=user.id`.
- WhatsApp:
  - `saveStructuredData`, `handleTaskQuery`, `handleTaskEdit`, `handleEditClarification` all use `user_id` filters.
- App-centric endpoints:
  - `src/lib/tasks/queries.ts` use `app_user_id` and `status`.
- WhatsApp link status:
  - `HomePage` checks `whatsapp_users` by `auth_user_id`.

### 6.4 Inconsistencies

- Tasks have both `user_id` and `app_user_id`; not all flows set `app_user_id`.
- App-centric task queries (by `app_user_id` and `status`) do not directly overlap with legacy `user_id` / `is_done`-based views.

---

## 7. Inference System

### 7.1 Flags and purpose

- `inferred_date` and `inferred_time` on `tasks`:
  - Added by `20260220000000_add_inferred_flags_to_tasks.sql`.
  - Intended for UI “confirm schedule” badge when schedule was inferred from text.

### 7.2 Where flags are set

- `segmentToProposedTask`:
  - `inferred_date = true`.
  - `inferred_time = true` when time fallback used.
- `/api/tasks/create`:
  - Overrides `inferred_*` to `false` when user-picked date/time.
- Brain Dump:
  - `/api/parseDump` passes through `inferred_*`.
  - `FloatingBrainDump` inserts into `tasks` with these flags.
- OCR:
  - `ocrTextToProposedTasks` → `segmentToProposedTask` sets flags.
  - `insertTasksWithDedupe` persists them.

### 7.3 Where flags are cleared

- `TasksPage.handleConfirmInference`:
  - Sets `inferred_date=false`, `inferred_time=false` locally and in DB.
- `/api/tasks/create`:
  - UI overrides for date/time force corresponding `inferred_*` to `false`.
- `ImportTasksModal`:
  - On date/time change, updates local `ProposedTask` with `inferred_* = false`.

### 7.4 UI components

- `ConfirmInferenceBadge` (used in `TasksPage`) shows a badge when any `inferred_*` is true and calls `handleConfirmInference`.

### 7.5 Flows bypassing flags

- WhatsApp-created tasks:
  - `saveStructuredData` does not set `inferred_*`; flags remain defaults (false).

---

## 8. Duplicate Protection

### 8.1 Logic and window

- Implemented solely in `insertTasksWithDedupe`:
  - Window: last **5 seconds** tasks for the same `user_id`.
  - Matching:
    - Same normalized title.
    - Same `due_date`.
    - Same `due_time` (first 5 chars).
  - Control:
    - `allowDuplicateIndices` allows bypassing dedupe per-task index.

### 8.2 Surfaces applying dedupe

- Keyboard:
  - `/api/tasks/create` always uses `insertTasksWithDedupe`.
- OCR import:
  - `/api/tasks/import/confirm` uses `insertTasksWithDedupe`.

### 8.3 Surfaces without dedupe

- Brain Dump:
  - `FloatingBrainDump` inserts tasks directly via Supabase, **no dedupe**.
- WhatsApp:
  - `saveStructuredData` inserts tasks directly, **no dedupe**.

---

## 9. Reminder & Digest Architecture

### 9.1 Reminder job

- File: `src/lib/whatsapp-reminder.ts`.
- Query:
  - `tasks` where:
    - `is_done = false`
    - `reminder_sent = false`
    - `due_at IS NOT NULL`
    - `due_at <= now()`
  - Joined to `whatsapp_users` (`inner`) for `phone_number`, `opted_out`.
- Flow:
  - Skip if:
    - No WhatsApp user row.
    - `opted_out = true`.
    - `due_time` is `null`.
  - Atomic claim via `update` with `eq('id', task.id)` and `eq('reminder_sent', false)`.
  - Build `when` string via `formatWhen`.
  - Call `sendWhatsAppMessageWithFallback`.
  - On failure: revert `reminder_sent` and `reminder_sent_at`.

### 9.2 Digest job

- File: `src/lib/whatsapp-digest.ts`.
- User selection:
  - `whatsapp_users` where `daily_digest_enabled = true` and:
    - `last_digest_sent_at IS NULL OR last_digest_sent_at != today`.
- Flow:
  - Skip if:
    - `auth_user_id` is null (unlinked).
    - `opted_out = true`.
  - Atomic claim (`last_digest_sent_at = today`) guarded by conditions.
  - Load today’s tasks: `tasks` where `user_id = auth_user_id`, `is_done = false`, `due_date = today`.
  - If no tasks: revert `last_digest_sent_at` to null.
  - If tasks:
    - Format digest list and count.
    - Call `sendWhatsAppMessageWithFallback` with `TEMPLATES.DAILY_DIGEST`.
    - On send failure: revert `last_digest_sent_at`.

### 9.3 Cron wiring

- No cron or scheduler configuration found in the repo:
  - `runReminderJob` and `runDailyDigestJob` are **library functions only**, intended to be called by an external scheduler.

### 9.4 Template fallback logic

- Implemented in `sendWhatsAppMessageWithFallback`:
  - Enforces:
    - `opted_out` from `whatsapp_users`.
    - 24h free-form window using `canSendFreeformMessage`.
  - Outside 24h:
    - Requires template id and params; otherwise no send.

---

## 10. WhatsApp Enforcement Model

### 10.1 AI usage

- Plain text:
  - If not STOP/START/digest toggle, not a query, not an edit:
    - `processWithLaya` is always called (blocking).
- Media:
  - Audio:
    - Transcribed via `transcribeAudioFromWhatsApp`; text then routed as normal.
  - Other media types:
    - Logged and ignored; no AI on tasks.

### 10.2 24h session window

- `canSendFreeformMessage`:
  - Reads last inbound `messages` row for `user_id`.
  - Returns whether last inbound is within 24 hours.
  - On error: logs and **returns true** (fail-open).

- `sendWhatsAppMessageWithFallback`:
  - Checks `whatsapp_users.opted_out` and blocks if true.
  - Uses:
    - Free-form if `withinWindow = true`.
    - Template send if `withinWindow = false` and template id is provided.

### 10.3 STOP/START enforcement

- `processWhatsAppMessage`:
  - `stop`, `stopall`, `unsubscribe`:
    - Sets `opted_out = true`.
    - Sends unsubscribe confirmation.
  - `start`:
    - Sets `opted_out = false`.
    - Sends welcome-back confirmation.

- `sendWhatsAppMessageWithFallback`:
  - Checks `opted_out` before sending any proactive or fallback messages and drops if opted out.

### 10.4 Template usage conditions

- Digest:
  - Uses `TEMPLATES.DAILY_DIGEST` when outside 24h; free-form available inside 24h.
- Reminder:
  - Uses `TEMPLATES.TASK_REMINDER` when outside 24h; free-form available inside 24h.

---

## 11. Known Architectural Risks (from code)

All items below are observed in the codebase.

### 11.1 In-memory state

- Rate limiting:
  - `/api/parseDump` uses an in-memory `Map` keyed by auth header or IP.
  - Not shared across processes; resets on deploy/restart.
- Conversational focus:
  - `userFocusStore` in `whatsapp-processor.ts`:
    - Stores current “focus task” for edits with a 2h TTL.
    - Lost on restart; can break edit flows (e.g. “change it to 5pm”) mid-conversation.

### 11.2 Identity inconsistencies

- Dual identity on tasks:
  - Some flows populate `app_user_id`; WhatsApp does not.
  - Legacy views rely on `user_id` and `is_done`; newer queries use `app_user_id` and `status`.

### 11.3 Duplicate and reminder coverage gaps

- Deduplication:
  - Only applies to keyboard and OCR import via `insertTasksWithDedupe`.
  - Brain Dump and WhatsApp creation have no dedupe; double submits can create near-identical tasks.
- Reminders vs due_at:
  - Reminder job uses `due_at`; many flows write only `due_date`/`due_time` and do not update `due_at`.
  - Some tasks may never receive reminders unless `due_at` is also populated elsewhere.

### 11.4 Fail-open behaviors

- 24h window:
  - `canSendFreeformMessage` returns `true` on DB errors, potentially allowing free-form sends when session cannot be verified.
- WhatsApp AI:
  - All create operations on WhatsApp rely on AI; on failure, the system sends a soft failure message but does not use a rules fallback.
- Refinement:
  - `/api/refineTasks` errors are silent from a user perspective; only logs and no UI feedback (safe but opaque).

---

This `ARCHITECTURE.md` captures the observed behavior of the Laya Tasks-only MVP as implemented in the current codebase. 
