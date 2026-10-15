// Progression tracker: who is growing, stalling or declining compared with what their age normally allows.
//
// Pure logic, no DOM and no app.js globals, so scripts/test_progression.js can run it on plain arrays. It takes the
// per-player season history the app already stores (getPlayerHistory in main.js: { seasonOrder, season, overall,
// potential } per synced season) plus the live squad rows (overall, potential, overall_delta = change so far this
// season), and answers three questions per player:
//   - how much have they changed (this season so far, or in any earlier stored season, and in total since we first saw them)?
//   - is that more or less than a typical player of that age gains or loses (EXPECTED_GROWTH below)?
//   - if they are young with room to grow, when might they reach their potential?
// EXPECTED_GROWTH is a rule of thumb for the typical yearly overall change by age, not EA's real curve; every row
// reports `vsExpected` so the UI can show the raw numbers and not only the label.
(function (root) {
  'use strict';

  // typical yearly overall change by age (ages below the first / above the last use the nearest entry)
  const EXPECTED_GROWTH = { 16: 5, 17: 4.5, 18: 4, 19: 3.5, 20: 3, 21: 2.5, 22: 2, 23: 1.5, 24: 1, 25: 0.5, 26: 0, 27: 0, 28: -0.3, 29: -0.7, 30: -1, 31: -1.5, 32: -2, 33: -2.5 };
  const MIN_AGE = 16, MAX_AGE = 33;
  const expectedGrowth = age => EXPECTED_GROWTH[Math.max(MIN_AGE, Math.min(MAX_AGE, Math.round(age)))];

  const T = {
    risingBy: 1.5,        // this far above the age norm = rising
    decliningBy: 2,       // this far below the age norm = declining
    stallingBy: 1.5,      // a young player this far below the norm (with room to grow) = stalling
    stallingMaxAge: 23,
    minGrowthGap: 5,      // potential - overall that counts as "room to grow"
    maxedMaxAge: 25       // reached potential at or under this age is worth a note (older players are simply at their level)
  };

  const num = v => (v == null || v === '' ? NaN : Number(v));

  // One point per season in order, ending with the live row. getPlayerHistory (main.js) returns rows oldest -> newest
  // WITHOUT a season id, only the label ("2026/27"), so seasons are keyed by label (or by seasonOrder when a caller
  // has it) and kept in the order given. A later row for the same season replaces the earlier one.
  function series(history, player) {
    const pts = [], at = new Map();
    (history || []).forEach((h, i) => {
      const o = num(h.overall);
      if (!(Number.isFinite(o) && o > 0)) return;
      const key = h.seasonOrder != null ? 'o:' + h.seasonOrder : h.season != null ? 'l:' + h.season : 'i:' + i;
      const pt = { key, order: h.seasonOrder != null ? h.seasonOrder : null, label: h.season, overall: o, potential: num(h.potential) || null };
      if (at.has(key)) pts[at.get(key)] = pt; else { at.set(key, pts.length); pts.push(pt); }
    });
    if (pts.length && pts.every(pt => pt.order != null)) pts.sort((a, b) => a.order - b.order);
    const live = num(player.overall);
    if (Number.isFinite(live) && live > 0) {
      const last = pts[pts.length - 1];
      // the current season's row is usually already in `history`; refresh it with the live value rather than add a twin
      const isCurrent = last && ((player.__seasonLabel != null && last.label === player.__seasonLabel) || (player.__seasonOrder != null && last.order === player.__seasonOrder));
      if (isCurrent) { last.overall = live; last.potential = num(player.potential) || last.potential; }
      else pts.push({ key: 'now', order: null, label: 'Now', overall: live, potential: num(player.potential) || null });
    }
    return pts;
  }

  // Years until a young player reaches their potential if they follow the age curve (null if they never would).
  function curveYearsToPotential(age, overall, potential, maxYears) {
    let o = overall;
    for (let y = 1; y <= (maxYears || 8); y++) {
      o += Math.max(0, expectedGrowth(age + y - 1));
      if (o >= potential) return y;
    }
    return null;
  }

  // trajectory(player, history, age) -> one row. `age` may be null: the row is then 'unknown' and says why.
  // opts.back: judge the change in the season `back` seasons before the current one (0 = the current season so far, the
  // default). A past season is judged on what the player was THEN (his overall, potential and age at that time).
  function trajectory(player, history, age, opts) {
    const back = Math.max(0, Math.floor(Number(opts && opts.back) || 0));
    const all = series(history, player);
    const pts = all.slice(0, Math.max(0, all.length - back)); // the story up to and including the season being judged
    const here = pts[pts.length - 1] || {};
    if (age != null && Number.isFinite(age)) age = age - back; // how old he was in that season
    const overall = back ? (here.overall || 0) : (num(player.overall) || 0), potential = back ? (here.potential || 0) : (num(player.potential) || 0);
    const gap = potential > 0 ? Math.max(0, potential - overall) : 0;
    const inSeason = back ? NaN : num(player.overall_delta);
    const row = { player, age, series: pts, overall, potential, gap, inSeason: Number.isFinite(inSeason) ? inSeason : 0, back,
      basis: back ? (here.label || 'that season') : 'this season',
      sinceLast: null, total: null, change: null, source: null, expected: null, vsExpected: null, ageThen: null,
      status: 'unknown', yearsToPotential: null, curveYears: null, reasons: [] };

    if (pts.length >= 2) {
      row.sinceLast = pts[pts.length - 1].overall - pts[pts.length - 2].overall;
      row.total = pts[pts.length - 1].overall - pts[0].overall;
      row.change = row.sinceLast; row.source = 'seasons';
    } else if (Number.isFinite(inSeason)) {
      row.change = inSeason; row.source = 'in-season';   // first season we have: all we know is the change since the first sync
    }

    if (age == null || !Number.isFinite(age)) { row.reasons.push('No date of birth, so there is no age norm to compare with'); return row; }
    if (row.change == null) { row.reasons.push('Not enough history yet'); return row; }
    // a first sync reports 0 for everyone, which says nothing about whether he is flat
    if (row.source === 'in-season' && row.change === 0) { row.reasons.push('No movement recorded yet (only one season synced)'); return row; }

    // compare like with like: a season's change is judged against the norm for the age they were at the start of it
    const ageThen = row.source === 'seasons' ? age - 1 : age;
    row.ageThen = ageThen; // the age the change happened at, which is what the norm is looked up by
    row.expected = expectedGrowth(ageThen);
    row.vsExpected = row.change - row.expected;
    // The in-season fallback is part of a season and is 0 for everyone right after a first sync, so it may flag a real
    // rise or drop but never 'stalling', and a flat reading never counts as rising.
    const sign = n => (n > 0 ? '+' : '') + n;
    // the current season's change is measured from the last stored season-end value, so it is the season so far
    const basis = back ? `in ${row.basis}` : 'so far this season';
    const norm = `typical for ${Math.round(ageThen)} is ${sign(row.expected)}`;

    if (row.vsExpected <= -T.decliningBy && row.change < 0) { // flat is not a decline: a stalled teenager is judged below
      row.status = 'declining';
      row.reasons.push(`${sign(row.change)} OVR ${basis} (${norm})`);
    } else if (row.source === 'seasons' && age <= T.stallingMaxAge && gap >= T.minGrowthGap && row.vsExpected <= -T.stallingBy) {
      row.status = 'stalling';
      row.reasons.push(`${sign(row.change)} OVR ${basis} (${norm}) with ${gap} points of potential left`);
    } else if (gap === 0 && age <= T.maxedMaxAge && potential > 0) {
      row.status = 'maxed';
      row.reasons.push(`Already at his potential (${potential}) at ${Math.round(age)}`);
    } else if (row.vsExpected >= T.risingBy && row.change > 0) {
      row.status = 'rising';
      row.reasons.push(`${sign(row.change)} OVR ${basis} (${norm})`);
    } else {
      row.status = 'on-track';
      row.reasons.push(`${sign(row.change)} OVR ${basis}, about what is expected (${norm})`);
    }

    if (!back && gap > 0 && age <= T.stallingMaxAge + 2) { // the pace-to-potential outlook only makes sense for the current season
      row.curveYears = curveYearsToPotential(age, overall, potential);
      if (row.change > 0) row.yearsToPotential = Math.ceil(gap / row.change);
      if (row.yearsToPotential != null) row.reasons.push(`At this pace he reaches POT ${potential} in about ${row.yearsToPotential} season${row.yearsToPotential > 1 ? 's' : ''}`);
      else if (row.curveYears != null) row.reasons.push(`A typical player his age would take about ${row.curveYears} season${row.curveYears > 1 ? 's' : ''} to reach POT ${potential}`);
      else row.reasons.push(`POT ${potential} is out of reach on a typical curve`);
    }
    if (row.total != null && pts.length >= 3) row.reasons.push(`${sign(row.total)} OVR over ${pts.length} seasons`);
    return row;
  }

  // the live row marked with the current season, so it replaces its own history entry instead of doubling it
  const withSeason = (p, opts) => (opts.seasonLabel != null || opts.seasonOrder != null
    ? Object.assign({}, p, { __seasonLabel: opts.seasonLabel, __seasonOrder: opts.seasonOrder }) : p);

  // The seasons the squad has a change for, newest first: [{ back, label, current }]. A season needs a previous one to
  // compare with, so the oldest stored season is never offered. Uses the longest history in the squad.
  function seasonOptions(players, histories, opts) {
    opts = opts || {};
    const get = id => (histories instanceof Map ? histories.get(id) : histories && histories[id]) || [];
    let best = [];
    (players || []).forEach(p => { const pts = series(get(p.player_id), withSeason(p, opts)); if (pts.length > best.length) best = pts; });
    const out = [];
    for (let b = 0; b <= best.length - 2; b++) {
      const pt = best[best.length - 1 - b];
      out.push({ back: b, current: b === 0, label: b === 0 && (!pt.label || pt.label === 'Now') ? (opts.seasonLabel || 'This season') : pt.label });
    }
    return out;
  }

  // board(players, histories, opts) -> { rows, risers, fallers, stalling, maxed }
  //   players    live squad rows (player_id, name, overall, potential, overall_delta)
  //   histories  Map or object: player_id -> getPlayerHistory rows
  //   opts.ageOf(p) -> number | null (required for any label), opts.isAway(p), opts.limit (per list, default 5),
  //   opts.back: judge the season this many seasons before the current one (default 0, the current season so far),
  //   opts.seasonLabel / opts.seasonOrder  the current season's label ("2026/27") or id, so the live row replaces its own
  //                     history entry instead of doubling it (getPlayerHistory rows carry the label, not the id)
  function board(players, histories, opts) {
    opts = opts || {};
    const get = id => (histories instanceof Map ? histories.get(id) : histories && histories[id]) || [];
    const limit = opts.limit || 5;
    const rows = (players || []).filter(p => !(opts.isAway && opts.isAway(p))).map(p => {
      const r = trajectory(withSeason(p, opts), get(p.player_id), opts.ageOf ? opts.ageOf(p) : null, { back: opts.back });
      r.player = p;
      return r;
    });
    const by = (status, cmp) => rows.filter(r => r.status === status).sort(cmp).slice(0, limit);
    return {
      rows,
      risers: by('rising', (a, b) => b.vsExpected - a.vsExpected || b.overall - a.overall),
      fallers: by('declining', (a, b) => a.vsExpected - b.vsExpected || b.overall - a.overall),
      stalling: by('stalling', (a, b) => b.gap - a.gap || a.vsExpected - b.vsExpected),
      maxed: by('maxed', (a, b) => b.overall - a.overall)
    };
  }

  const api = { trajectory, board, seasonOptions, series, expectedGrowth, curveYearsToPotential, EXPECTED_GROWTH, THRESHOLDS: T };
  root.Progression = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
