// Academy tracker + regen watchlist (Squad tab > Academy view).
//
// Tracker: every academy prospect the app has ever snapshotted for this save, with per-season history and a status
// (academy / promoted / left), from main.js getAcademyTracker. Watchlist: prospects the user stars; the numbers at
// the moment of starring are frozen in academy_watchlist so "since added" movement and alerts can be shown.
//
// Pure helpers (summarise, alertsFor) take plain data and are exported via module.exports for tests. Rendering reads
// app.js globals at call time (let/const ones by bare name): currentPlayers, currentYouthAcademy, currentSaveId,
// SHOW_TRUE_POTENTIAL.
(function (root) {
  'use strict';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS_LABEL = { academy: 'In academy', promoted: 'Promoted', left: 'Left' };
  const BIG_OVR_JUMP = 3;

  // history is ordered oldest -> newest.
  function summarise(track) {
    const h = track.history || [];
    const first = h[0] || {}, last = h[h.length - 1] || {};
    return {
      first, last,
      ovrChange: (last.overall || 0) - (first.overall || 0),
      ceilingChange: (last.potential_high || 0) - (first.potential_high || 0),
      seasons: h.length
    };
  }

  // Alerts for a watched prospect; `base` is the academy_watchlist row. showRange=false hides anything derived from
  // the potential range (the app can be configured to keep the true range hidden).
  function alertsFor(track, base, showRange) {
    const out = [];
    if (track.status === 'left') out.push({ sev: 'high', text: 'Left the academy' });
    if (track.status === 'promoted') out.push({ sev: 'ok', text: 'Promoted to the senior squad' });
    const last = (track.history || [])[(track.history || []).length - 1] || {};
    if (base && base.base_overall != null && last.overall != null) {
      const d = last.overall - base.base_overall;
      if (d >= BIG_OVR_JUMP) out.push({ sev: 'ok', text: `OVR +${d} since added` });
      else if (d <= -BIG_OVR_JUMP) out.push({ sev: 'mid', text: `OVR ${d} since added` });
    }
    if (showRange && base && base.base_pot_high != null && last.potential_high != null) {
      const w0 = base.base_pot_high - base.base_pot_low, w1 = last.potential_high - last.potential_low;
      if (w1 < w0) out.push({ sev: 'info', text: `Potential range narrowed ${base.base_pot_low}–${base.base_pot_high} → ${last.potential_low}–${last.potential_high}` });
      const dc = last.potential_high - base.base_pot_high;
      if (dc >= 3) out.push({ sev: 'ok', text: `Ceiling +${dc}` });
      else if (dc <= -3) out.push({ sev: 'mid', text: `Ceiling ${dc}` });
    }
    return out;
  }

  // ---- state --------------------------------------------------------------
  let tracks = [];
  let watch = new Map(); // player_id -> academy_watchlist row
  let filterStatus = 'academy'; // academy | promoted | left | all | watched
  let filterGroup = 'ALL';
  const open = new Set();
  let loaded = false;

  const hasApi = () => !!(root.api && root.api.getAcademyTracker);
  const saveId = () => (typeof currentSaveId !== 'undefined' ? currentSaveId : null);
  const showRange = () => typeof SHOW_TRUE_POTENTIAL !== 'undefined' && !!SHOW_TRUE_POTENTIAL;
  const host = () => root.document.getElementById('squad-alt-view');

  async function load() {
    if (!hasApi()) { loaded = true; return; }
    try {
      const [t, w] = await Promise.all([root.api.getAcademyTracker(saveId()), root.api.getAcademyWatchlist(saveId())]);
      tracks = t || [];
      watch = new Map((w || []).map(r => [r.player_id, r]));
    } catch (e) { console.error('Academy tracker load failed', e); }
    loaded = true;
  }

  async function reload() { await load(); render(); }
  function invalidate() { loaded = false; }
  function setData(t, w) { tracks = t || []; watch = new Map((w || []).map(r => [r.player_id, r])); loaded = true; }

  async function toggleWatch(pid) {
    if (!hasApi()) return;
    await root.api.toggleAcademyWatch(pid, saveId());
    await reload();
  }
  async function saveNote(pid, value) {
    if (hasApi()) await root.api.setAcademyWatchNote(pid, value, saveId());
    const row = watch.get(pid); if (row) row.note = value;
  }
  function toggleOpen(pid) { open.has(pid) ? open.delete(pid) : open.add(pid); render(); }
  function setStatus(v) { filterStatus = v; render(); }
  function setGroup(v) { filterGroup = v; render(); }

  // ---- rendering ----------------------------------------------------------
  const seniors = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
  const liveAcademyRow = pid => (typeof currentYouthAcademy !== 'undefined' ? currentYouthAcademy || [] : []).find(a => a.player_id == pid);
  const signed = n => (n > 0 ? '+' : '') + n;

  // Squad readiness: the prospect's OVR against the weakest senior player of the same natural position, as a plain
  // verdict (Ready / Close / Developing / Open spot) plus the one comparison it is based on.
  function readinessOf(ovr, label, same) {
    if (!same.length) return { key: 'open', verdict: 'Open spot', detail: `No senior ${label} in the squad` };
    const weakest = same.reduce((m, p) => Number(p.overall || 0) < Number(m.overall || 0) ? p : m);
    const d = ovr - Number(weakest.overall || 0);
    const vs = `${weakest.name} (${weakest.overall})`;
    if (d >= 0) return { key: 'ready', verdict: 'Ready', detail: d === 0 ? `Level with ${vs}` : `${d} above ${vs}` };
    if (d >= -3) return { key: 'close', verdict: 'Close', detail: `${-d} below ${vs}` };
    return { key: 'dev', verdict: 'Developing', detail: `${-d} below ${vs}` };
  }

  function readiness(track) {
    const label = root.getPositionInfo(track.position_id).label;
    const same = seniors().filter(p => root.getPositionInfo(p.position_id).label === label);
    const r = readinessOf(summarise(track).last.overall || 0, label, same);
    return `<span class="at-ready rd-${r.key}">${r.verdict}</span><div class="at-ready-detail">${esc(r.detail)}</div>`;
  }

  function potentialCell(track) {
    const live = liveAcademyRow(track.player_id);
    if (live && typeof formatAcademyPotentialDisplay === 'function') return esc(formatAcademyPotentialDisplay(live));
    const l = summarise(track).last;
    return showRange() && l.potential_high ? `${l.potential_low}–${l.potential_high}` : '—';
  }

  function alertHtml(list) {
    return list.map(a => `<span class="at-alert sev-${a.sev}">${esc(a.text)}</span>`).join('');
  }

  function historyHtml(track) {
    const rows = track.history.slice().reverse().map(h => `<tr><td>${esc(h.season)}</td><td>${h.overall ?? '—'}</td>
      <td>${showRange() && h.potential_high ? `${h.potential_low}–${h.potential_high}` : '—'}</td><td>${h.months_in_squad ?? '—'}</td></tr>`).join('');
    const w = watch.get(track.player_id);
    return `<table class="sub-table at-history"><thead><tr><th>Season</th><th>OVR</th><th>Potential</th><th>Months in academy</th></tr></thead><tbody>${rows}</tbody></table>
      ${w ? `<div class="at-note"><label>Note <input type="text" value="${esc(w.note || '')}" maxlength="500" placeholder="e.g. regen CB, could cover for the 33-year-old"
        onclick="event.stopPropagation()" onchange="AcademyTracker.saveNote(${track.player_id}, this.value)"></label></div>` : ''}`;
  }

  function rowHtml(track) {
    const s = summarise(track);
    const age = root.computeAge(track.dob);
    const w = watch.get(track.player_id);
    const posInfo = root.getPositionInfo(track.position_id);
    const alerts = w ? alertsFor(track, w, showRange()) : [];
    const delta = s.seasons > 1 ? ` <span class="${s.ovrChange > 0 ? 'at-good' : s.ovrChange < 0 ? 'at-bad' : 'at-dim'}" title="Since first seen (${esc(s.first.season)})">${signed(s.ovrChange)}</span>` : '';
    return `<tr class="at-row" onclick="AcademyTracker.toggleOpen(${track.player_id})">
      <td><button class="at-star${w ? ' on' : ''}" title="${w ? 'Remove from watchlist' : 'Add to watchlist'}" onclick="event.stopPropagation(); AcademyTracker.toggleWatch(${track.player_id})">${w ? '★' : '☆'}</button></td>
      <td><span class="clickable-name" onclick="event.stopPropagation(); openPlayerProfile('${track.player_id}')">${esc(track.name)}</span>${alerts.length ? `<div>${alertHtml(alerts)}</div>` : ''}</td>
      <td><span class="pos-badge pos-${posInfo.group}">${posInfo.label}</span></td>
      <td>${age ?? '—'}</td>
      <td><span class="at-status st-${track.status}">${STATUS_LABEL[track.status]}</span></td>
      <td>${s.last.months_in_squad ?? '—'}</td>
      <td><strong>${s.last.overall ?? '—'}</strong>${delta}</td>
      <td style="color: var(--accent-color); font-weight: 600;">${potentialCell(track)}</td>
      <td>${track.status === 'academy' ? readiness(track) : ''}</td>
    </tr>${open.has(track.player_id) ? `<tr class="at-detail"><td></td><td colspan="8">${historyHtml(track)}</td></tr>` : ''}`;
  }

  function tableHtml(list, emptyMsg) {
    if (!list.length) return `<div class="empty-state" style="padding: 12px;">${emptyMsg}</div>`;
    return `<table class="sub-table at-table"><thead><tr><th></th><th>Player</th><th>Pos</th><th>Age</th><th>Status</th><th>Months</th><th>OVR</th><th>Potential</th><th title="Compares the prospect OVR with your weakest senior player at the same position">Squad readiness</th></tr></thead>
      <tbody>${list.map(rowHtml).join('')}</tbody></table>`;
  }

  function html() {
    if (!loaded) return '<div class="empty-state">Loading academy…</div>';
    const watched = tracks.filter(t => watch.has(t.player_id));
    // A watched player who has since vanished from every snapshot table still deserves a line.
    const orphans = [...watch.keys()].filter(pid => !tracks.some(t => t.player_id === pid)).length;
    const counts = { academy: 0, promoted: 0, left: 0 };
    tracks.forEach(t => counts[t.status]++);
    const chip = (v, label, n) => `<button class="pf-chip${filterStatus === v ? ' active' : ''}" onclick="AcademyTracker.setStatus('${v}')">${label}${n != null ? ` <span class="pf-count">${n}</span>` : ''}</button>`;
    const groupChip = g => `<button class="pf-chip${filterGroup === g ? ' active' : ''}" onclick="AcademyTracker.setGroup('${g}')">${g === 'ALL' ? 'All positions' : g}</button>`;
    const list = tracks.filter(t => {
      if (filterStatus === 'watched' ? !watch.has(t.player_id) : (filterStatus !== 'all' && t.status !== filterStatus)) return false;
      return filterGroup === 'ALL' || root.getPositionInfo(t.position_id).group === filterGroup;
    }).sort((a, b) => (summarise(b).last.potential_high || 0) - (summarise(a).last.potential_high || 0) || (summarise(b).last.overall || 0) - (summarise(a).last.overall || 0));

    return `<h4 class="dc-section" style="margin-top: 0;">Regen watchlist <span class="at-dim">(${watched.length})</span></h4>
      <div class="at-help">Squad readiness compares a prospect's OVR with your weakest senior player in the same position: <span class="at-ready rd-ready">Ready</span> level or better, <span class="at-ready rd-close">Close</span> within 3, <span class="at-ready rd-dev">Developing</span> further off, <span class="at-ready rd-open">Open spot</span> no senior at that position.</div>
      ${tableHtml(watched, 'Star a prospect (☆) to follow them here. The numbers when you add them are remembered, so you can see how they develop.')}
      ${orphans ? `<div class="at-dim" style="font-size: 12px;">${orphans} watched player${orphans > 1 ? 's' : ''} no longer in any academy snapshot.</div>` : ''}
      <h4 class="dc-section">Academy tracker</h4>
      <div class="pf-bar" style="margin-bottom: 10px;">
        ${chip('academy', 'In academy', counts.academy)}${chip('promoted', 'Promoted', counts.promoted)}${chip('left', 'Left', counts.left)}${chip('watched', 'Watched', watched.length)}${chip('all', 'All', tracks.length)}
        <span style="width: 12px;"></span>${['ALL', 'GK', 'DEF', 'MID', 'ATT'].map(groupChip).join('')}
      </div>
      ${tableHtml(list, tracks.length ? 'No prospects match.' : 'No academy history yet — it builds up as the app syncs your academy (F10).')}`;
  }

  async function show() {
    const h = host(); if (!h) return;
    if (!loaded) { h.innerHTML = html(); await load(); }
    render();
  }
  function render() {
    const h = host(); if (!h) return;
    h.innerHTML = html();
  }

  const api = { readinessOf, invalidate, show, render, reload, setData, toggleWatch, saveNote, toggleOpen, setStatus, setGroup, summarise, alertsFor };
  root.AcademyTracker = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
