#!/usr/bin/env node
/*
 * Laya UI seed generator — v2
 *
 * Purpose:
 *   Generate deterministic SQL seed data for UI/UX testing aligned to the
 *   actual live schema (derived from supabase/migrations/). Targets the
 *   persisted UI-driving entities: tasks, lists, list_items.
 *
 * Schema fixes applied vs. original draft (v1):
 *   C1 - tasks.source_message_id is UUID — set to NULL (no FK row in messages)
 *   C2 - list_items.source CHECK ('web','whatsapp','ocr') — cap via safeItemSource()
 *   C3 - tasks.due_at never computed — added from due_date + due_time
 *   C4 - tasks.status not set — added, derived from is_done
 *   C5 - tasks.category non-canonical ('Kids','Errands','Food') — remapped
 *   M1 - Inbox system list removed (unique partial index conflict risk)
 *   M2 - tasks.source 'brain_dump'/'ocr' mapped to 'web'
 *
 * v2 additions (architecture_v5 + TEST_MATRIX_v2 alignment):
 *   V1 - tasks.source constraint expanded: web_keyboard, web_brain_dump,
 *        web_media, whatsapp_text, whatsapp_media now accepted
 *   V2 - lists.is_starred column added (migration 20260318); seeded on some lists
 *   V3 - Default baseNow / --base-date moved to 2026-03-27 (window: Mar 27–Apr 20)
 *   V4 - Default seedTag changed to 'seed-v2' (additive; won't touch [seed] rows)
 *   V5 - Task scenarios extended to cover full TEST_MATRIX_v2 §3.1/3.2/3.3 cases
 *
 * Usage:
 *   node scripts/seeds/laya_ui_seed.js --preview
 *   node scripts/seeds/laya_ui_seed.js --auth-user-id=<UUID> --app-user-id=<UUID>
 *   node scripts/seeds/laya_ui_seed.js --auth-user-id=<UUID> --app-user-id=<UUID> --output=./scripts/seeds/laya-ui-seed-v2-local.sql
 *   node scripts/seeds/laya_ui_seed.js --auth-user-id=<UUID> --app-user-id=<UUID> --large
 *   node scripts/seeds/laya_ui_seed.js --auth-user-id=<UUID> --app-user-id=<UUID> --base-date=2026-03-27
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// CLI
// ============================================================
function parseArgs(argv) {
  const args = {
    authUserId: '00000000-0000-0000-0000-000000000001',
    appUserId:  '00000000-0000-0000-0000-000000000002',
    mode:       'medium',
    seedTag:    'seed-v2',          // V4: changed from 'laya-ui-seed'
    baseDate:   '2026-03-27',       // V3: new default date anchor
    output:     null,
    preview:    false,
    noReset:    false,
  };

  for (const raw of argv.slice(2)) {
    if (raw === '--small')          args.mode = 'small';
    else if (raw === '--medium')    args.mode = 'medium';
    else if (raw === '--large')     args.mode = 'large';
    else if (raw === '--preview')   args.preview = true;
    else if (raw === '--no-reset')  args.noReset = true;
    else if (raw.startsWith('--auth-user-id=')) args.authUserId = raw.split('=')[1];
    else if (raw.startsWith('--app-user-id='))  args.appUserId  = raw.split('=')[1];
    else if (raw.startsWith('--seed-tag='))      args.seedTag    = raw.split('=')[1];
    else if (raw.startsWith('--base-date='))     args.baseDate   = raw.split('=')[1]; // V3
    else if (raw.startsWith('--output='))        args.output     = raw.split('=')[1];
  }
  return args;
}

// ============================================================
// Helpers
// ============================================================

/** Deterministic UUID from any string input (SHA-1 hex → UUID v4-ish format). */
function hashToUuid(input) {
  const hex = crypto.createHash('sha1').update(input).digest('hex').slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

/** SQL-quote a scalar value. */
function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number')  return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** SQL-quote a JSONB value. */
function json(value) {
  return value == null ? 'NULL' : `${q(JSON.stringify(value))}::jsonb`;
}

function ts(date) {
  return date instanceof Date ? date.toISOString() : date;
}

function dateOnly(date) {
  return (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10);
}

function timeOnly(date) {
  return (date instanceof Date ? date : new Date(date)).toISOString().slice(11, 16) + ':00';
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function withTime(date, hour, minute = 0) {
  const d = new Date(date);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

/**
 * Compute due_at ISO string from due_date + due_time.
 * Treats the date/time as UTC for seed purposes.
 * Returns null when due_date is absent.
 */
function computeDueAt(dueDate, dueTime) {
  if (!dueDate) return null;
  const time = dueTime || '20:00:00';
  const timePart = time.length === 5 ? `${time}:00` : time;
  return `${dueDate}T${timePart}Z`;
}

/**
 * V1: Normalise tasks.source to the full v5 constraint set.
 * Previously only 'web' / 'whatsapp' were safe; migration 20260319 expanded
 * the CHECK to include web_keyboard, web_brain_dump, web_media,
 * whatsapp_text, whatsapp_media.
 */
const V5_TASK_SOURCES = new Set([
  'web', 'web_keyboard', 'web_brain_dump', 'web_media',
  'whatsapp', 'whatsapp_text', 'whatsapp_media',
]);
function safeTaskSource(src) {
  return V5_TASK_SOURCES.has(src) ? src : 'web';
}

/**
 * C2: Normalise list_item.source to the only values the DB CHECK allows.
 */
function safeItemSource(src) {
  return ['web', 'whatsapp', 'ocr'].includes(src) ? src : 'web';
}

/** Normalised text for list items. */
function normalized(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ============================================================
// Category mapping — C5 fix
// Canonical TASK_CATEGORIES from src/lib/categories.ts:
//   Admin, Finance, Fitness, Health, Home, Learning, Meals,
//   Personal, Shopping, Tasks, Work
// ============================================================
const CATEGORY_MAP = { Kids: 'Tasks', Errands: 'Shopping', Food: 'Meals' };
function canonicalCategory(cat) {
  return CATEGORY_MAP[cat] || cat || 'Tasks';
}

// ============================================================
// Dataset size config
// ============================================================
function buildConfig(mode) {
  if (mode === 'small')  return { extraTasks: 6,  extraLists: 1, extraItems: 4  };
  if (mode === 'large')  return { extraTasks: 28, extraLists: 4, extraItems: 20 };
  return                        { extraTasks: 16, extraLists: 2, extraItems: 10 };
}

// ============================================================
// Tasks — V5: scenarios cover March 27–April 20, all TEST_MATRIX_v2 §3.1/3.2 cases
// ============================================================
function buildTasks(baseNow, seedTag) {
  const today = withTime(baseNow, 9, 0);
  const tasks = [];
  let i = 0;

  function push(partial) {
    i += 1;
    const id        = hashToUuid(`${seedTag}:task:${i}:${partial.title}`);
    const createdAt = partial.createdAt || addDays(baseNow, -Math.max(1, 14 - i));
    const updatedAt = partial.updatedAt || createdAt;
    const isDone    = partial.is_done ?? false;

    // C1: source_message_id is FK → messages; always NULL for seed tasks.
    const sourceMessageId = null;

    // C3: compute due_at from due_date + due_time
    const dueAt  = computeDueAt(partial.due_date ?? null, partial.due_time ?? null);

    // C4: status must reflect is_done
    const status = isDone ? 'completed' : 'active';

    // V1: map task source to full v5 safe values
    const source = safeTaskSource(partial.source);

    // C5: map category to canonical value
    const category = canonicalCategory(partial.category);

    tasks.push({
      id,
      title:            partial.title,
      category,
      due_date:         partial.due_date   ?? null,
      due_time:         partial.due_time   ?? null,
      due_at:           dueAt,
      is_done:          isDone,
      status,
      source,
      source_message_id: sourceMessageId,
      inferred_date:    partial.inferred_date ?? false,
      inferred_time:    partial.inferred_time ?? false,
      created_at:       createdAt,
      updated_at:       updatedAt,
      deleted_at:       partial.deleted_at || null,
    });
  }

  // -----------------------------------------------------------------
  // OVERDUE (§3.2 – overdue section)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Pay electricity bill`,
         category: 'Personal', source: 'web_keyboard',
         due_date: dateOnly(addDays(today, -3)), due_time: '09:00:00' });

  push({ title: `[${seedTag}] Renew car insurance`,
         category: 'Admin',    source: 'whatsapp_text',
         due_date: dateOnly(addDays(today, -1)), inferred_date: true });

  // -----------------------------------------------------------------
  // TODAY (§3.1 Home – today card; §3.2 Tasks – today tasks)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Pack Ved swimming bag`,
         category: 'Tasks',   source: 'web_keyboard',
         due_date: dateOnly(today), due_time: '07:30:00' });

  push({ title: `[${seedTag}] Send school fee receipt`,
         category: 'Admin',   source: 'whatsapp_text',
         due_date: dateOnly(today), due_time: '10:15:00', inferred_time: true });

  push({ title: `[${seedTag}] Order vegetables for dinner`,
         category: 'Home',    source: 'web_keyboard',
         due_date: dateOnly(today), due_time: '17:30:00' });

  push({ title: `[${seedTag}] Refill protein powder`,
         category: 'Health',  source: 'web_brain_dump',
         due_date: dateOnly(today), inferred_time: true });

  // -----------------------------------------------------------------
  // TOMORROW (§3.1 Home – upcoming / tomorrow bucket)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Book pest control visit`,
         category: 'Home',    source: 'web_keyboard',
         due_date: dateOnly(addDays(today, 1)), due_time: '11:00:00' });

  push({ title: `[${seedTag}] Review mockups for calm home screen`,
         category: 'Work',    source: 'web_brain_dump',
         due_date: dateOnly(addDays(today, 1)), due_time: '14:00:00' });

  // -----------------------------------------------------------------
  // THIS WEEK — March 29–April 2 (§3.1 Upcoming)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Follow up with carpenter`,
         category: 'Home',    source: 'whatsapp_text',
         due_date: dateOnly(addDays(today, 2)), inferred_date: true });

  push({ title: `[${seedTag}] Buy return-gift wrapping paper`,
         category: 'Shopping', source: 'web_keyboard',
         due_date: dateOnly(addDays(today, 3)), due_time: '16:30:00' });

  push({ title: `[${seedTag}] Plan breakfast menu for Sunday guests`,
         category: 'Meals',   source: 'web_brain_dump',
         due_date: dateOnly(addDays(today, 5)) });

  // -----------------------------------------------------------------
  // MID-APRIL — April 7–14 (§3.2 scroll / pagination density)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Upload final invoice to drive folder`,
         category: 'Admin',   source: 'web_keyboard',
         due_date: dateOnly(addDays(today, 11)), due_time: '13:00:00' });

  push({ title: `[${seedTag}] Check school holiday schedule April`,
         category: 'Tasks',   source: 'whatsapp_text',
         due_date: dateOnly(addDays(today, 13)) });

  push({ title: `[${seedTag}] Pay society maintenance fee`,
         category: 'Finance', source: 'web_keyboard',
         due_date: dateOnly(addDays(today, 14)), due_time: '09:00:00' });

  // -----------------------------------------------------------------
  // LATE APRIL — April 15–20 (§3.2 far upcoming / scroll)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Plan Goa packing list`,
         category: 'Personal', source: 'web_brain_dump',
         due_date: dateOnly(addDays(today, 19)) });

  push({ title: `[${seedTag}] Book train tickets for summer trip`,
         category: 'Personal', source: 'whatsapp_media',
         due_date: dateOnly(addDays(today, 24)), due_time: '10:00:00' });

  // -----------------------------------------------------------------
  // NO DUE DATE (§3.2 inbox / no-date filter)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Compare stroller rain cover options`,
         category: 'Shopping', source: 'whatsapp_text' });

  push({ title: `[${seedTag}] Collect dry cleaning`,
         category: 'Shopping', source: 'web_keyboard' });

  push({ title: `[${seedTag}] Research summer camp options for Ved`,
         category: 'Tasks',   source: 'web_brain_dump' });

  // -----------------------------------------------------------------
  // COMPLETED (§3.2 completed filter)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Read 15 pages of current book`,
         category: 'Personal', source: 'web_keyboard',
         is_done: true, due_date: dateOnly(addDays(today, -2)) });

  push({ title: `[${seedTag}] Confirm playdate timing with Aditi`,
         category: 'Tasks',   source: 'whatsapp_text',
         is_done: true, due_date: dateOnly(today), due_time: '12:00:00' });

  push({ title: `[${seedTag}] Submit Q1 expense report`,
         category: 'Finance', source: 'web_keyboard',
         is_done: true, due_date: dateOnly(addDays(today, -4)) });

  // -----------------------------------------------------------------
  // SOFT DELETED (§3.2 delete / undo flow)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Move winter jackets to upper shelf`,
         category: 'Home',    source: 'web_keyboard',
         deleted_at: ts(addDays(today, -1)) });

  // -----------------------------------------------------------------
  // LONG TITLE (§3.2 overflow / wrap stress test)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Fix bedside lamp or replace bulb before guests come over this weekend because the current warm light flickers intermittently`,
         category: 'Home',    source: 'web_brain_dump',
         due_date: dateOnly(addDays(today, 2)), due_time: '19:15:00' });

  // -----------------------------------------------------------------
  // DISAMBIGUATION PAIR (§3.2 search — two near-identical titles)
  // -----------------------------------------------------------------
  push({ title: `[${seedTag}] Pick up coriander`,
         category: 'Meals',   source: 'whatsapp_text',
         due_date: dateOnly(today) });

  push({ title: `[${seedTag}] Pick up coriander for chutney`,
         category: 'Meals',   source: 'whatsapp_text',
         due_date: dateOnly(addDays(today, 1)) });

  return tasks;
}

// ============================================================
// Lists — V2: includes is_starred; covers TEST_MATRIX_v2 §3.3
// ============================================================
function buildLists(baseNow, seedTag) {
  const lists = [];
  let i = 0;

  function push(partial) {
    i += 1;
    const id        = hashToUuid(`${seedTag}:list:${i}:${partial.name}`);
    const createdAt = partial.createdAt || addDays(baseNow, -Math.max(1, 8 - i));
    const updatedAt = partial.updatedAt || createdAt;
    lists.push({
      id,
      name:                     partial.name,
      source:                   partial.source || 'web',
      source_message_id:        partial.source_message_id || `${seedTag}-msg-list-${i}`,
      created_at:               createdAt,
      updated_at:               updatedAt,
      deleted_at:               partial.deleted_at    || null,
      deleted_source:           partial.deleted_source || null,
      deleted_by_auth_user_id:  partial.deleted_by_auth_user_id || null,
      import_candidates:        partial.import_candidates ?? null,
      is_system:                partial.is_system ?? false,
      system_key:               partial.system_key ?? null,
      is_starred:               partial.is_starred ?? false,  // V2
    });
  }

  // M1: Inbox system list intentionally omitted — unique partial index conflict risk.

  // Two starred lists for §3.3 star/unstar test
  push({ name: `[${seedTag}] Grocery`,                              source: 'whatsapp',  is_starred: true  });
  push({ name: `[${seedTag}] Travel packing for Goa trip`,          source: 'web',        is_starred: true  });
  push({ name: `[${seedTag}] School admin`,                         source: 'web',        is_starred: false });
  push({ name: `[${seedTag}] Pantry OCR import`,                    source: 'ocr',        is_starred: false,
         import_candidates: ['almonds', 'basmati rice', 'toor dal', 'paper napkins'] });
  push({ name: `[${seedTag}] Empty ideas list`,                     source: 'web',        is_starred: false });
  push({ name: `[${seedTag}] Deep storage items to check before festival hosting and guest setup`,
         source: 'web',        is_starred: false });
  // Soft-deleted list (§3.3 deleted state)
  push({ name: `[${seedTag}] Archived spring cleaning`,             source: 'web',        is_starred: false,
         deleted_at: ts(addDays(baseNow, -2)), deleted_source: 'web' });

  return lists;
}

// ============================================================
// List items
// ============================================================
function buildListItems(lists, baseNow, seedTag) {
  const find = (needle) => lists.find((l) => l.name.includes(needle));
  const rows = [];
  let i = 0;

  function push(list, text, opts = {}) {
    i += 1;
    const rawSource = opts.source || list.source || 'web';
    rows.push({
      id:              hashToUuid(`${seedTag}:list-item:${i}:${list.id}:${text}`),
      list_id:         list.id,
      text,
      normalized_text: normalized(text),
      is_done:         opts.is_done ?? false,
      source:          safeItemSource(rawSource),   // C2
      created_at:      opts.created_at || addDays(baseNow, -3),
      updated_at:      opts.updated_at || addDays(baseNow, -2),
      deleted_at:      opts.deleted_at || null,
    });
  }

  const grocery = find('Grocery');
  const travel  = find('Travel packing');
  const school  = find('School admin');
  const pantry  = find('Pantry OCR');
  const deep    = find('Deep storage');
  // 'Empty ideas list' is intentionally left without items — empty list state test.

  // Grocery (source: whatsapp — allowed by safeItemSource)
  ['tomatoes', 'coriander', 'greek yogurt', 'paneer', 'dishwasher tablets'].forEach((t, idx) =>
    push(grocery, `[${seedTag}] ${t}`, { is_done: idx === 1 })
  );

  // Travel packing — Goa trip
  ['Ved night suit', 'swim shorts', 'phone charger', 'snacks for flight', 'small medicines pouch'].forEach((t, idx) =>
    push(travel, `[${seedTag}] ${t}`, { is_done: idx === 0 })
  );

  // School admin
  ['submit transport form', 'label extra uniform set', 'pay activity fee online'].forEach((t) =>
    push(school, `[${seedTag}] ${t}`)
  );

  // Pantry OCR import — source: 'ocr' (allowed)
  ['almonds', 'basmati rice', 'toor dal', 'paper napkins', 'cling wrap'].forEach((t, idx) =>
    push(pantry, `[${seedTag}] ${t}`, { is_done: idx === 2, source: 'ocr' })
  );

  // Deep storage — long-text item for wrap stress test
  [
    'extra floor cushions',
    'guest bath towels',
    'festive serving bowls',
    'string lights for balcony railing and dining shelf because the usual box is not labelled clearly',
  ].forEach((t) => push(deep, `[${seedTag}] ${t}`));

  return rows;
}

// ============================================================
// Volume padding (extra rows for scroll / density testing)
// ============================================================
function addVolume(arr, makeFn, count) {
  for (let i = 0; i < count; i += 1) makeFn(i);
  return arr;
}

// ============================================================
// Generate full dataset
// ============================================================
function generate(args) {
  const cfg      = buildConfig(args.mode);
  const baseNow  = new Date(`${args.baseDate}T09:00:00.000Z`); // V3: parameterised
  const tasks    = buildTasks(baseNow, args.seedTag);
  const lists    = buildLists(baseNow, args.seedTag);
  const listItems = buildListItems(lists, baseNow, args.seedTag);

  const categories = ['Home', 'Admin', 'Tasks', 'Meals', 'Work', 'Shopping'];
  // V1: granular v5 source values across volume rows
  const sources = ['web_keyboard', 'web_brain_dump', 'whatsapp_text', 'web_keyboard', 'web_media'];

  addVolume(tasks, (idx) => {
    // Spread extra tasks across the March 27–April 20 window (0–24 days ahead)
    const dueBase    = addDays(baseNow, idx % 25);
    const rawDueDate = idx % 5 === 0 ? null : dateOnly(dueBase);
    const rawDueTime = idx % 3 === 0 ? timeOnly(withTime(dueBase, 9 + (idx % 8), 15)) : null;
    const isDone     = idx % 9 === 0;
    const dueAt      = computeDueAt(rawDueDate, rawDueTime); // C3

    tasks.push({
      id:                hashToUuid(`${args.seedTag}:task-extra:${idx}`),
      title:             `[${args.seedTag}] Extra task ${idx + 1} for UI density and scroll validation`,
      category:          categories[idx % categories.length],
      due_date:          rawDueDate,
      due_time:          rawDueTime,
      due_at:            dueAt,
      is_done:           isDone,
      status:            isDone ? 'completed' : 'active',     // C4
      source:            sources[idx % sources.length],       // V1
      source_message_id: null,                                 // C1
      inferred_date:     idx % 4 === 0,
      inferred_time:     idx % 6 === 0,
      created_at:        addDays(baseNow, -10 + (idx % 5)),
      updated_at:        addDays(baseNow, -8  + (idx % 5)),
      deleted_at:        idx % 17 === 0 ? ts(addDays(baseNow, -1)) : null,
    });
  }, cfg.extraTasks);

  addVolume(lists, (idx) => {
    lists.push({
      id:                      hashToUuid(`${args.seedTag}:list-extra:${idx}`),
      name:                    `[${args.seedTag}] Extra list ${idx + 1}`,
      source:                  sources[idx % sources.length],
      source_message_id:       `${args.seedTag}-msg-list-extra-${idx + 1}`,
      created_at:              addDays(baseNow, -6 + idx),
      updated_at:              addDays(baseNow, -5 + idx),
      deleted_at:              null,
      deleted_source:          null,
      deleted_by_auth_user_id: null,
      import_candidates:       null,
      is_system:               false,
      system_key:              null,
      is_starred:              idx === 0, // V2: first extra list is starred
    });
  }, cfg.extraLists);

  const itemTargetLists = lists.filter((l) => !l.deleted_at).slice(0, Math.max(1, cfg.extraLists + 3));
  addVolume(listItems, (idx) => {
    const list = itemTargetLists[idx % itemTargetLists.length];
    listItems.push({
      id:              hashToUuid(`${args.seedTag}:list-item-extra:${idx}`),
      list_id:         list.id,
      text:            `[${args.seedTag}] Extra item ${idx + 1} for ${list.name}`,
      normalized_text: normalized(`${args.seedTag} extra item ${idx + 1} for ${list.name}`),
      is_done:         idx % 5 === 0,
      source:          safeItemSource(list.source), // C2
      created_at:      addDays(baseNow, -2),
      updated_at:      addDays(baseNow, -1),
      deleted_at:      idx % 13 === 0 ? ts(baseNow) : null,
    });
  }, cfg.extraItems);

  return { tasks, lists, listItems };
}

// ============================================================
// SQL generation
// ============================================================
function sqlFor(args, data) {
  const parts = [];
  const { authUserId, appUserId, seedTag, noReset } = args;

  parts.push('-- Laya UI seed SQL v2');
  parts.push(`-- seed_tag:      ${seedTag}`);
  parts.push(`-- mode:          ${args.mode}`);
  parts.push(`-- base_date:     ${args.baseDate}`);
  parts.push('-- generated_by:  scripts/seeds/laya_ui_seed.js');
  parts.push(`-- generated_at:  ${new Date().toISOString()}`);
  parts.push('BEGIN;\n');

  if (!noReset) {
    parts.push('-- Safe reset: deletes only rows created by this seed, in FK order.');
    parts.push(`DELETE FROM list_items WHERE app_user_id = ${q(appUserId)} AND (text LIKE ${q(`[${seedTag}]%`)} OR id IN (${data.listItems.map((r) => q(r.id)).join(', ')}));`);
    parts.push(`DELETE FROM tasks WHERE app_user_id = ${q(appUserId)} AND (title LIKE ${q(`[${seedTag}]%`)} OR id IN (${data.tasks.map((r) => q(r.id)).join(', ')}));`);
    parts.push(`DELETE FROM lists WHERE app_user_id = ${q(appUserId)} AND (name LIKE ${q(`[${seedTag}]%`)} OR id IN (${data.lists.map((r) => q(r.id)).join(', ')}));\n`);
  }

  // Insert lists first (list_items FK → lists)
  parts.push('-- Insert lists');
  for (const row of data.lists) {
    // V2: is_starred included in INSERT
    parts.push(
      `INSERT INTO lists (id, app_user_id, name, source, source_message_id, created_at, updated_at, deleted_at, deleted_source, deleted_by_auth_user_id, import_candidates, is_system, system_key, is_starred) VALUES (${q(row.id)}, ${q(appUserId)}, ${q(row.name)}, ${q(row.source)}, ${q(row.source_message_id)}, ${q(ts(row.created_at))}, ${q(ts(row.updated_at))}, ${q(row.deleted_at)}, ${q(row.deleted_source)}, ${q(row.deleted_by_auth_user_id)}, ${json(row.import_candidates)}, ${q(row.is_system)}, ${q(row.system_key)}, ${q(row.is_starred)});`
    );
  }
  parts.push('');

  // Insert list_items (FK → lists, app_users)
  parts.push('-- Insert list items');
  for (const row of data.listItems) {
    parts.push(
      `INSERT INTO list_items (id, app_user_id, list_id, text, normalized_text, is_done, source, created_at, updated_at, deleted_at) VALUES (${q(row.id)}, ${q(appUserId)}, ${q(row.list_id)}, ${q(row.text)}, ${q(row.normalized_text)}, ${q(row.is_done)}, ${q(row.source)}, ${q(ts(row.created_at))}, ${q(ts(row.updated_at))}, ${q(row.deleted_at)});`
    );
  }
  parts.push('');

  // Insert tasks (FK → auth.users + app_users)
  parts.push('-- Insert tasks');
  for (const row of data.tasks) {
    parts.push(
      `INSERT INTO tasks (id, user_id, app_user_id, title, category, due_date, due_time, due_at, is_done, status, source, source_message_id, inferred_date, inferred_time, created_at, updated_at, deleted_at) VALUES (${q(row.id)}, ${q(authUserId)}, ${q(appUserId)}, ${q(row.title)}, ${q(row.category)}, ${q(row.due_date)}, ${q(row.due_time)}, ${q(row.due_at)}, ${q(row.is_done)}, ${q(row.status)}, ${q(row.source)}, ${q(row.source_message_id)}, ${q(row.inferred_date)}, ${q(row.inferred_time)}, ${q(ts(row.created_at))}, ${q(ts(row.updated_at))}, ${q(row.deleted_at)});`
    );
  }
  parts.push('');
  parts.push('COMMIT;');
  parts.push('');
  return parts.join('\n');
}

// ============================================================
// Main
// ============================================================
function main() {
  const args = parseArgs(process.argv);
  const data = generate(args);

  if (args.preview) {
    const summary = {
      mode:         args.mode,
      seedTag:      args.seedTag,
      baseDate:     args.baseDate,
      counts: {
        tasks:      data.tasks.length,
        lists:      data.lists.length,
        listItems:  data.listItems.length,
      },
      sampleTaskTitles: data.tasks.slice(0, 6).map((t) => t.title),
      sampleListNames:  data.lists.slice(0, 6).map((l) => `${l.name} (starred=${l.is_starred})`),
      schemaFixesApplied: [
        'C1: source_message_id→NULL',
        'C2: list_items.source capped',
        'C3: due_at computed',
        'C4: status added',
        'C5: category remapped',
        'M1: inbox list removed',
        'V1: task source uses full v5 set',
        'V2: lists.is_starred included',
        'V3: baseDate parameterised (default 2026-03-27)',
        'V4: seedTag default seed-v2',
        'V5: task scenarios cover Mar 27–Apr 20 / TEST_MATRIX_v2',
      ],
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const sql = sqlFor(args, data);

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), sql, 'utf8');
    console.error(`[laya-ui-seed-v2] Wrote ${data.tasks.length} tasks, ${data.lists.length} lists, ${data.listItems.length} list_items → ${args.output}`);
  } else {
    process.stdout.write(sql);
  }
}

main();
