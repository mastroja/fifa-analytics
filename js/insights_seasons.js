// Insights > Seasons: how the squad has changed season by season — size, average and best-11 overall, average age,
// weekly wage bill and U21 count — from the rosters stored for every synced season (getSeasonsList + getSquadData;
// the current season uses the live squad so it matches every other view).
// Pure helpers (ownClubRows, seasonSummary) are exported via module.exports for scripts/test_insights_seasons.js.
// Rendering reads app.js globals at render time only (currentPlayers, currentSaveId, parseBirthDate, currencySymbol,
// convertFromEur) and js/charts.js.
(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------------------------------------------------------------------------------------------------
  // Pure logic
  // ---------------------------------------------------------------------------------------------------------

  // A past season's stored roster also holds players we had loaned out (on_loan) and loanees from other clubs; the
  // club's own players are the non-loan rows at the most common club_id.
  function ownClubRows(rows) {
    const own = (rows || []).filter(r => !r.on_loan && r.club_id != null);
    if (own.length === 0) return [];
    const counts = new Map();
    own.forEach(r => counts.set(r.club_id, (counts.get(r.club_id) || 0) + 1));
    const club = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return own.filter(r => r.club_id === club);
  }

  // ageOf(row) -> age at the end of that season (or null). Averages skip missing values; null when nobody has one.
  function seasonSummary(rows, ageOf) {
    const avg = arr => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
    const ovrs = rows.map(r => Number(r.overall)).filter(v => v > 0).sort((a, b) => b - a);
    const ages = rows.map(ageOf).filter(v => v != null && Number.isFinite(v));
    return {
      size: rows.length,
      avgOvr: avg(ovrs),
      best11: avg(ovrs.slice(0, 11)),
      avgAge: avg(ages),
      wageBill: rows.reduce((s, r) => s + (Number(r.wage) || 0), 0),
      u21: ages.filter(a => a <= 21).length
    };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------------------

  let cache = null; // { saveId, seasons: [{ id, year_label, league_name, is_current, rows }] }
  let loading = false;

  async function load() {
    const api = root.api, saveId = typeof currentSaveId !== 'undefined' ? currentSaveId : null;
    if (loading || !api || !api.getSeasonsList || !api.getSquadData) return;
    loading = true;
    try {
      const seasons = (await api.getSeasonsList()) || [];
      const withRows = await Promise.all(seasons.map(async s => ({ ...s, rows: s.is_current ? null : ownClubRows((await api.getSquadData(s.id)) || []) })));
      cache = { saveId, seasons: withRows };
    } catch (e) {
      console.error('Insights Seasons: load failed', e);
      cache = { saveId, seasons: [] };
    } finally {
      loading = false;
      if (root.Insights) root.Insights.refresh();
    }
  }

  const wk = v => `${root.currencySymbol()}${Math.round(root.convertFromEur(v) / 1000).toLocaleString()}K`;
  const delta = (a, b, digits, fmt) => {
    if (a == null || b == null) return '';
    const d = a - b; if (Math.abs(d) < Math.pow(10, -digits) / 2) return '<span style="color: var(--text-dim);">±0</span>';
    return `<span style="color: var(--text-dim);">${d > 0 ? '+' : '−'}${fmt ? fmt(Math.abs(d)) : Math.abs(d).toFixed(digits)} vs last season</span>`;
  };

  function seasonsHtml() {
    const saveId = typeof currentSaveId !== 'undefined' ? currentSaveId : null;
    if (!cache || cache.saveId !== saveId) { load(); return '<div class="empty-state">Loading seasons…</div>'; }
    if (cache.seasons.length === 0) return '<div class="empty-state">No seasons synced yet.</div>';

    const live = (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
    const data = cache.seasons.map(s => {
      const rows = s.is_current ? live : s.rows;
      const ageOf = r => root.Charts.ageAtSeasonEnd(root.parseBirthDate(r.dob), s.year_label);
      return { label: s.year_label, league: s.league_name, current: s.is_current, ...seasonSummary(rows, ageOf) };
    }).filter(d => d.size > 0);
    if (data.length === 0) return '<div class="empty-state">No squad data stored for any season yet.</div>';

    const labels = data.map(d => d.label);
    const cur = data[data.length - 1], prev = data.length > 1 ? data[data.length - 2] : null;
    const tile = (label, value, d) => `<div class="profile-card" style="margin: 0; padding: 12px 14px;"><div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim);">${label}</div>
      <div style="font-size: 22px; font-weight: 700; margin-top: 2px;">${value}</div><div style="font-size: 12px;">${d || '&nbsp;'}</div></div>`;
    const fmt1 = v => (v == null ? '–' : v.toFixed(1));
    const tiles = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px;">
      ${tile('Best 11 avg OVR', fmt1(cur.best11), prev && delta(cur.best11, prev.best11, 1))}
      ${tile('Squad avg OVR', fmt1(cur.avgOvr), prev && delta(cur.avgOvr, prev.avgOvr, 1))}
      ${tile('Average age', fmt1(cur.avgAge), prev && delta(cur.avgAge, prev.avgAge, 1))}
      ${tile('Wage bill / wk', wk(cur.wageBill), prev && delta(cur.wageBill, prev.wageBill, 0, wk))}
    </div>`;

    const C = root.Charts;
    const few = data.length < 3 ? `<div style="font-size: 12px; color: var(--text-dim); margin-bottom: 10px;">Trends fill in as more seasons are synced (${data.length} so far).</div>` : '';
    const charts = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px;">
      <div class="profile-card"><h3>Squad strength</h3>${C.lineChartSvg(labels, [{ name: 'Best 11 avg', color: '#00ff87', values: data.map(d => d.best11) }, { name: 'Squad avg', color: '#58a6ff', values: data.map(d => d.avgOvr) }], { yFmt: v => v.toFixed(0), dashed: ['Squad avg'], width: 400, height: 240 })}</div>
      <div class="profile-card"><h3>Average age</h3>${C.lineChartSvg(labels, [{ name: 'Average age', color: '#d29922', values: data.map(d => d.avgAge) }], { yFmt: v => v.toFixed(1), width: 400, height: 240 })}</div>
      <div class="profile-card"><h3>Wage bill / wk</h3>${C.lineChartSvg(labels, [{ name: 'Wage bill', color: '#f85149', values: data.map(d => d.wageBill || null) }], { yFmt: wk, width: 400, height: 240 })}</div>
    </div>`;
    const table = `<div class="profile-card" style="margin-top: 16px;"><h3>Season by season</h3><table class="sub-table">
      <thead><tr><th>Season</th><th>League</th><th>Squad</th><th>Best 11</th><th>Avg OVR</th><th>Avg age</th><th>U21s</th><th>Wage bill / wk</th></tr></thead>
      <tbody>${data.slice().reverse().map(d => `<tr><td>${esc(d.label)}${d.current ? ' <span style="color: var(--accent-color); font-size: 12px;">current</span>' : ''}</td><td>${esc(d.league || '–')}</td>
        <td>${d.size}</td><td>${fmt1(d.best11)}</td><td>${fmt1(d.avgOvr)}</td><td>${fmt1(d.avgAge)}</td><td>${d.u21}</td><td>${d.wageBill ? wk(d.wageBill) : '–'}</td></tr>`).join('')}</tbody></table>
      <div style="font-size: 11px; color: var(--text-dim); margin-top: 8px;">Past seasons use the roster as last synced that season (everyone registered with the club, loaned-out players excluded); ages are as of 30 June of the season's end year.</div></div>`;
    return few + tiles + charts + table;
  }

  if (root.Insights) root.Insights.addView('seasons', seasonsHtml);
  const api = { ownClubRows, seasonSummary, invalidate: () => { cache = null; } };
  root.InsightsSeasons = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
