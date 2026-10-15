// node scripts/test_progression.js — logic checks for js/progression.js (age-adjusted growth labels, series, board).
const assert = require('assert');
const G = require('../js/progression.js');

const H = (order, overall, potential) => ({ seasonOrder: order, season: `${2020 + order}/${21 + order}`, overall, potential });
const P = (id, ovr, pot, delta) => ({ player_id: id, name: 'P' + id, overall: ovr, potential: pot, overall_delta: delta || 0 });

// --- age curve ------------------------------------------------------------------------------------------------
assert.strictEqual(G.expectedGrowth(19), 3.5);
assert.strictEqual(G.expectedGrowth(10), G.expectedGrowth(16), 'clamped below');
assert.strictEqual(G.expectedGrowth(40), G.expectedGrowth(33), 'clamped above');
assert.strictEqual(G.expectedGrowth(19.4), 3.5, 'rounds');

// --- series ---------------------------------------------------------------------------------------------------
{
  const s = G.series([H(2, 70), H(1, 66), H(2, 71)], { overall: 74, potential: 80 });
  assert.deepStrictEqual(s.map(x => x.overall), [66, 71, 74], 'sorted, duplicate season keeps the last, live value appended');
  const same = G.series([H(1, 66), H(2, 71)], { overall: 73, potential: 80, __seasonOrder: 2 });
  assert.deepStrictEqual(same.map(x => x.overall), [66, 73], 'live row replaces its own season instead of doubling it');
  assert.deepStrictEqual(G.series(undefined, { overall: 70 }).map(x => x.overall), [70]);
  assert.deepStrictEqual(G.series([H(1, 0), H(2, null)], { overall: 70 }).map(x => x.overall), [70], 'zero / missing overalls dropped');
}

// --- the real getPlayerHistory shape: labels only, no season id (main.js strips seasonOrder) ----------------------
{
  const row = (season, overall, potential) => ({ season, league_name: 'League', overall, potential, goals: 0, appearances: 10 });
  const hist = [row('2024/25', 60, 80), row('2025/26', 66, 80), row('2026/27', 69, 80)];
  const live = P(1, 71, 80, 2);
  // current season is already the last history row: the live value replaces it, never a twin point
  const s = G.series(hist, Object.assign({}, live, { __seasonLabel: '2026/27' }));
  assert.deepStrictEqual(s.map(x => x.overall), [60, 66, 71], 'three seasons stay three points, live value refreshes the current one');
  assert.deepStrictEqual(s.map(x => x.label), ['2024/25', '2025/26', '2026/27']);
  // without knowing the current label, the live value is appended as "Now" (history order is kept as given)
  assert.deepStrictEqual(G.series(hist, live).map(x => x.overall), [60, 66, 69, 71]);
  // duplicate labels keep one point, in place
  assert.deepStrictEqual(G.series([row('2024/25', 60), row('2025/26', 64), row('2025/26', 66)], { overall: 66 }).map(x => x.overall), [60, 66, 66]);

  const r = G.trajectory(Object.assign({}, live, { __seasonLabel: '2026/27' }), hist, 20);
  assert.strictEqual(r.sinceLast, 5, '66 -> 71 since last season');
  assert.strictEqual(r.total, 11, '60 -> 71 over three seasons');
  assert.strictEqual(r.source, 'seasons');

  const b = G.board([P(1, 71, 80, 2)], new Map([[1, hist]]), { ageOf: () => 20, seasonLabel: '2026/27' });
  assert.strictEqual(b.rows[0].series.length, 3, 'board passes the current label through');
  assert.notStrictEqual(b.rows[0].status, 'unknown', 'real-shaped history must not collapse into one point');
}

// --- labels, judged against the age norm ---------------------------------------------------------------------
{
  // 19yo +7 in a year (norm 3.5 at 18 -> +3.5 above): rising
  const rising = G.trajectory(P(1, 71, 85), [H(1, 64, 84)], 19);
  assert.strictEqual(rising.status, 'rising');
  assert.strictEqual(rising.sinceLast, 7);
  assert.strictEqual(rising.expected, G.expectedGrowth(18));
  assert(Math.abs(rising.vsExpected - 3) < 1e-9);
  assert.strictEqual(rising.yearsToPotential, 2, 'gap 14 at +7 per season = 2 seasons');
  assert.strictEqual(rising.ageThen, 18, 'the change happened at 18, a year before he turned 19: the norm is looked up by that age');

  // 19yo flat for a year with 15 points of potential: stalling, not declining
  const stall = G.trajectory(P(2, 64, 76), [H(1, 64, 76)], 19);
  assert.strictEqual(stall.status, 'stalling');
  assert(stall.reasons[0].includes('12 points of potential'));
  assert.strictEqual(stall.curveYears, 5, '3.5+3+2.5+2+1.5 >= 12 on the typical curve');
  assert.strictEqual(stall.yearsToPotential, null, 'no personal pace when he did not grow');
  // 15 points is more than a typical player gains from 19 on: say so instead of promising a date
  const far = G.trajectory(P(9, 64, 79), [H(1, 64, 79)], 19);
  assert.strictEqual(far.curveYears, null);
  assert(far.reasons.some(x => /out of reach/.test(x)));

  // 31yo -4: declining; 31yo -1.5 is just normal ageing
  assert.strictEqual(G.trajectory(P(3, 76, 76), [H(1, 80, 80)], 31).status, 'declining');
  assert.strictEqual(G.trajectory(P(4, 78.5, 78.5), [H(1, 80, 80)], 31).status, 'on-track', 'ageing at the norm is not a decline');

  // a 27yo flat for a season is on track; a 27yo +2 is above the norm (0) so rising
  assert.strictEqual(G.trajectory(P(5, 80, 80), [H(1, 80, 80)], 27).status, 'on-track');
  assert.strictEqual(G.trajectory(P(6, 82, 82), [H(1, 80, 80)], 27).status, 'rising');

  // holding level at 33 beats the age norm (-2.5) but is not 'rising': growth has to be real
  assert.strictEqual(G.trajectory(P(12, 75, 75), [H(1, 75, 75)], 33).status, 'on-track');

  // at his ceiling young: maxed
  assert.strictEqual(G.trajectory(P(7, 80, 80), [H(1, 80, 80)], 22).status, 'maxed');
  assert.notStrictEqual(G.trajectory(P(8, 80, 80), [H(1, 80, 80)], 29).status, 'maxed', 'older players are simply at their level');
}

// --- first season only: falls back to the in-season delta, and says so ---------------------------------------
{
  const r = G.trajectory(P(10, 70, 85, 5), [], 20);
  assert.strictEqual(r.source, 'in-season');
  assert.strictEqual(r.change, 5);
  assert.strictEqual(r.ageThen, 20, 'an in-season change is judged at his current age');
  assert.strictEqual(G.trajectory(P(99, 70, 80, 4), [], null).ageThen, null, 'no age: no age-then');
  assert(r.reasons[0].includes('so far this season'));
  assert.strictEqual(r.status, 'rising', '+5 at 20 vs norm 3');
  const flat0 = G.trajectory(P(11, 70, 85, 0), [], 20);
  assert.strictEqual(flat0.status, 'unknown', 'a zero delta on a first sync is no information, not "flat"');
  assert(/only one season/.test(flat0.reasons[0]));
}

// --- unusable data never throws or produces NaN ---------------------------------------------------------------
{
  const noAge = G.trajectory(P(20, 70, 80), [H(1, 65, 80)], null);
  assert.strictEqual(noAge.status, 'unknown');
  assert(noAge.reasons.length === 1);
  const nothing = G.trajectory({ player_id: 21, overall: 70, potential: 80 }, [], 25);
  assert.strictEqual(nothing.status, 'unknown', 'no history and no delta');
  const bad = G.trajectory({ player_id: 22, overall: 'x', potential: null }, undefined, 25);
  assert.strictEqual(bad.status, 'unknown');
  assert.strictEqual(G.curveYearsToPotential(34, 70, 90), null, 'a 34yo never grows into a 90');
}

// --- board ----------------------------------------------------------------------------------------------------
{
  const players = [
    P(1, 71, 85), P(2, 64, 79), P(3, 76, 76), P(4, 80, 80), P(5, 69, 82), P(6, 60, 60), P(7, 74, 74)
  ];
  const ages = { 1: 19, 2: 19, 3: 31, 4: 22, 5: 20, 6: 40, 7: 27 };
  const histories = new Map([[1, [H(1, 64, 84)]], [2, [H(1, 64, 79)]], [3, [H(1, 80, 80)]], [4, [H(1, 80, 80)]], [5, [H(1, 66, 82)]], [7, [H(1, 74, 74)]]]);
  const b = G.board(players, histories, { ageOf: p => ages[p.player_id] });
  assert.deepStrictEqual(b.risers.map(r => r.player.player_id), [1], 'only the +7 teen rises (player 5 is +3 at 20, norm 3.5)');
  assert.deepStrictEqual(b.fallers.map(r => r.player.player_id), [3]);
  assert.deepStrictEqual(b.stalling.map(r => r.player.player_id), [2]);
  assert.deepStrictEqual(b.maxed.map(r => r.player.player_id), [4]);
  assert.strictEqual(b.rows.length, 7);
  assert.strictEqual(b.rows.find(r => r.player.player_id === 6).status, 'unknown', 'no history, no delta');

  // plain-object histories, away players skipped, per-list limit
  const asObject = G.board(players, { 1: [H(1, 64, 84)] }, { ageOf: p => ages[p.player_id], isAway: p => p.player_id === 1 });
  assert.strictEqual(asObject.rows.length, 6);
  assert.strictEqual(asObject.risers.length, 0);
  const many = Array.from({ length: 9 }, (_, i) => P(100 + i, 75 + i, 90));
  const hm = new Map(many.map(p => [p.player_id, [H(1, 65, 90)]]));
  const lim = G.board(many, hm, { ageOf: () => 20, limit: 3 });
  assert.strictEqual(lim.risers.length, 3);
  assert(lim.risers[0].vsExpected >= lim.risers[2].vsExpected, 'biggest risers first');
  assert.deepStrictEqual(G.board([], new Map(), {}).rows, []);
  assert.deepStrictEqual(G.board(undefined, undefined, {}).risers, []);
}

console.log('progression: all checks passed');
