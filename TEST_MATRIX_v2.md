# Laya – Test Matrix v2

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
| [ ] | Env: Supabase URL + keys, `CRON_SECRET`, WhatsApp vars, OCR provider vars if testing OCR/WA media | S |
| [ ] | DB migrations applied (tasks, lists, list_items, messages/task_ids/list_ids, `wa_pending_actions`, `lists.is_starred`, system inbox) | S |
| [ ] | Test user exists with linked `app_users` row | S |
| [ ] | Optional linked WhatsApp test user available for WA manual tests | R |
| [ ] | Test data present for: overdue, today, upcoming, inferred schedule, deleted/undo, multiple lists, OCR import candidates | R |

---

## 1. Web – Auth, routing, and shell

Architecture v4 says `/` redirects by auth state; app shell/nav behavior is route-based; `/activity` exists but is **not** in the standard nav allowlist.

| # | Area | Steps / expected | Auth | Tier |
|---|------|------------------|------|------|
| [ ] | `/` | Logged out → redirect `/signin`; logged in → `/home` | both | S |
| [ ] | `/signin`, `/login` | Can start auth flow per configured method | no | S |
| [ ] | `/auth/callback` | Session completes; lands in app | yes | R |
| [ ] | Protected routes | Unauthed access redirects or shows sign-in state as designed | no | R |
| [ ] | `/onboarding`, `/onboarding/first-task` | Flow completes; first-run state behaves correctly | yes | R |
| [ ] | `/app` | Loads alternate app home; behavior consistent with shell routes | yes | R |
| [ ] | Signed-in shell routes | `/home`, `/app`, `/tasks`, `/lists`, `/lists/[id]`, `/capture`, `/profile` all render inside app shell correctly | yes | S |
| [ ] | `/activity` route | Reachable by URL; loads or redirects as designed | yes | E |
| [ ] | `/activity` nav visibility | Standard nav does **not** render on `/activity` unless intentionally changed | yes | R |
| [ ] | Shell padding – mobile | Bottom padding present on main app routes; content not obscured by bottom nav | yes | R |
| [ ] | Shell padding – desktop | Top padding/header spacing correct on main app routes | yes | R |
| [ ] | Global error handler | Unhandled client error path shows fallback/reporting behavior without white screen | yes | E |
| [ ] | Theme toggle | Light/dark works and persists | yes | R |
| [ ] | Toast viewport | Success/error toasts render, stack, dismiss, and do not obscure primary controls | yes | R |

---

## 2. Navigation – mobile + desktop

Architecture v4 adds both **mobile bottom nav** and **desktop top nav**; desktop logo routes to `/home` and there is **no duplicate Home tab**.

### 2.1 Mobile bottom nav

| # | Route | Steps / expected | Tier |
|---|-------|------------------|------|
| [ ] | Home | Tap Home → `/home` | S |
| [ ] | Tasks | Tap Tasks → `/tasks` | S |
| [ ] | Lists | Tap Lists → `/lists` | S |
| [ ] | Unload | Tap Unload → `/capture` | S |
| [ ] | Profile | Tap Profile → `/profile` | S |
| [ ] | Active state | Current route highlights correctly | R |

### 2.2 Desktop top nav

| # | Area | Steps / expected | Tier |
|---|------|------------------|------|
| [ ] | Logo | Click logo → `/home` | S |
| [ ] | Links | Tasks / Lists / Unload / Profile visible and route correctly | S |
| [ ] | No duplicate Home tab | Desktop nav does not show separate Home link if logo covers home | R |
| [ ] | Route highlight / selection state | Current section is visually clear | R |
| [ ] | Hidden on `/activity` | Standard desktop nav absent on `/activity` unless intentionally changed | R |

---

## 3. Web – Main tabs and pages

### 3.1 Home

| # | Route | Steps / expected | Tier |
|---|-------|------------------|------|
| [ ] | `/home` | Today and Upcoming sections/chips load from Task View | S |
| [ ] | Today | Only today-relevant tasks appear | S |
| [ ] | Upcoming | Upcoming window behaves as designed | R |
| [ ] | Unlinked WA state | WhatsApp link card/banner appears when unlinked | R |
| [ ] | Linked WA state | Link card/banner hides when linked | R |
| [ ] | Empty state | Empty home renders correct CTA/copy | R |

### 3.2 Tasks

| # | Route | Steps / expected | Tier |
|---|-------|------------------|------|
| [ ] | `/tasks` load | List loads without crash | S |
| [ ] | Search | Search returns matching tasks only | S |
| [ ] | Pagination | Next/prev/load-more behavior works | R |
| [ ] | Quick add | Task creates successfully | S |
| [ ] | Edit | Edit path updates task correctly | S |
| [ ] | Delete | Soft delete removes task from active list | S |
| [ ] | Undo toast | Undo restores task within allowed window | S |
| [ ] | Inference badge | Inferred date/time badge shows when applicable | R |
| [ ] | Long titles | Wrapping/overflow remains clean | E |
| [ ] | Empty state | Empty tasks view is usable and visually correct | R |

### 3.3 Lists

| # | Route | Steps / expected | Tier |
|---|-------|------------------|------|
| [ ] | `/lists` load | Lists index loads | S |
| [ ] | Create list | New list creates and appears | S |
| [ ] | Star/unstar | `is_starred` behavior works if UI shown | R |
| [ ] | Empty list state | Empty list index renders correctly | R |
| [ ] | `/lists/[listId]` load | Items render for selected list | S |
| [ ] | Add item | Item added successfully | S |
| [ ] | Toggle done | Done/undone works | S |
| [ ] | Delete item | Soft delete hides item from active list | S |
| [ ] | Back navigation | Returns to list index correctly | R |
| [ ] | Long list/list-item names | Layout remains stable | E |

### 3.4 Capture / Unload

| # | Route | Steps / expected | Tier |
|---|-------|------------------|------|
| [ ] | `/capture` | Page loads | S |
| [ ] | Brain dump parse | `parseDump` succeeds and preview/result is sensible | S |
| [ ] | Confirm import | Tasks persist after confirm | S |
| [ ] | Optional refine | Background refine does not break UX if present/enabled | E |
| [ ] | Error path | Invalid/empty dump handled gracefully | R |

### 3.5 Profile + linking

| # | Route | Steps / expected | Tier |
|---|-------|------------------|------|
| [ ] | `/profile` | Profile loads | S |
| [ ] | Sign out | Sign out works and route protection updates correctly | S |
| [ ] | Display name / timezone UI | Works if exposed in profile | E |
| [ ] | `/link-whatsapp` | Link flow works end-to-end | R |

---

## 4. Web – Floating UI and import modals

Architecture v4 explicitly calls out `FloatingBrainDump`, `ImportTasksModal`, and `ImportListsModal`.

| # | Area | Steps / expected | Tier |
|---|------|------------------|------|
| [ ] | Floating Brain Dump visibility | Appears only where intended on signed-in app routes | R |
| [ ] | Floating Brain Dump open/close | Opens, closes, and returns focus cleanly | R |
| [ ] | ImportTasksModal | Upload → OCR → preview → confirm works | S |
| [ ] | ImportTasksModal duplicates | Duplicate handling behaves correctly | R |
| [ ] | ImportListsModal | Upload → OCR → preview → confirm works | S |
| [ ] | ImportListsModal save inbox | Save-to-inbox path works | R |
| [ ] | OCR error state | OCR failure / malformed file handled gracefully | R |

---

## 5. API – Tasks and parse/refine

### 5.1 Tasks

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/tasks/create` | Bearer | Creates task via canonical intake/insert path | S |
| [ ] | POST | `/api/tasks/update` | Bearer | Updates title/date/time/category as allowed | S |
| [ ] | POST | `/api/tasks/delete` | Bearer | Soft delete works | S |
| [ ] | POST | `/api/tasks/undo-delete` | Bearer | Undo restore works within window/rules | S |
| [ ] | POST | `/api/tasks/import/preview` | Bearer | OCR task preview generated | R |
| [ ] | POST | `/api/tasks/import/confirm` | Bearer | Tasks inserted idempotently / dedupe behavior holds | R |

### 5.2 Parse / refine

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/parseDump` | Bearer | Rules-first parse returns expected proposed tasks | S |
| [ ] | POST | `/api/refineTasks` | Bearer | If used, refine route works or is intentionally skipped | E |

### 5.3 Task API auth negatives

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | task routes above | none/invalid | Rejected appropriately when auth missing/invalid | R |

---

## 6. API – Lists, list items, and list import

Architecture v4 includes list CRUD, list import preview/confirm/save-inbox, and `find-or-create-and-add`.

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | GET | `/api/lists/view` | Bearer | Paginated list view works | S |
| [ ] | POST | `/api/lists/create` | Bearer | New list creates | S |
| [ ] | PATCH | `/api/lists/[listId]` | Bearer | Update name / `is_starred` works | S |
| [ ] | GET | `/api/lists/[listId]/items` | Bearer | Items load for list | S |
| [ ] | POST | `/api/lists/[listId]/items` | Bearer | Add items works | S |
| [ ] | PATCH | `/api/list-items/[itemId]` | Bearer | Update text / done state works | S |
| [ ] | DELETE | `/api/list-items/[itemId]` | Bearer | Soft delete works | S |
| [ ] | POST | `/api/lists/import/preview` | Bearer | OCR list preview generated | R |
| [ ] | POST | `/api/lists/import/confirm` | Bearer | Creates lists/items idempotently | R |
| [ ] | POST | `/api/lists/import/save-inbox` | Bearer | Inbox system list path works | R |
| [ ] | POST | `/api/lists/find-or-create-and-add` | Bearer | Resolves/creates list and adds items | R |
| [ ] | POST repeat | `/api/lists/import/confirm` | Bearer | Repeat confirm does not create duplicate import output | R |
| [ ] | POST repeat | `/api/lists/import/save-inbox` | Bearer | Repeated inbox save remains idempotent | R |
| [ ] | auth negative | list routes above | none/invalid | Rejected appropriately | R |

---

## 7. API – Media and OCR provider coverage

Architecture v4 supports `OCR_PROVIDER = openai | google`.

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/media/upload` | Bearer | Returns `mediaId`; storage + metadata row created | S |
| [ ] | POST | `/api/media/[mediaId]/ocr` | Bearer | OCR text stored; route succeeds | S |
| [ ] | OCR provider: current configured provider | media OCR flow | Bearer | Works under current env provider | S |
| [ ] | OCR provider: alternate provider | media OCR flow | Bearer | Smoke-test alternate provider if still supported before ship | E |
| [ ] | Invalid media | OCR route | Bearer | Graceful error on unsupported/corrupt file | R |

---

## 8. API – WhatsApp, linking, jobs, and negatives

Architecture v4 says POST `/api/whatsapp-webhook` accepts **Gupshup** inbound payloads only; jobs are protected by `CRON_SECRET`, and link route is active.

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/whatsapp-webhook` | provider payload | Gupshup payload shape processes correctly | S |
| [ ] | POST | `/api/whatsapp-webhook` | invalid/malformed | Graceful reject or safe no-op; no crash | R |
| [ ] | POST | `/api/link-whatsapp` | Bearer | Links phone to user | S |
| [ ] | POST | `/api/jobs/whatsapp-reminder` | `x-cron-secret` | Job completes | R |
| [ ] | POST | `/api/jobs/whatsapp-digest` | `x-cron-secret` | Job completes | R |
| [ ] | POST | jobs above | missing/wrong secret | Rejected | S |

---

## 9. API – Other

| # | Method | Path | Auth | Steps / expected | Tier |
|---|--------|------|------|------------------|------|
| [ ] | POST | `/api/log` | Optional | Client error logging succeeds | E |
| [ ] | POST | `/api/generate-category` | If used | Route works if still used by UI; else document skip | E |

---

## 10. WhatsApp – Manual message flows

Assume linked user + `WHATSAPP_ENABLED` as needed.

### 10.1 Task creation & query

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | Plain text task (AI path or implemented create path) | Task created; confirmation sent | S |
| [ ] | Task query – today | Returns today view; outbound context saved with `task_ids` where applicable | S |
| [ ] | Task query – search | Returns search results; outbound context saved with `task_ids` | S |
| [ ] | Digest-style phrase | Digest formatted correctly | R |
| [ ] | Unlinked user messages | Link instructions sent; no task/list writes | S |

### 10.2 Edit

Architecture v4 keeps edit as `wa_pending_actions`-based and anchored/idempotent.

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | Reply-anchored edit | Pending edit session created; patch applies | R |
| [ ] | Search-based edit fallback | 0/1/many-result behavior correct | R |
| [ ] | Idempotent retry | Duplicate inbound retry does not double-apply | R |
| [ ] | Expired edit session | Friendly expiry response; no patch applied | R |
| [ ] | Empty/invalid patch | Helpful clarification prompt | R |

### 10.3 Delete & undo

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | Reply delete | Soft delete via anchored `task_ids` | S |
| [ ] | Search fallback delete | Correct single/multi-path behavior | R |
| [ ] | UNDO within window | Restore succeeds with friendly confirmation | S |
| [ ] | UNDO after expiry | Friendly failure path; no restore | R |

### 10.4 Lists

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | “Show my lists” | Summary sent; outbound context includes `list_ids` | S |
| [ ] | Open specific list by name | Correct list preview | S |
| [ ] | Reply with number to summary | Opens correct list | R |
| [ ] | Add to list by reply | Items added to anchored list | S |
| [ ] | Add to list by name | Correct list resolved and item added | S |
| [ ] | Multiple lists match | `add_to_list_choose` disambiguation works | R |
| [ ] | Quick Add after open list | Plain lines add to active list | R |
| [ ] | Quick Add expiry | After expiry, plain text no longer hijacked as list add | R |
| [ ] | Quick Add exit phrase | Exit phrase leaves mode cleanly | R |
| [ ] | Done item | Item toggled done | S |
| [ ] | Remove item | Item removed/soft-deleted as designed | S |
| [ ] | Missing item reference | Help / clarification prompt | R |
| [ ] | Clear completed | Completed items cleared | R |
| [ ] | Action counter preview | Preview resend behavior works if threshold reached | E |

### 10.5 OCR import pending flows

Architecture v4 explicitly lists `ocr_import_list_name` and `ocr_import_confirm_tasks` in `wa_pending_actions`.

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | WA OCR → choose list name | `ocr_import_list_name` path works | R |
| [ ] | WA OCR → confirm tasks | `ocr_import_confirm_tasks` path works | R |
| [ ] | WA OCR malformed/ambiguous response | Clarification or safe failure path | R |

### 10.6 Session, compliance, and delivery window

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | STOP | `opted_out` toggles on; future proactive sends blocked | S |
| [ ] | START | `opted_out` toggles off; sends allowed again | S |
| [ ] | Inside 24h window | Free-form allowed where applicable | R |
| [ ] | Outside 24h window | Template fallback used where configured | R |

---

## 11. WhatsApp – Anchoring and persistence checks

Architecture v4 calls out `messages.provider_message_id`, `task_ids`, `list_ids`, and outbound `kind` values including `task_list`, `search_results`, `digest`, `delete_confirm`, `list_preview`, `list_summary`, `list_add_confirm`, `ocr_import_prompt`, and `ocr_import_confirm`.

| # | Scenario | Expected | Tier |
|---|----------|----------|------|
| [ ] | Task list outbound | `provider_message_id` + `task_ids` persisted | R |
| [ ] | Search results outbound | `provider_message_id` + `task_ids` persisted | R |
| [ ] | Digest outbound | `kind='digest'` or equivalent persisted correctly if applicable | E |
| [ ] | Delete confirm outbound | `kind='delete_confirm'` anchored correctly | R |
| [ ] | List preview outbound | `provider_message_id` + `list_ids` persisted | R |
| [ ] | List summary outbound | `list_ids` persisted | R |
| [ ] | List add confirm outbound | `kind='list_add_confirm'` path persists correctly if used | R |
| [ ] | OCR import prompt outbound | `kind='ocr_import_prompt'` path persists correctly if used | R |
| [ ] | OCR import confirm outbound | `kind='ocr_import_confirm'` path persists correctly if used | R |

---

## 12. Automated tests and local commands

Architecture v4 says the runner is **Vitest**, and the repo should support `npm test`, `npm run test:watch`, `npm run build`, and `npm run type-check`. The old matrix’s “no npm test script yet” note is stale.

| # | Command / area | Expected | Tier |
|---|----------------|----------|------|
| [ ] | `npm test` | Unit tests run under Vitest and pass | S |
| [ ] | `npm run test:watch` | Watch mode starts successfully | E |
| [ ] | `npm run type-check` | No type errors | S |
| [ ] | `npm run build` | Production build passes | S |

### 12.1 Unit test inventory spot-check

| # | File / area | Focus | Tier |
|---|-------------|-------|------|
| [ ] | Task intake / parity tests | Parsing + intake parity | R |
| [ ] | Task View engine/time/search/pagination tests | View logic | R |
| [ ] | Scheduling / remind_at tests | Reminder/schedule helpers | R |
| [ ] | WA parser tests | Delete/edit/digest intent detection | R |

---

## 13. Disabled / legacy routes

| # | Path group | Action | Tier |
|---|------------|--------|------|
| [ ] | `src/app/api/_disabled_*` | Confirm excluded from MVP sign-off unless explicitly re-enabled | R |

---

## 14. Release sign-off

| # | Item |
|---|------|
| [ ] | All **Tier S** web rows pass |
| [ ] | All **Tier S** API rows pass |
| [ ] | All **Tier S** WhatsApp rows pass on staging |
| [ ] | `npm test` passes |
| [ ] | `npm run type-check` passes |
| [ ] | `npm run build` passes |
| [ ] | Any skipped **Tier R**/**E** rows are explicitly documented with rationale |
| [ ] | Final staging sanity run completed with linked and unlinked user states |
| [ ] | No open blockers on task/list data integrity, OCR import, or WhatsApp anchoring |

---

## 15. Known deliberate skips / notes

| # | Note |
|---|------|
| [ ] | Document any routes/features intentionally not in MVP despite existing in repo |
| [ ] | Document any provider-specific WA/OCR tests skipped and why |
| [ ] | Document whether `/activity` is intentionally reachable-but-unlinked |
