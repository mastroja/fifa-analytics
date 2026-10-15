// Academy page (Squad tab > Academy): every prospect the app has ever snapshotted for this save, laid out like the Squad
// list: a status row, the shared filter panel (js/player_filters.js), a sortable header and expandable rows.
//
// Data: main.js getAcademyTracker gives one entry per prospect with a per-season history and a status (academy / promoted
// / left). Promotion readiness compares a prospect with the senior squad: see readinessOf.
//
// The row building, sorting, filter definitions and readiness are pure (plain data in, plain data out) and exported via
// module.exports for scripts/test_academy_tracker.js. Only liveEnv() and the render functions read app.js globals, at
// call time: currentPlayers, currentYouthAcademy, currentSaveId, SHOW_TRUE_POTENTIAL, getPositionInfo, computeAge,
// getLastName, POSITION_SORT_ORDER, formatAcademyPotentialDisplay, openPlayerProfile.
//
// Potential is shown as the app's own display text (it can be a range, or hidden entirely in Youth Mode), and sorting and
// filtering use only that displayed number, so this page can never reveal a ceiling the rest of the app is hiding.
(function (root) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS_LABEL = { academy: 'In academy', promoted: 'Promoted', left: 'Left' };
  const STATUS_RANK = { academy: 0, promoted: 1, left: 2 };
  const VERDICT = { ready: 'Ready for promotion', close: 'Close', dev: 'Developing', open: 'Position open' };
  const READY_RANK = { ready: 0, close: 1, open: 2, dev: 3 };
  const CLOSE_GAP = 3; // this far below the weakest senior at the position is still "close"

  const ordinal = n => { const r = n % 100; return r >= 11 && r <= 13 ? `${n}th` : `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`; };
  const signed = n => (n > 0 ? '+' : '') + n;

  // ---------------------------------------------------------------------------------------------------------
  // Pure logic
  // ---------------------------------------------------------------------------------------------------------

  // history is ordered oldest -> newest.
  function summarise(track) {
    const h = (track && track.history) || [];
    const first = h[0] || {}, last = h[h.length - 1] || {};
    return { first, last, ovrChange: (last.overall || 0) - (first.overall || 0), seasons: h.length };
  }

  // Promotion readiness: the prospect's OVR against the weakest senior player at the same natural position, plus where he
  // would slot into that position's pecking order. `same` = the senior players with that natural position label.
  //   ready  level with or above the weakest senior there ("Ready for promotion")
  //   close  within CLOSE_GAP below
  //   dev    further below ("Developing")
  //   open   no senior player at that position at all
  function readinessOf(ovr, label, same) {
    const list = same || [];
    if (!list.length) return { key: 'open', verdict: VERDICT.open, detail: `No senior ${label} in the squad`, rank: 1, total: 1, gap: null };
    const weakest = list.reduce((m, p) => (Number(p.overall || 0) < Number(m.overall || 0) ? p : m));
    const gap = (Number(ovr) || 0) - Number(weakest.overall || 0);
    const rank = 1 + list.filter(p => Number(p.overall || 0) > (Number(ovr) || 0)).length;
    const total = list.length + 1;
    const vs = `${weakest.name} (${weakest.overall})`;
    const place = `would be ${ordinal(rank)} of ${total} ${label}s`;
    if (gap >= 0) return { key: 'ready', verdict: VERDICT.ready, detail: `${gap === 0 ? 'Level with' : `${gap} above`} ${vs} · ${place}`, rank, total, gap };
    if (gap >= -CLOSE_GAP) return { key: 'close', verdict: VERDICT.close, detail: `${-gap} below ${vs} · ${place}`, rank, total, gap };
    return { key: 'dev', verdict: VERDICT.dev, detail: `${-gap} below ${vs}`, rank, total, gap };
  }

  // The top number of a displayed potential ("70-78" -> 78, "74" -> 74, "—" -> null).
  function parsePotTop(text) {
    const m = String(text ?? '').match(/\d+/g);
    return m ? Number(m[m.length - 1]) : null;
  }

  // env: { labelOf(positionId), groupOf(positionId), ageOf(dob), potText(track), lastName?(name), positionOrder?(label) }
  // One row per track with everything the table sorts and filters on already worked out.
  function buildRows(tracks, seniors, env) {
    const byLabel = new Map();
    (seniors || []).forEach(p => {
      const l = env.labelOf(p.position_id);
      if (!byLabel.has(l)) byLabel.set(l, []);
      byLabel.get(l).push(p);
    });
    return (tracks || []).map(t => {
      const s = summarise(t), label = env.labelOf(t.position_id);
      const potText = env.potText ? env.potText(t) : '—';
      const ovr = s.last.overall == null ? null : Number(s.last.overall);
      const ready = t.status === 'academy' ? readinessOf(ovr || 0, label, byLabel.get(label) || []) : null;
      return {
        track: t, player_id: t.player_id, name: t.name, position_id: t.position_id, label, group: env.groupOf(t.position_id),
        age: env.ageOf(t.dob), ovr, ovrChange: s.seasons > 1 ? s.ovrChange : 0, seasons: s.seasons,
        months: s.last.months_in_squad == null ? null : Number(s.last.months_in_squad),
        potText, potHigh: parsePotTop(potText), status: t.status, ready, readyRank: ready ? READY_RANK[ready.key] : null
      };
    });
  }

  const COLUMNS = [['name', 'Player'], ['position', 'Pos'], ['age', 'Age'], ['status', 'Status'], ['months', 'Months'], ['ovr', 'OVR'], ['pot', 'Potential'], ['ready', 'Promotion']];
  // text columns start A-Z / best-first, numbers start high-to-low
  const defaultAsc = col => col === 'name' || col === 'position' || col === 'status' || col === 'ready';

  // The Status column only says something on the All tab (every other tab is already one status), so it is hidden there.
  const visibleColumns = status => COLUMNS.filter(([k]) => k !== 'status' || status === 'all');

  // Comparator for the chosen column. A missing value sorts last in either direction; ties fall back to the best
  // potential, then overall, then name, so the order is stable.
  function compareRows(col, asc, env) {
    const dir = asc ? 1 : -1;
    const lastWord = n => String(n || '').trim().split(/\s+/).pop();
    const val = r => {
      switch (col) {
        case 'name': return String((env && env.lastName ? env.lastName(r.name) : lastWord(r.name)) || '').toLowerCase();
        case 'position': return env && env.positionOrder ? env.positionOrder(r.label) : null;
        case 'age': return r.age;
        case 'status': return STATUS_RANK[r.status];
        case 'months': return r.months;
        case 'ovr': return r.ovr;
        case 'pot': return r.potHigh;
        case 'ready': return r.readyRank;
        default: return null;
      }
    };
    return (a, b) => {
      const va = val(a), vb = val(b);
      const ma = va == null, mb = vb == null;
      if (ma !== mb) return ma ? 1 : -1;
      if (!ma) { const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb; if (c) return c * dir; }
      return (b.potHigh || 0) - (a.potHigh || 0) || (b.ovr || 0) - (a.ovr || 0) || String(a.name).localeCompare(String(b.name));
    };
  }

  const GROUP_CHIPS = ['GK', 'DEF', 'MID', 'ATT'].map(g => ({ value: g, label: g }));
  // Field definitions for the shared PlayerFilters panel (js/player_filters.js); each get() reads a buildRows row.
  function filterFields() {
    return [
      { id: 'group', label: 'Position', type: 'chips', options: GROUP_CHIPS, get: r => r.group },
      { id: 'ready', label: 'Promotion', type: 'chips', options: Object.keys(READY_RANK).sort((a, b) => READY_RANK[a] - READY_RANK[b]).map(k => ({ value: k, label: VERDICT[k] })), get: r => (r.ready ? r.ready.key : null) },
      { id: 'age', label: 'Age', type: 'range', get: r => r.age },
      { id: 'ovr', label: 'Overall', type: 'range', get: r => r.ovr },
      { id: 'pot', label: 'Potential (as shown)', type: 'range', get: r => r.potHigh },
      { id: 'months', label: 'Months in academy', type: 'range', get: r => r.months },
      { id: 'growth', label: 'OVR gained since first seen (at least)', type: 'min', get: r => r.ovrChange }
    ];
  }
  const FILTER_PRESETS = [
    { label: 'Ready for promotion', set: { ready: ['ready'] } },
    { label: 'Ready or close', set: { ready: ['ready', 'close'] } },
    { label: 'Under 18', set: { age: { max: 17 } } },
    { label: 'High ceiling (78+)', set: { pot: { min: 78 } } },
    { label: 'Rising fast (+8)', set: { growth: 8 } }
  ];

  // Academy prospects who are ready (or close) for the first team, best margin first; for the Home card.
  // academy: live academy rows (overall, position_id, name); seniors: senior squad rows.
  function readyProspects(academy, seniors, env) {
    const byLabel = new Map();
    (seniors || []).forEach(p => { const l = env.labelOf(p.position_id); if (!byLabel.has(l)) byLabel.set(l, []); byLabel.get(l).push(p); });
    return (academy || []).map(a => ({ player: a, ready: readinessOf(Number(a.overall) || 0, env.labelOf(a.position_id), byLabel.get(env.labelOf(a.position_id)) || []) }))
      .filter(x => x.ready.key === 'ready' || x.ready.key === 'close')
      .sort((x, y) => READY_RANK[x.ready.key] - READY_RANK[y.ready.key] || (y.ready.gap || 0) - (x.ready.gap || 0) || (Number(y.player.overall) || 0) - (Number(x.player.overall) || 0));
  }

  // ---------------------------------------------------------------------------------------------------------
  // Page wiring (everything below reads the page or app.js globals)
  // ---------------------------------------------------------------------------------------------------------

  const $ = id => root.document.getElementById(id);
  const hasApi = () => !!(root.api && root.api.getAcademyTracker);
  const saveId = () => (typeof currentSaveId !== 'undefined' ? currentSaveId : null);
  const showRange = () => typeof SHOW_TRUE_POTENTIAL !== 'undefined' && !!SHOW_TRUE_POTENTIAL;
  const seniors = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
  const liveAcademyRow = pid => (typeof currentYouthAcademy !== 'undefined' ? currentYouthAcademy || [] : []).find(a => a.player_id == pid);

  function liveEnv() {
    return {
      labelOf: pos => root.getPositionInfo(pos).label,
      groupOf: pos => root.getPositionInfo(pos).group,
      ageOf: dob => { const a = root.computeAge(dob); return a == null ? null : a; },
      lastName: root.getLastName,
      positionOrder: label => (typeof POSITION_SORT_ORDER !== 'undefined' ? POSITION_SORT_ORDER[label] || 99 : 99),
      potText: track => {
        const live = liveAcademyRow(track.player_id);
        if (live && typeof formatAcademyPotentialDisplay === 'function') return formatAcademyPotentialDisplay(live);
        const l = summarise(track).last;
        return showRange() && l.potential_high ? `${l.potential_low}-${l.potential_high}` : '—';
      }
    };
  }

  let tracks = [];
  let loaded = false;
  let loading = null;
  let statusFilter = 'academy'; // academy | promoted | left | all
  let sortCol = 'ready', sortAsc = true; // ready-for-promotion prospects first, then by potential
  const open = new Set();
  let filter = null;

  async function load() {
    if (loading) return loading;
    loading = (async () => {
      try { tracks = hasApi() ? (await root.api.getAcademyTracker(saveId())) || [] : []; }
      catch (e) { console.error('Academy: load failed', e); tracks = tracks || []; }
      finally { loaded = true; loading = null; }
    })();
    return loading;
  }
  const invalidate = () => { loaded = false; };
  const isShown = () => { const v = $('squad-academy-view'); return !!(v && v.style.display !== 'none'); };
  async function reload() { await load(); if (isShown()) render(); }
  function setData(t) { tracks = t || []; loaded = true; }

  function ensureFilter() {
    if (filter || !root.PlayerFilters || !$('academy-filter-mount')) return;
    filter = root.PlayerFilters.create({
      key: 'academy', mount: 'academy-filter-mount', onChange: () => render(),
      fields: filterFields(), presets: FILTER_PRESETS
    });
  }

  function sort(col) {
    if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = defaultAsc(col); }
    render();
  }
  function setStatus(v) { statusFilter = v; render(); }
  function toggleOpen(pid) { const k = String(pid); open.has(k) ? open.delete(k) : open.add(k); render(); }
  // Like the Squad list: clicking the name expands the history, anywhere else opens the profile.
  function rowClick(ev, pid) {
    if (ev && ev.target && ev.target.closest && ev.target.closest('.player-name')) toggleOpen(pid);
    else if (typeof openPlayerProfile === 'function') openPlayerProfile(String(pid));
  }
  function clearFilters() { if (filter) filter.reset(); else render(); }
  // The "N ready for promotion" chip: academy prospects only, the ready ones.
  function showReady() {
    statusFilter = 'academy';
    ensureFilter();
    if (filter) filter.set({ ready: ['ready'] }); else render();
  }

  function historyHtml(track) {
    const rows = (track.history || []).slice().reverse().map(h => `<tr><td>${esc(h.season)}</td><td>${h.overall ?? '—'}</td>
      <td>${showRange() && h.potential_high ? `${h.potential_low}-${h.potential_high}` : '—'}</td><td>${h.months_in_squad ?? '—'}</td></tr>`).join('');
    return `<table class="sub-table"><thead><tr><th>Season</th><th>OVR</th><th>Potential</th><th>Months in academy</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function promotionCell(r) {
    if (!r.ready) return '<span class="at-dim">—</span>';
    return `<span class="at-ready rd-${r.ready.key}">${esc(r.ready.verdict)}</span><div class="at-ready-detail">${esc(r.ready.detail)}</div>`;
  }

  function rowHtml(r, showStatus) {
    const id = esc(r.player_id), isOpen = open.has(String(r.player_id));
    const pos = root.getPositionInfo(r.position_id);
    // same small +N / -N badge as the Squad list, here since the prospect was first seen
    const badge = typeof deltaBadge === 'function' ? deltaBadge(r.ovrChange) : (r.ovrChange ? ` <span class="${r.ovrChange > 0 ? 'at-good' : 'at-bad'}">${signed(r.ovrChange)}</span>` : '');
    const delta = r.seasons > 1 && r.ovrChange ? `<span title="Since first seen (${esc(r.track.history[0].season)})">${badge}</span>` : '';
    const avatar = typeof buildPlayerAvatarHtml === 'function' ? buildPlayerAvatarHtml({ name: r.name }, 34, '50%') : '';
    return `<tr class="player-row${isOpen ? ' expanded' : ''}" onclick="AcademyTracker.rowClick(event, '${id}')">
        <td><div class="player-name-cell"><span class="player-name"><span class="expand-icon">▶</span>${avatar}${esc(r.name)}</span></div></td>
        <td><span class="pos-badge pos-${pos.group}">${pos.label}</span></td>
        <td>${r.age ?? '—'}</td>
        ${showStatus ? `<td><span class="at-status st-${r.status}">${STATUS_LABEL[r.status]}</span></td>` : ''}
        <td>${r.months ?? '—'}</td>
        <td>${r.ovr == null ? '—' : `<span class="rating-badge">${r.ovr}</span>`}${delta}</td>
        <td style="color: var(--accent-color); font-weight: 600;">${esc(r.potText)}</td>
        <td>${promotionCell(r)}</td>
      </tr>
      <tr class="detail-row${isOpen ? ' open' : ''}"><td colspan="${visibleColumns(showStatus ? 'all' : '').length}"><div class="detail-wrapper">${isOpen ? historyHtml(r.track) : ''}</div></td></tr>`;
  }

  function renderHead() {
    const head = $('academy-head'); if (!head) return;
    head.innerHTML = `<tr>${visibleColumns(statusFilter).map(([k, label]) => `<th onclick="AcademyTracker.sort('${k}')" style="cursor: pointer;">${label} ${sortCol === k ? (sortAsc ? '▲' : '▼') : '↕'}</th>`).join('')}</tr>`;
  }

  function renderStatusChips(rows) {
    const el = $('academy-status'); if (!el) return;
    const n = f => (f === 'all' ? rows.length : rows.filter(r => r.status === f).length);
    el.innerHTML = [['academy', 'In academy'], ['promoted', 'Promoted'], ['left', 'Left'], ['all', 'All']].map(([f, label]) =>
      `<button class="home-toggle-btn${statusFilter === f ? ' active' : ''}" onclick="AcademyTracker.setStatus('${f}')">${label} <span style="opacity: 0.7;">${n(f)}</span></button>`).join('');
  }

  function renderReadyChip(rows) {
    const el = $('academy-ready-chip'); if (!el) return;
    const inAcademy = rows.filter(r => r.status === 'academy');
    const ready = inAcademy.filter(r => r.ready && r.ready.key === 'ready').length;
    const close = inAcademy.filter(r => r.ready && r.ready.key === 'close').length;
    el.innerHTML = !inAcademy.length ? ''
      : ready ? `<button class="at-ready rd-ready at-ready-btn" onclick="AcademyTracker.showReady()" title="Show only the prospects who are ready for the first team">${ready} ready for promotion${close ? ` · ${close} close` : ''}</button>`
      : `<span class="at-dim" style="font-size: 13px;">No one ready for promotion yet${close ? ` · ${close} close` : ''}</span>`;
  }

  function renderFootnote(rows) {
    const el = $('academy-footnote'); if (!el) return;
    const parts = [`<strong>Ready for promotion</strong> = the prospect's OVR is level with or above your weakest senior player at the same natural position; <strong>Close</strong> = within ${CLOSE_GAP} below; <strong>Developing</strong> = further off; <strong>Position open</strong> = no senior player there. Under each verdict: who he is compared with and where he would rank in the squad at that position.`];
    if (!showRange()) parts.push('Potential follows the app\'s display setting; sorting and filtering use the number shown, never a hidden one.');
    if (rows.some(r => r.status !== 'academy')) parts.push('Click a name to see a prospect\'s season-by-season history; click anywhere else on the row to open the profile.');
    el.innerHTML = parts.map(t => `<div>${t}</div>`).join('');
  }

  function render() {
    const body = $('academy-body'); if (!body) return;
    ensureFilter();
    if (sortCol === 'status' && statusFilter !== 'all') { sortCol = 'ready'; sortAsc = true; } // the column is not shown on this tab
    renderHead();
    if (!loaded) { body.innerHTML = `<tr><td colspan="${visibleColumns(statusFilter).length}" class="empty-state">Loading academy…</td></tr>`; return; }
    const env = liveEnv();
    const rows = buildRows(tracks, seniors(), env);
    renderStatusChips(rows); renderReadyChip(rows); renderFootnote(rows);
    const q = (($('academy-search') || {}).value || '').trim().toLowerCase();
    const scoped = rows.filter(r => statusFilter === 'all' || r.status === statusFilter);
    const shown = scoped.filter(r => (!q || String(r.name).toLowerCase().includes(q)) && (!filter || filter.matches(r))).sort(compareRows(sortCol, sortAsc, env));
    if (filter) filter.setSummary(shown.length, scoped.length);
    if (!rows.length) { body.innerHTML = `<tr><td colspan="${visibleColumns(statusFilter).length}" class="empty-state">No academy history yet. It builds up as the app syncs your academy (F10).</td></tr>`; return; }
    if (!shown.length) { body.innerHTML = `<tr><td colspan="${visibleColumns(statusFilter).length}" class="empty-state">No prospects match${(filter && filter.activeCount()) || q ? ' your search and filters' : ''}.</td></tr>`; return; }
    body.innerHTML = shown.map(r => rowHtml(r, statusFilter === 'all')).join('');
  }

  async function show() {
    if (!$('squad-academy-view')) return;
    if (!loaded) { render(); await load(); }
    render();
  }

  const api = {
    // pure
    readinessOf, buildRows, compareRows, filterFields, readyProspects, parsePotTop, summarise, ordinal,
    COLUMNS, visibleColumns, FILTER_PRESETS, STATUS_LABEL, VERDICT, defaultAsc,
    // page
    show, render, reload, invalidate, setData, sort, setStatus, toggleOpen, rowClick, showReady, clearFilters,
    // Readiness for one live academy row (the profile page); null when it cannot be worked out.
    readinessFor: row => {
      try {
        if (!row) return null;
        const env = liveEnv(), label = env.labelOf(row.position_id);
        return readinessOf(Number(row.overall) || 0, label, seniors().filter(p => env.labelOf(p.position_id) === label));
      } catch (e) { console.error('Academy: readiness failed', e); return null; }
    },
    liveReady: () => { try { return readyProspects(typeof currentYouthAcademy !== 'undefined' ? currentYouthAcademy || [] : [], seniors(), liveEnv()); } catch (e) { console.error('Academy: ready list failed', e); return []; } }
  };
  root.AcademyTracker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
