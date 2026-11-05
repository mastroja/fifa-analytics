// node scripts/test_depth_chart.js — logic checks for the depth chart (js/depth_chart.js buildDepth): no player twice in a
// lineup, pinned players honoured, removed (vacated) strings stay empty, central-midfield roles are interchangeable.
const assert = require('assert');
const labels = { 0: 'GK', 5: 'CB', 4: 'CB', 14: 'CM', 25: 'ST', 27: 'LW', 23: 'RW', 3: 'RB', 7: 'LB', 10: 'CDM', 18: 'CAM', 21: 'CF', 16: 'LM', 12: 'RM' };
globalThis.getPositionInfo = id => ({ label: labels[id] || 'SUB', group: 'MID' });
globalThis.computeMonthsUntilExpiry = () => 20;
const D = require('../js/depth_chart.js');

let id = 1;
const P = (pos, ovr, alt = '') => ({ player_id: id++, name: 'P' + (id - 1), position_id: pos, overall: ovr, alt_positions: alt, contract_expiry: 2030 });
const squad = [P(0, 75), P(5, 80), P(5, 78), P(5, 70), P(3, 72), P(7, 71), P(14, 74), P(14, 73), P(10, 76), P(27, 77), P(25, 79), P(23, 76), P(25, 60)];
squad.push({ ...squad[1] }); // a duplicated source row

const unique = slots => {
  const seen = new Set();
  slots.forEach(s => s.strings.forEach(p => { if (p) { assert(!seen.has(p.player_id), 'duplicate player ' + p.player_id); seen.add(p.player_id); } }));
  return seen;
};

Object.keys(D.FORMATIONS).forEach(f => unique(D.buildDepth(f, squad, [])));

// pins: same player pinned twice + an unknown id must not duplicate or crash
let slots = D.buildDepth('4-3-3', squad, [], null, null, { 1: { 0: 2, 1: 2, 2: 2 }, 2: { 0: 3, 1: 2 }, 5: { 0: 99 } });
unique(slots);

// a pinned starter is respected
slots = D.buildDepth('4-3-3', squad, [], null, null, { 9: { 0: 13 } });
assert.strictEqual(slots[9].starter.player_id, 13, 'pinned starter');

// an explicit empty pin keeps the string vacant
slots = D.buildDepth('4-3-3', squad, [], null, null, { 9: { 0: '-' } });
assert.strictEqual(slots[9].starter, null, 'vacated string stays empty');

// a CDM is a close (non-null) fit for a CM slot: the auto fill uses him there
slots = D.buildDepth('4-3-3 (4)', [P(0, 70), P(10, 76), P(14, 72), P(18, 70)], []);
assert(slots.filter(s => s.role === 'CM' || s.role === 'CAM').every(s => s.starter), 'central mids fill each other\'s slots');

// ---- the official formation list ----
const names = Object.keys(D.FORMATIONS);
assert.strictEqual(names.length, 30, 'EA FC has 30 formations');
assert.strictEqual(D.FORMATION_GROUPS.reduce((n, [, g]) => n + Object.keys(g).length, 0), 30, 'every formation is in a dropdown group');
const roleCount = (f, r) => D.FORMATIONS[f].filter(s => s[0] === r).length;
names.forEach(f => {
  const slots = D.FORMATIONS[f];
  assert.strictEqual(slots.length, 11, f + ' has 11 slots');
  assert.strictEqual(roleCount(f, 'GK'), 1, f + ' has one keeper');
  assert.strictEqual(slots[0][0], 'GK', f + ' starts with the keeper');
  // the name's first number is the back line (wing-backs count in a back five)
  const back = slots.filter(s => ['LB', 'RB', 'CB', 'LWB', 'RWB'].includes(s[0])).length;
  assert.strictEqual(back, Number(f[0]), f + ' back line');
  slots.forEach(([role, x, y]) => {
    assert(D.tierFor({ position_id: 0, alt_positions: '' }, role) !== undefined, f + ': unknown role ' + role);
    assert(x >= 5 && x <= 95 && y >= 10 && y <= 92, f + ' slot inside the pitch');
  });
  // no two cards on top of each other: a pitch card is 20% of the pitch wide and 18.4% tall (measured in the app),
  // placed at (x, mapY(y))
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const dx = Math.abs(slots[i][1] - slots[j][1]), dy = Math.abs(D.mapY(slots[i][2]) - D.mapY(slots[j][2]));
    assert(dx >= 20 || dy >= 18.4, `${f}: ${slots[i][0]} and ${slots[j][0]} cards overlap (dx ${dx}, dy ${dy.toFixed(1)})`);
  }
  unique(D.buildDepth(f, squad, []));
});
// a few shapes spelled out
assert.deepStrictEqual(D.FORMATIONS['4-3-3 (2)'].map(s => s[0]), ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CDM', 'CM', 'LW', 'ST', 'RW']);
assert.deepStrictEqual(D.FORMATIONS['4-4-1-1 (2)'].map(s => s[0]).slice(5), ['LM', 'CM', 'CM', 'RM', 'CF', 'ST']);
assert.deepStrictEqual(D.FORMATIONS['3-5-2'].map(s => s[0]).slice(4), ['CDM', 'CDM', 'LM', 'CAM', 'RM', 'ST', 'ST']);

// second-striker roles: a striker or CAM is a close fit, a CF is natural, a defender is not
assert.strictEqual(D.tierFor({ position_id: 21, alt_positions: '' }, 'CF'), 0);
assert.strictEqual(D.tierFor({ position_id: 25, alt_positions: '' }, 'CF'), 0);
assert.strictEqual(D.tierFor({ position_id: 18, alt_positions: '' }, 'LF'), 1);
assert.strictEqual(D.tierFor({ position_id: 5, alt_positions: '' }, 'RF'), null);

// ---- migrating lineups saved with the old names ----
Object.entries(D.LEGACY_FORMATIONS).forEach(([oldName, to]) => {
  assert(D.FORMATIONS[to], oldName + ' maps to a real formation');
  assert.strictEqual(D.LEGACY_SHAPES[oldName].length, 11);
});
const mig = l => { D.migrateLegacyLineup(l); return l; };
// old 4-3-3 is EA's 4-3-3 (2): same slots, pins unchanged
let l = mig({ formation: '4-3-3', pins: { 6: { 0: 9 }, 9: { 0: 11 } } });
assert.strictEqual(l.formation, '4-3-3 (2)');
assert.deepStrictEqual(l.pins, { 6: { 0: 9 }, 9: { 0: 11 } });
// old 3-5-2 (wing-backs) becomes 5-3-2: pins follow the role
l = mig({ formation: '3-5-2', pins: { 1: { 0: 2 }, 4: { 0: 5 }, 6: { 0: 9 }, 8: { 0: 7 }, 10: { 0: 11 } } });
assert.strictEqual(l.formation, '5-3-2');
const r532 = D.FORMATIONS['5-3-2'].map(s => s[0]);
assert.strictEqual(r532[Object.keys(l.pins).find(k => l.pins[k][0] === 2)], 'CB', 'first CB stays a CB');
assert.strictEqual(r532[Object.keys(l.pins).find(k => l.pins[k][0] === 5)], 'LWB');
assert.strictEqual(r532[Object.keys(l.pins).find(k => l.pins[k][0] === 9)], 'CDM');
assert.strictEqual(r532[Object.keys(l.pins).find(k => l.pins[k][0] === 7)], 'RWB');
assert.strictEqual(Object.keys(l.pins).find(k => l.pins[k][0] === 11), '10', 'second ST stays second ST');
// old flat 5-3-2: only two CM slots remain, so the third CM pin is dropped
l = mig({ formation: '5-3-2', pins: { 6: { 0: 1 }, 7: { 0: 2 }, 8: { 0: 3 } } });
assert.deepStrictEqual(Object.values(l.pins).map(p => p[0]).sort(), [1, 2]);
// an unknown name falls back to the default with no pins
l = mig({ formation: 'nonsense', pins: { 1: { 0: 1 } } });
assert.strictEqual(l.formation, '4-3-3'); assert.deepStrictEqual(l.pins, {});

console.log('depth chart tests passed');
