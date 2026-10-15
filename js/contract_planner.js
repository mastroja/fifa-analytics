// Contract planner: what the wage bill looks like in the coming seasons and what to do with each expiring contract.
//
// The Insights > Wages view (js/squad_analytics.js) already shows today's bill, the expiry chart and who is over- or
// underpaid. This is the forward-looking half: a season-by-season projection (what rolls off each summer, what the bill
// becomes if the planned renewals go through) and one recommended action per expiring player.
//
// Pure logic, no DOM and no app.js globals, so scripts/test_contract_planner.js can run it on plain arrays. Squad
// specifics are passed in through `opts`. FC 27 only stores the contract END YEAR (no start date or length), so
// contract_expiry = 2028 means "paid through the season that ends in 2028", i.e. a player is still on the books for
// the season ending Y while expiry >= Y. Wages are weekly, in whatever unit the squad rows use.
// Renewal wages are ESTIMATES: the squad's own wage-vs-overall curve, never below what he earns now.
(function (root) {
  'use strict';

  const DEFAULTS = {
    horizon: 3,            // seasons projected after the current one
    renewWithinYears: 1,   // players with this many years or fewer left get a plan (0 = expiring this summer only)
    shortDealAge: 31,      // renew these players for one more year, not the full horizon
    youngAge: 23           // at or under this a renewal is a prospect lock-in
  };

  const num = v => (v == null || v === '' ? NaN : Number(v));
  const expiryYear = p => { const y = parseInt(p.contract_expiry, 10); return Number.isFinite(y) && y >= 1900 ? y : null; };

  // Estimated weekly wage on renewal: the squad's curve at his overall, never below his current wage, times an optional
  // raise. Falls back to the current wage when there is no curve.
  function renewalWage(p, opts) {
    const cur = num(p.wage) || 0;
    const expected = opts.expectedWageOf ? num(opts.expectedWageOf(p)) : NaN;
    const base = Number.isFinite(expected) ? Math.max(cur, expected) : cur;
    return Math.max(cur, Math.round(base * (opts.renewalRaise || 1))); // rounding must never shave his current wage
  }

  // The action for one expiring player. `advice` is an optional RosterAdvice row ({ verdict, reasons }) for him.
  function actionFor(p, age, yearsLeft, advice, T) {
    const verdict = advice && advice.verdict;
    const reasons = [];
    const when = yearsLeft <= 0 ? 'contract ends this summer' : `${yearsLeft} year${yearsLeft > 1 ? 's' : ''} left on his deal`;
    if (verdict === 'sell') {
      reasons.push(yearsLeft <= 0 ? 'Recommended sale and the contract ends this summer: sell now or lose him for nothing' : `Recommended sale, ${when}: sell before the value drops`);
      return { action: yearsLeft <= 0 ? 'sell-now' : 'sell', reasons };
    }
    if (verdict === 'loan' || verdict === 'develop' || (age != null && age <= T.youngAge && !verdict)) {
      reasons.push(`Young and still developing, ${when}: lock him in${verdict === 'loan' ? ' (then loan him for minutes)' : ''}`);
      return { action: 'renew', reasons };
    }
    if (advice && advice.keyExpiring) {
      // RosterAdvice's 'monitor' for a regular on an expiring deal means "renew or cash in", not "undecided"
      const old = age != null && age >= T.shortDealAge;
      reasons.push(`Key player, ${when}: ${old ? 'a one-year extension' : 'renew him'}`);
      return { action: old ? 'renew-short' : 'renew', reasons };
    }
    if (age != null && age >= T.shortDealAge) {
      if (verdict === 'monitor') { reasons.push(`Age ${age}, no longer clearly needed, ${when}: let it run out`); return { action: 'let-go', reasons }; }
      reasons.push(verdict === 'keep' ? `Still a regular at ${age}, ${when}: a one-year extension` : `Age ${age}, ${when}: a one-year extension at most`);
      return { action: 'renew-short', reasons };
    }
    if (verdict === 'monitor') {
      reasons.push(`Undecided, ${when}: review before the window closes`);
      return { action: 'review', reasons };
    }
    reasons.push(`${verdict === 'keep' ? 'Part of the plan' : 'No red flags'}, ${when}: renew`);
    return { action: 'renew', reasons };
  }

  // plan(players, opts) -> { seasons, renewals, unknown, seasonEndYear }
  //   players  senior squad rows (player_id, name, overall, wage, contract_expiry, ...)
  //   opts.seasonEndYear   REQUIRED: the year the current season ends (2027 for 2026/27)
  //   opts.ageOf(p)        -> number | null
  //   opts.expectedWageOf(p) -> weekly wage the squad curve gives his overall (see fitWageCurve / expectedWage)
  //   opts.adviceOf(p)     -> a RosterAdvice row for him, if available
  //   opts.isAway(p)       true for loaned-out / departed players; they are skipped
  //   opts.wageBudget      weekly budget, optional: every season row then reports headroom
  //   opts.renewalRaise    multiplier on the estimated renewal wage (default 1)
  //   opts.thresholds      overrides for DEFAULTS
  function plan(players, opts) {
    opts = opts || {};
    const T = Object.assign({}, DEFAULTS, opts.thresholds || {});
    const end = opts.seasonEndYear;
    const squad = (players || []).filter(p => !(opts.isAway && opts.isAway(p)));
    if (!Number.isFinite(end) || !squad.length) return { seasons: [], renewals: [], unknown: [], seasonEndYear: end };

    const known = [], unknown = [];
    squad.forEach(p => { (expiryYear(p) == null ? unknown : known).push(p); });

    // one row per expiring player who needs a decision
    const renewals = known.map(p => {
      const exp = expiryYear(p), yearsLeft = exp - end;
      const age = opts.ageOf ? opts.ageOf(p) : null;
      const advice = opts.adviceOf ? opts.adviceOf(p) : null;
      const wage = num(p.wage) || 0;
      const a = actionFor(p, Number.isFinite(age) ? age : null, yearsLeft, advice, T);
      const renewal = renewalWage(p, opts);
      return { player: p, expiry: exp, yearsLeft, age: Number.isFinite(age) ? age : null, wage, renewalWage: renewal, raise: renewal - wage,
        action: a.action, reasons: a.reasons, advice: advice || null };
    }).filter(r => r.yearsLeft <= T.renewWithinYears)
      // most urgent first, then the most valuable players
      .sort((x, y) => x.yearsLeft - y.yearsLeft || (num(y.player.overall) || 0) - (num(x.player.overall) || 0));

    // For each projected season: wages still contracted, wages rolling off at its start, and the bill with renewals.
    // 'renew' keeps a player to the end of the horizon, 'renew-short' for one more year past his current expiry.
    const lastYear = end + T.horizon;
    const kept = new Map(); // player -> last season (year) the renewed deal covers
    renewals.forEach(r => {
      if (r.action === 'renew') kept.set(r.player, lastYear);
      else if (r.action === 'renew-short') kept.set(r.player, r.expiry + 1);
    });
    const renewalOf = new Map(renewals.map(r => [r.player, r.renewalWage]));
    const seasons = [];
    for (let y = end; y <= lastYear; y++) {
      const committed = known.filter(p => expiryYear(p) >= y);
      const rolling = y === end ? [] : known.filter(p => expiryYear(p) === y - 1);
      const committedWage = committed.reduce((s, p) => s + (num(p.wage) || 0), 0);
      // renewed players whose current deal has run out by season y but whose renewal still covers it
      const renewed = [...kept.entries()].filter(([p, until]) => expiryYear(p) < y && until >= y);
      const renewedWage = renewed.reduce((s, [p]) => s + renewalOf.get(p), 0);
      const withRenewals = committedWage + renewedWage;
      const row = { endYear: y, label: `${y - 1}/${String(y).slice(2)}`, committedWage, committedCount: committed.length,
        rollingOffWage: rolling.reduce((s, p) => s + (num(p.wage) || 0), 0), rollingOffCount: rolling.length,
        renewedWage, renewedCount: renewed.length, withRenewals };
      if (Number.isFinite(num(opts.wageBudget)) && num(opts.wageBudget) > 0) {
        row.headroom = num(opts.wageBudget) - withRenewals;
        row.overBudget = row.headroom < 0;
      }
      seasons.push(row);
    }
    return { seasons, renewals, unknown, seasonEndYear: end };
  }

  const api = { plan, renewalWage, actionFor, DEFAULTS };
  root.ContractPlanner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
