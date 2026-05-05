/**
 * HTML report builder for the Unload Simulator (3-pass comparison edition).
 *
 * Columns per row:
 *   A  Parser Output     — what rules-only produced
 *   B  Decision Point    — was LLM called and why (current pipeline)
 *   B  LLM Delta         — what current LLM added over rules
 *   C  New Architecture  — what proposed LLM-first would produce
 *   C  vs Current        — better / same / worse badge
 *   Learning + Recommended changes
 *
 * Row colour:
 *   Blue   — Run C is better than current (A+B)
 *   Green  — rules handled cleanly, no LLM needed
 *   Yellow — current LLM stepped in (gap-fill or partial)
 *   Orange — clarification triggered
 *   Red    — zero actions from both rules and LLM
 *   Grey   — error in Run C
 */

import type { SimulatorOutput, SimulatorRow, OutcomeLabel, RunCOutcome, RunDOutcome } from './unload-simulator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

// ─── Row rendering ────────────────────────────────────────────────────────────

function rowClass(row: SimulatorRow): string {
  if (row.runc_outcome === 'better') return 'row-blue';
  if (row.decision_point.toLowerCase().includes('clarification')) return 'row-orange';
  if (row.runc_outcome === 'error') return 'row-grey';
  if (row.outcome === 'clean')         return 'row-green';
  if (row.outcome === 'llm_recovered' || row.outcome === 'llm_partial') return 'row-yellow';
  if (row.outcome === 'zero')          return 'row-red';
  return 'row-grey';
}

function outcomeBadge(label: OutcomeLabel): string {
  const map: Record<OutcomeLabel, string> = {
    clean:         '<span class="badge badge-green">clean</span>',
    llm_recovered: '<span class="badge badge-yellow">llm_recovered</span>',
    llm_partial:   '<span class="badge badge-yellow">llm_partial</span>',
    zero:          '<span class="badge badge-red">zero</span>',
  };
  return map[label] ?? label;
}

function runcBadge(label: RunCOutcome): string {
  const map: Record<RunCOutcome, string> = {
    better: '<span class="badge badge-blue">▲ better</span>',
    same:   '<span class="badge badge-grey">= same</span>',
    worse:  '<span class="badge badge-red">▼ worse</span>',
    error:  '<span class="badge badge-red">error</span>',
  };
  return map[label] ?? label;
}

function rundBadge(label: RunDOutcome): string {
  const map: Record<RunDOutcome, string> = {
    new_signal: '<span class="badge badge-purple">🔔 new signal</span>',
    cleaner:    '<span class="badge badge-teal">✨ cleaner</span>',
    same:       '<span class="badge badge-grey">= same</span>',
  };
  return map[label] ?? label;
}

function rundSignalBadges(row: SimulatorRow): string {
  const badges: string[] = [];
  if (row.rund_filler)             badges.push('<span class="badge badge-orange">filler</span>');
  if (row.rund_needs_clarification) badges.push('<span class="badge badge-yellow">llm_clarify</span>');
  if (row.rund_confirm_steps > 0)  badges.push(`<span class="badge badge-purple">${row.rund_confirm_steps}× confirm</span>`);
  if (row.rund_clarify_steps > 0)  badges.push(`<span class="badge badge-yellow">${row.rund_clarify_steps}× clarify</span>`);
  if (row.rund_booking_preserved)  badges.push('<span class="badge badge-teal">booking✓</span>');
  if (row.rund_semantic_violations > 0) badges.push(`<span class="badge badge-red">${row.rund_semantic_violations}× constraint</span>`);
  return badges.join(' ');
}

function renderRow(row: SimulatorRow): string {
  const cls = rowClass(row);
  return `
    <tr class="${cls}"
        data-category="${esc(row.category)}"
        data-channel="${row.channel}"
        data-outcome="${row.outcome}"
        data-runcoutcome="${row.runc_outcome}"
        data-reasoncode="${esc(row.reason_code)}">
      <td class="td-id">${row.id}</td>
      <td class="td-cat">
        <span class="cat-tag">${esc(row.category)}</span><br>
        <span class="channel-tag">${row.channel}</span>
      </td>
      <td class="td-prompt"><code>${esc(row.input)}</code></td>
      <td class="td-a">${esc(row.parser_output)}</td>
      <td class="td-b-decision">${esc(row.decision_point)}</td>
      <td class="td-b-llm">${esc(row.llm_output)}</td>
      <td class="td-c">
        ${esc(row.runc_output)}
        <div style="margin-top:6px">${runcBadge(row.runc_outcome)}</div>
      </td>
      <td class="td-c-delta">${esc(row.runc_delta)}</td>
      <td class="td-d col-divider">
        <div style="margin-bottom:5px">${rundBadge(row.rund_outcome)}</div>
        ${rundSignalBadges(row)}
        ${row.rund_date_summary ? `<div class="rund-dates">${esc(row.rund_date_summary)}</div>` : ''}
        ${row.rund_response_message ? `<div class="rund-response"><span class="rund-response-label">💬 </span>${esc(row.rund_response_message)}</div>` : ''}
        ${(row.rund_filler || row.rund_confirm_steps > 0 || row.rund_clarify_steps > 0 || row.rund_semantic_violations > 0)
          ? `<div class="rund-extra">${esc([
              row.rund_filler ? 'Filler detected.' : '',
              row.rund_needs_clarification ? 'LLM asked for clarification.' : '',
              row.rund_confirm_steps > 0 ? `${row.rund_confirm_steps}× confirm gate.` : '',
              row.rund_clarify_steps > 0 ? `${row.rund_clarify_steps}× clarify step.` : '',
              row.rund_semantic_violations > 0 ? `${row.rund_semantic_violations}× constraint violation.` : '',
            ].filter(Boolean).join(' '))}</div>`
          : ''}
      </td>
      <td class="td-learning">${esc(row.learning)}</td>
      <td class="td-rec">${esc(row.recommendation)}</td>
    </tr>`;
}

// ─── Summary panel ────────────────────────────────────────────────────────────

function renderSummary(output: SimulatorOutput): string {
  const s = output.summary;

  const reasonRows = Object.entries(s.reason_code_counts)
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `<tr><td>${esc(code)}</td><td>${count}</td><td>${pct(count, s.total)}%</td></tr>`)
    .join('');

  const catRows = Object.entries(s.by_category)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, c]) => `<tr>
      <td>${esc(cat)}</td><td>${c.total}</td>
      <td class="cell-green">${c.clean}</td>
      <td class="cell-yellow">${c.llm_recovered + c.llm_partial}</td>
      <td class="cell-red">${c.zero}</td>
    </tr>`).join('');

  return `
  <section class="summary-panel">
    <h2>Run Summary</h2>
    <p class="generated-at">Generated ${output.generated_at}</p>

    <div class="summary-group">
      <h3>Current pipeline (A + B)</h3>
      <div class="summary-cards">
        <div class="card card-total"><div class="card-num">${s.total}</div><div class="card-label">Total prompts</div></div>
        <div class="card card-green"><div class="card-num">${s.clean}</div><div class="card-label">Clean (rules only)</div><div class="card-pct">${pct(s.clean, s.total)}%</div></div>
        <div class="card card-yellow"><div class="card-num">${s.llm_recovered + s.llm_partial}</div><div class="card-label">LLM contributed</div><div class="card-pct">${pct(s.llm_recovered + s.llm_partial, s.total)}%</div></div>
        <div class="card card-red"><div class="card-num">${s.zero}</div><div class="card-label">Zero actions</div><div class="card-pct">${pct(s.zero, s.total)}%</div></div>
      </div>
    </div>

    <div class="summary-group">
      <h3>Proposed architecture (C) vs current</h3>
      <div class="summary-cards">
        <div class="card card-blue"><div class="card-num">${s.runc_better}</div><div class="card-label">Better</div><div class="card-pct">${pct(s.runc_better, s.total)}%</div></div>
        <div class="card card-grey2"><div class="card-num">${s.runc_same}</div><div class="card-label">Same</div><div class="card-pct">${pct(s.runc_same, s.total)}%</div></div>
        <div class="card card-red"><div class="card-num">${s.runc_worse}</div><div class="card-label">Worse</div><div class="card-pct">${pct(s.runc_worse, s.total)}%</div></div>
        <div class="card card-orange"><div class="card-num">${s.runc_error}</div><div class="card-label">Errors</div></div>
      </div>
    </div>

    <div class="summary-group">
      <h3>Post-Overhaul pipeline (D) — new signal coverage</h3>
      <div class="summary-cards">
        <div class="card card-purple"><div class="card-num">${s.rund_new_signal}</div><div class="card-label">New signals fired</div><div class="card-pct">${pct(s.rund_new_signal, s.total)}%</div></div>
        <div class="card card-teal"><div class="card-num">${s.rund_cleaner}</div><div class="card-label">Cleaner titles</div><div class="card-pct">${pct(s.rund_cleaner, s.total)}%</div></div>
        <div class="card card-grey2"><div class="card-num">${s.rund_same}</div><div class="card-label">No change</div><div class="card-pct">${pct(s.rund_same, s.total)}%</div></div>
      </div>
      <div class="summary-cards" style="margin-top:8px">
        <div class="card card-orange"><div class="card-num">${s.rund_filler_total}</div><div class="card-label">Filler detected</div></div>
        <div class="card card-purple"><div class="card-num">${s.rund_confirm_total}</div><div class="card-label">Confirm gates triggered</div></div>
        <div class="card card-yellow"><div class="card-num">${s.rund_clarify_total}</div><div class="card-label">Clarify steps</div></div>
        <div class="card card-teal"><div class="card-num">${s.rund_booking_preserved_total}</div><div class="card-label">Booking titles preserved</div></div>
      </div>
    </div>

    <div class="summary-group">
      <h3>Date/Time resolution quality (D) — temporal parsing coverage</h3>
      <div class="summary-cards">
        <div class="card ${s.rund_inferred_dates_total === 0 ? 'card-green' : 'card-red'}">
          <div class="card-num">${s.rund_inferred_dates_total}</div>
          <div class="card-label">Tasks date-defaulted to today</div>
          <div class="card-pct" style="font-size:11px">${s.rund_inferred_dates_total === 0 ? '✓ all explicit' : '⚠ no temporal match'}</div>
        </div>
        <div class="card ${s.rund_inferred_times_total === 0 ? 'card-green' : 'card-yellow'}">
          <div class="card-num">${s.rund_inferred_times_total}</div>
          <div class="card-label">Tasks time-defaulted</div>
          <div class="card-pct" style="font-size:11px">${s.rund_inferred_times_total === 0 ? '✓ all explicit' : '⚠ defaulted'}</div>
        </div>
      </div>
      <p style="font-size:11px;color:#666;margin:6px 0 0">
        Each row's Run D column now shows per-task date/time resolution.
        ✓ = explicitly parsed from input text.
        [inferred] = fell back to today's date.
        [defaulted] = time was 20:00 fallback.
      </p>
    </div>

    <div class="summary-tables">
      <div class="summary-table-block">
        <h3>Reason-code breakdown (current)</h3>
        <table class="summary-table">
          <thead><tr><th>Reason code</th><th>Count</th><th>%</th></tr></thead>
          <tbody>${reasonRows}</tbody>
        </table>
      </div>
      <div class="summary-table-block">
        <h3>By category</h3>
        <table class="summary-table">
          <thead><tr><th>Category</th><th>Total</th><th class="cell-green">Clean</th><th class="cell-yellow">LLM</th><th class="cell-red">Zero</th></tr></thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>
    </div>
  </section>`;
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

function getUniqueValues(rows: SimulatorRow[], key: keyof SimulatorRow): string[] {
  return [...new Set(rows.map((r) => String(r[key])))].sort();
}

function renderFilters(rows: SimulatorRow[]): string {
  const categories  = getUniqueValues(rows, 'category');
  const channels    = getUniqueValues(rows, 'channel');
  const outcomes    = getUniqueValues(rows, 'outcome');
  const runcOutcomes = getUniqueValues(rows, 'runc_outcome');
  const codes       = getUniqueValues(rows, 'reason_code');

  function opts(values: string[], field: string, label: string): string {
    return `<select id="filter-${field}" onchange="applyFilters()">
      <option value="">All ${label}</option>
      ${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
    </select>`;
  }

  return `
  <section class="filter-bar">
    <strong>Filter:</strong>
    ${opts(categories,   'category',    'categories')}
    ${opts(channels,     'channel',     'channels')}
    ${opts(outcomes,     'outcome',     'A+B outcomes')}
    ${opts(runcOutcomes, 'runcoutcome', 'Run C outcome')}
    ${opts(codes,        'reasoncode',  'reason codes')}
    <input id="filter-search" type="text" placeholder="Search prompt…" oninput="applyFilters()" style="width:200px">
    <button onclick="resetFilters()">Reset</button>
    <span id="filter-count" style="margin-left:12px;color:#666"></span>
    <button onclick="exportCSV()" style="margin-left:auto;background:#1a7a4a;">⬇ Export to CSV</button>
  </section>`;
}

// ─── JS: filtering + sorting + CSV export ────────────────────────────────────

const PAGE_JS = `
  // ── Filtering ──────────────────────────────────────────────────────────────
  function applyFilters() {
    const cat  = document.getElementById('filter-category').value.toLowerCase();
    const ch   = document.getElementById('filter-channel').value.toLowerCase();
    const out  = document.getElementById('filter-outcome').value.toLowerCase();
    const rc   = document.getElementById('filter-runcoutcome').value.toLowerCase();
    const code = document.getElementById('filter-reasoncode').value.toLowerCase();
    const q    = document.getElementById('filter-search').value.toLowerCase();

    let visible = 0;
    document.querySelectorAll('#results-table tbody tr').forEach(function(row) {
      const show =
        (!cat  || row.dataset.category    === cat)  &&
        (!ch   || row.dataset.channel     === ch)   &&
        (!out  || row.dataset.outcome     === out)  &&
        (!rc   || row.dataset.runcoutcome === rc)   &&
        (!code || row.dataset.reasoncode  === code) &&
        (!q    || row.textContent.toLowerCase().includes(q));
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    document.getElementById('filter-count').textContent =
      visible + ' / ' + document.querySelectorAll('#results-table tbody tr').length + ' rows';
  }

  function resetFilters() {
    ['filter-category','filter-channel','filter-outcome','filter-runcoutcome','filter-reasoncode'].forEach(function(id) {
      document.getElementById(id).value = '';
    });
    document.getElementById('filter-search').value = '';
    currentSort = { col: -1, asc: true };
    document.querySelectorAll('#results-table thead th').forEach(function(th) {
      th.removeAttribute('data-sort');
    });
    applyFilters();
  }

  // ── Sorting ────────────────────────────────────────────────────────────────
  var currentSort = { col: -1, asc: true };

  function sortTable(colIdx) {
    var table   = document.getElementById('results-table');
    var tbody   = table.querySelector('tbody');
    var rows    = Array.from(tbody.querySelectorAll('tr'));
    var headers = Array.from(table.querySelectorAll('thead th'));

    if (currentSort.col === colIdx) {
      currentSort.asc = !currentSort.asc;
    } else {
      currentSort.col = colIdx;
      currentSort.asc = true;
    }

    headers.forEach(function(th, i) {
      th.removeAttribute('data-sort');
      if (i === colIdx) th.setAttribute('data-sort', currentSort.asc ? 'asc' : 'desc');
    });

    rows.sort(function(a, b) {
      var aText = (a.querySelectorAll('td')[colIdx] || {}).textContent || '';
      var bText = (b.querySelectorAll('td')[colIdx] || {}).textContent || '';
      var aNum = parseFloat(aText), bNum = parseFloat(bText);
      var cmp = (!isNaN(aNum) && !isNaN(bNum)) ? (aNum - bNum) : aText.trim().localeCompare(bText.trim());
      return currentSort.asc ? cmp : -cmp;
    });
    rows.forEach(function(row) { tbody.appendChild(row); });
    applyFilters();
  }

  // ── CSV export ─────────────────────────────────────────────────────────────
  function csvCell(val) {
    var s = (val === null || val === undefined) ? '' : String(val);
    if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\\n') !== -1 || s.indexOf('\\r') !== -1) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function exportCSV() {
    var table = document.getElementById('results-table');
    var headers = Array.from(table.querySelectorAll('thead th')).map(function(th) {
      return csvCell(th.textContent.replace(/[▲▼]/g, '').trim());
    });
    var visibleRows = Array.from(table.querySelectorAll('tbody tr')).filter(function(tr) {
      return tr.style.display !== 'none';
    });
    var dataRows = visibleRows.map(function(tr) {
      return Array.from(tr.querySelectorAll('td')).map(function(td) {
        return csvCell(td.innerText || td.textContent || '');
      }).join(',');
    });
    var csv = '\\uFEFF' + [headers.join(',')].concat(dataRows).join('\\r\\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    a.href = url; a.download = 'simulator-report-' + ts + '.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('#results-table thead th').forEach(function(th, i) {
      th.style.cursor = 'pointer';
      th.title = 'Click to sort';
      th.addEventListener('click', function() { sortTable(i); });
    });
    applyFilters();
  });
`;

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  :root {
    --green:  #d4edda;
    --yellow: #fff3cd;
    --orange: #fde8cd;
    --red:    #f8d7da;
    --blue:   #cce5ff;
    --grey:   #e9ecef;
    --border: #dee2e6;
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; font-size: 13px; color: #212529; margin: 0; padding: 0; background: #f8f9fa; }
  h1 { background: #1a1a2e; color: #fff; margin: 0; padding: 20px 32px; font-size: 20px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  h3 { font-size: 13px; margin: 0 0 8px; color: #444; }

  .summary-panel   { background: #fff; padding: 24px 32px; border-bottom: 1px solid var(--border); }
  .generated-at    { color: #888; font-size: 11px; margin: -8px 0 16px; }
  .summary-group   { margin-bottom: 20px; }
  .summary-group h3 { font-size: 13px; font-weight: 600; color: #1a1a2e; margin-bottom: 8px; border-left: 3px solid #1a1a2e; padding-left: 8px; }

  .summary-cards   { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 6px; }
  .card            { border-radius: 8px; padding: 14px 20px; min-width: 120px; text-align: center; border: 1px solid var(--border); background: #f8f9fa; }
  .card-total      { background: #e8f4fd; }
  .card-green      { background: var(--green); }
  .card-yellow     { background: var(--yellow); }
  .card-red        { background: var(--red); }
  .card-blue       { background: var(--blue); }
  .card-grey2      { background: var(--grey); }
  .card-orange     { background: var(--orange); }
  .card-num        { font-size: 28px; font-weight: 700; line-height: 1; }
  .card-label      { font-size: 11px; color: #555; margin-top: 4px; }
  .card-pct        { font-size: 16px; font-weight: 500; color: #555; }

  .summary-tables  { display: flex; gap: 32px; flex-wrap: wrap; }
  .summary-table-block { flex: 1; min-width: 260px; }
  .summary-table   { width: 100%; border-collapse: collapse; }
  .summary-table th,
  .summary-table td { border: 1px solid var(--border); padding: 5px 10px; text-align: left; }
  .summary-table thead th { background: #f0f0f0; font-weight: 600; }

  .cell-green  { background: var(--green); }
  .cell-yellow { background: var(--yellow); }
  .cell-red    { background: var(--red); }

  .filter-bar  { background: #fff; padding: 12px 32px; border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .filter-bar select,
  .filter-bar input  { border: 1px solid #ccc; border-radius: 4px; padding: 4px 8px; font-size: 12px; }
  .filter-bar button { background: #6c757d; color: #fff; border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 12px; }

  .table-wrap { overflow-x: auto; padding: 0 32px 40px; }
  table#results-table { width: 100%; border-collapse: collapse; margin-top: 16px; background: #fff; table-layout: fixed; }

  thead th   { background: #1a1a2e; color: #fff; padding: 10px 12px; text-align: left; font-size: 11px; white-space: nowrap; position: sticky; top: 0; z-index: 2; user-select: none; overflow: hidden; text-overflow: ellipsis; }
  thead th:hover { background: #2d2d50; }
  thead th[data-sort="asc"]::after  { content: ' ▲'; font-size: 9px; }
  thead th[data-sort="desc"]::after { content: ' ▼'; font-size: 9px; }

  /* Column group headers */
  .th-group-a    { background: #2c4a2c !important; }
  .th-group-b    { background: #4a3a0e !important; }
  .th-group-c    { background: #0e2a4a !important; }
  .th-group-d    { background: #2a1a4a !important; }
  .th-group-meta { background: #3a2a3a !important; }

  tbody tr   { border-bottom: 1px solid var(--border); }
  tbody tr:hover { filter: brightness(0.97); }
  .row-blue   td { background: var(--blue); }
  .row-green  td { background: var(--green); }
  .row-yellow td { background: var(--yellow); }
  .row-orange td { background: var(--orange); }
  .row-red    td { background: var(--red); }
  .row-grey   td { background: var(--grey); }

  td { padding: 7px 10px; vertical-align: top; word-break: break-word; }

  .td-id         { width: 36px; text-align: center; font-weight: 600; color: #888; font-size: 11px; }
  .td-cat        { width: 90px; }
  .td-prompt     { width: 160px; }
  .td-a          { width: 160px; }
  .td-b-decision { width: 180px; }
  .td-b-llm      { width: 140px; }
  .td-c          { width: 180px; }
  .td-c-delta    { width: 170px; }
  .td-d          { width: 180px; }
  .td-learning   { width: 180px; }
  .td-rec        { width: 160px; }

  .card-purple { background: #e8d5f5; }
  .card-teal   { background: #d0f0eb; }
  .badge-purple { background: #7c3aed; color: #fff; }
  .badge-teal   { background: #0d9488; color: #fff; }
  .badge-orange { background: #f97316; color: #fff; }

  .rund-dates {
    margin-top: 7px;
    font-size: 10.5px;
    font-family: 'SF Mono', monospace;
    background: rgba(0,0,0,.05);
    border-left: 3px solid #7c3aed;
    padding: 4px 6px;
    border-radius: 0 4px 4px 0;
    color: #1a1a2e;
    line-height: 1.6;
  }
  .rund-dates br { display: block; content: ''; margin: 1px 0; }
  .rund-extra {
    margin-top: 5px;
    font-size: 10.5px;
    color: #555;
    font-style: italic;
  }
  .rund-response {
    margin-top: 6px;
    font-size: 10.5px;
    background: #f0fdf4;
    border-left: 3px solid #16a34a;
    padding: 3px 6px;
    border-radius: 0 4px 4px 0;
    color: #14532d;
    white-space: pre-wrap;
  }
  .rund-response-label { font-style: normal; }

  code { font-family: 'SF Mono', monospace; font-size: 11px; background: rgba(0,0,0,.06); padding: 1px 4px; border-radius: 3px; }

  .cat-tag     { font-size: 10px; background: #1a1a2e; color: #cce; padding: 2px 6px; border-radius: 10px; white-space: nowrap; }
  .channel-tag { font-size: 10px; color: #888; margin-top: 3px; display: inline-block; }

  .badge       { display: inline-block; font-size: 10px; padding: 2px 7px; border-radius: 10px; font-weight: 600; }
  .badge-green  { background: #28a745; color: #fff; }
  .badge-yellow { background: #ffc107; color: #333; }
  .badge-red    { background: #dc3545; color: #fff; }
  .badge-blue   { background: #007bff; color: #fff; }
  .badge-grey   { background: #6c757d; color: #fff; }

  .col-divider { border-left: 2px solid #1a1a2e !important; }
`;

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildHTMLReport(output: SimulatorOutput): string {
  const { rows } = output;
  const tableRows = rows.map(renderRow).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Laya Simulator — A/B/C/D Comparison</title>
  <style>${CSS}</style>
</head>
<body>
  <h1>Laya Unload Simulator — A/B/C/D Four-Pass Comparison</h1>

  ${renderSummary(output)}
  ${renderFilters(rows)}

  <div class="table-wrap">
    <table id="results-table">
      <thead>
        <tr>
          <th rowspan="2" class="td-id">#</th>
          <th rowspan="2">Category<br>Channel</th>
          <th rowspan="2">Prompt</th>
          <th colspan="1" class="th-group-a" style="text-align:center">Run A — Rules only</th>
          <th colspan="2" class="th-group-b" style="text-align:center">Run B — Current pipeline (rules + LLM)</th>
          <th colspan="2" class="th-group-c" style="text-align:center">Run C — Proposed LLM-first (evaluation)</th>
          <th colspan="1" class="th-group-d" style="text-align:center">Run D — Post-Overhaul Signals</th>
          <th colspan="2" class="th-group-meta" style="text-align:center">Analysis</th>
        </tr>
        <tr>
          <th class="th-group-a">Parser Output</th>
          <th class="th-group-b col-divider">Decision Point</th>
          <th class="th-group-b">LLM Delta</th>
          <th class="th-group-c col-divider">New Architecture Output</th>
          <th class="th-group-c">vs Current</th>
          <th class="th-group-d col-divider">Overhaul Signals</th>
          <th class="th-group-meta col-divider">Learning</th>
          <th class="th-group-meta">Recommended Changes</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <script>${PAGE_JS}</script>
</body>
</html>`;
}
