// Insights > Roster Moves / Progression, plus the contract planning sections of Wages & Contracts.
//
//  - Roster Moves: one sell / keep / loan verdict per senior player with the reasons (js/roster_advice.js).
//  - Progression:  who is rising, stalling or declining for their age, from every stored season (js/progression.js).
//  - Wages & Contracts gains the wage bill projected season by season and what to do with each expiring deal
//    (js/contract_planner.js), added through Insights.addWagesSection so the wage view stays one tab.
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
  // Name with a small "position · age · rating" line under it: keeps the wide tables to the columns that need room.
  const subLine = parts => `<div style="font-size: 11px; color: var(--text-dim); margin-top: 2px; white-space: nowrap;">${parts.filter(x => x != null && x !== '').map(esc).join(' · ')}</div>`;
  const ageText = a => (a == null || !Number.isFinite(a) ? null : Math.round(a));
  const note = html => `<div style="font-size: 11px; color: var(--text-dim); margin-top: 10px;">${html}</div>`;
  const reasonsHtml = r => `<ul style="margin: 0; padding-left: 16px; font-size: 12px; color: var(--text-dim);">${r.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;

  // ---------------------------------------------------------------------------------------------------------
  // Shared computation
  // ---------------------------------------------------------------------------------------------------------

  // Roster advice rows for the squad (also feeds the contract actions in Wages & Contracts).
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
    const table = shown.length ? `<div class="planning-wrap"><table class="sub-table planning-table"><thead><tr><th>Player</th><th>Play time</th><th>Deal</th><th>Verdict</th><th>Why</th></tr></thead><tbody>
      ${shown.map(r => { const p = r.player; return `<tr>
        <td>${nameLink(p)}${subLine([env.posLabel(p), ageText(r.age), `${p.overall || '?'}/${p.potential || '?'}`])}</td>
        <td>${playTimeText(r.playTime)}</td><td>${Number(p.wage) > 0 ? esc(env.wageFmt(p.wage)) : '–'}${subLine([p.contract_expiry ? `to ${p.contract_expiry}` : null])}</td>
        <td>${r.keyExpiring ? badge(VERDICTS.monitor, 'Renew?') : badge(VERDICTS[r.verdict])}${r.blocked ? '<div style="font-size: 11px; color: #d29922;">blocked</div>' : ''}</td><td>${reasonsHtml(r.reasons)}</td></tr>`; }).join('')}
      </tbody></table></div>` : empty(`Nobody is currently a "${esc(VERDICTS[filter].label)}".`);
    return `${banner}${tiles(t('sell', 'worth moving on') + t('loan', 'need minutes') + t('develop', 'growing, playing') + t('keep', 'part of the plan') + t('monitor', 'watch'))}
      <div class="profile-card"><h3>Sell / keep / loan${filter === 'all' ? '' : ` · ${esc(VERDICTS[filter].label)} <a href="#" style="font-size: 12px;" onclick="InsightsPlanning.setAdviceFilter('all'); return false;">show all</a>`}</h3>${table}</div>
      ${note(`Advice is a rule of thumb, not a fact: it weighs age, OVR vs POT, play time, wage vs the squad median and contract length. Play time uses
        ${usesMinutes ? 'minutes played' : 'appearances'} when the game provides them${usesDepth ? ' and falls back to depth rank (marked "estimated") for players with no games yet' : ''}. Under each name: position · age · OVR/POT. Click a tile to filter. Loaned-out players are not included.`)}`;
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
    const table = `<div class="planning-wrap"><table class="sub-table planning-table"><thead><tr><th>Player</th><th>Change</th><th>vs age norm</th><th>Status</th><th>Outlook</th></tr></thead><tbody>
      ${all.map(r => `<tr><td>${nameLink(r.player)}${subLine([env.posLabel(r.player), ageText(r.age), `${r.overall}/${r.potential || '?'}`])}</td>
        <td>${r.change == null ? '–' : sign(r.change)}${subLine([r.source === 'in-season' ? 'this season' : 'last season', r.total != null && r.series.length >= 3 ? `${sign(r.total)} in total` : null])}</td>
        <td>${r.vsExpected == null ? '–' : sign(Math.round(r.vsExpected * 10) / 10)}${subLine([r.expected == null ? null : `norm ${sign(r.expected)}`])}</td>
        <td>${badge(STATUSES[r.status])}</td><td>${reasonsHtml(r.reasons.slice(0, 2))}</td></tr>`).join('')}</tbody></table></div>`;
    return `${tiles(['rising', 'stalling', 'declining', 'maxed'].map(s => tile(STATUSES[s].label, countOf(s), s === 'rising' ? 'ahead of the age norm' : s === 'stalling' ? 'young, not growing' : s === 'declining' ? 'falling faster than age' : 'young, at the ceiling')).join(''))}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 16px;">
        ${list('Biggest risers', b.risers, 'Nobody is growing faster than their age allows.')}
        ${list('Stalling prospects', b.stalling, 'No young player with room to grow has stopped developing.')}
        ${list('Biggest fallers', b.fallers, 'Nobody is falling faster than their age explains.')}
      </div>
      <div class="profile-card"><h3>Whole squad</h3>${table}</div>
      ${note('"Age norm" is a rule-of-thumb yearly change for that age (about +4 at 18, 0 at 26-27, -2.5 from 33), not EA\'s real curve. A player is rising or declining relative to it, not in absolute terms. With one season of history the figure is the change so far this season, which a first sync reports as 0, so those players show as unknown. Under each name: position · age · OVR/POT.')}`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Contract planning: two sections of the Wages & Contracts view (the projection card and the actions table)
  // ---------------------------------------------------------------------------------------------------------

  // The plan for the squad, or null when it cannot be made (no in-game date, no contract dates, no squad).
  function computePlan(env) {
    if (!env.players.length || !root.ContractPlanner || !Number.isFinite(env.seasonEndYear)) return null;
    const adviceByPlayer = new Map(computeAdvice(env).map(r => [r.player, r]));
    const plan = root.ContractPlanner.plan(env.players, {
      seasonEndYear: env.seasonEndYear, ageOf: env.ageOf, expectedWageOf: env.expectedWageOf, adviceOf: p => adviceByPlayer.get(p) || null
    });
    // nobody under contract this season (no contract dates at all, or all long expired): bars of zero would look like data
    return plan.seasons.length && plan.seasons[0].committedCount > 0 ? plan : null;
  }
  const noMoney = a => a === 'sell' || a === 'sell-now' || a === 'let-go'; // no renewal wage is quoted for a player who leaves

  // Card for the chart grid: the weekly wage bill over the coming seasons, with planned renewals included.
  function planCardHtml(env) {
    const plan = computePlan(env);
    if (!plan) return '';
    const bars = env.barsHtml(plan.seasons.map(s => ({
      label: s.label, value: s.withRenewals, text: `${env.wageShort(s.withRenewals)}/wk`,
      sub: s.endYear === plan.seasonEndYear ? 'current' : `${env.wageShort(s.committedWage)} + ${env.wageShort(s.renewedWage)}`,
      color: s.endYear === plan.seasonEndYear ? 'var(--accent-color)' : '#58a6ff'
    })));
    return `<div class="profile-card"><h3>Projected wage bill</h3>${bars}
      <div style="font-size: 11px; color: var(--text-dim); margin-top: 6px;">The two figures after each bar are wages already signed + planned renewals (the players marked Renew / Renew (1 yr) below). Players marked Sell, Let go or Review are assumed to leave. No signings are included.${plan.unknown.length ? ` ${plan.unknown.length} player${plan.unknown.length === 1 ? ' has' : 's have'} no contract date and ${plan.unknown.length === 1 ? 'is' : 'are'} left out.` : ''}</div></div>`;
  }

  // Full-width card: one recommended action per expiring contract (this season and next).
  function planTableHtml(env) {
    const plan = computePlan(env);
    if (!plan) return '';
    const table = plan.renewals.length ? `<div class="planning-wrap"><table class="sub-table planning-table"><thead><tr><th>Player</th><th>Ends</th><th>Wage</th><th>Action</th><th>Why</th></tr></thead><tbody>
      ${plan.renewals.map(r => `<tr><td>${nameLink(r.player)}${subLine([env.posLabel(r.player), ageText(r.age), `OVR ${r.player.overall || '?'}`])}</td>
        <td>${esc(r.expiry)}${r.yearsLeft <= 0 ? '<div style="font-size: 11px; color: #f85149; white-space: nowrap;">this summer</div>' : ''}</td>
        <td>${esc(env.wageFmt(r.wage))}${noMoney(r.action) ? subLine(['no renewal']) : `<div style="font-size: 11px; white-space: nowrap; color: ${r.raise > 0 ? '#d29922' : 'var(--text-dim)'};">${r.raise > 0 ? `→ ${esc(env.wageFmt(r.renewalWage))} (+${esc(env.wageFmt(r.raise))})` : 'renews at the same wage'}</div>`}</td>
        <td>${badge(ACTIONS[r.action] || ACTIONS.review)}</td><td>${reasonsHtml(r.reasons)}</td></tr>`).join('')}</tbody></table></div>`
      : empty('Nobody\'s contract runs out in the planning window (this season and next).');
    return `<div class="profile-card" style="margin-top: 16px;"><h3>Contract decisions</h3>${table}
      ${note('Renewal wages are estimates: the pay this squad\'s own wage curve gives that overall, never below his current wage. Only the contract end year is stored (no start date or length), so a deal listed as ending in 2028 runs through the 2027/28 season. Players on loan elsewhere are not counted. Under each name: position · age · OVR.')}</div>`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Player profile card: this player's verdict, progression and contract action in one place
  // ---------------------------------------------------------------------------------------------------------

  // seasons: the profile's per-season rows ({ year_label, overall, potential }), oldest -> newest. '' for anyone who is
  // not a senior squad player (loaned out, former, academy): there is nothing to advise about.
  function profileCardHtml(env, player, seasons) {
    if (!player) return '';
    const row = computeAdvice(env).find(r => String(r.player.player_id) === String(player.player_id));
    if (!row) return '';
    const p = row.player;
    const hist = (seasons || []).filter(x => x && x.year_label).map(x => ({ season: x.year_label, overall: x.overall, potential: x.potential }));
    // the stored row for the current season is refreshed with the live value instead of being counted twice
    const cur = root.Charts ? hist.find(h => root.Charts.seasonEndYear(h.season) === env.seasonEndYear) : null;
    const tr = root.Progression ? root.Progression.trajectory(Object.assign({}, p, { __seasonLabel: cur ? cur.season : null }), hist, env.ageOf(p)) : null;
    const plan = computePlan(env);
    const dec = plan && plan.renewals.find(r => String(r.player.player_id) === String(p.player_id));

    const item = (label, value) => `<div class="attr-item"><span>${esc(label)}:</span> <strong>${value}</strong></div>`;
    const items = [
      item('Verdict', badge(VERDICTS[row.verdict]) + (row.blocked ? ' <span style="font-size: 11px; color: #d29922;">blocked</span>' : '')),
      item('Play time', playTimeText(row.playTime))
    ];
    if (tr) items.push(item('Progression', badge(STATUSES[tr.status])));
    if (dec) items.push(item('Contract', badge(ACTIONS[dec.action] || ACTIONS.review) + (noMoney(dec.action) ? '' : ` <span style="font-weight: 400; color: var(--text-dim); font-size: 12px;">est. ${esc(env.wageFmt(dec.renewalWage))} / wk</span>`)));
    // a recommended sale already explains the expiring contract; the Contract badge carries the action
    const reasons = row.reasons.concat(tr ? tr.reasons.slice(0, 2) : [], dec && row.verdict !== 'sell' ? dec.reasons : []);
    return `<div class="profile-card">
      <h3 style="display: flex; align-items: center; justify-content: space-between; gap: 8px;"><span>Planning</span>
        <button class="home-toggle-btn" onclick="Insights.open('advice')">Roster Moves →</button></h3>
      <div class="attr-list">${items.join('')}</div>
      <div style="margin-top: 10px;">${reasonsHtml(reasons)}</div>
      <div style="font-size: 11px; color: var(--text-dim); margin-top: 8px;">Rule-of-thumb advice from this squad's own numbers, not a prediction.</div></div>`;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Home: "Roster Moves" card and the action pills on the Contracts card
  // ---------------------------------------------------------------------------------------------------------

  const HOME_MOVES = 5;

  // The most actionable moves (sells first, then loans, then the watch list), counts, and the first reason for each.
  function homeMovesHtml(env) {
    if (!env.players.length) return '<div style="color: var(--text-dim); font-size: 13px;">No squad loaded.</div>';
    const rows = computeAdvice(env);
    const moves = rows.filter(r => r.verdict === 'sell' || r.verdict === 'loan');
    const watch = rows.filter(r => r.verdict === 'monitor').length;
    const n = v => rows.filter(r => r.verdict === v).length;
    const plan = computePlan(env);
    const ending = plan ? plan.renewals.filter(r => r.yearsLeft <= 0).length : 0;
    const summary = `<div style="font-size: 13px; margin-bottom: 8px;"><strong>${n('sell')}</strong> to sell · <strong>${n('loan')}</strong> to loan out${watch ? ` · <span style="color: var(--text-dim);">${watch} to watch</span>` : ''}</div>`;
    if (!moves.length) {
      return `${summary}<div style="color: var(--text-dim); font-size: 13px;">No sales or loans recommended right now.</div>${ending ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 8px;">${ending} contract${ending === 1 ? '' : 's'} end this summer: see Wages &amp; Contracts.</div>` : ''}`;
    }
    const sorted = moves.slice().sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'sell' ? -1 : 1) || b.weight - a.weight);
    const shown = sorted.slice(0, HOME_MOVES);
    return `${env.transferBan ? '<div style="font-size: 12px; color: #d29922; margin-bottom: 6px;">Transfer ban active: these are on hold.</div>' : ''}${summary}
      <ul class="injury-report-list home-list-full">${shown.map(r => `<li class="clickable-name" onclick="openPlayerProfile('${esc(r.player.player_id)}')"><span>${esc(r.player.name)}</span>
        <span class="injury-report-meta">${esc(env.posLabel(r.player))} · ${esc(r.player.overall || '?')} OVR · ${badge(VERDICTS[r.verdict])}</span>
        <span class="injury-report-meta" style="color: var(--text-dim);">${esc(r.reasons[0])}</span></li>`).join('')}</ul>
      ${sorted.length > shown.length ? `<div style="font-size: 12px; color: var(--text-dim);">+${sorted.length - shown.length} more</div>` : ''}
      ${ending ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 8px;">${ending} contract${ending === 1 ? '' : 's'} end this summer: see Wages &amp; Contracts.</div>` : ''}`;
  }

  // player_id (string) -> pill HTML for each player with a contract decision; Map() when there is no plan.
  function homeActionsFor(env) {
    const plan = computePlan(env);
    return new Map(plan ? plan.renewals.map(r => [String(r.player.player_id), badge(ACTIONS[r.action] || ACTIONS.review)]) : []);
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
    })
  };
  if (root.Insights) {
    Object.keys(views).forEach(k => root.Insights.addView(k, views[k]));
    root.Insights.addWagesSection('cards', () => planCardHtml(liveEnv()));
    root.Insights.addWagesSection('table', () => planTableHtml(liveEnv()));
  }

  function renderHomeWidget() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('home-roster-moves-body');
    if (!el) return;
    try { el.innerHTML = homeMovesHtml(liveEnv()); }
    catch (e) { console.error('Home roster moves:', e); el.innerHTML = '<div style="color: var(--text-dim); font-size: 13px;">Could not draw this card.</div>'; }
  }

  // The live card for app.js's player profile. Never throws: a profile must open even if this card cannot be drawn.
  function profileHtml(player, seasons) {
    try { return player && player.__clubStatus === 'normal' ? profileCardHtml(liveEnv(), player, seasons) : ''; }
    catch (e) { console.error('Insights profile card:', e); return ''; }
  }

  const api = {
    homeMovesHtml, homeActionsFor, homeActions: () => homeActionsFor(liveEnv()), renderHomeWidget,
    profileCardHtml, profileHtml,
    adviceHtml, progressHtml, planCardHtml, planTableHtml, computePlan, computeAdvice, seasonEndYearNow,
    setAdviceFilter(v) { adviceFilter = VERDICTS[v] ? v : 'all'; if (root.Insights) root.Insights.render(); },
    invalidate() { cache = null; }
  };
  root.InsightsPlanning = api;
  // app.js and squad_analytics.js draw the Home cards before this file loads, so fill them (and the Contracts pills) once here.
  if (typeof document !== 'undefined') { renderHomeWidget(); if (root.Insights && root.Insights.renderHomeWidget) root.Insights.renderHomeWidget(); }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
