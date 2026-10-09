// node scripts/test_insights_seasons.js — js/insights_seasons.js: own-club roster filter and per-season summary.
const assert = require('assert');
const S = require('../js/insights_seasons.js');

const rows = [
  { player_id: 1, club_id: 10, on_loan: 0, overall: 80, wage: 1000 }, { player_id: 2, club_id: 10, on_loan: 0, overall: 70, wage: 500 },
  { player_id: 3, club_id: 10, on_loan: 1, overall: 65, wage: 400 },            // ours, loaned out
  { player_id: 4, club_id: 99, on_loan: 0, overall: 75, wage: 900 },            // a loanee from another club
  { player_id: 5, club_id: 10, on_loan: false, overall: 60, wage: 0 }, { player_id: 6, club_id: null, overall: 50 }
];
assert.deepStrictEqual(S.ownClubRows(rows).map(r => r.player_id), [1, 2, 5]);
assert.deepStrictEqual(S.ownClubRows([]), []);
assert.deepStrictEqual(S.ownClubRows([{ club_id: 10, on_loan: 1 }]), [], 'only loaned-out rows -> nothing');

const ages = { 1: 30, 2: 20, 5: null };
const sum = S.seasonSummary(S.ownClubRows(rows), r => ages[r.player_id]);
assert.strictEqual(sum.size, 3);
assert.strictEqual(sum.avgOvr, 70);
assert.strictEqual(sum.best11, 70, 'fewer than 11 -> everyone');
assert.strictEqual(sum.avgAge, 25, 'missing ages skipped');
assert.strictEqual(sum.wageBill, 1500);
assert.strictEqual(sum.u21, 1);

// best 11 really is the top 11
const big = Array.from({ length: 15 }, (_, i) => ({ overall: 60 + i }));
assert.strictEqual(S.seasonSummary(big, () => null).best11, (64 + 74) / 2);
const empty = S.seasonSummary([], () => null);
assert.deepStrictEqual([empty.size, empty.avgOvr, empty.best11, empty.avgAge, empty.wageBill, empty.u21], [0, null, null, null, 0, 0]);

console.log('insights seasons tests passed');
