## Laya Architecture v5

This document reflects the **current implementation** in the `laya` repo. It extends `architecture_v3` with:

- **Phone OTP auth** replacing email/magic-link sign-in
- **3-step onboarding state machine** (`app_verified → profile_required_done → preferences_done → onboarding_complete`)
- **`tasks.app_user_id` is now `NOT NULL`** — canonical ownership enforced at the DB level
- **Unload tab** (`/capture`) replacing the floating brain dump as primary text entry, with mixed tasks + list-item output
- **`/api/parseDump` returns `listItems`** in addition to tasks
- **`/api/lists/find-or-create-and-add`** for atomic list resolution + item insertion
- **`lists.is_starred`** column
- **`app_users` profile fields**: `display_name`, `city`, `country`, `household_mode`, `reminder_window_pref`, `whatsapp_assistant_enabled`
- **`tasks.source` expanded** to `web_keyboard`, `web_brain_dump`, `web_media`, `whatsapp_text`, `whatsapp_media`
- **Profile tab** (`/profile`) with `display_name`, WhatsApp link status, sign-out

Sections unchanged from v3 are noted with *(unchanged)*.

Where something is **not found in code**, it is called out explicitly.

---

## 1. High-Level System Overview

### 1.1 Entry points

- **Web app (Next.js App Router)**
  - Root redirect: `src/app/page.tsx` → `/home` (logged in) or `/signin` (logged out)
  - Login: `src/app/login/page.tsx` — **phone OTP** (primary sign-in)
  - Sign-in: `src/app/signin/page.tsx` — legacy / alternate
  - Auth callback: `src/app/auth/callback/page.tsx`
  - Onboarding funnel (state-machine driven):
    - `src/app/onboarding/page.tsx` — router: reads `onboarding_state`, delegates to correct step via `resolvePostAuthRoute`
    - `src/app/onboarding/required/page.tsx` — Step 1: `display_name`, email, city, country → `profile_required_done`
    - `src/app/onboarding/preferences/page.tsx` — Step 2: `household_mode`, `reminder_window_pref`, `whatsapp_assistant_enabled` → `preferences_done`
    - `src/app/onboarding/first-task/page.tsx` — Step 3: optional first task → `onboarding_complete`
  - **Bottom nav tabs (mobile):** Home, Tasks, Lists, Unload, Profile
  - Home tab: `src/app/(tabs)/home/page.tsx` — today tasks, upcoming buckets, lists preview, WhatsApp link card, `display_name`
  - App home: `src/app/app/page.tsx` — task-view-backed, today/tomorrow/week view, snooze actions
  - Tasks tab: `src/app/(tabs)/tasks/page.tsx` — search, pagination, quick add, edit, delete, OCR import
  - Lists tab: `src/app/(tabs)/lists/page.tsx` and `lists/[listId]/page.tsx`
  - **Unload tab** (`/capture`): `src/app/(tabs)/capture/page.tsx` — text brain dump + OCR import, review mode, saves tasks + list items
  - Profile tab: `src/app/(tabs)/profile/page.tsx` — `display_name`, WhatsApp link, sign-out
  - Activity tab: `src/app/(tabs)/activity/page.tsx`
  - Link WhatsApp: `src/app/link-whatsapp/page.tsx`
  - WhatsApp dashboard: `src/app/whatsapp-dashboard/[userId]/page.tsx`

- **Brain Dump / Unload API (rules-only)**
  - `POST /api/parseDump` → returns `{ tasks, listItems }` (both in one call)

- **WhatsApp webhook (Gupshup / Meta)** *(unchanged)*
  - `POST /api/whatsapp-webhook` → `processWhatsAppMessage`

- **Cron jobs (protected by `x-cron-secret`)**
  - `POST /api/jobs/whatsapp-reminder` → `runReminderJob`
  - `POST /api/jobs/whatsapp-digest` → `runDailyDigestJob`

- **WhatsApp account linking** *(unchanged)*
  - `POST /api/link-whatsapp`

---

## 2. Auth: Phone OTP

**Entry:** `src/app/login/page.tsx`

**Flow:**
1. User enters phone number (Indian format normalised to E.164 by `normalizeToE164India` in `src/lib/phone.ts`)
2. `sendOtp(phoneE164)` → `supabase.auth.signInWithOtp({ phone })` — SMS OTP sent
3. `verifyOtp(phoneE164, token)` → `supabase.auth.verifyOtp({ phone, token, type: 'sms' })` — session created
4. `linkAuthUserToAppUser({ authUserId, phoneE164 })` → RPC `link_auth_user` (see Section 3.3)
5. `resolvePostAuthRoute(appUser)` → directs to correct onboarding step or `/app`

**Key files:**
- `src/lib/auth/otp.ts` — `sendOtp`, `verifyOtp`
- `src/lib/auth/phone.ts` — re-exports from `src/lib/phone.ts`
- `src/lib/users/linking.ts` — `linkAuthUserToAppUser`, `getCurrentAppUser`, `resolvePostAuthRoute`

---

## 3. Onboarding State Machine

### 3.1 States and routes

| State | Meaning | Route |
|-------|---------|-------|
| `app_verified` | Phone OTP verified; no profile yet | `/onboarding/required` |
| `profile_required_done` | Name, email, city, country saved | `/onboarding/preferences` |
| `preferences_done` | Preferences set or skipped | `/onboarding/first-task` |
| `onboarding_complete` | All done | `/app` |

**Router logic** (`resolvePostAuthRoute` in `src/lib/users/linking.ts`):
- `no appUser` → `/onboarding/required`
- `app_verified` → `/onboarding/required`
- `profile_required_done` → `/onboarding/preferences`
- `preferences_done` → `/onboarding/first-task`
- `onboarding_complete` → `/app`

Each onboarding page guards against already-completed states and redirects forward.

### 3.2 Onboarding service (`src/lib/onboarding/service.ts`)

| Function | Step | Sets `onboarding_state` to |
|----------|------|---------------------------|
| `saveRequiredProfile` | 1 | `profile_required_done` |
| `savePreferencesOrSkip` | 2 | `preferences_done` |
| `completeWithFirstTaskOrSkip` | 3 | `onboarding_complete` |

### 3.3 `app_users` profile schema (as of v5)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `auth_user_id` | uuid | FK to `auth.users` |
| `phone_e164` | text | E.164 format |
| `email` | text | Optional |
| `has_app_account` | bool | Set `true` on link |
| `onboarding_state` | text | See state machine |
| `display_name` | text | Captured in Step 1 |
| `city` | text | Captured in Step 1 |
| `country` | text | Default `'India'` |
| `household_mode` | text | `run_most` / `shared` / `support` |
| `reminder_window_pref` | text | `morning` / `afternoon` / `evening` |
| `whatsapp_assistant_enabled` | bool | Default `true` |
| `timezone` | text | User timezone |

### 3.4 `link_auth_user` RPC

- Called by `linkAuthUserToAppUser` on login/OTP-verify
- Creates `app_users` row with `onboarding_state = 'app_verified'` if new; otherwise updates, preserving advanced states
- Upserts `user_identities` for `app_phone` (and `app_email` if provided)
- Security: `SECURITY DEFINER`; checks `auth.uid() = p_auth_user_id`; grants only to `authenticated`

---

## 4. Identity Model (updated from v2)

### 4.1 Canonical ownership

- **`tasks.app_user_id` is `NOT NULL`** (enforced by migration `20260326000001`; blocked by a defensive guard if null rows exist)
- RLS on `tasks` is scoped via `app_users.auth_user_id = auth.uid()`
- All write paths (Web, WhatsApp) must resolve `app_user_id` before inserting tasks

### 4.2 `task.source` values (expanded constraint)

| Value | Surface |
|-------|---------|
| `web` | Legacy / generic web |
| `web_keyboard` | Tasks page quick add |
| `web_brain_dump` | Unload tab, FloatingBrainDump |
| `web_media` | Web OCR import |
| `whatsapp` | Legacy WhatsApp |
| `whatsapp_text` | WhatsApp plain text / audio |
| `whatsapp_media` | WhatsApp media OCR |

---

## 5. Unload Tab (`/capture`)

The Unload tab is the primary **web brain dump / text entry surface**, replacing the floating button as the main unload entry point. It handles both tasks and list items in one flow.

### 5.1 Flow

```
User
→ /capture  (text area input + drag/drop upload)
→ POST /api/parseDump { text }
→ Returns { tasks: ProposedTask[], listItems: [{ item, listName }] }
→ Review mode: user can edit task titles / list items, toggle rejected
→ Save:
    tasks       → POST /api/tasks/import/confirm  (insertTasksWithDedupe, source: web_brain_dump)
    list items  → POST /api/lists/find-or-create-and-add (per item; finds or creates list, then inserts)
→ Optional: OCR import via ImportTasksModal (drag/drop or Upload button)
```

### 5.2 `POST /api/parseDump` (updated)

- Returns **both** tasks and list items in a single response: `{ tasks, listItems }`
- `listItems: [{ item: string; listName: string }]` — extracted from lines matching add-to-list patterns (via `detectAddToListIntent`)
- Tasks extracted via `splitBrainDump` → `textToProposedTasksFromSegments` (Feature #1 parsers)
- Rules-only; no AI in hot path

### 5.3 `POST /api/lists/find-or-create-and-add`

- Atomically resolves list by name (case-insensitive `ilike`) or creates it via `insertListWithIdempotency`
- Inserts item via `insertListItems`
- Returns `{ listId, listName, itemId, created: bool }`
- Used by: Unload tab (for each `listItem` in review-mode save)

---

## 6. Task Intake *(unchanged, source enum expanded)*

All paths converge on:
- `src/lib/task_intake.ts` → `segmentToProposedTask`, `textToProposedTasksFromSegments`
- `src/server/tasks/insertTasksWithDedupe.ts` — single canonical insert with 5s dedupe window

---

## 7. Lists *(unchanged from v3, plus `is_starred`)*

- `lists.is_starred boolean NOT NULL DEFAULT false` (migration `20260318`)
- Index: `idx_lists_app_user_starred (app_user_id, is_starred) WHERE deleted_at IS NULL`
- `PATCH /api/lists/[listId]` accepts `{ is_starred: boolean }` to toggle star, or `{ name: string }` to rename

All other list behavior (create, view, items, OCR import, system inbox, WhatsApp) unchanged from v3.

---

## 8. Task View Engine *(unchanged from v3)*

- `executeTaskView` with `view: 'today' | 'upcomingDays' | 'all' | 'search' | 'digest' | 'reminder'`
- Web: Tasks tab, Home tab, App home
- WhatsApp: `handleTaskQuery`, digest job, reminder job

---

## 9. WhatsApp Handlers *(unchanged from v3)*

All handlers in `src/lib/whatsapp-processor.ts`:

| Handler | Purpose |
|---------|---------|
| `handleListRead` | Show lists / specific list / reply-anchored open |
| `handleAddToList` | Add items (reply-anchored, explicit name, disambiguation) |
| `handleListItemDoneRemove` | Done / remove list items |
| `handleOcrImportPending` | OCR import for lists |
| `handleTaskDelete` | Delete tasks |
| `handleEditSelect` | Reply-anchored edit selection |
| `handleTaskQuery` | Task queries |
| `handleTaskEdit` | Edit task fields |

Quick Add mode, clear-completed, list preview counter, `wa_pending_actions` action types (`edit`, `ocr_import_list_name`, `ocr_import_confirm_tasks`, `add_to_list_choose`, `quick_add`) — all unchanged from v3.

---

## 10. Scheduling, Delete, Edit *(unchanged from v2/v3)*

- **Canonical schedule:** `due_date`/`due_time` → `computeDueAtFromLocal`, `computeRemindAtFromDueAt`
- **Updates:** `updateTaskFields`
- **Soft delete + undo:** `deleteTasks`, `undoDelete`; reply-anchored via `messages.task_ids`
- **Edit sessions:** `wa_pending_actions` with idempotency via `last_inbound_provider_message_id`

---

## 11. Navigation

**Bottom nav** (mobile, hidden on desktop via `lg:hidden`):

| Label | Route |
|-------|-------|
| Home | `/home` |
| Tasks | `/tasks` |
| Lists | `/lists` |
| Unload | `/capture` |
| Profile | `/profile` |

---

## 12. Summary: What's New in v5

| Area | Change |
|------|--------|
| **Auth** | Phone OTP via Supabase SMS; `sendOtp` / `verifyOtp` in `src/lib/auth/otp.ts`; `link_auth_user` RPC hardened (security definer, auth.uid check) |
| **Onboarding** | 4-state machine; 3 new onboarding pages; `resolvePostAuthRoute` routes by `onboarding_state` |
| **`app_users`** | 6 new profile columns: `display_name`, `city`, `country`, `household_mode`, `reminder_window_pref`, `whatsapp_assistant_enabled` |
| **`tasks.app_user_id`** | Now `NOT NULL`; RLS on tasks scoped via `app_users.auth_user_id = auth.uid()` |
| **`tasks.source`** | Expanded constraint: `web_keyboard`, `web_brain_dump`, `web_media`, `whatsapp_text`, `whatsapp_media` |
| **Unload tab** | `/capture` is the new primary brain dump surface; review mode; saves tasks + list items together |
| **`/api/parseDump`** | Now returns `{ tasks, listItems }` |
| **`/api/lists/find-or-create-and-add`** | New: atomic find-or-create list + insert item |
| **`lists.is_starred`** | New bool column + index; toggled via `PATCH /api/lists/[listId]` |
| **Profile tab** | New `/profile`: `display_name`, WhatsApp link status, sign-out |
| **Navigation** | 5 tabs: Home, Tasks, Lists, Unload, Profile |
