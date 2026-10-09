// Squad tab "All-Time" view (index.html #squad-alltime-view): everyone who has ever played for the club, with their
// career totals here, peak overall, and where they are now. Replaces the old Former Players tab and the Squad season
// dropdown's "All Time" option, which showed the two halves of this separately.
//
// Sources (no new main.js queries): getAllTimeSquad (career totals per player), getAllTimeXI (seasons at the club and
// peak overall/season), and app.js's currentPastPlayers (getPastPlayers: departed players followed live, minus the
// ones the user cleared) plus currentPlayers (who is at the club / out on loan right now).
// Status: 'club' (at the club), 'loan' (ours, loaned out), 'left' (departed, followed: current club / live OVR),
// 'untracked' (departed but not followed, e.g. cleared with "Clear former players"; shown under All only, the same as
// the old Former Players tab left them out).
// buildAllTimeRows / clubRecords are pure and exported via module.exports for scripts/test_all_time.js. Rendering
// reads app.js globals at render time only (currentPlayers, currentPastPlayers, currentSaveId, getPositionInfo,
// computeAge, getLastName, POSITION_SORT_ORDER, buildPlayerAvatarHtml, openPlayerProfile, formatMoney,
// estimateMarketValue, getTransferFeeForPlayer, formatYearsActiveRange, fetchAllTimeCompetitionsForPlayer,
// renderCompetitionsTableHtml, GROUP_CHIPS, isFc27Save) and PlayerFilters.
(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const RATING_MIN_APPS = 20; // "best average rating" record needs a real sample

  // ---------------------------------------------------------------------------------------------------------
  // Pure logic
  // ---------------------------------------------------------------------------------------------------------

  // stats: getAllTimeSquad rows; xi: getAllTimeXI rows; past: getPastPlayers rows; squad: currentPlayers (with
  // __clubStatus). Returns one row per player, status set, career totals from stats, tracking info from past.
  function buildAllTimeRows(stats, xi, past, squad) {
    const key = id => String(id);
    const xiById = new Map((xi || []).map(r => [key(r.player_id), r]));
    const pastById = new Map((past || []).map(r => [key(r.player_id), r]));
    const squadById = new Map((squad || []).map(r => [key(r.player_id), r]));
    const out = new Map();

    const make = (base, statRow) => {
      const id = key(base.player_id);
      const here = squadById.get(id), gone = pastById.get(id), x = xiById.get(id);
      let status = 'untracked';
      if (here && here.__clubStatus === 'normal') status = 'club';
      else if (here && here.__clubStatus === 'loan') status = 'loan';
      else if (gone) status = 'left';
      const apps = Number(statRow && statRow.appearances) || 0;
      return {
        player_id: base.player_id,
        name: base.name,
        position_id: base.position_id,
        dob: base.dob,
        status,
        appearances: apps,
        goals: Number(statRow && statRow.goals) || 0,
        assists: Number(statRow && statRow.assists) || 0,
        clean_sheets: Number(statRow && statRow.clean_sheets) || 0,
        yellow_cards: Number(statRow && statRow.yellow_cards) || 0,
        red_cards: Number(statRow && statRow.red_cards) || 0,
        avg_rating: apps > 0 ? Number(statRow.avg_rating) || 0 : 0,
        seasons: x ? Number(x.seasons) || 0 : (gone && gone.years_active) || null,
        peak_overall: x ? Number(x.overall) || null : null,
        peak_season: x ? x.peak_season || null : null,
        // overall right now: live squad value, or the followed value for a departed player (live or last known)
        overall_now: here ? Number(here.overall) || null : gone ? Number(gone.overall) || null : (statRow ? Number(statRow.overall) || null : null),
        overall_is_live: here ? true : gone ? !!gone.overall_is_live : false,
        current_club: here && here.__clubStatus === 'loan' ? here.club_name || null : gone ? gone.current_club || null : null,
        joined_season: gone ? gone.joined_season : null,
        departed_season: gone ? gone.departed_season : null,
        years_active: gone ? gone.years_active : null,
        wage_at_departure: gone ? gone.wage_at_departure : null,
        potential: here ? here.potential : gone ? gone.potential : statRow ? statRow.potential : null,
        avatar: here || gone || base
      };
    };

    (stats || []).forEach(s => out.set(key(s.player_id), make(s, s)));
    // A followed ex-player with no stats row (should not happen, both come from player_season_stats) still shows.
    (past || []).forEach(p => { if (!out.has(key(p.player_id))) out.set(key(p.player_id), make(p, null)); });
    return [...out.values()];
  }

  const inStatus = (row, filter) => filter === 'all' || (filter === 'club' ? row.status === 'club' || row.status === 'loan' : row.status === 'left');

  // Club records over every row: [{ label, row, value }] with null row when nobody qualifies.
  function clubRecords(rows) {
    const best = (fn, ok) => {
      let top = null;
      (rows || []).forEach(r => { if ((!ok || ok(r)) && fn(r) > 0 && (!top || fn(r) > fn(top))) top = r; });
      return top;
    };
    const apps = best(r => r.appearances), goals = best(r => r.goals), assists = best(r => r.assists);
    const rating = best(r => r.avg_rating, r => r.appearances >= RATING_MIN_APPS), peak = best(r => r.peak_overall || 0);
    return [
      { label: 'Most appearances', row: apps, value: apps && apps.appearances },
      { label: 'Top scorer', row: goals, value: goals && goals.goals },
      { label: 'Most assists', row: assists, value: assists && assists.assists },
      { label: `Best avg rating (${RATING_MIN_APPS}+ apps)`, row: rating, value: rating && rating.avg_rating.toFixed(2) },
      { label: 'Highest peak OVR', row: peak, value: peak && `${peak.peak_overall}${peak.peak_season ? ` · ${peak.peak_season}` : ''}` }
    ];
  }

  // ---------------------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------------------

  const $ = id => document.getElementById(id);
  let stats = null, xi = null, loading = null;
  let statusFilter = 'all';
  let sortCol = 'appearances', sortAsc = false;
  const open = new Set();

  const COLUMNS = [
    ['name', 'Player'], ['position_id', 'Pos'], ['age', 'Age'], ['seasons', 'Seasons'], ['appearances', 'Apps'],
    ['goals', 'Goals'], ['assists', 'Assists'], ['clean_sheets', 'CS'], ['avg_rating', 'Avg Rtg'], ['peak_overall', 'Peak'], ['status', 'Status']
  ];
  const STATUS_RANK = { club: 0, loan: 1, left: 2, untracked: 3 };

  function allRows() {
    const past = typeof currentPastPlayers !== 'undefined' ? currentPastPlayers : [];
    const squad = typeof currentPlayers !== 'undefined' ? currentPlayers : [];
    return buildAllTimeRows(stats || [], xi || [], past, squad).map(r => ({ ...r, age: root.computeAge(r.dob) }));
  }

  let filter = null;
  function ensureFilter() {
    if (filter || !root.PlayerFilters || !$('alltime-filter-mount')) return;
    const seasonsOf = (rows, k) => [...new Set(rows.map(r => r[k]).filter(Boolean))].sort();
    filter = root.PlayerFilters.create({
      key: 'alltime',
      mount: 'alltime-filter-mount',
      onChange: () => renderRows(),
      getRows: () => allRows(),
      fields: [
        { id: 'group', label: 'Position', type: 'chips', options: typeof GROUP_CHIPS !== 'undefined' ? GROUP_CHIPS : [], get: r => root.getPositionInfo(r.position_id).group },
        { id: 'age', label: 'Age now', type: 'range', get: r => r.age },
        { id: 'apps', label: 'Appearances', type: 'range', get: r => r.appearances },
        { id: 'goals', label: 'Goals', type: 'range', get: r => r.goals },
        { id: 'seasons', label: 'Seasons at club', type: 'range', get: r => r.seasons },
        { id: 'peak', label: 'Peak OVR', type: 'range', get: r => r.peak_overall },
        { id: 'club', label: 'Current club', type: 'text', get: r => r.current_club },
        { id: 'fee', label: 'Sold for', type: 'range', step: 1000, get: r => soldFor(r) },
        { id: 'joined', label: 'Joined season', type: 'select', options: rows => seasonsOf(rows, 'joined_season'), get: r => r.joined_season },
        { id: 'departed', label: 'Departed season', type: 'select', options: rows => seasonsOf(rows, 'departed_season'), get: r => r.departed_season }
      ],
      presets: [
        { label: '100+ apps', set: { apps: { min: 100 } } },
        { label: '25+ goals', set: { goals: { min: 25 } } },
        { label: '3+ seasons', set: { seasons: { min: 3 } } },
        { label: 'Sold for a fee', set: { fee: { min: 1 } } }
      ]
    });
  }

  const soldFor = r => (r.status === 'left' || r.status === 'untracked') && root.getTransferFeeForPlayer ? root.getTransferFeeForPlayer(r.player_id) : null;

  function statusHtml(r) {
    const ovr = r.overall_now ? ` · ${r.overall_now}${r.overall_is_live ? '' : ' <span title="Last known, not live">*</span>'}` : '';
    if (r.status === 'club') return `<span style="color: var(--accent-color); font-weight: 600;">At club</span><span style="color: var(--text-dim);">${ovr}</span>`;
    if (r.status === 'loan') return `<span style="color: #58a6ff; font-weight: 600;">On loan${r.current_club ? ` at ${esc(r.current_club)}` : ''}</span><span style="color: var(--text-dim);">${ovr}</span>`;
    if (r.status === 'left') return `<span>→ ${esc(r.current_club || 'Unknown')}</span><span style="color: var(--text-dim);">${ovr}</span>${r.departed_season ? `<div style="font-size: 12px; color: var(--text-dim);">left ${esc(r.departed_season)}</div>` : ''}`;
    return '<span style="color: var(--text-dim);">Left · not tracked</span>';
  }

  function cmp(a, b) {
    let va, vb;
    if (sortCol === 'name') { va = root.getLastName(a.name).toLowerCase(); vb = root.getLastName(b.name).toLowerCase(); return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va); }
    if (sortCol === 'position_id') { va = POSITION_SORT_ORDER[root.getPositionInfo(a.position_id).label] || 99; vb = POSITION_SORT_ORDER[root.getPositionInfo(b.position_id).label] || 99; }
    else if (sortCol === 'status') { va = STATUS_RANK[a.status]; vb = STATUS_RANK[b.status]; }
    else { va = Number(a[sortCol]) || 0; vb = Number(b[sortCol]) || 0; }
    return (sortAsc ? va - vb : vb - va) || (b.appearances - a.appearances);
  }

  function renderHead() {
    const head = $('alltime-head'); if (!head) return;
    head.innerHTML = `<tr>${COLUMNS.map(([k, label]) => `<th onclick="AllTime.sort('${k}')" style="cursor: pointer;">${label} ${sortCol === k ? (sortAsc ? '▲' : '▼') : '↕'}</th>`).join('')}</tr>`;
  }

  function renderRecords(rows) {
    const el = $('alltime-records'); if (!el) return;
    el.innerHTML = clubRecords(rows).map(rec => `
      <div class="profile-card" style="margin: 0; padding: 12px 14px;${rec.row ? ' cursor: pointer;' : ''}"${rec.row ? ` onclick="openPlayerProfile('${esc(rec.row.player_id)}')"` : ''}>
        <div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim);">${esc(rec.label)}</div>
        <div style="font-size: 18px; font-weight: 700; margin-top: 2px;">${rec.row ? esc(rec.row.name) : '—'}</div>
        <div style="font-size: 13px; color: var(--accent-color);">${rec.row ? esc(rec.value) : 'no data yet'}</div>
      </div>`).join('');
  }

  function renderStatusChips(rows) {
    const el = $('alltime-status'); if (!el) return;
    const n = f => rows.filter(r => inStatus(r, f)).length;
    el.innerHTML = [['all', 'All'], ['club', 'At club'], ['left', 'Left']].map(([f, label]) =>
      `<button class="home-toggle-btn${statusFilter === f ? ' active' : ''}" onclick="AllTime.setStatus('${f}')">${label} <span style="opacity: 0.7;">${n(f)}</span></button>`).join('');
  }

  function detailHtml(r) {
    const bits = [];
    if (r.joined_season) bits.push(`Joined ${esc(r.joined_season)}`);
    if (r.departed_season) bits.push(`Left ${esc(r.departed_season)} (${esc(root.formatYearsActiveRange(r.joined_season, r.departed_season))})`);
    if (r.peak_overall) bits.push(`Peak ${r.peak_overall} OVR${r.peak_season ? ` in ${esc(r.peak_season)}` : ''}`);
    if (r.yellow_cards || r.red_cards) bits.push(`${r.yellow_cards} 🟨 · ${r.red_cards} 🟥`);
    const fee = soldFor(r);
    if (fee) bits.push(`Sold for ${esc(root.formatMoney(fee))}`);
    if (r.status === 'left') bits.push(`Value now ~${esc(root.formatMoney(root.estimateMarketValue(r.overall_now, r.potential, r.age, r.wage_at_departure)))}`);
    return `${bits.length ? `<div style="font-size: 13px; color: var(--text-dim); padding: 6px 4px 10px;">${bits.join(' · ')}</div>` : ''}<div data-at-comps>Loading competitions…</div>`;
  }

  function renderRows() {
    const body = $('alltime-body'); if (!body) return;
    renderHead();
    if (!stats) { body.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="empty-state">Loading…</td></tr>`; return; }
    const rows = allRows();
    renderRecords(rows);
    renderStatusChips(rows);
    const q = (($('alltime-search') || {}).value || '').trim().toLowerCase();
    const scoped = rows.filter(r => inStatus(r, statusFilter));
    const shown = scoped.filter(r => (!q || String(r.name).toLowerCase().includes(q)) && (!filter || filter.matches(r))).sort(cmp);
    if (filter) filter.setSummary(shown.length, scoped.length);

    const note = $('alltime-footnote');
    if (note) {
      const untracked = rows.filter(r => r.status === 'untracked').length;
      const parts = [];
      if (rows.some(r => r.overall_now && !r.overall_is_live)) parts.push('* last known overall, not live (updates after a player has been followed for one F10 sync).');
      if (untracked) parts.push(`${untracked} ex-player${untracked === 1 ? ' is' : 's are'} not followed any more (cleared), so they show under All only.`);
      if (root.isFc27Save && root.isFc27Save()) parts.push('FC 27 seasons add goals, assists and clean sheets once Live Editor exposes them; appearances and ratings there are approximate.');
      note.innerHTML = parts.map(t => `<div>${t}</div>`).join('');
    }

    if (rows.length === 0) { body.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="empty-state">No players recorded for this save yet.</td></tr>`; return; }
    if (shown.length === 0) { body.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="empty-state">No players match.</td></tr>`; return; }

    const zero = v => (v ? '' : ' class="zero-stat"');
    body.innerHTML = shown.map(r => {
      const pos = root.getPositionInfo(r.position_id);
      const id = esc(r.player_id);
      const isOpen = open.has(String(r.player_id));
      return `
        <tr class="player-row${isOpen ? ' expanded' : ''}" id="at-row-${id}">
          <td>
            <span class="expand-icon" style="cursor: pointer; margin-right: 4px;" onclick="AllTime.toggle('${id}')" title="Details and competitions breakdown for their whole time at the club">▶</span>
            <span style="display: inline-flex; align-items: center; gap: 6px;">${root.buildPlayerAvatarHtml(r.avatar, 34, '50%')}
              <strong class="clickable-name" style="color: #58a6ff;" onclick="openPlayerProfile('${id}')">${esc(r.name)}</strong></span>
          </td>
          <td><span class="pos-badge pos-${pos.group}">${pos.label}</span></td>
          <td>${r.age ?? '—'}</td>
          <td>${r.seasons ?? '—'}</td>
          <td><span${zero(r.appearances)}>${r.appearances}</span></td>
          <td><span${zero(r.goals)}>${r.goals}</span></td>
          <td><span${zero(r.assists)}>${r.assists}</span></td>
          <td><span${zero(r.clean_sheets)}>${r.clean_sheets}</span></td>
          <td><strong>${r.avg_rating > 0 ? r.avg_rating.toFixed(2) : '—'}</strong></td>
          <td>${r.peak_overall ? `<span class="rating-badge" title="${esc(r.peak_season || '')}">${r.peak_overall}</span>` : '—'}</td>
          <td>${statusHtml(r)}</td>
        </tr>
        <tr class="detail-row${isOpen ? ' open' : ''}" id="at-detail-${id}"><td colspan="${COLUMNS.length}"><div class="detail-wrapper">${isOpen ? detailHtml(r) : ''}</div></td></tr>`;
    }).join('');
    shown.filter(r => open.has(String(r.player_id))).forEach(r => loadComps(r.player_id));
  }

  async function loadComps(playerId) {
    const detail = $(`at-detail-${playerId}`);
    const slot = detail && detail.querySelector('[data-at-comps]');
    if (!slot) return;
    try {
      const breakdown = await root.fetchAllTimeCompetitionsForPlayer(playerId);
      const again = $(`at-detail-${playerId}`);
      const s = again && again.classList.contains('open') && again.querySelector('[data-at-comps]');
      if (s) s.innerHTML = root.renderCompetitionsTableHtml(breakdown);
    } catch (e) {
      console.error('All-Time: competitions breakdown failed for', playerId, e);
      slot.innerHTML = '<div class="empty-state" style="padding: 8px; font-size: 12px;">Couldn\'t load competitions data.</div>';
    }
  }

  async function load() {
    if (loading) return loading;
    const api = root.api;
    loading = (async () => {
      try {
        const [s, x] = await Promise.all([
          api && api.getAllTimeSquad ? api.getAllTimeSquad() : [],
          api && api.getAllTimeXI ? api.getAllTimeXI(typeof currentSaveId !== 'undefined' ? currentSaveId : undefined) : []
        ]);
        stats = s || []; xi = x || [];
      } catch (e) {
        console.error('All-Time: load failed', e);
        stats = stats || []; xi = xi || [];
      } finally { loading = null; }
    })();
    return loading;
  }

  const isShown = () => { const v = $('squad-alltime-view'); return !!(v && v.style.display !== 'none'); };

  const AllTime = {
    async show() { ensureFilter(); renderRows(); if (!stats) { await load(); renderRows(); } },
    renderRows,
    // New sync / save switch: drop the cached totals; reload now only if the view is on screen.
    invalidate() { stats = null; xi = null; },
    async reload() { AllTime.invalidate(); if (isShown()) { renderRows(); await load(); renderRows(); } },
    // currentPastPlayers or the transfer fees changed (app.js renderPastPlayersTable / fee refresh): just redraw.
    redraw() { if (isShown() && stats) renderRows(); },
    setStatus(f) { statusFilter = f; renderRows(); },
    sort(col) { if (sortCol === col) sortAsc = !sortAsc; else { sortCol = col; sortAsc = col === 'name' || col === 'position_id' || col === 'status'; } renderRows(); },
    toggle(id) {
      id = String(id);
      const row = $(`at-row-${id}`), detail = $(`at-detail-${id}`);
      if (!row || !detail) return;
      if (open.has(id)) { open.delete(id); detail.classList.remove('open'); row.classList.remove('expanded'); return; }
      open.add(id); detail.classList.add('open'); row.classList.add('expanded');
      const r = allRows().find(x => String(x.player_id) === id);
      if (r) { detail.querySelector('.detail-wrapper').innerHTML = detailHtml({ ...r }); loadComps(id); }
    }
  };

  root.AllTime = AllTime;
  const api = { buildAllTimeRows, clubRecords, inStatus, RATING_MIN_APPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
