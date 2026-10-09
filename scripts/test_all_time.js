// node scripts/test_all_time.js — logic checks for js/all_time.js (merging career totals, where-are-they-now and the
// live squad into one All-Time row per player; status filter; club records).
const assert = require('assert');
const A = require('../js/all_time.js');

const stats = [
  { player_id: 1, name: 'Here', overall: 80, appearances: 120, goals: 40, assists: 10, avg_rating: 7.1, yellow_cards: 3 },
  { player_id: 2, name: 'Loanee', overall: 66, appearances: 5, goals: 0, assists: 1, avg_rating: 6.5 },
  { player_id: 3, name: 'Sold', overall: 74, appearances: 90, goals: 12, assists: 30, avg_rating: 7.4 },
  { player_id: 4, name: 'Cleared', overall: 60, appearances: 30, goals: 2, assists: 0, avg_rating: 6.2 },
  { player_id: 5, name: 'NoApps', overall: 55, appearances: 0, goals: 0, assists: 0, avg_rating: 9.9 }
];
const xi = [{ player_id: 1, overall: 82, peak_season: '2025/26', seasons: 3 }, { player_id: 3, overall: 79, peak_season: '2024/25', seasons: 2 }];
const past = [{ player_id: 3, name: 'Sold', overall: 78, overall_is_live: true, current_club: 'Norwich', joined_season: '2023/24', departed_season: '2025/26', years_active: 3 }];
const squad = [{ player_id: 1, overall: 81, __clubStatus: 'normal' }, { player_id: 2, overall: 67, __clubStatus: 'loan', club_name: 'Wrexham' }, { player_id: 4, overall: 60, __clubStatus: 'transferred' }];

const rows = A.buildAllTimeRows(stats, xi, past, squad);
const by = id => rows.find(r => r.player_id === id);
assert.strictEqual(rows.length, 5, 'one row per player');
assert.strictEqual(by(1).status, 'club');
assert.strictEqual(by(2).status, 'loan');
assert.strictEqual(by(2).current_club, 'Wrexham', 'loanee shows where they are');
assert.strictEqual(by(3).status, 'left');
assert.strictEqual(by(4).status, 'untracked', 'a stale "transferred" squad row who is not followed is untracked, not at the club');
assert.strictEqual(by(1).overall_now, 81, 'at-club players use the live squad overall');
assert.strictEqual(by(3).overall_now, 78, 'departed players use the followed overall');
assert.strictEqual(by(3).current_club, 'Norwich');
assert.strictEqual(by(1).peak_overall, 82, 'peak from getAllTimeXI');
assert.strictEqual(by(1).seasons, 3);
assert.strictEqual(by(3).seasons, 2, 'seasons from getAllTimeXI win over years_active');
assert.strictEqual(by(5).avg_rating, 0, 'no appearances -> no rating (ignores a junk value)');
assert.strictEqual(by(1).yellow_cards, 3);
assert.strictEqual(by(2).seasons, null, 'unknown seasons stay null, not 0');

// string vs number ids still join
const mixed = A.buildAllTimeRows([{ player_id: '7', name: 'S', appearances: 1 }], [{ player_id: 7, overall: 70, seasons: 1 }], [], [{ player_id: 7, __clubStatus: 'normal', overall: 70 }]);
assert.strictEqual(mixed[0].status, 'club'); assert.strictEqual(mixed[0].peak_overall, 70);

// a followed ex-player without a stats row still appears (zero stats), never twice
const extra = A.buildAllTimeRows([], [], past, []);
assert.strictEqual(extra.length, 1); assert.strictEqual(extra[0].status, 'left'); assert.strictEqual(extra[0].appearances, 0);
assert.strictEqual(A.buildAllTimeRows(stats, [], past, []).filter(r => r.player_id === 3).length, 1);
assert.deepStrictEqual(A.buildAllTimeRows(undefined, undefined, undefined, undefined), []);

// status filter: All = everyone; At club = club + loan; Left = followed departures only (cleared ones only under All)
const count = f => rows.filter(r => A.inStatus(r, f)).length;
assert.strictEqual(count('all'), 5);
assert.strictEqual(count('club'), 2);
assert.strictEqual(count('left'), 1);

// records: right holders; rating needs the minimum apps; empty data -> null holders, no crash
const rec = Object.fromEntries(A.clubRecords(rows).map(r => [r.label.split(' (')[0], r]));
assert.strictEqual(rec['Most appearances'].row.player_id, 1);
assert.strictEqual(rec['Top scorer'].row.player_id, 1);
assert.strictEqual(rec['Most assists'].row.player_id, 3);
assert.strictEqual(rec['Best avg rating'].row.player_id, 3, '7.4 over 90 apps beats 7.1, and the 9.9 with 0 apps never counts');
assert.strictEqual(rec['Highest peak OVR'].value, '82 · 2025/26');
assert(A.clubRecords([]).every(r => r.row === null));
assert(A.clubRecords([{ appearances: A.RATING_MIN_APPS - 1, avg_rating: 9 }]).find(r => r.label.startsWith('Best')).row === null, 'too few apps for the rating record');

console.log('all-time tests passed');
