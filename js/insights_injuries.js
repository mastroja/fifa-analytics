// Injuries: a timeline in the player profile's Injury History card (InsightsInjuries.profileTimelineHtml, called from
// app.js buildInjuryHistoryCardHtml) and Insights > Injuries, a squad-wide view: who is out now, days lost, the most
// injury-prone players and a swimlane timeline of the last 18 months.
// Episodes come from player_injury_history via getPlayerInjuryHistory (one call per squad player; the squad is small).
// Pure helpers (daysBetween, injurySummary, isInjuryProne) are exported via module.exports for
// scripts/test_insights_injuries.js. Rendering reads app.js globals at render time only (currentPlayers, currentSaveId,
// currentIngameDate, getPositionInfo, injuryTypeName, formatDateMMDDYYYY, openPlayerProfile) and js/charts.js.
(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DAY = 86400000;
  const PRONE_COUNT = 3, PRONE_DAYS = 60; // in the last 365 days
  const TIMELINE_DAYS = 540;

  // ---------------------------------------------------------------------------------------------------------
  // Pure logic
  // ---------------------------------------------------------------------------------------------------------

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const s = String(v);
    const d = new Date(/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
    return isNaN(d.getTime()) ? null : d;
  }
  // Whole days from a to b (never negative); null if either date is unreadable.
  function daysBetween(a, b) {
    const x = toDate(a), y = toDate(b);
    return x && y ? Math.max(0, Math.round((y - x) / DAY)) : null;
  }

  // episodes: [{ start_date, end_date (null = still out), injury_type_id }]; today: in-game date.
  // -> { count, daysOut, longest, last (episode with the latest start), out (currently injured), recentCount, recentDays }
  // "recent" = the last 365 days, counting only the part of each episode inside that window.
  function injurySummary(episodes, today) {
    const now = toDate(today) || new Date();
    const windowStart = new Date(now.getTime() - 365 * DAY);
    const eps = (episodes || []).filter(e => toDate(e.start_date));
    let daysOut = 0, longest = 0, recentDays = 0, recentCount = 0, last = null;
    eps.forEach(e => {
      const s = toDate(e.start_date), end = toDate(e.end_date) || now;
      const d = daysBetween(s, end) || 0;
      daysOut += d; longest = Math.max(longest, d);
      if (end >= windowStart) { recentCount++; recentDays += daysBetween(s < windowStart ? windowStart : s, end) || 0; }
      if (!last || s > toDate(last.start_date)) last = e;
    });
    return { count: eps.length, daysOut, longest, last, out: eps.some(e => !e.end_date), recentCount, recentDays };
  }
  const isInjuryProne = sum => sum.recentCount >= PRONE_COUNT || sum.recentDays >= PRONE_DAYS;

  // ---------------------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------------------

  const today = () => (typeof currentIngameDate !== 'undefined' && currentIngameDate) || new Date();
  const typeName = id => (root.injuryTypeName ? root.injuryTypeName(id) : 'Injury');
  const dateLabel = d => (root.formatDateMMDDYYYY ? root.formatDateMMDDYYYY(d) : d);
  const itemsOf = eps => (eps || []).map(e => ({ start: e.start_date, end: e.end_date,
    title: `${typeName(e.injury_type_id)} · ${dateLabel(e.start_date)} – ${e.end_date ? dateLabel(e.end_date) : 'still out'}` }));

  // Profile card: summary line + one-lane timeline over the player's injury history. '' when there is none.
  function profileTimelineHtml(episodes) {
    if (!episodes || episodes.length === 0 || !root.Charts) return '';
    const sum = injurySummary(episodes, today());
    const svg = root.Charts.timelineSvg([{ items: itemsOf(episodes) }], { to: today(), laneHeight: 30 });
    return `<div style="font-size: 13px; margin-bottom: 4px;"><strong>${sum.count}</strong> injur${sum.count === 1 ? 'y' : 'ies'} · <strong>${sum.daysOut}</strong> days out · longest ${sum.longest} days${isInjuryProne(sum) ? ' · <span style="color: #f85149;">injury-prone</span>' : ''}</div>
      ${svg}<div style="font-size: 11px; color: var(--text-dim); margin: 2px 0 12px;"><span style="color: #d29922;">■</span> recovered · <span style="color: #f85149;">■</span> still out · dashed line = today</div>`;
  }

  let cache = null; // { saveId, byId: Map(player_id -> episodes) }
  let loading = false;
  const squad = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal' || p.__clubStatus === 'loan');

  async function load() {
    const api = root.api, saveId = typeof currentSaveId !== 'undefined' ? currentSaveId : null;
    if (loading || !api || !api.getPlayerInjuryHistory) return;
    loading = true;
    try {
      const players = squad();
      const lists = await Promise.all(players.map(p => api.getPlayerInjuryHistory(p.player_id, saveId).catch(() => [])));
      cache = { saveId, byId: new Map(players.map((p, i) => [String(p.player_id), lists[i] || []])) };
    } catch (e) {
      console.error('Insights Injuries: load failed', e);
      cache = { saveId, byId: new Map() };
    } finally {
      loading = false;
      if (root.Insights) root.Insights.refresh();
    }
  }

  function injuriesHtml() {
    const saveId = typeof currentSaveId !== 'undefined' ? currentSaveId : null;
    if (!cache || cache.saveId !== saveId) { load(); return '<div class="empty-state">Loading injuries…</div>'; }
    const now = today();
    const rows = squad().map(p => ({ p, eps: cache.byId.get(String(p.player_id)) || [] }))
      .map(x => ({ ...x, sum: injurySummary(x.eps, now) }));
    const hurt = rows.filter(x => x.sum.count > 0).sort((a, b) => b.sum.recentDays - a.sum.recentDays || b.sum.daysOut - a.sum.daysOut);
    if (hurt.length === 0) return '<div class="empty-state">No injuries recorded for the current squad. Episodes are logged automatically from each F10 sync (or added by hand on a player\'s profile).</div>';

    const out = rows.filter(x => x.sum.out);
    const recentDays = rows.reduce((s, x) => s + x.sum.recentDays, 0);
    const prone = hurt.filter(x => isInjuryProne(x.sum));
    const tile = (label, value, sub) => `<div class="profile-card" style="margin: 0; padding: 12px 14px;"><div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim);">${label}</div>
      <div style="font-size: 22px; font-weight: 700; margin-top: 2px;">${value}</div><div style="font-size: 12px; color: var(--text-dim);">${sub || '&nbsp;'}</div></div>`;
    const tiles = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px;">
      ${tile('Injured now', out.length, out.map(x => esc(x.p.name)).slice(0, 3).join(', ') + (out.length > 3 ? '…' : ''))}
      ${tile('Days lost (12 months)', recentDays, `across ${hurt.filter(x => x.sum.recentCount).length} players`)}
      ${tile('Injury-prone', prone.length, `${PRONE_COUNT}+ injuries or ${PRONE_DAYS}+ days out in 12 months`)}
      ${tile('Most days lost', esc(hurt[0].p.name), `${hurt[0].sum.recentDays} days in 12 months`)}
    </div>`;

    const from = new Date((toDate(now) || new Date()).getTime() - TIMELINE_DAYS * DAY);
    const lanes = hurt.filter(x => x.eps.some(e => (toDate(e.end_date) || toDate(now)) >= from)).slice(0, 15)
      .map(x => ({ label: x.p.name, id: x.p.player_id, items: itemsOf(x.eps) }));
    const timeline = lanes.length ? root.Charts.timelineSvg(lanes, { from, to: now, onClick: 'openPlayerProfile', width: 1200, laneHeight: 30 }) : '<div class="empty-state" style="padding: 12px;">No injuries in the last 18 months.</div>';

    const table = `<table class="sub-table"><thead><tr><th>Player</th><th>Pos</th><th>Injuries</th><th>Days out</th><th>Last 12 months</th><th>Longest</th><th>Last injury</th><th>Status</th></tr></thead><tbody>
      ${hurt.map(x => { const pos = root.getPositionInfo(x.p.position_id); const l = x.sum.last; return `<tr>
        <td><span class="clickable-name" style="color: #58a6ff;" onclick="openPlayerProfile('${esc(x.p.player_id)}')">${esc(x.p.name)}</span>${isInjuryProne(x.sum) ? ' <span style="color: #f85149; font-size: 12px;" title="' + PRONE_COUNT + '+ injuries or ' + PRONE_DAYS + '+ days out in the last 12 months">prone</span>' : ''}</td>
        <td><span class="pos-badge pos-${pos.group}">${pos.label}</span></td><td>${x.sum.count}</td><td>${x.sum.daysOut}</td>
        <td>${x.sum.recentCount ? `${x.sum.recentCount} · ${x.sum.recentDays} days` : '–'}</td><td>${x.sum.longest} days</td>
        <td>${l ? `${esc(typeName(l.injury_type_id))} <span style="color: var(--text-dim); font-size: 12px;">${esc(dateLabel(l.start_date))}</span>` : '–'}</td>
        <td>${x.sum.out ? '<span style="color: #f85149; font-weight: 600;">Injured</span>' : '<span style="color: var(--text-dim);">Fit</span>'}</td></tr>`; }).join('')}
    </tbody></table>`;

    return `${tiles}<div class="profile-card"><h3>Last 18 months</h3>${timeline}
        <div style="font-size: 11px; color: var(--text-dim);"><span style="color: #d29922;">■</span> recovered · <span style="color: #f85149;">■</span> still out · dashed line = today · click a name for their profile${hurt.length > lanes.length ? ` · showing the ${lanes.length} with recent injuries` : ''}</div></div>
      <div class="profile-card" style="margin-top: 16px;"><h3>Injury record (current squad, all time)</h3>${table}</div>`;
  }

  if (root.Insights) root.Insights.addView('injuries', injuriesHtml);
  const api = { daysBetween, injurySummary, isInjuryProne, profileTimelineHtml, invalidate: () => { cache = null; }, PRONE_COUNT, PRONE_DAYS };
  root.InsightsInjuries = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
