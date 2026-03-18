#!/usr/bin/env node
/*
 * Laya UI seed generator
 *
 * Purpose:
 *   Generate deterministic SQL seed data for UI/UX testing aligned to the
 *   actual live schema (derived from supabase/migrations/). Targets the
 *   persisted UI-driving entities: tasks, lists, list_items.
 *
 * Schema fixes applied vs. original draft:
 *   C1 - tasks.source_message_id is UUID — derive with hashToUuid(), remove LIKE from reset
 *   C2 - list_items.source CHECK ('web','whatsapp','ocr') — cap via safeItemSource()
 *   C3 - tasks.due_at never computed — added from due_date + due_time
 *   C4 - tasks.status not set — added, derived from is_done
 *   C5 - tasks.category non-canonical ('Kids','Errands','Food') — remapped
 *   M1 - Inbox system list removed (unique partial index conflict risk)
 *   M2 - tasks.source 'brain_dump'/'ocr' mapped to 'web'
 *
 * Usage:
 *   node scripts/seeds/laya_ui_seed.js --preview
 *   node scripts/seeds/laya_ui_seed.js --auth-user-id=<UUID> --app-user-id=<UUID>
 *   node scripts/seeds/laya_ui_seed.js --auth-user-id=<UUID> --app-user-id=<UUID> --output=./laya-ui-seed.sql
 *   node scripts/seeds/laya_ui_seed.js --auth-user-id=<UUID> --app-user-id=<UUID> --large
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
    appUserId: '00000000-0000-0000-0000-000000000002',
    mode: 'medium',
    seedTag: 'laya-ui-seed',
    output: null,
    preview: false,
    noReset: false,
  };

  for (const raw of argv.slice(2)) {
    if (raw === '--small') args.mode = 'small';
    else if (raw === '--medium') args.mode = 'medium';
    else if (raw === '--large') args.mode = 'large';
    else if (raw === '--preview') args.preview = true;
    else if (raw === '--no-reset') args.noReset = true;
    else if (raw.startsWith('--auth-user-id=')) args.authUserId = raw.split('=')[1];
    else if (raw.startsWith('--app-user-id=')) args.appUserId = raw.split('=')[1];
    else if (raw.startsWith('--seed-tag=')) args.seedTag = raw.split('=')[1];
    else if (raw.startsWith('--output=')) args.output = raw.split('=')[1];
  }
  return args;
}

// ============================================================
// Helpers
// ============================================================

/** Deterministic UUID from any string input (SHA-1 hex → UUID v4-ish format). */
function hashToUuid(input) {
  const hex = crypto.createHash('sha1').update(input).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** SQL-quote a scalar value. */
function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
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
 * Treats the date/time as UTC for seed purposes (consistent with baseNow UTC anchor).
 * Returns null when due_date is absent.
 */
function computeDueAt(dueDate, dueTime) {
  if (!dueDate) return null;
  const time = dueTime || '20:00:00';
  // Normalise time to HH:MM:SS
  const timePart = time.length === 5 ? `${time}:00` : time;
  return `${dueDate}T${timePart}Z`;
}

/**
 * Normalise list_item.source to the only values the DB CHECK allows.
 * C2 fix: 'brain_dump' and any other unknown source → 'web'.
 */
function safeItemSource(src) {
  return ['web', 'whatsapp', 'ocr'].includes(src) ? src : 'web';
}

/**
 * Normalise tasks.source to the only values that are safe.
 * M2 fix: 'brain_dump' and 'ocr' → 'web'. 'whatsapp' stays.
 */
function safeTaskSource(src) {
  if (!src) return 'web';
  if (src === 'whatsapp') return 'whatsapp';
  // 'brain_dump', 'ocr', 'web', and anything else → 'web'
  return 'web';
}

/** Normalised text for list items (mirrors app's normalization logic). */
function normalized(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

// ============================================================
// Category mapping — C5 fix
// Canonical TASK_CATEGORIES from src/lib/categories.ts:
//   Admin, Finance, Fitness, Health, Home, Learning, Meals,
//   Personal, Shopping, Tasks, Work
// ============================================================
const CATEGORY_MAP = {
  Kids: 'Tasks',
  Errands: 'Shopping',
  Food: 'Meals',
};

function canonicalCategory(cat) {
  return CATEGORY_MAP[cat] || cat || 'Tasks';
}

// ============================================================
// Dataset size config
// ============================================================
function buildConfig(mode) {
  if (mode === 'small') return { extraTasks: 6, extraLists: 1, extraItems: 4 };
  if (mode === 'large') return { extraTasks: 28, extraLists: 4, extraItems: 20 };
  return { extraTasks: 16, extraLists: 2, extraItems: 10 };
}

// ============================================================
// Tasks
// ============================================================
function buildTasks(baseNow, seedTag) {
  const today = withTime(baseNow, 9, 0);
  const tasks = [];
  let i = 0;

  function push(partial) {
    i += 1;
    const id = hashToUuid(`${seedTag}:task:${i}:${partial.title}`);
    const createdAt = partial.createdAt || addDays(baseNow, -Math.max(1, 12 - i));
    const updatedAt = partial.updatedAt || createdAt;
    const isDone = partial.is_done ?? false;

    // source_message_id is a FK → messages table. Seed tasks have no real messages row,
    // so always set NULL to avoid FK violation.
    const sourceMessageId = null;

    // C3: compute due_at from due_date + due_time
    const dueAt = computeDueAt(partial.due_date ?? null, partial.due_time ?? null);

    // C4: status must reflect is_done
    const status = isDone ? 'completed' : 'active';

    // M2: map task source to safe values
    const source = safeTaskSource(partial.source);

    // C5: map category to canonical value
    const category = canonicalCategory(partial.category);

    tasks.push({
      id,
      title: partial.title,
      category,
      due_date: partial.due_date ?? null,
      due_time: partial.due_time ?? null,
      due_at: dueAt,
      is_done: isDone,
      status,
      source,
      source_message_id: sourceMessageId,
      inferred_date: partial.inferred_date ?? false,
      inferred_time: partial.inferred_time ?? false,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: partial.deleted_at || null,
    });
  }

  // Scenarios: overdue, today, upcoming, no-due-date, completed, soft-deleted,
  // inferred flags, long title, disambiguation pair, source diversity.
  push({ title: `[${seedTag}] Pay electricity bill`,                       category: 'Personal',  due_date: dateOnly(addDays(today, -2)), due_time: '09:00:00', source: 'web' });
  push({ title: `[${seedTag}] Call plumber about kitchen sink`,             category: 'Home',      due_date: dateOnly(addDays(today, -1)), inferred_date: true,  source: 'whatsapp' });
  push({ title: `[${seedTag}] Pack Ved swimming bag`,                       category: 'Tasks',     due_date: dateOnly(today),             due_time: '07:30:00', source: 'web' });       // Kids → Tasks (C5)
  push({ title: `[${seedTag}] Send school fee receipt`,                     category: 'Admin',     due_date: dateOnly(today),             due_time: '10:15:00', inferred_time: true, source: 'whatsapp' });
  push({ title: `[${seedTag}] Order vegetables for dinner`,                 category: 'Home',      due_date: dateOnly(today),             due_time: '17:30:00', source: 'web' });
  push({ title: `[${seedTag}] Refill protein powder`,                       category: 'Health',    due_date: dateOnly(today),                                   source: 'web', inferred_time: true });  // ocr → web (M2)
  push({ title: `[${seedTag}] Book pest control visit`,                     category: 'Home',      due_date: dateOnly(addDays(today, 1)), due_time: '11:00:00', source: 'web' });
  push({ title: `[${seedTag}] Review mockups for calm home screen`,         category: 'Work',      due_date: dateOnly(addDays(today, 1)), due_time: '14:00:00', source: 'web' });
  push({ title: `[${seedTag}] Follow up with carpenter`,                    category: 'Home',      due_date: dateOnly(addDays(today, 2)),                        source: 'whatsapp', inferred_date: true });
  push({ title: `[${seedTag}] Buy return-gift wrapping paper`,              category: 'Shopping',  due_date: dateOnly(addDays(today, 2)), due_time: '16:30:00', source: 'web' });     // Errands → Shopping (C5)
  push({ title: `[${seedTag}] Plan breakfast menu for Sunday guests`,       category: 'Meals',     due_date: dateOnly(addDays(today, 3)),                        source: 'web' });     // Food → Meals (C5); brain_dump → web (M2)
  push({ title: `[${seedTag}] Upload final invoice to drive folder`,        category: 'Admin',     due_date: dateOnly(addDays(today, 4)), due_time: '13:00:00', source: 'web' });
  push({ title: `[${seedTag}] Compare stroller rain cover options`,         category: 'Shopping',  source: 'whatsapp' });
  push({ title: `[${seedTag}] Collect dry cleaning`,                        category: 'Shopping',  source: 'web' });                                                                    // Errands → Shopping (C5)
  push({ title: `[${seedTag}] Read 15 pages of current book`,               category: 'Personal',  is_done: true, due_date: dateOnly(addDays(today, -1)),       source: 'web' });
  push({ title: `[${seedTag}] Confirm playdate timing with Aditi`,          category: 'Tasks',     is_done: true, due_date: dateOnly(today), due_time: '12:00:00', source: 'whatsapp' }); // Kids → Tasks (C5)
  push({ title: `[${seedTag}] Move winter jackets to upper shelf`,          category: 'Home',      deleted_at: ts(addDays(today, -1)),   source: 'web' });
  push({ title: `[${seedTag}] Fix bedside lamp or replace bulb before guests come over this weekend because the current warm light flickers intermittently`,
                                                                             category: 'Home',      due_date: dateOnly(addDays(today, 2)), due_time: '19:15:00', source: 'web' });     // ocr → web (M2)
  push({ title: `[${seedTag}] Pick up coriander`,                           category: 'Meals',     due_date: dateOnly(today),             source: 'whatsapp' });                       // Food → Meals (C5)
  push({ title: `[${seedTag}] Pick up coriander for chutney`,               category: 'Meals',     due_date: dateOnly(addDays(today, 1)), source: 'whatsapp' });                       // Food → Meals (C5) + disambiguation pair

  return tasks;
}

// ============================================================
// Lists
// ============================================================
function buildLists(baseNow, seedTag) {
  const lists = [];
  let i = 0;

  function push(partial) {
    i += 1;
    const id = hashToUuid(`${seedTag}:list:${i}:${partial.name}`);
    const createdAt = partial.createdAt || addDays(baseNow, -Math.max(1, 8 - i));
    const updatedAt = partial.updatedAt || createdAt;
    lists.push({
      id,
      name: partial.name,
      source: partial.source || 'web',
      source_message_id: partial.source_message_id || `${seedTag}-msg-list-${i}`,
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: partial.deleted_at || null,
      deleted_source: partial.deleted_source || null,
      deleted_by_auth_user_id: partial.deleted_by_auth_user_id || null,
      import_candidates: partial.import_candidates ?? null,
      is_system: partial.is_system ?? false,
      system_key: partial.system_key ?? null,
    });
  }

  // M1: Inbox system list removed — unique partial index on (app_user_id, system_key)
  // conflicts if user already has an active inbox. System lists are owned by app logic.

  push({ name: `[${seedTag}] Grocery`,                   source: 'whatsapp' });
  push({ name: `[${seedTag}] Travel packing for weekend`, source: 'web' });
  push({ name: `[${seedTag}] School admin`,               source: 'web' });  // was brain_dump — no constraint on lists.source but 'web' is safer for items
  push({ name: `[${seedTag}] Pantry OCR import`,          source: 'ocr', import_candidates: ['almonds', 'basmati rice', 'toor dal', 'paper napkins'] });
  push({ name: `[${seedTag}] Empty ideas list`,           source: 'web' });
  push({ name: `[${seedTag}] Deep storage items to check before festival hosting and guest setup`, source: 'web' });
  push({ name: `[${seedTag}] Archived spring cleaning`,   source: 'web', deleted_at: ts(addDays(baseNow, -2)), deleted_source: 'web' });

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
    // C2: cap source to ('web','whatsapp','ocr')
    const rawSource = opts.source || list.source || 'web';
    rows.push({
      id: hashToUuid(`${seedTag}:list-item:${i}:${list.id}:${text}`),
      list_id: list.id,
      text,
      normalized_text: normalized(text),
      is_done: opts.is_done ?? false,
      source: safeItemSource(rawSource),
      created_at: opts.created_at || addDays(baseNow, -3),
      updated_at: opts.updated_at || addDays(baseNow, -2),
      deleted_at: opts.deleted_at || null,
    });
  }

  const grocery = find('Grocery');
  const travel = find('Travel packing');
  const school = find('School admin');
  const pantry = find('Pantry OCR');
  const deep = find('Deep storage');

  // Grocery (source: whatsapp — allowed)
  ['tomatoes', 'coriander', 'greek yogurt', 'paneer', 'dishwasher tablets'].forEach((t, idx) =>
    push(grocery, `[${seedTag}] ${t}`, { is_done: idx === 1 })
  );

  // Travel packing
  ['Ved night suit', 'swim shorts', 'phone charger', 'snacks for flight', 'small medicines pouch'].forEach((t, idx) =>
    push(travel, `[${seedTag}] ${t}`, { is_done: idx === 0 })
  );

  // School admin — source was 'brain_dump', safeItemSource() maps to 'web'
  ['submit transport form', 'label extra uniform set', 'pay activity fee online'].forEach((t) =>
    push(school, `[${seedTag}] ${t}`)
  );

  // Pantry OCR import — source: 'ocr' (allowed)
  ['almonds', 'basmati rice', 'toor dal', 'paper napkins', 'cling wrap'].forEach((t, idx) =>
    push(pantry, `[${seedTag}] ${t}`, { is_done: idx === 2, source: 'ocr' })
  );

  // Deep storage — long text item for wrap stress test
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
  const cfg = buildConfig(args.mode);
  const baseNow = new Date('2026-03-16T09:00:00.000Z');
  const tasks = buildTasks(baseNow, args.seedTag);
  const lists = buildLists(baseNow, args.seedTag);
  const listItems = buildListItems(lists, baseNow, args.seedTag);

  const categories = ['Home', 'Admin', 'Tasks', 'Meals', 'Work', 'Shopping'];  // C5: only canonical
  const sources = ['web', 'whatsapp', 'web', 'web'];  // M2: 'brain_dump'/'ocr' removed

  addVolume(tasks, (idx) => {
    const dueBase = addDays(baseNow, (idx % 7) - 2);
    const rawDueDate = idx % 5 === 0 ? null : dateOnly(dueBase);
    const rawDueTime = idx % 3 === 0 ? timeOnly(withTime(dueBase, 9 + (idx % 8), 15)) : null;
    const isDone = idx % 9 === 0;

    // source_message_id is FK → messages; always NULL for seed tasks.
    const sourceMessageId = null;

    // C3: compute due_at
    const dueAt = computeDueAt(rawDueDate, rawDueTime);

    tasks.push({
      id: hashToUuid(`${args.seedTag}:task-extra:${idx}`),
      title: `[${args.seedTag}] Extra task ${idx + 1} for UI density and scroll validation`,
      category: categories[idx % categories.length],   // C5: canonical only
      due_date: rawDueDate,
      due_time: rawDueTime,
      due_at: dueAt,                                    // C3
      is_done: isDone,
      status: isDone ? 'completed' : 'active',          // C4
      source: sources[idx % sources.length],            // M2
      source_message_id: sourceMessageId,               // C1
      inferred_date: idx % 4 === 0,
      inferred_time: idx % 6 === 0,
      created_at: addDays(baseNow, -10 + (idx % 5)),
      updated_at: addDays(baseNow, -8 + (idx % 5)),
      deleted_at: idx % 17 === 0 ? ts(addDays(baseNow, -1)) : null,
    });
  }, cfg.extraTasks);

  addVolume(lists, (idx) => {
    lists.push({
      id: hashToUuid(`${args.seedTag}:list-extra:${idx}`),
      name: `[${args.seedTag}] Extra list ${idx + 1}`,
      source: sources[idx % sources.length],
      source_message_id: `${args.seedTag}-msg-list-extra-${idx + 1}`,
      created_at: addDays(baseNow, -6 + idx),
      updated_at: addDays(baseNow, -5 + idx),
      deleted_at: null,
      deleted_source: null,
      deleted_by_auth_user_id: null,
      import_candidates: null,
      is_system: false,
      system_key: null,
    });
  }, cfg.extraLists);

  const itemTargetLists = lists.filter((l) => !l.deleted_at).slice(0, Math.max(1, cfg.extraLists + 3));
  addVolume(listItems, (idx) => {
    const list = itemTargetLists[idx % itemTargetLists.length];
    listItems.push({
      id: hashToUuid(`${args.seedTag}:list-item-extra:${idx}`),
      list_id: list.id,
      text: `[${args.seedTag}] Extra item ${idx + 1} for ${list.name}`,
      normalized_text: normalized(`${args.seedTag} extra item ${idx + 1} for ${list.name}`),
      is_done: idx % 5 === 0,
      source: safeItemSource(list.source),              // C2
      created_at: addDays(baseNow, -2),
      updated_at: addDays(baseNow, -1),
      deleted_at: idx % 13 === 0 ? ts(baseNow) : null,
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

  parts.push('-- Laya UI seed SQL');
  parts.push(`-- seed_tag: ${seedTag}`);
  parts.push(`-- mode: ${args.mode}`);
  parts.push('-- generated_by: scripts/seeds/laya_ui_seed.js');
  parts.push(`-- generated_at: ${new Date().toISOString()}`);
  parts.push('BEGIN;\n');

  if (!noReset) {
    parts.push('-- Safe reset: deletes only rows created by this seed, in FK order.');
    // C1 fix: removed `OR source_message_id LIKE ...` — LIKE on UUID column is invalid in PostgreSQL.
    // Reset relies on title prefix LIKE + explicit ID list.
    parts.push(`DELETE FROM list_items WHERE app_user_id = ${q(appUserId)} AND (text LIKE ${q(`[${seedTag}]%`)} OR id IN (${data.listItems.map((r) => q(r.id)).join(', ')}));`);
    parts.push(`DELETE FROM tasks WHERE app_user_id = ${q(appUserId)} AND (title LIKE ${q(`[${seedTag}]%`)} OR id IN (${data.tasks.map((r) => q(r.id)).join(', ')}));`);
    parts.push(`DELETE FROM lists WHERE app_user_id = ${q(appUserId)} AND (name LIKE ${q(`[${seedTag}]%`)} OR id IN (${data.lists.map((r) => q(r.id)).join(', ')}));\n`);
  }

  // Insert lists first (list_items FK → lists)
  parts.push('-- Insert lists');
  for (const row of data.lists) {
    parts.push(
      `INSERT INTO lists (id, app_user_id, name, source, source_message_id, created_at, updated_at, deleted_at, deleted_source, deleted_by_auth_user_id, import_candidates, is_system, system_key) VALUES (${q(row.id)}, ${q(appUserId)}, ${q(row.name)}, ${q(row.source)}, ${q(row.source_message_id)}, ${q(ts(row.created_at))}, ${q(ts(row.updated_at))}, ${q(row.deleted_at)}, ${q(row.deleted_source)}, ${q(row.deleted_by_auth_user_id)}, ${json(row.import_candidates)}, ${q(row.is_system)}, ${q(row.system_key)});`
    );
  }
  parts.push('');

  // Insert list_items second (FK → lists, app_users)
  parts.push('-- Insert list items');
  for (const row of data.listItems) {
    parts.push(
      `INSERT INTO list_items (id, app_user_id, list_id, text, normalized_text, is_done, source, created_at, updated_at, deleted_at) VALUES (${q(row.id)}, ${q(appUserId)}, ${q(row.list_id)}, ${q(row.text)}, ${q(row.normalized_text)}, ${q(row.is_done)}, ${q(row.source)}, ${q(ts(row.created_at))}, ${q(ts(row.updated_at))}, ${q(row.deleted_at)});`
    );
  }
  parts.push('');

  // Insert tasks last (independent of lists; FK → auth.users + app_users)
  // C3 + C4 fix: includes due_at and status columns
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
      mode: args.mode,
      seedTag: args.seedTag,
      counts: {
        tasks: data.tasks.length,
        lists: data.lists.length,
        listItems: data.listItems.length,
      },
      sampleTaskTitles: data.tasks.slice(0, 5).map((t) => t.title),
      sampleListNames: data.lists.slice(0, 5).map((l) => l.name),
      schemaFixesApplied: ['C1: source_message_id→UUID', 'C2: list_items.source capped', 'C3: due_at computed', 'C4: status added', 'C5: category remapped', 'M1: inbox list removed', 'M2: task source sanitised'],
    };
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const sql = sqlFor(args, data);

  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), sql, 'utf8');
    console.error(`[laya-ui-seed] Wrote ${data.tasks.length} tasks, ${data.lists.length} lists, ${data.listItems.length} list_items → ${args.output}`);
  } else {
    process.stdout.write(sql);
  }
}

main();
