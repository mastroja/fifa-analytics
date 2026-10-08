// node scripts/test_depth_chart.js — logic checks for the depth chart (js/depth_chart.js buildDepth): no player twice in a
// lineup, pinned players honoured, removed (vacated) strings stay empty, central-midfield roles are interchangeable.
const assert = require('assert');
const labels = { 0: 'GK', 5: 'CB', 4: 'CB', 14: 'CM', 25: 'ST', 27: 'LW', 23: 'RW', 3: 'RB', 7: 'LB', 10: 'CDM', 18: 'CAM' };
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
slots = D.buildDepth('4-3-3 Holding', [P(0, 70), P(10, 76), P(14, 72), P(18, 70)], []);
assert(slots.filter(s => s.role === 'CM' || s.role === 'CAM').every(s => s.starter), 'central mids fill each other\'s slots');

console.log('depth chart tests passed');
