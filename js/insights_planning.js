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
  // accent: optional colour for a left edge, so a row of tiles can double as a colour key for a chart
  const tile = (label, value, sub, onclick, active, accent) => `<div class="profile-card" style="margin: 0; padding: 12px 14px;${accent ? ` border-left: 3px solid ${accent};` : ''}${onclick ? ' cursor: pointer;' : ''}${active ? ' outline: 2px solid var(--accent-color);' : ''}"${onclick ? ` onclick="${onclick}"` : ''}>
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

  const STATUS_ORDER = ['rising', 'stalling', 'declining', 'maxed', 'on-track', 'unknown'];
  const ATTENTION = ['rising', 'stalling', 'declining'];
  const PROGRESS_FILTERS = ['attention', 'all'].concat(STATUS_ORDER);

  // A compact arrow for the direction of a player's overall (the colour says how that compares with their age).
  function trendArrow(change, color) {
    const n = Number(change);
    if (change == null || !Number.isFinite(n)) return '<span style="color: var(--text-dim);">–</span>';
    const glyph = n >= 3 ? '↑' : n >= 1 ? '↗' : n <= -3 ? '↓' : n <= -1 ? '↘' : '→';
    return `<span style="font-size: 20px; font-weight: 700; line-height: 1; color: ${color};" title="${esc(sign(n))} OVR">${glyph}</span>`;
  }
  // "64 → 71": a player's overall season by season, as text; '' with fewer than two seasons.
  function pathText(series) {
    const v = (series || []).map(p => Number(p.overall)).filter(Number.isFinite);
    return v.length >= 2 ? v.join(' → ') : '';
  }

  const clickName = p => `<span class="clickable-name" style="color: #58a6ff;" onclick="event.stopPropagation(); openPlayerProfile('${esc(p.player_id)}')">${esc(p.name)}</span>`;
  const round1 = n => Math.round(n * 10) / 10;

  // The chart: one bar per player, from a centre line. Right = ahead of what is typical for their age, left = behind, length
  // = how far (capped so one outlier cannot flatten everyone else), best at the top. On-track players are short grey ticks,
  // so the whole squad can be shown without the quiet ones competing for attention. Click a row for the reasoning.
  //   rows: Progression.board rows; f: status key or anything else for everyone; open: Set of player ids
  function progressChartHtml(env, rows, f, open) {
    const known = rows.filter(r => r.vsExpected != null && Number.isFinite(r.vsExpected));
    const missing = rows.length - known.length;
    const pick = STATUS_ORDER.includes(f) ? known.filter(r => r.status === f) : known;
    if (!pick.length) return empty(`Nobody is "${esc(STATUSES[f] ? STATUSES[f].label : f)}" right now.`);
    const sorted = pick.slice().sort((a, b) => b.vsExpected - a.vsExpected || b.overall - a.overall);
    const maxAbs = Math.max(4, Math.min(8, Math.ceil(Math.max(...known.map(r => Math.abs(r.vsExpected))))));
    const cols = 'grid-template-columns: minmax(140px, 230px) 1fr 52px;';
    const head = `<div style="display: grid; ${cols} gap: 10px; font-size: 11px; color: var(--text-dim); padding: 0 6px 6px;"><span></span>
      <div style="display: flex; justify-content: space-between;"><span>◀ behind for their age</span><span>as expected</span><span>ahead for their age ▶</span></div><span style="text-align: right;">vs typical</span></div>`;
    const rowsHtml = sorted.map(r => {
      const v = r.vsExpected, color = STATUSES[r.status].color;
      const pct = Math.min(Math.abs(v), maxAbs) / maxAbs * 50;
      const side = v >= 0 ? `left: 50%;` : `right: 50%;`;
      const id = esc(r.player.player_id), isOpen = open.has(String(r.player.player_id));
      const detail = isOpen ? `<div style="margin: 0 6px 8px; padding: 8px 12px; background: var(--hover-color); border-radius: 6px; display: flex; gap: 18px; align-items: center; flex-wrap: wrap;">
          <div>${trendArrow(r.change, color)}</div><div>${badge(STATUSES[r.status])}</div>${pathText(r.series) ? `<div style="font-size: 12px; color: var(--text-dim); white-space: nowrap;">${esc(pathText(r.series))} OVR</div>` : ''}<div style="flex: 1; min-width: 220px;">${reasonsHtml(r.reasons)}</div></div>` : '';
      return `<div class="pl-chart-row" onclick="InsightsPlanning.toggleProgress('${id}')" title="${esc(sign(r.change == null ? 0 : r.change))} OVR ${r.back ? `in ${esc(r.basis)}` : 'so far this season'}, typical ${esc(sign(r.expected))}. Click for the reasoning."
          style="display: grid; ${cols} gap: 10px; align-items: center; padding: 5px 6px; border-radius: 6px; cursor: pointer;">
        <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${clickName(r.player)} <span style="font-size: 11px; color: var(--text-dim);">${esc([env.posLabel(r.player), ageText(r.age)].filter(x => x != null && x !== '').join(' · '))}</span></div>
        <div style="position: relative; height: 16px;"><div style="position: absolute; left: 50%; top: -6px; bottom: -6px; width: 1px; background: var(--border-color);"></div>
          <div style="position: absolute; top: 2px; height: 12px; ${side} width: ${pct.toFixed(1)}%; min-width: 3px; border-radius: 3px; background: ${color};"></div></div>
        <div style="text-align: right; font-weight: 600; color: ${color};">${sign(round1(v))}</div></div>${detail}`;
    }).join('');
    return `${head}${rowsHtml}${missing ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 8px;">${missing} player${missing === 1 ? ' has' : 's have'} no history yet and ${missing === 1 ? 'is' : 'are'} not shown.</div>` : ''}`;
  }

  // Progression: by default only the players who need attention (rising, stalling or declining for their age), each with
  // a trend line and one number; the reasoning opens on a click. "Everyone" and the tiles are filters over the same rows.
  //   env.progressFilter: 'attention' (default) | 'all' | a status key;  env.progressOpen: Set of player ids with reasons open
  function progressHtml(env) {
    if (!env.players.length) return empty('No squad loaded.');
    if (!root.Progression) return empty('Progression logic is not available.');
    const seasons = env.progressSeasons || [];
    const back = seasons.some(o => o.back === env.progressBack) ? env.progressBack : 0;   // an unknown choice means the current season
    const rows = root.Progression.board(env.players, env.histories || new Map(), { ageOf: env.ageOf, seasonLabel: env.seasonLabel, seasonOrder: env.seasonOrder, back }).rows;
    if (!rows.some(r => r.status !== 'unknown')) {
      return empty('Not enough history yet. Each F10 sync stores a snapshot, so rises and falls appear after your second season or once ratings start moving.');
    }
    const count = s => rows.filter(r => r.status === s).length;
    const f = PROGRESS_FILTERS.includes(env.progressFilter) ? env.progressFilter : 'attention';
    const open = env.progressOpen || new Set();
    const attention = rows.filter(r => ATTENTION.includes(r.status));
    const pick = f === 'attention' ? attention : f === 'all' ? rows : rows.filter(r => r.status === f);
    const rank = r => STATUS_ORDER.indexOf(r.status);
    const shown = pick.slice().sort((a, b) => rank(a) - rank(b) || Math.abs(b.vsExpected || 0) - Math.abs(a.vsExpected || 0) || b.overall - a.overall);

    const hint = { rising: 'ahead of their age', stalling: 'young, not growing', declining: 'falling for their age', maxed: 'at their ceiling' };
    const tileFor = s => tile(STATUSES[s].label, count(s), hint[s], `InsightsPlanning.setProgressFilter('${f === s ? 'attention' : s}')`, f === s, STATUSES[s].color);
    const toggle = (key, label, n) => `<button class="home-toggle-btn${f === key ? ' active' : ''}" onclick="InsightsPlanning.setProgressFilter('${key}')">${label} <span style="opacity: 0.7;">${n}</span></button>`;

    let body = '';
    let lastStatus = null;
    shown.forEach(r => {
      if (r.status !== lastStatus) {
        lastStatus = r.status;
        body += `<tr><td colspan="4" style="background: var(--hover-color); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: ${STATUSES[r.status].color};">${esc(STATUSES[r.status].label)} <span style="opacity: 0.7;">· ${shown.filter(x => x.status === r.status).length}</span></td></tr>`;
      }
      const id = esc(r.player.player_id), isOpen = open.has(String(r.player.player_id));
      body += `<tr class="player-row${isOpen ? ' expanded' : ''}">
        <td><span class="expand-icon" style="font-size: 14px; padding: 0 6px 0 0;" title="Show the reasoning" onclick="InsightsPlanning.toggleProgress('${id}')">▶</span>${nameLink(r.player)}${subLine([env.posLabel(r.player), ageText(r.age), `${r.overall}/${r.potential || '?'}`])}</td>
        <td>${trendArrow(r.change, STATUSES[r.status].color)}</td>
        <td><strong style="font-size: 16px; color: ${r.change > 0 ? '#3fb950' : r.change < 0 ? '#f85149' : 'inherit'};">${r.change == null ? '–' : sign(r.change)}</strong>${subLine([r.basis, r.expected == null ? null : `typical ${sign(r.expected)}`])}</td>
        <td>${badge(STATUSES[r.status])}</td></tr>`;
      if (isOpen) body += `<tr class="detail-row open"><td colspan="4"><div class="detail-wrapper">${reasonsHtml(r.reasons)}</div></td></tr>`;
    });

    const rest = rows.length - attention.length;
    const table = shown.length
      ? `<div class="planning-wrap"><table class="sub-table planning-table"><thead><tr><th>Player</th><th>Trend</th><th>Change</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></div>`
      : empty(f === 'attention' ? 'Everyone is moving about as expected for their age.' : `Nobody is "${esc(STATUSES[f] ? STATUSES[f].label : f)}" right now.`);
    const mode = env.progressMode === 'list' ? 'list' : 'chart';
    const modeBtn = (m, label) => `<button class="home-toggle-btn${mode === m ? ' active' : ''}" onclick="InsightsPlanning.setProgressMode('${m}')">${label}</button>`;
    const picker = seasons.length > 1 ? `<label style="font-size: 13px; color: var(--text-dim);">Season <select onchange="InsightsPlanning.setProgressSeason(this.value)" style="background: var(--card-bg); color: var(--text-color); border: 1px solid var(--border-color); border-radius: 6px; padding: 5px 8px; margin-left: 4px;">${seasons.map(o => `<option value="${o.back}"${o.back === back ? ' selected' : ''}>${esc(o.label)}${o.current ? ' (so far)' : ''}</option>`).join('')}</select></label>` : '';
    const controls = `<div style="display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;"><div class="home-toggle">${modeBtn('chart', 'Chart')}${modeBtn('list', 'List')}</div>${picker}${mode === 'list' ? `<div class="home-toggle">${toggle('attention', 'Needs attention', attention.length)}${toggle('all', 'Everyone', rows.length)}</div>` : ''}</div>`;
    const tileRow = tiles(['rising', 'stalling', 'declining', 'maxed'].map(tileFor).join(''));
    if (mode === 'chart') {
      return `${tileRow}${controls}<div class="profile-card">${progressChartHtml(env, rows, f, open)}</div>
      ${note(`Each bar is the change ${back ? `in ${esc((seasons.find(o => o.back === back) || {}).label || 'that season')}` : 'so far this season'} compared with what is typical for that age (a rule of thumb, not EA\'s curve). Click a row for the reasoning, a tile to focus on one group.${seasons.length > 1 ? ' Use Season to look at an earlier year.' : ''}`)}`;
    }
    return `${tileRow}${controls}
      <div class="profile-card">${table}
        ${f === 'attention' && rest ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 10px;">${rest} more ${rest === 1 ? 'is' : 'are'} on track, at their ceiling or have no history yet. <button class="home-toggle-btn" style="font-size: 12px; padding: 2px 10px; margin-left: 6px;" onclick="InsightsPlanning.setProgressFilter('all')">Show everyone</button></div>` : ''}</div>
      ${note('Compared with a typical yearly change for that age (a rule of thumb, not EA\'s curve), not in absolute terms. Click ▶ for the numbers behind a label. A first sync reports no movement, so those players show as unknown.')}`;
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

  const HOME_MOVES = 5, HOME_PROMOS = 3;

  // The most actionable moves (sells first, then loans), counts, and the first reason for each, then the academy
  // prospects who are ready for the first team (env.promotions: [{ player, ready }], optional).
  function homeMovesHtml(env) {
    if (!env.players.length) return '<div style="color: var(--text-dim); font-size: 13px;">No squad loaded.</div>';
    const rows = computeAdvice(env);
    const moves = rows.filter(r => r.verdict === 'sell' || r.verdict === 'loan');
    const promos = env.promotions || [];
    const watch = rows.filter(r => r.verdict === 'monitor').length;
    const n = v => rows.filter(r => r.verdict === v).length;
    const plan = computePlan(env);
    const ending = plan ? plan.renewals.filter(r => r.yearsLeft <= 0).length : 0;
    const endingLine = ending ? `<div style="font-size: 12px; color: var(--text-dim); margin-top: 8px;">${ending} contract${ending === 1 ? '' : 's'} end this summer: see Wages &amp; Contracts.</div>` : '';
    const summary = `<div style="font-size: 13px; margin-bottom: 8px;"><strong>${n('sell')}</strong> to sell · <strong>${n('loan')}</strong> to loan out${watch ? ` · <span style="color: var(--text-dim);">${watch} to watch</span>` : ''}${promos.length ? ` · <strong style="color: #3fb950;">${promos.length}</strong> <span style="color: #3fb950;">ready for promotion</span>` : ''}</div>`;
    if (!moves.length && !promos.length) {
      return `${summary}<div style="color: var(--text-dim); font-size: 13px;">No sales or loans recommended right now.</div>${endingLine}`;
    }
    const sorted = moves.slice().sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'sell' ? -1 : 1) || b.weight - a.weight);
    const shown = sorted.slice(0, HOME_MOVES);
    const movesHtml = moves.length ? `<ul class="injury-report-list home-list-full">${shown.map(r => `<li class="clickable-name" onclick="openPlayerProfile('${esc(r.player.player_id)}')"><span>${esc(r.player.name)}</span>
        <span class="injury-report-meta">${esc(env.posLabel(r.player))} · ${esc(r.player.overall || '?')} OVR · ${badge(VERDICTS[r.verdict])}</span>
        <span class="injury-report-meta" style="color: var(--text-dim);">${esc(r.reasons[0])}</span></li>`).join('')}</ul>
      ${sorted.length > shown.length ? `<div style="font-size: 12px; color: var(--text-dim);">+${sorted.length - shown.length} more</div>` : ''}`
      : '<div style="color: var(--text-dim); font-size: 13px;">No sales or loans recommended right now.</div>';
    const promoShown = promos.slice(0, HOME_PROMOS);
    const promoHtml = promos.length ? `<div style="font-size: 11px; text-transform: uppercase; color: var(--text-dim); margin: 14px 0 6px; display: flex; justify-content: space-between; align-items: center;">
        <span>Ready for promotion</span><button class="home-toggle-btn" style="font-size: 12px; padding: 2px 10px; text-transform: none;" onclick="switchTab('squad'); SquadViews.setView('academy')">Academy →</button></div>
      <ul class="injury-report-list home-list-full">${promoShown.map(x => `<li class="clickable-name" onclick="openPlayerProfile('${esc(x.player.player_id)}')"><span>${esc(x.player.name)}</span>
        <span class="injury-report-meta">${esc(env.posLabel(x.player))} · ${esc(x.player.overall || '?')} OVR · <span class="at-ready rd-ready">${esc(x.ready.verdict)}</span></span>
        <span class="injury-report-meta" style="color: var(--text-dim);">${esc(x.ready.detail)}</span></li>`).join('')}</ul>
      ${promos.length > promoShown.length ? `<div style="font-size: 12px; color: var(--text-dim);">+${promos.length - promoShown.length} more</div>` : ''}` : '';
    return `${env.transferBan && moves.length ? '<div style="font-size: 12px; color: #d29922; margin-bottom: 6px;">Transfer ban active: sales and loans are on hold.</div>' : ''}${summary}${movesHtml}${promoHtml}${endingLine}`;
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
  let progressFilter = 'attention';
  let progressMode = 'chart'; // 'chart' | 'list'
  let progressBack = 0;       // 0 = the current season so far, 1 = the season before, ...
  const progressOpen = new Set();
  let cache = null;   // { saveId, seasonLabel, byId: Map(player_id -> history rows) } for Progression
  let loading = false;

  const squad = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
  const saveIdNow = () => (typeof currentSaveId !== 'undefined' ? currentSaveId : null);

  function seasonEndYearNow() {
    const raw = typeof currentIngameDate !== 'undefined' ? currentIngameDate : null;
    // Read yyyy-mm-dd straight off the string: new Date('2027-07-01') is UTC midnight, which is 30 June in the Americas.
    const iso = raw && /^(\d{4})-(\d{2})-\d{2}/.exec(String(raw));
    const d = iso ? new Date(+iso[1], +iso[2] - 1, 1) : (root.parseBirthDate && raw ? root.parseBirthDate(raw) : null) || new Date();
    return d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear(); // July-June seasons, as computeMonthsUntilExpiry assumes
  }

  const academyIds = () => new Set((typeof currentYouthAcademy !== 'undefined' ? currentYouthAcademy || [] : []).map(a => String(a.player_id)));
  // the academy features follow the same Pro gate as the Academy page
  const isAcademyLocked = () => { try { return !!(root.License && root.License.isPro && !root.License.isPro('academy-tracker')); } catch (e) { return false; } };

  function liveEnv() {
    const players = squad();
    const ban = typeof challengeStatus !== 'undefined' && challengeStatus && challengeStatus.ban && challengeStatus.ban.active;
    const SA = root.SquadAnalytics;
    const curve = SA && SA.fitWageCurve ? SA.fitWageCurve(players.filter(p => Number(p.wage) > 0)) : null;
    return {
      players, filter: adviceFilter, progressFilter, progressMode, progressOpen, progressBack,
      progressSeasons: cache && cache.saveId === saveIdNow() && root.Progression ? root.Progression.seasonOptions(players, cache.byId, { seasonLabel: cache.seasonLabel }) : [], transferBan: !!ban, seasonEndYear: seasonEndYearNow(),
      ageOf: p => { const a = root.computeAge ? root.computeAge(p.dob || p.birthdate) : null; return a == null ? null : a; },
      groupOf: p => root.getPositionInfo(p.position_id).group,
      posLabel: p => root.getPositionInfo(p.position_id).label,
      wageFmt: v => root.formatWageAmount(v),
      wageShort: v => `${root.currencySymbol()}${Math.round(root.convertFromEur(v) / 1000).toLocaleString()}K`,
      expectedWageOf: curve ? p => SA.expectedWage(curve, p.overall) : null,
      barsHtml: rows => (root.Charts ? root.Charts.barsHtml(rows) : ''),
      promotions: !isAcademyLocked() && root.AcademyTracker ? root.AcademyTracker.liveReady().filter(x => x.ready.key === 'ready').map(x => x) : [],
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

  // Profile card for an academy prospect: just the promotion verdict and its reason. '' when there is none.
  function promotionCardHtml(ready) {
    if (!ready) return '';
    return `<div class="profile-card">
      <h3 style="display: flex; align-items: center; justify-content: space-between; gap: 8px;"><span>Promotion</span>
        <button class="home-toggle-btn" onclick="switchTab('squad'); SquadViews.setView('academy')">Academy →</button></h3>
      <div class="attr-list"><div class="attr-item"><span>Verdict:</span> <strong><span class="at-ready rd-${esc(ready.key)}">${esc(ready.verdict)}</span></strong></div></div>
      <div style="margin-top: 10px;">${reasonsHtml([ready.detail])}</div>
      <div style="font-size: 11px; color: var(--text-dim); margin-top: 8px;">Compared with your weakest senior player at the same position (current ability only).</div></div>`;
  }

  // The live card for app.js's player profile. Never throws: a profile must open even if this card cannot be drawn.
  function profileHtml(player, seasons) {
    try {
      if (player && player.__clubStatus === 'normal') return profileCardHtml(liveEnv(), player, seasons);
      // an academy prospect (the profile is built from the live academy row, with no club status)
      if (player && root.AcademyTracker && isAcademyLocked() === false && academyIds().has(String(player.player_id))) return promotionCardHtml(root.AcademyTracker.readinessFor(player));
      return '';
    }
    catch (e) { console.error('Insights profile card:', e); return ''; }
  }

  const api = {
    homeMovesHtml, homeActionsFor, homeActions: () => homeActionsFor(liveEnv()), renderHomeWidget,
    profileCardHtml, profileHtml, promotionCardHtml,
    adviceHtml, progressHtml, planCardHtml, planTableHtml, computePlan, computeAdvice, seasonEndYearNow,
    setProgressFilter(v) { progressFilter = PROGRESS_FILTERS.includes(v) ? v : 'attention'; if (root.Insights) root.Insights.render(); },
    setProgressSeason(v) { progressBack = Math.max(0, Math.floor(Number(v)) || 0); progressOpen.clear(); if (root.Insights) root.Insights.render(); },
    setProgressMode(v) { progressMode = v === 'list' ? 'list' : 'chart'; if (root.Insights) root.Insights.render(); },
    toggleProgress(id) { const k = String(id); progressOpen.has(k) ? progressOpen.delete(k) : progressOpen.add(k); if (root.Insights) root.Insights.render(); },
    trendArrow, pathText, progressChartHtml,
    setAdviceFilter(v) { adviceFilter = VERDICTS[v] ? v : 'all'; if (root.Insights) root.Insights.render(); },
    invalidate() { cache = null; progressBack = 0; }
  };
  root.InsightsPlanning = api;
  // app.js and squad_analytics.js draw the Home cards before this file loads, so fill them (and the Contracts pills) once here.
  if (typeof document !== 'undefined') { renderHomeWidget(); if (root.Insights && root.Insights.renderHomeWidget) root.Insights.renderHomeWidget(); }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
