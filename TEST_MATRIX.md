# Laya – Test Matrix

Use this document for **smoke**, **regression**, and **release** testing. Check boxes `[ ]` as you verify. Pair with `FEATURES.md` for feature-level context.

**Legend**

| Column | Meaning |
|--------|---------|
| **Tier** | `S` = smoke (critical path), `R` = regression (full behavior), `E` = edge / optional |
| **Auth** | `yes` = signed-in user required, `no` = public or webhook, `cron` = `CRON_SECRET` header |

---

## 0. Preconditions

| # | Check | Tier |
|---|--------|------|
| [ ] | Env: Supabase URL + keys, `CRON_SECRET` (for jobs), WhatsApp vars if testing WA | S |
| [ ] | DB migrations applied (including `lists.is_starred`, `tasks.source` check, `app_users.display_name`) | S |
| [ ] | Test user: linked `app_users`, optional `whatsapp_users` row | R |

---

## 1. Web – Auth & routing

| # | Area | Steps / expected | Auth | Tier |
|---|------|------------------|------|------|
| [ ] | `/` | Logged out → redirect `/signin`; logged in → `/home` | both | S |
| [ ] | `/signin`, `/login` | Can start OAuth / magic link per your setup | no | S |
| [ ] | `/auth/callback` | Completes session; lands in app | yes | R |
| [ ] | Protected routes | Unauthed access redirects or shows sign-in | no | R |
| [ ] | `/onboarding`, `/onboarding/first-task` | Flow completes; `display_name` / first task if applicable | yes | R |
| [ ] | `/app` | Loads (alternate home if used); consistent with `/home` behavior | yes | R |

---

## 2. Web – Bottom nav & main tabs

Nav (mobile): **Home**, **Tasks**, **Lists**, **Unload** (`/capture`), **Profile**.

| # | Route | Steps / expected | Tier |
|---|-------|------------------|------|
| [ ] | `/home` | Today / Upcoming (or chips); tasks load; WhatsApp link card when unlinked | S |
| [ ] | `/tasks` | List loads; search; pagination; quick add; edit; delete; undo toast; inference badge if inferred | S |
| [ ] | `/tasks` | OCR import modal: upload → preview → confirm; duplicates handling | R |
| [ ] | `/lists` | Lists load; create list; import lists (OCR); **star/unstar** if UI present | S |
| [ ] | `/lists/[listId]` | Items load; add item; toggle done; delete item; back navigation | S |
| [ ] | `/capture` | Brain dump / unload flow works; tasks created; optional refine | S |
| [ ] | `/profile` | Profile settings / sign out / timezone or display name if exposed | R |
| [ ] | `/link-whatsapp` | Link phone; success; home card hides when linked | R |
| [ ] | `/activity` | Still reachable if linked from UI; loads or redirects as designed | E |
| [ ] | Theme toggle | Light/dark persists | R |
| [ ] | Toasts | Success/error toasts show and dismiss | R |

---

## 3. Web – Floating UI

| # | Component | Steps / expected | Tier |
|---|-----------|------------------|------|
| [ ] | Floating brain dump (if mounted) | Open → submit → tasks created; same pipeline as capture where applicable | S |
| [ ] | Floating button position | Does not cover primary actions (safe area / nav) | E |

---

## 4. API – Tasks

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/tasks/create` | Bearer | Quick add JSON → tasks inserted; dedupe | S |
| [ ] | POST | `/api/tasks/update` | Bearer | Patch task fields; `due_at`/`remind_at` consistent | S |
| [ ] | POST | `/api/tasks/delete` | Bearer | Soft delete | S |
| [ ] | POST | `/api/tasks/undo-delete` | Bearer | Restores within window | S |
| [ ] | POST | `/api/tasks/import/preview` | Bearer | OCR/media preview payload | R |
| [ ] | POST | `/api/tasks/import/confirm` | Bearer | Inserts; `source` one of: `web`, `web_keyboard`, `web_brain_dump`, `web_media`, … | S |
| [ ] | POST | `/api/parseDump` | Bearer | Rules-only multi-task parse | S |
| [ ] | POST | `/api/refineTasks` | Bearer | Background refine (called after brain dump) | R |

**Source values (DB constraint):** `web`, `whatsapp`, `web_keyboard`, `web_brain_dump`, `web_media`, `whatsapp_text`, `whatsapp_media` — confirm inserts use allowed values only.

---

## 5. API – Lists

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | GET | `/api/lists/view` | Bearer | Paginated lists | S |
| [ ] | POST | `/api/lists/create` | Bearer | New list | S |
| [ ] | PATCH | `/api/lists/[listId]` | Bearer | Update name / **is_starred** | S |
| [ ] | GET/POST | `/api/lists/[listId]/items` | Bearer | List items; add items | S |
| [ ] | PATCH/DELETE | `/api/list-items/[itemId]` | Bearer | Update text / done; soft delete | S |
| [ ] | POST | `/api/lists/import/preview` | Bearer | List OCR preview | R |
| [ ] | POST | `/api/lists/import/confirm` | Bearer | Creates lists idempotently | R |
| [ ] | POST | `/api/lists/import/save-inbox` | Bearer | Inbox system list | R |
| [ ] | POST | `/api/lists/find-or-create-and-add` | Bearer | Resolves list + adds items (per product spec) | R |

---

## 6. API – Media & OCR

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/media/upload` | Bearer | Returns `mediaId`; storage row | S |
| [ ] | POST | `/api/media/[mediaId]/ocr` | Bearer | OCR text stored (`OCR_PROVIDER`) | S |

---

## 7. API – WhatsApp & jobs

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | GET | `/api/whatsapp-webhook` | Meta verify token | Challenge echo | S |
| [ ] | POST | `/api/whatsapp-webhook` | Provider signature | Inbound message processed | S |
| [ ] | POST | `/api/link-whatsapp` | Bearer | Links phone to user | S |
| [ ] | POST | `/api/jobs/whatsapp-reminder` | `x-cron-secret` | `runReminderJob` completes | R |
| [ ] | POST | `/api/jobs/whatsapp-digest` | `x-cron-secret` | `runDailyDigestJob` completes | R |

---

## 8. API – Other

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/log` | Optional | Client error logging; 200 | E |
| [ ] | POST | `/api/generate-category` | ? | If used by UI; else skip | E |

---

## 9. WhatsApp – Message flows (manual)

Assume linked user + `WHATSAPP_ENABLED` as needed.

### 9.1 Task creation & query

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | Plain text task (AI path) | Task created; confirmation | S |
| [ ] | Rules-first / media OCR → tasks | Tasks or list import per pipeline | R |
| [ ] | “Show tasks” / today / search | Task list; `provider_message_id` + `task_ids` on outbound | S |
| [ ] | Digest-style phrase | Digest formatted message | R |

### 9.2 Edit

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | Reply to list + EDIT flow | Pending edit; patch applies; idempotent retry | R |

### 9.3 Delete & undo

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | Reply delete / search delete | Soft delete; UNDO within window | S |

### 9.4 Lists

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | “Show my lists” / lists | Summary + `list_ids` | S |
| [ ] | Open specific list by name | Preview + quick-action line | S |
| [ ] | Reply with number to summary | Opens correct list | R |
| [ ] | Add to list (reply + phrase) | Items added; `list_ids` on preview | S |
| [ ] | Multiple lists match | Disambiguation (`add_to_list_choose`) | R |
| [ ] | Quick Add after open list | Plain lines add as items; expiry / exit phrases | R |
| [ ] | Done / remove item | Item toggled or removed | S |
| [ ] | “Done”/“remove” without item | Help / incomplete prompt | R |
| [ ] | Clear completed | Completed items cleared | R |
| [ ] | After several actions | List preview may resend (counter) | E |

### 9.5 Session & compliance

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | STOP / START | `opted_out` toggles; messages blocked/allowed | S |
| [ ] | Outside 24h window | Template fallback where configured | R |

---

## 10. Automated tests (`src/__tests__`)

Tests use Jest-style `describe` / `test`. **There is no `npm test` script in `package.json` yet** — wire Jest (or run via your CI) to execute these files.

| File | Focus |
|------|--------|
| `src/__tests__/task-intake-parity.test.ts` | Task intake parity |
| `src/__tests__/taskViewEngine.test.ts` | Task view engine |
| `src/__tests__/taskViewEngine.identity.test.ts` | Identity resolution |
| `src/__tests__/taskViewTime.test.ts` | Time windows |
| `src/__tests__/taskViewTime.upcomingDays.test.ts` | Upcoming days |
| `src/__tests__/taskViewUpcoming.test.ts` | Upcoming view |
| `src/__tests__/taskViewSearch.test.ts` | Search |
| `src/__tests__/taskViewSearch.termFloor.test.ts` | Search term floor |';?.q       Q
| `src/__tests__/taskViewPagination.test.ts` | Pagination |
| `src/__tests__/taskViewPagination.behavior.test.ts` | Pagination behavior |
| `src/__tests__/insertTasksWithDedupe.remindAt.test.ts` | Dedupe + remind_at |
| `src/__tests__/tasksScheduleTimezones.test.ts` | Schedule + TZ |
| `src/__tests__/remindAt.helper.test.ts` | remind_at helper |
| `src/__tests__/scheduleEditPayload.test.ts` | Schedule edit payload |
| `src/__tests__/waDeleteParser.test.ts` | WA delete parsing |
| `src/__tests__/waEditParser.test.ts` | WA edit parsing |
| `src/__tests__/whatsappDigestIntent.test.ts` | Digest intent detection |

**Note:** Automated tests do **not** replace E2E for web UI or live WhatsApp. Add Playwright/Cypress later if desired.

---

## 11. Disabled / legacy (skip for MVP)

| Path | Action |
|------|--------|
| `_disabled_mealplan`, `_disabled_meals`, `_disabled_grocery`, `_disabled_dish` | Do not include in MVP sign-off unless re-enabled |

---

## 12. Sign-off checklist (release)

| # | Item |
|---|------|
| [ ] | All **Tier S** web rows pass |
| [ ] | All **Tier S** API rows pass (or documented skip) |
| [ ] | WhatsApp **9.1–9.4** critical rows pass on staging |
| [ ] | `npm run build` passes |
| [ ] | Unit tests in `src/__tests__` green once a runner is configured (or N/A) |

---

*Last aligned with repo routes and APIs as of document creation. Update when adding routes or migrations.*
