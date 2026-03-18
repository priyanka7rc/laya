# Laya – Implemented Features List

This document consolidates all features referenced and implemented in the Laya codebase (from architecture docs, migrations, plans, and implementation summaries).

---

## Tasks (Features #1–#15)

| # | Feature | Description | Surfaces |
|---|---------|-------------|----------|
| **1** | Canonical task intake (rules-first) | Segment string → ProposedTask; parseDate, parseTime, getSmartDefaultTime, stripTemporalPhrases, detectCategory | Web keyboard, Brain Dump, OCR |
| **2** | OCR task import + dedupe | Normalize text, split candidates, candidateToProposedTask; 5s duplicate window via `insertTasksWithDedupe` | Web OCR import |
| **3** | *(implicit)* Brain Dump parsing | splitBrainDump → textToProposedTasksFromSegments | FloatingBrainDump |
| **4** | WhatsApp task creation | processWithLaya (AI) for plain text; rules-first for OCR media | WhatsApp |
| **5** | *(implicit)* Task View – Today | view: 'today', timezone-aware window | Web Home, WhatsApp digest |
| **6** | *(implicit)* Task View – Upcoming | view: 'upcomingDays' | Web Home |
| **7** | Task View – All / Search | view: 'all', view: 'search', pagination | Web Tasks, WhatsApp query |
| **8** | *(implicit)* Task View engine | executeTaskView, contracts, queries | All task read paths |
| **9** | Task View – Digest | view: 'digest', formatDigestFromResult | WhatsApp on-demand, scheduled digest job |
| **10** | *(implicit)* Task View – Reminder | view: 'reminder' window | WhatsApp reminder job |
| **11** | Task View formatting | formatTaskListForQuery, formatDigestFromResult | WhatsApp responses |
| **12** | WhatsApp task edit (Stage 1) | Edit selection: reply-anchored, search fallback; wa_pending_actions | WhatsApp |
| **13** | WhatsApp task edit (Stage 2) | Apply patch: parseEditPatch → updateTaskFields; idempotency, expiry | WhatsApp |
| **14** | Task delete (Web + WA) | Soft delete, reply-anchored via messages.task_ids | Web Tasks, WhatsApp |
| **15** | Task undo | undoDelete, last_deleted_task_ids, 5‑minute window | Web Tasks, WhatsApp |

---

## Lists (Features #16–#20)

| # | Feature | Description | Surfaces |
|---|---------|-------------|----------|
| **16** | Lists tab (MVP) | Create list, view lists, `lists` table | Web Lists |
| **17** | List items (Web) | list_items table; add, toggle, soft-delete items | Web Lists/[listId] |
| **18.4** | WhatsApp – Show lists | "show my lists", "lists" → getUserLists → formatListSummary | WhatsApp |
| **18.5** | WhatsApp – Show specific list | "show grocery", "open X" → getListByName → formatListPreview | WhatsApp |
| **18.6** | WhatsApp – List preview | Reply hints: done, remove, add; list_ids on messages | WhatsApp |
| **19** | WhatsApp – Add/done/remove | Add to list (reply-anchored, explicit name, disambiguation); done/remove items; add_to_list_choose, list_ids | WhatsApp |
| **19** | Quick Add mode | Plain text → add to list after opening; wa_pending_actions quick_add (5 min) | WhatsApp |
| **19** | Clear completed | "clear completed", "remove completed" → deleteCompletedItems | WhatsApp |
| **19** | List preview after actions | After 3 add/done/remove actions → send list preview (listActionCounterStore) | WhatsApp |
| **20** | OCR list import | ocr_import_list_name, ocr_import_confirm_tasks; list extraction from OCR | WhatsApp (media), Web ImportListsModal |
| **20** | System lists (Inbox) | getOrCreateSystemList, system_key, is_system | Lists import save-inbox |
| **20** | wa_pending_actions extensions | task_id nullable; ocr_import_list_name, ocr_import_confirm_tasks, add_to_list_choose, quick_add | WhatsApp |

---

## Supporting Features (No Feature #)

| Feature | Description |
|---------|-------------|
| **WhatsApp linking** | Link phone to auth account; link-whatsapp page + API |
| **WhatsApp webhook** | Gupshup/Meta verification + inbound routing |
| **WhatsApp 24h window** | canSendFreeformMessage; template fallback outside 24h |
| **WhatsApp STOP/START** | opted_out, daily_digest_enabled |
| **Reply anchoring** | messages.provider_message_id + task_ids + list_ids |
| **OCR provider (swappable)** | OCR_PROVIDER env; openai, google adapters |
| **Brain Dump → insertTasksWithDedupe** | parseDump → /api/tasks/import/confirm (unified insert path) |
| **Refine Tasks (background)** | Optional AI refinement after Brain Dump insert |
| **Dev cache clearing** | npm run dev:clean, npm run clear:build |
| **App Store compliance** | Env vars, security docs (laya-mobile) |
| **Dark/light theme** | ThemeProvider, ThemeToggle, prefers-color-scheme |
| **Toast notifications** | ToastProvider, ToastViewport |
| **Bottom navigation** | Home, Tasks, Activity (fixed bottom) |

---

## Disabled / Legacy (Not in Active MVP)

| Area | Status |
|------|--------|
| Meal plan | `_disabled_mealplan` |
| Meals | `_disabled_meals` |
| Grocery | `_disabled_grocery` |
| Dish | `_disabled_dish` |

---

## Source References

- `architecture_v2.md` – Features #1–15
- `architecture_v3.md` – Features #16–20, Lists
- `.cursor/plans/whatsapp-list-read-18.4-18.6_ce0addd3.plan.md` – List-read spec
- `docs/TASK_INTAKE_DEDUPE_AUDIT.md` – Features #1, #2
- `supabase/migrations/*.sql` – Feature comments in migrations
