// node scripts/test_insights_injuries.js — js/insights_injuries.js: day counts, per-player summary, injury-prone rule.
const assert = require('assert');
const I = require('../js/insights_injuries.js');

assert.strictEqual(I.daysBetween('2026-01-01', '2026-01-11'), 10);
assert.strictEqual(I.daysBetween('20260101', '2026-01-11'), 10, '8-digit in-game dates');
assert.strictEqual(I.daysBetween('2026-01-11', '2026-01-01'), 0, 'never negative');
assert.strictEqual(I.daysBetween('junk', '2026-01-01'), null);

const today = '2026-10-15';
const eps = [
  { start_date: '2024-03-01', end_date: '2024-04-30', injury_type_id: 1 },   // 60 days, outside the 12-month window
  { start_date: '2025-09-01', end_date: '2025-11-15', injury_type_id: 2 },   // 75 days, 30 of them inside the window
  { start_date: '2026-10-05', end_date: null, injury_type_id: 3 },           // open: 10 days so far
  { start_date: 'bad', end_date: null }
];
const s = I.injurySummary(eps, today);
assert.strictEqual(s.count, 3, 'unreadable episode ignored');
assert.strictEqual(s.daysOut, 60 + 75 + 10);
assert.strictEqual(s.longest, 75);
assert.strictEqual(s.out, true, 'open episode -> currently injured');
assert.strictEqual(s.last.start_date, '2026-10-05');
assert.strictEqual(s.recentCount, 2);
assert.strictEqual(s.recentDays, 31 + 10, 'only the part of an episode inside the last 365 days counts');
assert.strictEqual(I.isInjuryProne(s), false);
assert.strictEqual(I.isInjuryProne({ recentCount: I.PRONE_COUNT, recentDays: 0 }), true, 'count rule');
assert.strictEqual(I.isInjuryProne({ recentCount: 1, recentDays: I.PRONE_DAYS }), true, 'days rule');

const none = I.injurySummary([], today);
assert.deepStrictEqual([none.count, none.daysOut, none.out, none.last], [0, 0, false, null]);
assert.strictEqual(I.injurySummary(undefined, today).count, 0);
assert.strictEqual(I.profileTimelineHtml([]), '', 'no episodes -> nothing on the profile');

console.log('insights injuries tests passed');
