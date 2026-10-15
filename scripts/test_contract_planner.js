// node scripts/test_contract_planner.js — logic checks for js/contract_planner.js (wage projection, renewal actions).
const assert = require('assert');
const C = require('../js/contract_planner.js');
const R = require('../js/roster_advice.js');
const A = require('../js/squad_analytics.js');

// id, overall, age, weekly wage, expiry year, what the squad curve would pay him (exp)
const P = (id, ovr, age, wage, expiry, exp) => ({ player_id: id, name: 'P' + id, overall: ovr, age, wage, contract_expiry: expiry, exp });
const base = extra => Object.assign({ seasonEndYear: 2027, ageOf: p => p.age, expectedWageOf: p => p.exp }, extra);
const byId = (rows, id) => rows.find(r => r.player.player_id === id);

const squad = () => [
  P(1, 80, 27, 1000, 2027, 1200),  // expiring, healthy age, underpaid vs curve: renew at the curve
  P(2, 70, 33, 800, 2027, 500),    // expiring, 33: one more year, and never a pay cut
  P(3, 65, 20, 200, 2028, 300),    // a year left, young: lock in
  P(4, 75, 28, 600, 2029, 700),    // two years left: no plan yet
  P(5, 75, 30, 500, 2027, 500),    // expiring, advised to sell
  P(6, 60, 25, 100, null, 100),    // no contract date
  P(7, 60, 25, 999, 2027, 100)     // loaned out
];
const advice = p => (p.player_id === 5 ? { verdict: 'sell', reasons: [] } : null);
const opts = extra => base(Object.assign({ adviceOf: advice, isAway: p => p.player_id === 7 }, extra));

// --- season-by-season projection (hand-computed) --------------------------------------------------------------
{
  const plan = C.plan(squad(), opts());
  assert.deepStrictEqual(plan.seasons.map(s => s.endYear), [2027, 2028, 2029, 2030]);
  assert.strictEqual(plan.seasons[0].label, '2026/27');
  const pick = s => [s.committedWage, s.committedCount, s.rollingOffWage, s.rollingOffCount, s.renewedWage, s.withRenewals];
  // 2027: everyone under contract (1..5) = 1000+800+200+600+500
  assert.deepStrictEqual(pick(plan.seasons[0]), [3100, 5, 0, 0, 0, 3100]);
  // 2028: only 3 and 4 still contracted (800); 1, 2 and 5 roll off (2300). Renewed: 1 at 1200 and 2 at 800 (a 33yo keeps his wage)
  assert.deepStrictEqual(pick(plan.seasons[1]), [800, 2, 2300, 3, 2000, 2800]);
  // 2029: only 4 (600). 3 rolls off (200) but is renewed at 300; 1 still covered at 1200; 2's one-year deal is over
  assert.deepStrictEqual(pick(plan.seasons[2]), [600, 1, 200, 1, 1500, 2100]);
  // 2030: nobody contracted; 4 rolls off (600). Renewed deals cover 1 (1200) and 3 (300). Player 5 was sold, 6 has no date
  assert.deepStrictEqual(pick(plan.seasons[3]), [0, 0, 600, 1, 1500, 1500]);
  assert.deepStrictEqual(plan.unknown.map(p => p.player_id), [6], 'no contract date: reported, not projected');
}

// --- renewals: who gets a plan, in what order, with what action ----------------------------------------------
{
  const { renewals } = C.plan(squad(), opts());
  assert.deepStrictEqual(renewals.map(r => r.player.player_id), [1, 5, 2, 3], 'expiring this summer first, best player first; 2 years left excluded; loanee skipped');
  const r1 = byId(renewals, 1), r2 = byId(renewals, 2), r3 = byId(renewals, 3), r5 = byId(renewals, 5);
  assert.deepStrictEqual([r1.action, r1.renewalWage, r1.raise], ['renew', 1200, 200]);
  assert.deepStrictEqual([r2.action, r2.renewalWage, r2.raise], ['renew-short', 800, 0], 'never below his current wage');
  assert.deepStrictEqual([r3.action, r3.renewalWage, r3.yearsLeft], ['renew', 300, 1]);
  assert.deepStrictEqual([r5.action, r5.yearsLeft], ['sell-now', 0]);
  assert(/sell now or lose him/.test(r5.reasons[0]));
  assert(renewals.every(r => r.reasons.length > 0), 'every row explains itself');

  const wider = C.plan(squad(), opts({ thresholds: { renewWithinYears: 2 } })).renewals;
  assert(wider.some(r => r.player.player_id === 4), 'the planning window is tunable');
  const narrow = C.plan(squad(), opts({ thresholds: { renewWithinYears: 0 } })).renewals;
  assert.deepStrictEqual(narrow.map(r => r.player.player_id), [1, 5, 2], 'expiring this summer only');
}

// --- actions by advice and age --------------------------------------------------------------------------------
{
  const T = C.DEFAULTS;
  const act = (age, yearsLeft, verdict) => C.actionFor({}, age, yearsLeft, verdict ? { verdict } : null, T).action;
  assert.strictEqual(act(25, 1, 'sell'), 'sell', 'recommended sale with a year left: sell, not sell-now');
  assert.strictEqual(act(25, 0, 'sell'), 'sell-now');
  assert.strictEqual(act(19, 0, 'loan'), 'renew');
  assert(/loan him for minutes/.test(C.actionFor({}, 19, 0, { verdict: 'loan' }, T).reasons[0]));
  assert.strictEqual(act(19, 0, 'develop'), 'renew');
  assert.strictEqual(act(20, 0, null), 'renew', 'young with no advice: lock in');
  assert.strictEqual(act(32, 0, 'monitor'), 'let-go');
  assert.strictEqual(act(32, 0, 'keep'), 'renew-short');
  assert.strictEqual(act(32, 0, null), 'renew-short');
  assert(!/regular/.test(C.actionFor({}, 32, 0, null, T).reasons[0]), 'does not claim he is a regular without advice');
  assert.strictEqual(act(26, 0, 'monitor'), 'review');
  const key = (age, y) => C.actionFor({}, age, y, { verdict: 'monitor', keyExpiring: true }, T);
  assert.strictEqual(key(26, 0).action, 'renew', "an expiring regular is 'monitor' in RosterAdvice but a renewal here");
  assert.strictEqual(key(33, 0).action, 'renew-short', 'an expiring regular at 33 gets one more year, not a let-go');
  assert.strictEqual(act(26, 0, 'keep'), 'renew');
  assert.strictEqual(act(null, 0, null), 'renew', 'unknown age: no age-based advice, so the plain default');
}

// --- renewal wage ---------------------------------------------------------------------------------------------
{
  assert.strictEqual(C.renewalWage({ wage: 1000, exp: 1200 }, base()), 1200);
  assert.strictEqual(C.renewalWage({ wage: 1000, exp: 400 }, base()), 1000, 'overpaid: stays, never cut');
  assert.strictEqual(C.renewalWage({ wage: 1000, exp: 1200 }, base({ renewalRaise: 1.1 })), 1320, 'optional raise on top');
  assert.strictEqual(C.renewalWage({ wage: 1000 }, { seasonEndYear: 2027 }), 1000, 'no curve: current wage');
  assert.strictEqual(C.renewalWage({ wage: 1000, exp: 'x' }, base()), 1000, 'junk estimate ignored');
  assert.strictEqual(C.renewalWage({}, base()), 0);
}

// --- budget ---------------------------------------------------------------------------------------------------
{
  const s = C.plan(squad(), opts({ wageBudget: 2500 })).seasons;
  assert.deepStrictEqual(s.map(x => x.headroom), [-600, -300, 400, 1000]);
  assert.deepStrictEqual(s.map(x => x.overBudget), [true, true, false, false]);
  assert.strictEqual(C.plan(squad(), opts()).seasons[0].headroom, undefined, 'no budget given: no headroom claimed');
  assert.strictEqual(C.plan(squad(), opts({ wageBudget: 0 })).seasons[0].headroom, undefined);
}

// --- robustness -----------------------------------------------------------------------------------------------
{
  assert.deepStrictEqual(C.plan([], base()).seasons, []);
  assert.deepStrictEqual(C.plan(undefined, base()).renewals, []);
  assert.deepStrictEqual(C.plan(squad(), { ageOf: p => p.age }).seasons, [], 'no season year: nothing to project');
  const odd = C.plan([P(1, 70, 25, undefined, '2027', 100), P(2, 70, 25, null, 'n/a', 100), P(3, 70, 25, 100, 0, 100)], base());
  assert(odd.seasons.every(s => Number.isFinite(s.withRenewals) && Number.isFinite(s.committedWage)), 'missing wages never give NaN');
  assert.strictEqual(odd.unknown.length, 2, "'n/a' and 0 are not contract years");
  assert.strictEqual(odd.seasons[0].committedCount, 1, 'string years parse');
  const past = C.plan([P(1, 70, 25, 500, 2026, 500)], base());
  assert.strictEqual(past.seasons[0].committedCount, 0, 'a contract already past is not counted');
  assert.strictEqual(past.renewals[0].yearsLeft, -1);
  assert.strictEqual(past.seasons[0].rollingOffCount, 0, 'already-expired is not "rolling off" in the current season');
  const h = C.plan(squad(), opts({ thresholds: { horizon: 1 } }));
  assert.strictEqual(h.seasons.length, 2);
}

// --- integration with the real wage curve and the sell/keep/loan engine ----------------------------------------
{
  const wage = o => 1000 * Math.exp(0.15 * (o - 60));
  const synth = [60, 64, 68, 72, 76, 80, 84].map((o, i) => ({ player_id: 100 + i, name: 'S' + i, overall: o, potential: o, wage: i === 3 ? wage(o) * 0.6 : wage(o),
    contract_expiry: 2027 + (i % 3), appearances: 20, minutes: 1700, age: 26, group: 'MID' }));
  const curve = A.fitWageCurve(synth);
  const advRows = R.advise(synth, { ageOf: p => p.age, groupOf: p => p.group, seasonEndYear: 2027, teamGames: 20 });
  const adv = new Map(advRows.map(r => [r.player, r]));
  const plan = C.plan(synth, { seasonEndYear: 2027, ageOf: p => p.age, expectedWageOf: p => A.expectedWage(curve, p.overall), adviceOf: p => adv.get(p) });
  assert(plan.renewals.length > 0 && plan.renewals.every(r => r.renewalWage >= r.wage), 'curve-based renewals never cut pay');
  // the curve is fit to the squad itself, so only someone paid below the squad's own pattern is quoted a rise
  const under = plan.renewals.find(r => r.player.overall === 72);
  assert(under && under.raise > 0 && under.action === 'renew', 'the underpaid 72 (an expiring regular) is renewed at a higher wage');
  assert(plan.renewals.every(r => r.action !== 'review'), 'regulars on expiring deals are never left as undecided');
  assert(plan.renewals.filter(r => r !== under).every(r => r.raise <= r.wage * 0.35), 'players on the curve are not quoted big rises');
  assert(plan.seasons.every(s => Number.isFinite(s.withRenewals)));
}

console.log('contract_planner: all checks passed');
