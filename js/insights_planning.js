// Insights > Roster Moves / Progression / Contract Plan: the three planning views.
//
//  - Roster Moves: one sell / keep / loan verdict per senior player with the reasons (js/roster_advice.js).
//  - Progression:  who is rising, stalling or declining for their age, from every stored season (js/progression.js).
//  - Contract Plan: the wage bill season by season and what to do with each expiring deal (js/contract_planner.js).
//
// The *Html builders take an explicit `env` and read no globals, so scripts/test_insights_planning.js can render them
// in node. liveEnv() is the only place that reads app.js globals at render time (currentPlayers, currentSaveId,
// currentIngameDate, challengeStatus, getPositionInfo, computeAge, parseBirthDate, formatWageAmount, currencySymbol,
// convertFromEur, openPlayerProfile) plus window.api for the Progression history. Each view needs a matching
// #insights-view-<key> button in index.html.
(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sign = n => (n > 0 ? '+' : '') + n;

  const VERDICTS = {
    sell: { label: 'Sell', color: '#f85149' },
    loan: { label: 'Loan', color: '#d29922' },
    develop: { label: 'Develop', color: '#58a6ff' },
    keep: { label: 'Keep', color: '#3fb950' },
    monitor: { label: 'Monitor', color: 'var(--text-dim)' }
  };
  const ACTIONS = {
    renew: { label: 'Renew', color: '#3fb950' },
    'renew-short': { label: 'Renew (1 yr)', color: '#58a6ff' },
    review: { label: 'Review', color: 'var(--text-dim)' },
    'let-go': { label: 'Let go', color: '#d29922' },
    sell: { label: 'Sell', color: '#f85149' },
    'sell-now': { label: 'Sell now', color: '#f85149' }
  };
  const STATUSES = {
    rising: { label: 'Rising', color: '#3fb950' },
    'on-track': { label: 'On track', color: 'var(--text-dim)' },
    stalling: { label: 'Stalling', color: '#d29922' },
    declining: { label: 'Declining', color: '#f85149' },
    maxed: { label: 'At potential', color: '#58a6ff' },
    unknown: { label: 'Unknown', color: 'var(--text-dim)' }
  };

  const badge = (def, text) => `<span style="display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; white-space: nowrap; color: ${def.color}; border: 1px solid ${def.color};">${esc(text || def.label)}</span>`;
  const empty = msg => `<div class="empty-state">${msg}</div>`;
  const tile = (label, value, sub, onclick, active) => `<div class="profile-card" style="margin: 0; padding: 12px 14px;${onclick ? ' cursor: pointer;' : ''}${active ? ' outline: 2px solid var(--accent-color);' : ''}"${onclick ? ` onclick="${onclick}"` : ''}>
    <div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim);">${esc(label)}</div>
    <div style="font-size: 22px; font-weight: 700; margin-top: 2px;">${value}</div>
    <div style="font-size: 12px; color: var(--text-dim); margin-top: 2px;">${sub || '&nbsp;'}</div></div>`;
  const tiles = html => `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px;">${html}</div>`;
  const nameLink = p => `<span class="clickable-name" style="color: #58a6ff;" onclick="openPlayerProfile('${esc(p.player_id)}')">${esc(p.name)}</span>`;
  const note = html => `<div style="font-size: 11px; color: var(--text-dim); margin-top: 10px;">${html}</div>`;
  const reasonsHtml = r => `<ul style="margin: 0; padding-left: 16px; font-size: 12px; color: var(--text-dim);">${r.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

  // ---------------------------------------------------------------------------------------------------------
  // Shared computation
  // ---------------------------------------------------------------------------------------------------------

  // Roster advice rows for the squad (also feeds the Contract Plan's per-player actions).
  function computeAdvice(env) {
    if (!root.RosterAdvice) return [];
    return root.RosterAdvice.advise(env.players, {
      ageOf: env.ageOf, groupOf: env.groupOf, seasonEndYear: env.seasonEndYear, transferBan: env.transferBan
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Roster Moves
  // ---------------------------------------------------------------------------------------------------------

  function playTimeText(pt) {
    const pct = `${Math.round(pt.share * 100)}%`;
    return pt.source === 'minutes' ? `${pct} <span style="color: var(--text-dim); font-size: 11px;">of minutes</span>`
      : pt.source === 'apps' ? `${pct} <span style="color: var(--text-dim); font-size: 11px;">of games</span>`
      : `<span style="color: var(--text-dim); font-size: 12px;" title="No minutes or appearances yet: estimated from his rank in the position group">estimated</span>`;
  }

  function adviceHtml(env) {
    if (!env.players.length) return empty('No squad loaded.');
    const rows = computeAdvice(env);
    const count = v => rows.filter(r => r.verdict === v).length;
    const filter = VERDICTS[env.filter] ? env.filter : 'all';
    const shown = filter === 'all' ? rows : rows.filter(r => r.verdict === filter);
    const t = (key, sub) => tile(VERDICTS[key].label, count(key), sub, `InsightsPlanning.setAdviceFilter('${filter === key ? 'all' : key}')`, filter === key);
    const banner = env.transferBan ? `<div class="profile-card" style="margin-bottom: 16px; border-left: 4px solid #d29922;">A transfer ban is active: sells and loans below are marked <strong>blocked</strong> until it ends.</div>` : '';
    const usesMinutes = rows.some(r => r.playTime.source === 'minutes');
    const usesDepth = rows.some(r => r.playTime.source === 'depth');
    const table = shown.length ? `<div class="planning-wrap"><table class="sub-table planning-table"><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR / POT</th><th>Play time</th><th>Wage</th><th>Contract</th><th>Verdict</th><th>Why</th></tr></thead><tbody>
      ${shown.map(r => { const p = r.player; return `<tr>
        <td>${nameLink(p)}</td><td>${esc(env.posLabel(p))}</td><td>${r.age == null ? '–' : esc(r.age)}</td><td>${esc(p.overall || '?')} / ${esc(p.potential || '?')}</td>
        <td>${playTimeText(r.playTime)}</td><td>${Number(p.wage) > 0 ? esc(env.wageFmt(p.wage)) : '–'}</td><td>${esc(p.contract_expiry || '–')}</td>
        <td>${badge(VERDICTS[r.verdict])}${r.blocked ? '<div style="font-size: 11px; color: #d29922;">blocked</div>' : ''}</td><td>${reasonsHtml(r.reasons)}</td></tr>`; }).join('')}
      </tbody></table></div>` : empty(`Nobody is currently a "${esc(VERDICTS[filter].label)}".`);
    return `${banner}${tiles(t('sell', 'worth moving on') + t('loan', 'need minutes') + t('develop', 'growing, playing') + t('keep', 'part of the plan') + t('monitor', 'watch'))}
      <div class="profile-card"><h3>Sell / keep / loan${filter === 'all' ? '' : ` · ${esc(VERDICTS[filter].label)} <a href="#" style="font-size: 12px;" onclick="InsightsPlanning.setAdviceFilter('all'); return false;">show all</a>`}</h3>${table}</div>
      ${note(`Advice is a rule of thumb, not a fact: it weighs age, OVR vs POT, play time, wage vs the squad median and contract length. Play time uses
        ${usesMinutes ? 'minutes played' : 'appearances'} when the game provides them${usesDepth ? ' and falls back to depth rank (marked "estimated") for players with no games yet' : ''}. Click a tile to filter. Loaned-out players are not included.`)}`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Progression
  // ---------------------------------------------------------------------------------------------------------

  function progressHtml(env) {
    if (!env.players.length) return empty('No squad loaded.');
    if (!root.Progression) return empty('Progression logic is not available.');
    const b = root.Progression.board(env.players, env.histories || new Map(), { ageOf: env.ageOf, seasonLabel: env.seasonLabel, seasonOrder: env.seasonOrder, limit: 5 });
    const known = b.rows.filter(r => r.status !== 'unknown');
    if (!known.length) {
      return empty('Not enough history yet. Each F10 sync stores a snapshot, so rises and falls appear after your second season or once ratings start moving in this one.');
    }
    const list = (title, items, none) => `<div class="profile-card" style="margin: 0;"><h3>${esc(title)}</h3>${items.length
      ? `<table class="sub-table"><tbody>${items.map(r => `<tr><td>${nameLink(r.player)}</td><td>${esc(r.player.overall)}${r.change != null ? ` <span style="color: ${r.change < 0 ? '#f85149' : r.change > 0 ? '#3fb950' : 'var(--text-dim)'};">${sign(r.change)}</span>` : ''}</td>
          <td style="color: var(--text-dim); font-size: 12px;">${r.expected != null ? `age norm ${sign(r.expected)}` : ''}</td></tr>`).join('')}</tbody></table>`
      : `<div style="color: var(--text-dim); font-size: 13px;">${none}</div>`}</div>`;
    const all = b.rows.slice().sort((x, y) => (y.vsExpected == null ? -99 : y.vsExpected) - (x.vsExpected == null ? -99 : x.vsExpected));
    const countOf = s => b.rows.filter(r => r.status === s).length;
    const table = `<div class="planning-wrap"><table class="sub-table planning-table"><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR / POT</th><th>Last change</th><th>Total</th><th>Age norm</th><th>vs norm</th><th>Status</th><th>Outlook</th></tr></thead><tbody>
      ${all.map(r => `<tr><td>${nameLink(r.player)}</td><td>${esc(env.posLabel(r.player))}</td><td>${r.age == null ? '–' : esc(Math.round(r.age))}</td><td>${esc(r.overall)} / ${esc(r.potential || '?')}</td>
        <td>${r.change == null ? '–' : sign(r.change)}${r.source === 'in-season' ? ' <span style="color: var(--text-dim); font-size: 11px;">this season</span>' : ''}</td>
        <td>${r.total == null ? '–' : sign(r.total)}</td><td>${r.expected == null ? '–' : sign(r.expected)}</td><td>${r.vsExpected == null ? '–' : sign(Math.round(r.vsExpected * 10) / 10)}</td>
        <td>${badge(STATUSES[r.status])}</td><td>${reasonsHtml(r.reasons.slice(0, 2))}</td></tr>`).join('')}</tbody></table></div>`;
    return `${tiles(['rising', 'stalling', 'declining', 'maxed'].map(s => tile(STATUSES[s].label, countOf(s), s === 'rising' ? 'ahead of the age norm' : s === 'stalling' ? 'young, not growing' : s === 'declining' ? 'falling faster than age' : 'young, at the ceiling')).join(''))}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 16px;">
        ${list('Biggest risers', b.risers, 'Nobody is growing faster than their age allows.')}
        ${list('Stalling prospects', b.stalling, 'No young player with room to grow has stopped developing.')}
        ${list('Biggest fallers', b.fallers, 'Nobody is falling faster than their age explains.')}
      </div>
      <div class="profile-card"><h3>Whole squad</h3>${table}</div>
      ${note('"Age norm" is a rule-of-thumb yearly change for that age (about +4 at 18, 0 at 26-27, -2.5 from 33), not EA\'s real curve. A player is rising or declining relative to it, not in absolute terms. With one season of history the figure is the change so far this season, which a first sync reports as 0, so those players show as unknown.')}`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Contract Plan
  // ---------------------------------------------------------------------------------------------------------

  function contractsHtml(env) {
    if (!env.players.length) return empty('No squad loaded.');
    if (!root.ContractPlanner || !Number.isFinite(env.seasonEndYear)) return empty('Contract planning needs the in-game date. Sync from the game (F10) to load it.');
    if (!env.players.some(p => Number(p.wage) > 0)) return empty('No wage data for this squad yet. Sync from the game (F10) to load it.');
    const adviceByPlayer = new Map(computeAdvice(env).map(r => [r.player, r]));
    const plan = root.ContractPlanner.plan(env.players, {
      seasonEndYear: env.seasonEndYear, ageOf: env.ageOf, expectedWageOf: env.expectedWageOf, adviceOf: p => adviceByPlayer.get(p) || null
    });
    if (!plan.seasons.length) return empty('No contract dates to plan from.');
    const [now, next] = plan.seasons;
    const decisions = plan.renewals.filter(r => r.yearsLeft <= 0).length;
    const bars = env.barsHtml(plan.seasons.map(s => ({
      label: s.label, value: s.withRenewals, text: `${env.wageShort(s.withRenewals)}/wk`,
      sub: s.endYear === plan.seasonEndYear ? 'current' : `${env.wageShort(s.committedWage)} + ${env.wageShort(s.renewedWage)}`,
      color: s.endYear === plan.seasonEndYear ? 'var(--accent-color)' : '#58a6ff'
    })));
    const rolling = plan.seasons.filter(s => s.rollingOffCount > 0).slice(0, 3).map(s => `<tr><td>${esc(s.label)}</td><td>${s.rollingOffCount} player${s.rollingOffCount === 1 ? '' : 's'}</td><td>${esc(env.wageShort(s.rollingOffWage))}/wk comes off</td></tr>`).join('');
    const table = plan.renewals.length ? `<div class="planning-wrap"><table class="sub-table planning-table"><thead><tr><th>Player</th><th>Pos</th><th>Age</th><th>OVR</th><th>Ends</th><th>Wage now</th><th>Est. renewal</th><th>Change</th><th>Action</th><th>Why</th></tr></thead><tbody>
      ${plan.renewals.map(r => `<tr><td>${nameLink(r.player)}</td><td>${esc(env.posLabel(r.player))}</td><td>${r.age == null ? '–' : esc(r.age)}</td><td>${esc(r.player.overall || '?')}</td>
        <td>${esc(r.expiry)}${r.yearsLeft <= 0 ? ' <span style="color: #f85149; font-size: 11px;">this summer</span>' : ''}</td><td>${esc(env.wageFmt(r.wage))}</td>
        <td>${r.action === 'sell' || r.action === 'sell-now' || r.action === 'let-go' ? '–' : esc(env.wageFmt(r.renewalWage))}</td>
        <td style="color: ${r.raise > 0 ? '#d29922' : 'var(--text-dim)'};">${r.action === 'sell' || r.action === 'sell-now' || r.action === 'let-go' ? '–' : (r.raise > 0 ? '+' + esc(env.wageFmt(r.raise)) : 'same')}</td>
        <td>${badge(ACTIONS[r.action] || ACTIONS.review)}</td><td>${reasonsHtml(r.reasons)}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Nobody\'s contract runs out in the planning window (this season and next).');
    return `${tiles(tile('Wage bill now', esc(env.wageShort(now.withRenewals)), 'per week')
        + tile('Next season', esc(next ? env.wageShort(next.withRenewals) : '–'), next ? `${next.rollingOffCount} roll off, ${next.renewedCount} renewed` : '')
        + tile('Decisions this summer', decisions, decisions ? 'contracts ending' : 'nobody expiring')
        + tile('Unknown contract', plan.unknown.length, plan.unknown.length ? 'not in the projection' : '&nbsp;'))}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 16px;">
        <div class="profile-card"><h3>Projected weekly wage bill</h3>${bars}
          <div style="font-size: 11px; color: var(--text-dim); margin-top: 6px;">The two figures after each bar are wages already signed + planned renewals (the players marked Renew / Renew (1 yr) below). Players marked Sell, Let go or Review are assumed to leave. No signings are included.</div></div>
        <div class="profile-card"><h3>What rolls off</h3>${rolling ? `<table class="sub-table"><tbody>${rolling}</tbody></table>` : '<div style="color: var(--text-dim); font-size: 13px;">Nothing rolls off in the next few seasons.</div>'}</div>
      </div>
      <div class="profile-card"><h3>Expiring contracts</h3>${table}</div>
      ${note('Renewal wages are estimates: the pay this squad\'s own wage curve gives that overall, never below his current wage. Only the contract end year is stored (no start date or length), so a deal listed as ending in 2028 runs through the 2027/28 season. Players on loan elsewhere are not counted.')}`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Live wiring (the only part that reads app.js globals)
  // ---------------------------------------------------------------------------------------------------------

  let adviceFilter = 'all';
  let cache = null;   // { saveId, seasonLabel, byId: Map(player_id -> history rows) } for Progression
  let loading = false;

  const squad = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
  const saveIdNow = () => (typeof currentSaveId !== 'undefined' ? currentSaveId : null);

  function seasonEndYearNow() {
    const raw = typeof currentIngameDate !== 'undefined' ? currentIngameDate : null;
    const d = (root.parseBirthDate && raw ? root.parseBirthDate(raw) : null) || new Date();
    return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear(); // July-June seasons, as computeMonthsUntilExpiry assumes
  }

  function liveEnv() {
    const players = squad();
    const ban = typeof challengeStatus !== 'undefined' && challengeStatus && challengeStatus.ban && challengeStatus.ban.active;
    const SA = root.SquadAnalytics;
    const curve = SA && SA.fitWageCurve ? SA.fitWageCurve(players.filter(p => Number(p.wage) > 0)) : null;
    return {
      players, filter: adviceFilter, transferBan: !!ban, seasonEndYear: seasonEndYearNow(),
      ageOf: p => { const a = root.computeAge ? root.computeAge(p.dob || p.birthdate) : null; return a == null ? null : a; },
      groupOf: p => root.getPositionInfo(p.position_id).group,
      posLabel: p => root.getPositionInfo(p.position_id).label,
      wageFmt: v => root.formatWageAmount(v),
      wageShort: v => `${root.currencySymbol()}${Math.round(root.convertFromEur(v) / 1000).toLocaleString()}K`,
      expectedWageOf: curve ? p => SA.expectedWage(curve, p.overall) : null,
      barsHtml: rows => (root.Charts ? root.Charts.barsHtml(rows) : ''),
      histories: cache && cache.saveId === saveIdNow() ? cache.byId : null,
      seasonLabel: cache && cache.saveId === saveIdNow() ? cache.seasonLabel : null
    };
  }

  async function load() {
    const api = root.api, saveId = saveIdNow();
    if (loading || !api || !api.getPlayerHistory || !api.getSeasonsList) return;
    loading = true;
    try {
      const players = squad();
      const [seasons, lists] = await Promise.all([
        api.getSeasonsList(),
        Promise.all(players.map(p => api.getPlayerHistory(p.player_id).catch(() => [])))
      ]);
      const list = seasons || [];
      const cur = list.find(s => s.is_current) || list[list.length - 1] || null;
      cache = { saveId, seasonLabel: cur ? cur.year_label : null, byId: new Map(players.map((p, i) => [p.player_id, lists[i] || []])) };
    } catch (e) {
      console.error('Insights Progression: load failed', e);
      cache = { saveId, seasonLabel: null, byId: new Map() };
    } finally {
      loading = false;
      if (root.Insights) root.Insights.refresh();
    }
  }

  const safe = (name, fn) => () => { try { return fn(); } catch (e) { console.error(`Insights ${name}:`, e); return empty(`Could not draw this view (${esc(e.message)}).`); } };

  const views = {
    advice: safe('Roster Moves', () => adviceHtml(liveEnv())),
    progress: safe('Progression', () => {
      if (!root.api || !root.api.getPlayerHistory) return progressHtml(liveEnv()); // no stored history to load: in-season changes only
      if (!cache || cache.saveId !== saveIdNow()) { load(); return empty('Loading season history…'); }
      return progressHtml(liveEnv());
    }),
    contracts: safe('Contract Plan', () => contractsHtml(liveEnv()))
  };
  if (root.Insights) Object.keys(views).forEach(k => root.Insights.addView(k, views[k]));

  const api = {
    adviceHtml, progressHtml, contractsHtml, computeAdvice, seasonEndYearNow,
    setAdviceFilter(v) { adviceFilter = VERDICTS[v] ? v : 'all'; if (root.Insights) root.Insights.render(); },
    invalidate() { cache = null; }
  };
  root.InsightsPlanning = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
