// Squad tab "Finance" and "Compare" views.
//
// Finance: wage bill, contract expiry timeline, and a wage-vs-overall scatter with a fitted curve that flags who is
// paid above / below what their overall usually earns in this squad. Compare: radar + side-by-side table for 2-3 players.
// The pure helpers (fitWageCurve, wageRatings, contractBuckets, compareAxes) take plain arrays and are exported via
// module.exports for scripts/test_squad_analytics.js. Rendering reads app.js globals at render time only
// (currentPlayers, getPositionInfo, computeAge, computeMonthsUntilExpiry, formatMoney, formatWageAmount, calculate*,
// estimateMarketValue, openPlayerProfile) and the chart builders from js/charts.js.
(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MIN_WAGE_SAMPLE = 6; // fewer priced players than this and a fitted curve says nothing
  const OVERPAID_RATIO = 1.25, GOOD_VALUE_RATIO = 0.8; // only call someone out when they are this far from typical

  // ---------------------------------------------------------------------------------------------------------
  // Pure logic
  // ---------------------------------------------------------------------------------------------------------

  // Least-squares fit of ln(wage) = a + b * overall over players with a real wage and overall.
  // Returns { a, b, n } or null when there is too little (or too uniform) data.
  function fitWageCurve(players) {
    const pts = (players || []).filter(p => Number(p.wage) > 0 && Number(p.overall) > 0)
      .map(p => ({ x: Number(p.overall), y: Math.log(Number(p.wage)) }));
    if (pts.length < MIN_WAGE_SAMPLE) return null;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
    const sxx = pts.reduce((s, p) => s + (p.x - mx) * (p.x - mx), 0);
    if (sxx === 0) return null; // everyone has the same overall
    const b = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
    return { a: my - b * mx, b, n };
  }
  const expectedWage = (curve, overall) => Math.exp(curve.a + curve.b * Number(overall));

  // One row per priced player: wage, what the curve expects for that overall, and the ratio (1.0 = typical).
  function wageRatings(players, curve) {
    if (!curve) return [];
    return (players || []).filter(p => Number(p.wage) > 0 && Number(p.overall) > 0).map(p => {
      const expected = expectedWage(curve, p.overall);
      return { player: p, wage: Number(p.wage), expected, ratio: Number(p.wage) / expected };
    });
  }

  // Expiry year -> { year, count, wage, players }, ascending; players without a parseable year go in `unknown`.
  function contractBuckets(players) {
    const map = new Map(); const unknown = [];
    (players || []).forEach(p => {
      const y = parseInt(p.contract_expiry, 10);
      if (!Number.isFinite(y) || y < 1900) { unknown.push(p); return; }
      if (!map.has(y)) map.set(y, { year: y, count: 0, wage: 0, players: [] });
      const b = map.get(y); b.count++; b.wage += Number(p.wage) || 0; b.players.push(p);
    });
    return { buckets: [...map.values()].sort((a, b) => a.year - b.year), unknown };
  }

  // Axes for the compare radar: goalkeepers get their own six, anything else the outfield six. `isGk` picks.
  const OUTFIELD_AXES = [['PAC', 'calculatePace'], ['SHO', 'calculateShooting'], ['PAS', 'calculatePassing'], ['DRI', 'calculateDribbling'], ['DEF', 'calculateDefending'], ['PHY', 'calculatePhysical']];
  const GK_AXES = [['DIV', 'diving'], ['HAN', 'handling'], ['KIC', 'kicking'], ['REF', 'reflexes'], ['SPE', 'speed'], ['POS', 'gk_positioning']];
  function compareAxes(players, isGkFn) {
    return players.length > 0 && players.every(isGkFn) ? { gk: true, axes: GK_AXES } : { gk: false, axes: OUTFIELD_AXES };
  }
  function axisValue(p, axis, gk) {
    const attrs = p.attributes || {}, base = Number(p.overall) || 75;
    if (gk) return axis[0] === 'SPE' ? root.calculatePace(attrs, base) : Number(attrs[axis[1]] ?? base);
    return root[axis[1]](attrs, base);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Shared rendering helpers
  // ---------------------------------------------------------------------------------------------------------

  const squad = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
  const loanedOut = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'loan').length;
  const host = () => document.getElementById('squad-alt-view');
  const wk = v => `${root.currencySymbol()}${Math.round(root.convertFromEur(v) / 1000).toLocaleString()}K`;
  const tile = (label, value, sub) => `<div class="profile-card" style="margin: 0; padding: 12px 14px;">
    <div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim);">${esc(label)}</div>
    <div style="font-size: 22px; font-weight: 700; margin-top: 2px;">${value}</div>
    ${sub ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 2px;">${sub}</div>` : ''}</div>`;
  const nameLink = p => `<span class="clickable-name" style="color: #58a6ff;" onclick="openPlayerProfile('${esc(p.player_id)}')">${esc(p.name)}</span>`;
  const GROUP_COLOR = { GK: '#d29922', DEF: '#58a6ff', MID: '#3fb950', ATT: '#f85149' };

  // ---------------------------------------------------------------------------------------------------------
  // Finance view
  // ---------------------------------------------------------------------------------------------------------

  function financeHtml() {
    const players = squad();
    const priced = players.filter(p => Number(p.wage) > 0);
    if (priced.length === 0) return '<div class="empty-state">No wage data for this squad yet. Sync from the game (F10) to load it.</div>';

    const total = priced.reduce((s, p) => s + Number(p.wage), 0);
    const top = priced.reduce((b, p) => (Number(p.wage) > Number(b.wage) ? p : b), priced[0]);
    // "Expiring" = contract ends within 12 months of the in-game date (same helper the rest of the app uses).
    const expiring = priced.filter(p => { const m = root.computeMonthsUntilExpiry(p.contract_expiry); return m != null && m <= 12; });
    const expiringWage = expiring.reduce((s, p) => s + Number(p.wage), 0);

    const { buckets, unknown } = contractBuckets(players);
    const bars = root.Charts.barsHtml(buckets.map(b => {
      const m = root.computeMonthsUntilExpiry(b.year);
      return { label: String(b.year), value: b.count, text: `${b.count} player${b.count === 1 ? '' : 's'}`, sub: wk(b.wage) + '/wk', color: m != null && m <= 12 ? '#f85149' : 'var(--accent-color)' };
    }));

    const curve = fitWageCurve(priced);
    const ratings = wageRatings(priced, curve);
    let scatter = '', lists = '';
    if (!curve) {
      lists = `<div class="empty-state" style="padding: 12px;">Need at least ${MIN_WAGE_SAMPLE} players with a wage and rating to compare pay against level.</div>`;
    } else {
      const oMin = Math.min(...ratings.map(r => Number(r.player.overall))), oMax = Math.max(...ratings.map(r => Number(r.player.overall)));
      const trend = []; for (let i = 0; i <= 12; i++) { const o = oMin + ((oMax - oMin) * i) / 12; trend.push({ x: o, y: expectedWage(curve, o) }); }
      scatter = root.Charts.scatterSvg(ratings.map(r => {
        const g = root.getPositionInfo(r.player.position_id).group;
        return { x: Number(r.player.overall), y: r.wage, color: GROUP_COLOR[g] || 'var(--accent-color)', id: r.player.player_id,
          title: `${r.player.name} · OVR ${r.player.overall} · ${root.formatWageAmount(r.wage)}/wk · ${r.ratio.toFixed(2)}× typical` };
      }), { xLabel: 'Overall', yLabel: 'Weekly wage', yFmt: wk, xFmt: v => Math.round(v), trend, onClick: 'openPlayerProfile' });
      const sorted = ratings.slice().sort((a, b) => b.ratio - a.ratio);
      const row = r => `<tr><td>${nameLink(r.player)}</td><td>${root.getPositionInfo(r.player.position_id).label}</td><td>${r.player.overall}</td><td>${root.formatWageAmount(r.wage)}</td><td class="${r.ratio > 1 ? 'at-bad' : 'at-good'}">${r.ratio.toFixed(2)}×</td></tr>`;
      const head = '<thead><tr><th>Player</th><th>Pos</th><th>OVR</th><th>Wage/wk</th><th>vs typical</th></tr></thead>';
      const table = (title, list, none) => `<div><div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 6px;">${title}</div>`
        + (list.length ? `<table class="sub-table">${head}<tbody>${list.map(row).join('')}</tbody></table>` : `<div style="color: var(--text-dim); font-size: 13px;">${none}</div>`) + '</div>';
      const over = sorted.filter(r => r.ratio >= OVERPAID_RATIO).slice(0, 5);
      const value = sorted.filter(r => r.ratio <= GOOD_VALUE_RATIO).reverse().slice(0, 5);
      lists = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
        ${table('Paid well above level', over, 'Nobody is paid far above what their rating usually earns here.')}
        ${table('Best value', value, 'Nobody is paid far below what their rating usually earns here.')}</div>
        <div style="font-size: 11px; color: var(--text-dim); margin-top: 8px;">"Typical" is the wage the fitted curve gives this squad for that overall (${curve.n} players); a player is listed at ${OVERPAID_RATIO}× or more, or ${GOOD_VALUE_RATIO}× or less. It looks at current overall only, so high-potential youngsters and veterans on legacy deals will show up here.</div>`;
    }
    const legend = Object.keys(GROUP_COLOR).map(g => `<span><span style="color: ${GROUP_COLOR[g]};">●</span> ${g}</span>`).join(' ');

    return `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px;">
        ${tile('Weekly wage bill', wk(total), `${priced.length} players`)}
        ${tile('Average wage', wk(total / priced.length), 'per player, per week')}
        ${tile('Expiring in 12 months', `${expiring.length}`, expiring.length ? `${wk(expiringWage)}/wk coming off` : 'nobody')}
        ${tile('Top earner', esc(top.name), `${root.formatWageAmount(top.wage)}/wk`)}
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px;">
        <div class="profile-card"><h3>Contract expiries</h3>${bars || '<div class="empty-state" style="padding: 12px;">No contract dates.</div>'}
          ${unknown.length ? `<div style="font-size: 11px; color: var(--text-dim);">${unknown.length} without a contract date (not shown)</div>` : ''}
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 6px;">Red = within 12 months.</div></div>
        <div class="profile-card"><h3>Wage vs overall</h3>${scatter || '<div class="empty-state" style="padding: 12px;">Not enough players to plot.</div>'}
          ${scatter ? `<div style="display: flex; gap: 12px; font-size: 12px; color: var(--text-dim); flex-wrap: wrap;">${legend}<span>╌ typical for this squad</span></div>` : ''}</div>
      </div>
      <div class="profile-card" style="margin-top: 16px;"><h3>Pay vs level</h3>${lists}</div>
      ${loanedOut() ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 8px;">${loanedOut()} loaned-out player${loanedOut() === 1 ? '' : 's'} not counted.</div>` : ''}`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Compare view
  // ---------------------------------------------------------------------------------------------------------

  const COMPARE_COLORS = ['#00ff87', '#58a6ff', '#d29922'];
  let picks = []; // player ids (strings), max 3

  const isGk = p => Number(p.position_id) === 0 || root.getPositionInfo(p.position_id).label === 'GK';
  const byId = id => squad().find(p => String(p.player_id) === String(id));

  function compareHtml() {
    const players = squad().slice().sort((a, b) => (Number(b.overall) || 0) - (Number(a.overall) || 0));
    if (players.length === 0) return '<div class="empty-state">No squad loaded.</div>';
    picks = picks.filter(id => byId(id));
    if (picks.length === 0) picks = players.slice(0, 2).map(p => String(p.player_id)); // start with the two best, not a blank page
    const chosen = picks.map(byId);

    const selects = [0, 1, 2].map(i => `<label class="dc-ctl">${i === 2 ? 'Player 3 (optional)' : 'Player ' + (i + 1)}
      <select onchange="SquadCompare.pick(${i}, this.value)">${i === 2 ? '<option value="">None</option>' : ''}${players.map(p => `<option value="${esc(p.player_id)}"${String(p.player_id) === picks[i] ? ' selected' : ''}>${esc(p.name)} (${root.getPositionInfo(p.position_id).label} ${p.overall})</option>`).join('')}</select></label>`).join('');

    const { gk, axes } = compareAxes(chosen, isGk);
    const series = chosen.map((p, i) => ({ name: p.name, color: COMPARE_COLORS[i], values: axes.map(a => axisValue(p, a, gk)) }));
    const radar = root.Charts.radarSvg(axes.map(a => a[0]), series);
    const legend = chosen.map((p, i) => `<span style="font-weight: 700; color: ${COMPARE_COLORS[i]};">● ${esc(p.name)}</span>`).join('<span style="margin: 0 8px;"></span>');

    // [label, value fn, higher-is-better?]. A row's best value is highlighted when 2+ players have a real number.
    const hasStats = chosen.some(p => Number(p.appearances) > 0);
    const rows = [
      ['Position', p => root.getPositionInfo(p.position_id).label],
      ['Age', p => root.computeAge(p.dob)],
      ['Overall', p => Number(p.overall) || null, true],
      ['Potential', p => Number(p.potential) || null, true],
      ...axes.map(a => [a[0], p => axisValue(p, a, gk), true]),
      ['Skill moves', p => Number(p.skill_moves) || null, true],
      ['Weak foot', p => Number(p.weak_foot) || null, true],
      ['Wage / wk', p => Number(p.wage) || null, null, v => root.formatWageAmount(v)],
      ['Contract ends', p => parseInt(p.contract_expiry, 10) || null],
      ...(hasStats ? [['Appearances', p => Number(p.appearances) || 0, true], ['Goals', p => Number(p.goals) || 0, true], ['Assists', p => Number(p.assists) || 0, true], ['Avg rating', p => Number(p.avg_rating) > 0 ? Number(p.avg_rating).toFixed(2) : null, true]] : [])
    ];
    const body = rows.map(([label, fn, higher, fmt]) => {
      const vals = chosen.map(fn);
      const nums = vals.map(v => (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)) && label !== 'Position')) ? Number(v) : null);
      const real = nums.filter(v => v != null);
      const best = higher == null || real.length < 2 ? null : (higher ? Math.max(...real) : Math.min(...real));
      return `<tr><td style="color: var(--text-dim);">${esc(label)}</td>${vals.map((v, i) => {
        const win = best != null && nums[i] === best && real.filter(x => x === best).length < real.length;
        return `<td style="${win ? 'color: #3fb950; font-weight: 700;' : ''}">${v == null ? '–' : esc(fmt && nums[i] != null ? fmt(nums[i]) : v)}</td>`;
      }).join('')}</tr>`;
    }).join('');

    return `<div class="dc-toolbar-controls" style="display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 14px;">${selects}</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; align-items: start;">
        <div class="profile-card" style="text-align: center;"><h3>${gk ? 'Goalkeeping' : 'Attributes'}</h3>${radar}<div style="font-size: 13px; margin-top: 4px;">${legend}</div></div>
        <div class="profile-card"><h3>Side by side</h3><table class="sub-table"><thead><tr><th></th>${chosen.map((p, i) => `<th style="color: ${COMPARE_COLORS[i]};">${nameLink(p)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 8px;">Green = best in the row (performance rows only; age, wage and contract are just shown). Attribute scores are the same PAC/SHO/PAS/DRI/DEF/PHY (outfield) or goalkeeping values shown on profiles.</div></div>
      </div>`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Public API (called by SquadViews in js/depth_chart.js)
  // ---------------------------------------------------------------------------------------------------------

  const wrap = fn => () => { const h = host(); if (h) h.innerHTML = fn(); };
  const Finance = { show: wrap(financeHtml) };
  const Compare = {
    show: wrap(compareHtml),
    pick(slot, id) {
      if (slot === 2 && !id) picks = picks.slice(0, 2); else picks[slot] = String(id);
      picks = picks.filter((id, i) => id && picks.indexOf(id) === i); // no empty slots, no player twice
      Compare.show();
    }
  };

  root.SquadFinance = Finance;
  root.SquadCompare = Compare;
  const api = { fitWageCurve, expectedWage, wageRatings, contractBuckets, compareAxes, MIN_WAGE_SAMPLE, OVERPAID_RATIO, GOOD_VALUE_RATIO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
