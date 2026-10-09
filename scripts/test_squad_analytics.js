// node scripts/test_squad_analytics.js — logic checks for js/squad_analytics.js (wage curve, contract buckets, compare axes).
const assert = require('assert');
const A = require('../js/squad_analytics.js');

const P = (id, ovr, wage, expiry) => ({ player_id: id, name: 'P' + id, overall: ovr, wage, contract_expiry: expiry });

// synthetic squad whose wage is exactly 1000 * e^(0.15 * (ovr - 60)): the fit must recover the slope
const clean = [60, 64, 68, 72, 76, 80, 84].map((o, i) => P(i + 1, o, 1000 * Math.exp(0.15 * (o - 60)), 2027));
const curve = A.fitWageCurve(clean);
assert(curve && Math.abs(curve.b - 0.15) < 1e-9, 'slope recovered');
assert(Math.abs(A.expectedWage(curve, 72) - 1000 * Math.exp(1.8)) < 1e-6, 'expected wage matches the generating curve');
assert(A.wageRatings(clean, curve).every(r => Math.abs(r.ratio - 1) < 1e-9), 'on-curve players rate 1.0');

// an overpaid player sits above 1, an underpaid one below
const mixed = clean.concat([P(10, 70, 1000 * Math.exp(0.15 * 10) * 4, 2027), P(11, 70, 1000 * Math.exp(0.15 * 10) / 4, 2027)]);
const r = A.wageRatings(mixed, A.fitWageCurve(mixed));
assert(r.find(x => x.player.player_id === 10).ratio > r.find(x => x.player.player_id === 11).ratio * 4, 'overpaid ranks well above underpaid');

// too little / unusable data => no curve and no ratings, never NaN
assert.strictEqual(A.fitWageCurve(clean.slice(0, A.MIN_WAGE_SAMPLE - 1)), null, 'below the minimum sample');
assert.strictEqual(A.fitWageCurve([]), null);
assert.strictEqual(A.fitWageCurve(undefined), null);
assert.strictEqual(A.fitWageCurve([1, 2, 3, 4, 5, 6, 7].map(i => P(i, 70, 1000 * i, 2027))), null, 'everyone the same overall');
assert.strictEqual(A.fitWageCurve(clean.map(p => ({ ...p, wage: 0 }))), null, 'no wages');
assert.deepStrictEqual(A.wageRatings(clean, null), []);
// zero / missing wage rows are ignored, not fitted as ln(0)
const withZero = clean.concat([P(20, 70, 0, 2027), P(21, 70, undefined, 2027)]);
assert(Math.abs(A.fitWageCurve(withZero).b - 0.15) < 1e-9, 'unpriced players ignored');

// contract buckets: ascending, summed wages, unparseable dates reported separately
const b = A.contractBuckets([P(1, 70, 100, 2028), P(2, 70, 50, 2027), P(3, 70, 25, '2027'), P(4, 70, 10, null), P(5, 70, 10, 'n/a'), P(6, 70, 10, 0)]);
assert.deepStrictEqual(b.buckets.map(x => [x.year, x.count, x.wage]), [[2027, 2, 75], [2028, 1, 100]]);
assert.strictEqual(b.unknown.length, 3);
assert.deepStrictEqual(A.contractBuckets(undefined), { buckets: [], unknown: [] });

// compare axes: all keepers => GK axes; any outfielder => outfield axes; nobody => outfield (no crash)
const gk = p => p.gk;
assert.strictEqual(A.compareAxes([{ gk: true }, { gk: true }], gk).gk, true);
assert.strictEqual(A.compareAxes([{ gk: true }, { gk: false }], gk).gk, false);
assert.strictEqual(A.compareAxes([], gk).gk, false);
assert.strictEqual(A.compareAxes([{ gk: false }], gk).axes.length, 6);

// compare companion: same position group first, never the player themself, null when alone
const grp = p => p.g;
const sq = [{ player_id: 1, overall: 80, g: 'DEF' }, { player_id: 2, overall: 85, g: 'ATT' }, { player_id: 3, overall: 70, g: 'DEF' }, { player_id: 4, overall: 75, g: 'DEF' }];
assert.strictEqual(A.companionFor(sq[0], sq, grp).player_id, 4, 'best other defender, not the better forward');
assert.strictEqual(A.companionFor({ player_id: 9, overall: 60, g: 'GK' }, sq, grp).player_id, 2, 'no other keeper -> best overall');
assert.strictEqual(A.companionFor(sq[0], [sq[0]], grp), null, 'nobody else in the squad');
assert.strictEqual(A.companionFor({ player_id: '1', g: 'DEF' }, sq, grp).player_id, 4, 'string vs number ids still exclude self');

console.log('squad analytics tests passed');
