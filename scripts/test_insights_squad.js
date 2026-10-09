// node scripts/test_insights_squad.js — js/insights_squad.js: best-11 level, age/level groups, role depth, cell tones.
const assert = require('assert');
const S = require('../js/insights_squad.js');

// best 11: average and cut-off of the top 11 overalls; fewer than 11 -> everyone; junk ignored
const ovr = [90, 85, 84, 83, 82, 81, 80, 79, 78, 77, 76, 60, 0, null].map(o => ({ overall: o }));
const lvl = S.bestElevenLevel(ovr);
assert.strictEqual(lvl.cutoff, 76);
assert(Math.abs(lvl.avg - (90 + 85 + 84 + 83 + 82 + 81 + 80 + 79 + 78 + 77 + 76) / 11) < 1e-9);
assert.deepStrictEqual(S.bestElevenLevel([{ overall: 70 }, { overall: 60 }]), { avg: 65, cutoff: 60 });
assert.deepStrictEqual(S.bestElevenLevel([]), { avg: null, cutoff: null });

// groups: age first, then level
assert.strictEqual(S.classify(19, 85, 76), 'prospect', 'a 19-year-old starter is a prospect');
assert.strictEqual(S.classify(32, 85, 76), 'veteran');
assert.strictEqual(S.classify(25, 76, 76), 'core', 'at the cut-off counts as core');
assert.strictEqual(S.classify(25, 75, 76), 'rotation');
assert.strictEqual(S.classify(null, 80, 76), 'core', 'unknown age falls back to level');
assert.strictEqual(S.classify(25, 80, null), 'rotation', 'no level -> rotation, never core by accident');

// role depth: natural players sorted by OVR; cover = best alt-position player who is not natural there
const labels = { 0: 'GK', 5: 'CB', 3: 'RB', 7: 'LB', 14: 'CM', 25: 'ST', 23: 'RW', 12: 'RM' };
const lab = id => labels[id] || 'SUB';
const sq = [
  { player_id: 1, position_id: 5, overall: 70 }, { player_id: 2, position_id: 5, overall: 78 },
  { player_id: 3, position_id: 14, overall: 75, alt_positions: '3, 5' }, { player_id: 4, position_id: 12, overall: 72 },
  { player_id: 5, position_id: 25, overall: 80 }
];
const depth = Object.fromEntries(S.roleDepth(sq, lab).map(r => [r.role, r]));
assert.deepStrictEqual(depth.CB.natural.map(p => p.player_id), [2, 1], 'CBs best first');
assert.strictEqual(depth.CB.cover.player_id, 3, 'CM listed at CB is cover');
assert.strictEqual(depth.RB.natural.length, 0); assert.strictEqual(depth.RB.cover.player_id, 3, 'cover with no natural player');
assert.strictEqual(depth.RW.natural[0].player_id, 4, 'RM counts as natural for the RW role');
assert.strictEqual(depth.GK.natural.length, 0); assert.strictEqual(depth.GK.cover, null);
assert.strictEqual(S.roleDepth(sq, lab).length, S.ROLES.length, 'every role always present');
assert.strictEqual(S.roleDepth(undefined, lab).every(r => r.natural.length === 0), true);

// tones against the best-11 average
assert.strictEqual(S.tone(80, 78), 'good'); assert.strictEqual(S.tone(78, 78), 'good');
assert.strictEqual(S.tone(74, 78), 'ok'); assert.strictEqual(S.tone(70, 78), 'weak'); assert.strictEqual(S.tone(69, 78), 'poor');
assert.strictEqual(S.tone(null, 78), 'empty'); assert.strictEqual(S.tone(70, null), 'ok');

console.log('insights squad tests passed');
