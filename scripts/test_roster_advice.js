// node scripts/test_roster_advice.js — logic checks for js/roster_advice.js (sell / keep / loan verdicts and play-time sources).
const assert = require('assert');
const R = require('../js/roster_advice.js');

// id, name, group, age, ovr, pot, wage, expiry, apps, minutes
const P = (id, group, age, ovr, pot, wage, expiry, apps, minutes) =>
  ({ player_id: id, name: 'P' + id, group, age, overall: ovr, potential: pot, wage, contract_expiry: expiry, appearances: apps, minutes });
const opts = extra => Object.assign({ ageOf: p => p.age, groupOf: p => p.group, seasonEndYear: 2027, teamGames: 20 }, extra);
const verdictOf = (rows, id) => rows.find(r => r.player.player_id === id);

// A midfield with a clear starter set, so rank-based "starters" are the three best.
const base = () => [
  P(1, 'MID', 26, 80, 80, 50000, 2029, 20, 1800),
  P(2, 'MID', 27, 78, 78, 40000, 2029, 19, 1700),
  P(3, 'MID', 25, 76, 77, 30000, 2029, 18, 1600),
];

// --- prospects ------------------------------------------------------------------------------------------------
{
  const squad = base().concat([P(10, 'MID', 19, 64, 82, 5000, 2029, 1, 90)]);
  const r = verdictOf(R.advise(squad, opts()), 10);
  assert.strictEqual(r.verdict, 'loan', 'a young high-ceiling player with ~5% of the minutes should be loaned');
  assert.strictEqual(r.playTime.source, 'minutes');
  assert(r.playTime.share < 0.25);
  assert(r.reasons.some(x => /needs minutes/.test(x)) && r.reasons.some(x => /better MID/.test(x)), 'says why and who blocks him');

  const playing = base().concat([P(11, 'MID', 19, 64, 82, 5000, 2029, 15, 1300)]);
  assert.strictEqual(verdictOf(R.advise(playing, opts()), 11).verdict, 'develop', 'same player getting minutes is developed, not loaned');

  const lowCeiling = base().concat([P(12, 'MID', 19, 64, 67, 5000, 2029, 1, 90)]);
  assert.notStrictEqual(verdictOf(R.advise(lowCeiling, opts()), 12).verdict, 'loan', 'no growth gap, so not a loan prospect');
}

// --- veterans -------------------------------------------------------------------------------------------------
{
  const squad = base().concat([P(20, 'MID', 32, 70, 70, 90000, 2027, 3, 200)]);
  const r = verdictOf(R.advise(squad, opts()), 20);
  assert.strictEqual(r.verdict, 'sell');
  assert(r.reasons.some(x => /median/.test(x)), 'mentions the wage');
  assert(r.reasons.some(x => /runs out this season/.test(x)), 'mentions the expiring contract');
  assert(r.weight > 0.9, 'well paid and expiring ranks very actionable');

  const regular = base().concat([P(21, 'MID', 33, 77, 77, 90000, 2029, 20, 1750)]);
  assert.strictEqual(verdictOf(R.advise(regular, opts()), 21).verdict, 'keep', 'an old player who still plays is kept');
}

// --- prime-age surplus ----------------------------------------------------------------------------------------
{
  const overpaid = base().concat([P(30, 'MID', 27, 66, 66, 120000, 2029, 2, 150)]);
  assert.strictEqual(verdictOf(R.advise(overpaid, opts()), 30).verdict, 'sell', 'prime age, not playing, well paid');
  const cheap = base().concat([P(31, 'MID', 27, 66, 66, 5000, 2029, 2, 150)]);
  assert.strictEqual(verdictOf(R.advise(cheap, opts()), 31).verdict, 'monitor', 'prime age, not playing but cheap: just watch');
}

// --- expiring key player --------------------------------------------------------------------------------------
{
  const squad = [P(40, 'MID', 28, 82, 82, 60000, 2027, 20, 1800)].concat(base().slice(1));
  const r = verdictOf(R.advise(squad, opts()), 40);
  assert.strictEqual(r.verdict, 'monitor');
  assert(/renew or cash in/.test(r.reasons[0]));
  assert.strictEqual(r.keyExpiring, true, 'flagged so the contract planner can treat him as a renewal');
  assert.strictEqual(verdictOf(R.advise(squad, opts()), 2).keyExpiring, false);
}

// --- play-time sources ----------------------------------------------------------------------------------------
{
  const pt = (p, games, role, rank) => R.playTime(p, games, role, rank);
  assert.deepStrictEqual(pt({ minutes: 900, appearances: 5 }, 20, null, false), { share: 0.5, source: 'minutes' }, 'minutes win over apps');
  assert.deepStrictEqual(pt({ appearances: 10 }, 20, null, false), { share: 0.5, source: 'apps' }, 'apps used when minutes are missing');
  assert.strictEqual(pt({ appearances: 99, minutes: 99999 }, 20, null, false).share, 1, 'share is capped at 1');
  assert.strictEqual(pt({}, 20, 'starter', false).source, 'depth', 'depth role when nothing is counted');
  assert.strictEqual(pt({ appearances: 1 }, 2, 'reserve', false).source, 'depth', 'too few team games: do not trust a share');
  assert.strictEqual(pt({}, 20, null, true).share > pt({}, 20, null, false).share, true, 'rank starter beats rank reserve');

  // no minutes, no appearances anywhere (early season / limited export): falls back to rank and says so
  const noStats = [P(50, 'MID', 20, 60, 80, 2000, 2029), P(51, 'MID', 26, 80, 80, 40000, 2029), P(52, 'MID', 27, 79, 79, 40000, 2029), P(53, 'MID', 24, 78, 78, 40000, 2029)]
    .map(p => ({ ...p, appearances: undefined, minutes: undefined }));
  const rows = R.advise(noStats, opts({ teamGames: 0 }));
  const kid = verdictOf(rows, 50);
  assert.strictEqual(kid.playTime.source, 'depth');
  assert.strictEqual(kid.verdict, 'loan', 'rank 4 of 4 prospect with no stats is an estimated loan');
  assert(kid.reasons.some(x => /estimated/.test(x)), 'flagged as an estimate');
  // an explicit depth-chart role beats the rank guess
  const starterKid = verdictOf(R.advise(noStats, opts({ teamGames: 0, roleOf: p => (p.player_id === 50 ? 'starter' : null) })), 50);
  assert.strictEqual(starterKid.verdict, 'develop');
}

// --- transfer ban, injuries, away players, thresholds ---------------------------------------------------------
{
  const squad = base().concat([P(60, 'MID', 19, 64, 82, 5000, 2029, 1, 90)]);
  assert.strictEqual(verdictOf(R.advise(squad, opts({ transferBan: true })), 60).blocked, true);
  assert(verdictOf(R.advise(squad, opts({ transferBan: true })), 60).reasons.some(x => /Transfer ban/.test(x)));
  assert.strictEqual(verdictOf(R.advise(squad, opts()), 60).blocked, false);
  assert.strictEqual(verdictOf(R.advise(squad, opts({ transferBan: true })), 1).blocked, false, 'keepers are never blocked');

  const away = R.advise(squad, opts({ isAway: p => p.player_id === 60 }));
  assert.strictEqual(verdictOf(away, 60), undefined, 'loaned-out / departed players are skipped');

  const strict = R.advise(squad, opts({ thresholds: { lowPlayShare: 0.01 } }));
  assert.strictEqual(verdictOf(strict, 60).verdict, 'develop', 'thresholds are tunable');
}

// --- robustness -----------------------------------------------------------------------------------------------
{
  assert.deepStrictEqual(R.advise([], opts()), []);
  assert.deepStrictEqual(R.advise(undefined, opts()), []);
  const rows = R.advise([P(70, 'MID', null, 70, 70, 100, 2027, 5, 400), P(71, 'MID', 25, 70, 70, 0, null, 5, 400)], opts());
  assert.strictEqual(verdictOf(rows, 70).verdict, 'monitor', 'unknown age is never given sell/loan advice');
  assert(rows.every(r => Number.isFinite(r.weight) && r.playTime && Array.isArray(r.reasons) && r.reasons.length), 'no NaN, every row explains itself');
  const dupe = R.advise([P(80, 'MID', 25, 70, 70, 100, 2027, 5, 400)], opts());
  assert.strictEqual(dupe.length, 1);
  // ordering: most actionable first
  const mixed = base().concat([P(90, 'MID', 32, 70, 70, 90000, 2027, 3, 200), P(91, 'MID', 19, 64, 82, 5000, 2029, 1, 90)]);
  const order = R.advise(mixed, opts());
  assert(order[0].weight >= order[order.length - 1].weight && order[0].verdict !== 'keep', 'actionable rows sort first');
}

console.log('roster_advice: all checks passed');
