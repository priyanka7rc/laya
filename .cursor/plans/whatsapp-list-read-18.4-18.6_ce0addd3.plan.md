---
name: whatsapp-list-read-18.4-18.6
overview: Add WhatsApp list-read capabilities (show my lists, show specific list, list preview with quick-action copy) via new server list queries, rules-first intent detection, and handlers in the existing processor, without changing task or list-item creation flows.
todos: []
isProject: false
---

# WhatsApp List Read (Features 18.4, 18.5, 18.6)

## Scope

- **18.4** Show list of lists (e.g. "show my lists", "lists").
- **18.5** Show a specific list by name or by reply (number/name after list summary).
- **18.6** List preview includes quick-action line: "Reply with: done , remove , add ."
- Rules-first only; no AI. Integrate into [src/lib/whatsapp-processor.ts](src/lib/whatsapp-processor.ts) without changing task creation (Feature #4) or list-item add/done/remove (Feature #19).

## 1. Server list queries

**New file: [src/server/listQueries.ts](src/server/listQueries.ts)**

- Use `supabaseAdmin` from `@/lib/supabaseClient` (same as [src/server/listView/listViewQueries.ts](src/server/listView/listViewQueries.ts) pattern; if the repo uses a local createClient with service role there, use that same pattern for consistency).
- `**getUserLists(appUserId: string)`**
  - Query `lists` where `app_user_id = appUserId` and `deleted_at IS NULL`, order by `created_at DESC`, limit 10.
  - For item counts: either (a) second query to `list_items` with `list_id IN (...)` and `deleted_at IS NULL`, then aggregate counts in JS, or (b) Supabase select with embedded count if supported (e.g. `list_items(count)`). Prefer (a) for clarity and compatibility.
  - Return `Array<{ id: string; name: string; item_count: number }>`.
- `**getListByName(appUserId: string, name: string)**`
  - Trim/lowercase name for matching.
  - First: exact match on `name` (case-insensitive), `app_user_id`, `deleted_at IS NULL`.
  - If none: `ilike` contains on `name`, same filters. Return first match.
  - Return `{ id: string; name: string } | null`.
- `**getListItems(listId: string)**`
  - Query `list_items` where `list_id = listId` and `deleted_at IS NULL`, order by `is_done ASC`, `created_at DESC`, limit 20.
  - Return `Array<{ id: string; text: string; is_done: boolean; created_at: string }>`.

All queries must filter `deleted_at` and scope by `app_user_id` where applicable.

## 2. Intent detection and formatters

**New file: [src/lib/waListReadParser.ts](src/lib/waListReadParser.ts)** (or split parser vs formatter; single file is fine)

- `**detectShowListsIntent(text: string): boolean`**
  - Normalize: trim, lowercase, collapse spaces.
  - Return true for: `show my lists`, `lists`, `my lists`, `what lists do i have` (exact or equivalent).
- `**detectShowSpecificListIntent(text: string): { listName: string } | null**`
  - Patterns (regex): `show\s+(.+)`, `open\s+(.+)`, `(.+)\s+list` (avoid matching "list" alone).
  - Extract list name (group 1), trim; return null if empty or too short.
- `**formatListSummary(lists: Array<{ name: string; item_count: number }>)**`
  - Output:
    - "Your lists:\n\n1. {name} ({n} items)\n2. ..."
    - "Reply with the number or name to open a list."
- `**formatListPreview(listName: string, itemCount: number, items: Array<{ text: string; is_done: boolean }>)**`
  - Header: "{listName} ({n} items)\n\n"
  - Numbered lines: "1. ☐ rice" or "2. ☑ milk" (☐ false, ☑ true).
  - Footer: "Reply with:\ndone \nremove \nadd "

## 3. Processor integration

**File: [src/lib/whatsapp-processor.ts](src/lib/whatsapp-processor.ts)**

- **Placement**: After the "3b-done-remove" block (around line 548) and **before** the "3c. Detect query intent" block (line 550). So list-read runs before generic task query (which uses "show", "list", etc.).
- **Resolution**: In the new block, resolve `appUserId` once via existing pattern: `supabase.from('app_users').select('id').eq('auth_user_id', userId).maybeSingle()`; if !appUser, skip list-read (or return).
- **Handlers (in order)**:
  1. **Reply-anchored "open list"**
    If `message.replyToMessage` is set:
    - Load message by `provider_message_id = replyToMessage` and read `list_ids` (array of list UUIDs).
    - If `list_ids` exists and reply text is a number (e.g. "1", "2") or matches a list name: resolve list (by index into `list_ids` or by name in that set), call `getListItems(list.id)`, format with `formatListPreview`, send, then `saveOutboundMessage` with `listIds: [list.id]`, `providerMessageId`, and `kind: 'list_preview'`. Return.
  2. **Show-lists intent**
    If `detectShowListsIntent(finalText)`:
    - Call `getUserLists(appUserId)`.
    - If empty: send "You don't have any lists yet. Say create list  to create one."
    - Else: format with `formatListSummary`, send, then `saveOutboundMessage` with `listIds: lists.map(l => l.id)` (in order), `providerMessageId`, `kind: 'list_summary'`. Return.
  3. **Show-specific-list intent**
    If `detectShowSpecificListIntent(finalText)` returns `{ listName }`:
    - Call `getListByName(appUserId, listName)`.
    - If not found: send "I couldn't find that list."
    - Else: call `getListItems(list.id)`, format with `formatListPreview`, send, then `saveOutboundMessage` with `listIds: [list.id]`, `providerMessageId`, `kind: 'list_preview'`. Return.
- **Logging**: Use a single tag e.g. `[WA] Route: LIST-READ` for these branches.
- Do **not** change any logic in task parsing, `handleTaskQuery`, `detectAddToListIntent`, or `parseDoneRemoveIntent`.

## 4. Safety and limits

- All list queries: `deleted_at IS NULL` and, for lists, `app_user_id` scope.
- Cap: 10 lists in summary, 20 items in preview (enforced in `getUserLists` and `getListItems`).
- No changes to [src/lib/waAddToListParser.ts](src/lib/waAddToListParser.ts) or to task creation/query paths.

## 5. Outbound message anchoring

- For list summary and list preview responses, call existing `saveOutboundMessage` after `sendWhatsAppMessage` with:
  - `providerMessageId` from send result.
  - `listIds`: array of list UUIDs in display order (so reply "1" or "add milk" can use reply context).
  - `kind`: `'list_summary'` or `'list_preview'`.

## 6. Deliverables


| Item              | Detail                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Files created     | `src/server/listQueries.ts`, `src/lib/waListReadParser.ts`                                                                              |
| Files modified    | `src/lib/whatsapp-processor.ts` (new block only)                                                                                        |
| SQL               | No new migration; uses existing `lists` and `list_items` tables.                                                                        |
| Example responses | Shown in formatter section above.                                                                                                       |
| Confirmation      | Task creation, task query, add-to-list, and done/remove flows unchanged; list-read runs in a dedicated block before generic task query. |


## 7. Optional enhancement

- If the codebase already has a shared "resolve app_user_id from auth user" helper used by list handlers, call that instead of inlining the `app_users` lookup in the list-read block.

