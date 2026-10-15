// Sell / keep / loan advice: one explainable verdict per senior player, with the reasons that produced it.
//
// Pure logic, no DOM and no app.js globals: every squad-specific lookup (position group, depth-chart role, the current
// season) is passed in through `opts`, so scripts/test_roster_advice.js can exercise it with plain arrays. The Insights
// view that renders the result is a separate step. It reads like Squad Gaps (js/depth_chart.js): a short list of
// reasons, never a black-box score.
//
// Play time is the strongest signal, and the best source available is used, in this order:
//   1. minutes  - p.minutes over the minutes the team has played (needs the Live Editor / match-rating minutes)
//   2. apps     - p.appearances over the games the team has played (the FC 27 match-rating fallback has this today)
//   3. depth    - the depth-chart role (opts.roleOf), or failing that the player's rank in their position group
// The signal actually used is reported on every row (`playTime.source`) so the UI can say "estimated".
(function (root) {
  'use strict';

  const DEFAULTS = {
    youngAge: 22,          // at or under this a player is still being developed
    primeMaxAge: 28,       // over this a player is judged on what they give now, not on potential
    sellAge: 30,           // older than this and no longer a starter is a sell
    minGrowthGap: 5,       // potential - overall needed to count as a prospect worth developing
    lowPlayShare: 0.25,    // below this share of available play time = "not playing"
    rotationShare: 0.5,    // between lowPlayShare and this = rotation, at or above = regular
    overpaidRatio: 1.25,   // wage vs squad median at or above this = well paid
    expiringYears: 0,      // contract years left after this season at or under this = expiring
    slotsByGroup: { GK: 1, DEF: 4, MID: 3, ATT: 3 } // starters per group for the rank-based fallback
  };
  const MIN_GAMES = 3;     // below this the team has played too little for a play-time share to mean anything

  const num = v => (v == null || v === '' ? NaN : Number(v));
  const median = arr => {
    const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  // Games the team has played so far: explicit if given, else the most-capped player (a squad's busiest regular has
  // played in practically every match, so this is a safe lower bound).
  function teamGames(players, opts) {
    const given = num(opts.teamGames);
    if (Number.isFinite(given) && given > 0) return given;
    return players.reduce((m, p) => Math.max(m, num(p.appearances) || 0), 0);
  }

  // Share of available play time, 0..1+, from the best source this player has. Returns { share, source }.
  function playTime(p, games, role, rankStarter) {
    const mins = num(p.minutes);
    if (games >= MIN_GAMES && Number.isFinite(mins) && mins >= 0) {
      return { share: Math.min(1, mins / (games * 90)), source: 'minutes' };
    }
    const apps = num(p.appearances);
    if (games >= MIN_GAMES && Number.isFinite(apps) && apps >= 0) {
      return { share: Math.min(1, apps / games), source: 'apps' };
    }
    const r = role || (rankStarter ? 'starter' : 'reserve');
    const share = r === 'starter' ? 0.85 : r === 'backup' || r === 'rotation' ? 0.4 : 0.1;
    return { share, source: 'depth' };
  }

  // advise(players, opts) -> rows sorted most-actionable first.
  //   players  senior squad rows. Used fields: player_id, name, overall, potential, wage, contract_expiry (year),
  //            appearances, minutes (optional), injury, plus whatever the callbacks below read.
  //   opts.ageOf(p)          -> number | null          (required in practice; rows without an age are 'monitor')
  //   opts.groupOf(p)        -> 'GK'|'DEF'|'MID'|'ATT'  (position group; default one group for everybody)
  //   opts.roleOf(p)         -> 'starter'|'backup'|'reserve'|null   depth-chart role, optional
  //   opts.seasonEndYear     year the current season ends, to turn contract_expiry into years left (default: none)
  //   opts.teamGames         games played so far (default: derived from the squad)
  //   opts.transferBan       true when Youth Mode's transfer ban is active: sells/loans are flagged `blocked`
  //   opts.thresholds        overrides for DEFAULTS
  //   opts.isAway(p)         true for players not at the club (loaned out / left); they are skipped
  function advise(players, opts) {
    opts = opts || {};
    const T = Object.assign({}, DEFAULTS, opts.thresholds || {});
    const groupOf = opts.groupOf || (() => 'ALL');
    const squad = (players || []).filter(p => !(opts.isAway && opts.isAway(p)));
    if (!squad.length) return [];

    const games = teamGames(squad, opts);
    const medianWage = median(squad.map(p => num(p.wage)).filter(w => w > 0));

    // rank within position group by overall (1 = best) for the depth fallback and "blocked by" reasoning
    const byGroup = new Map();
    squad.forEach(p => {
      const g = groupOf(p);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(p);
    });
    const rankOf = new Map(), blockers = new Map();
    byGroup.forEach(list => {
      list.sort((a, b) => (num(b.overall) || 0) - (num(a.overall) || 0));
      list.forEach((p, i) => {
        rankOf.set(p, i + 1);
        blockers.set(p, list.filter(o => o !== p && (num(o.overall) || 0) >= (num(p.overall) || 0) + 3).length);
      });
    });

    const rows = squad.map(p => {
      const age = opts.ageOf ? opts.ageOf(p) : null;
      const ovr = num(p.overall) || 0, pot = num(p.potential) || 0;
      const gap = pot > 0 ? Math.max(0, pot - ovr) : 0;
      const group = groupOf(p);
      const rank = rankOf.get(p), blockedBy = blockers.get(p);
      const slots = (T.slotsByGroup && T.slotsByGroup[group]) || 1;
      const role = opts.roleOf ? opts.roleOf(p) : null;
      const pt = playTime(p, games, role, rank <= slots);
      const wage = num(p.wage) || 0;
      const wageRatio = medianWage > 0 && wage > 0 ? wage / medianWage : null;
      const expiry = parseInt(p.contract_expiry, 10);
      const yearsLeft = opts.seasonEndYear && Number.isFinite(expiry) && expiry >= 1900 ? expiry - opts.seasonEndYear : null;
      const expiring = yearsLeft != null && yearsLeft <= T.expiringYears;
      const wellPaid = wageRatio != null && wageRatio >= T.overpaidRatio;
      const notPlaying = pt.share < T.lowPlayShare;
      const regular = pt.share >= T.rotationShare;
      const reasons = [];
      let verdict = 'keep', weight = 0;

      const playText = pt.source === 'minutes' ? `${Math.round(pt.share * 100)}% of available minutes`
        : pt.source === 'apps' ? `${Math.round(pt.share * 100)}% of games played`
        : role ? `${role} in the depth chart` : `rank ${rank} of ${byGroup.get(group).length} at ${group}`;
      const suffix = pt.source === 'depth' ? ' (estimated)' : '';

      if (age == null || !Number.isFinite(age)) {
        verdict = 'monitor'; reasons.push('No date of birth, so age-based advice is skipped');
      } else if (age <= T.youngAge && gap >= T.minGrowthGap) {
        // a prospect: the question is only whether he is getting the minutes to grow
        if (notPlaying) {
          verdict = 'loan'; weight = 0.6 + Math.min(0.3, gap / 40);
          reasons.push(`Age ${age}, OVR ${ovr} / POT ${pot}: a prospect who needs minutes`);
          reasons.push(`Only ${playText}${suffix}`);
          if (blockedBy > 0) reasons.push(`${blockedBy} better ${group} player${blockedBy > 1 ? 's' : ''} ahead of him`);
        } else {
          verdict = 'develop'; weight = 0.2;
          reasons.push(`Age ${age}, OVR ${ovr} / POT ${pot}: growing, ${playText}${suffix}`);
        }
      } else if (age >= T.sellAge && !regular) {
        verdict = 'sell'; weight = 0.7 + (wellPaid ? 0.15 : 0) + (expiring ? 0.1 : 0);
        reasons.push(`Age ${age} and no longer a regular (${playText}${suffix})`);
        if (wellPaid) reasons.push(`Paid ${wageRatio.toFixed(1)}x the squad median`);
        if (expiring) reasons.push('Contract runs out this season: sell now or lose him for nothing');
      } else if (age > T.primeMaxAge && notPlaying && (wellPaid || blockedBy >= 2)) {
        verdict = 'sell'; weight = 0.55 + (wellPaid ? 0.15 : 0);
        reasons.push(`Age ${age}, ${playText}${suffix}: surplus`);
        if (wellPaid) reasons.push(`Paid ${wageRatio.toFixed(1)}x the squad median`);
        if (blockedBy >= 2) reasons.push(`${blockedBy} clearly better ${group} players ahead of him`);
      } else if (age > T.youngAge && age <= T.primeMaxAge && notPlaying && wellPaid) {
        verdict = 'sell'; weight = 0.5;
        reasons.push(`Not playing (${playText}${suffix}) on ${wageRatio.toFixed(1)}x the median wage`);
      } else if (age > T.youngAge && age <= T.primeMaxAge + 1 && notPlaying && gap >= T.minGrowthGap && age <= 25) {
        verdict = 'loan'; weight = 0.45;
        reasons.push(`Age ${age}, still room to grow (POT ${pot}) but only ${playText}${suffix}`);
      } else if (expiring && regular) {
        verdict = 'monitor'; weight = 0.4;
        reasons.push(`Key player (${playText}${suffix}) with his contract expiring: renew or cash in`);
      } else if (notPlaying) {
        verdict = 'monitor'; weight = 0.3;
        reasons.push(`Barely playing (${playText}${suffix})`);
      } else {
        verdict = 'keep';
        reasons.push(regular ? `Regular: ${playText}${suffix}` : `Rotation option: ${playText}${suffix}`);
      }

      const blocked = !!opts.transferBan && (verdict === 'sell' || verdict === 'loan');
      if (blocked) reasons.push('Transfer ban is active: no incoming or outgoing deals until it ends');
      if (num(p.injury) > 0 && (verdict === 'sell' || verdict === 'loan')) reasons.push('Currently injured, so his value or appeal may be lower');

      return { player: p, verdict, weight, blocked, reasons, age, playTime: pt, wageRatio, yearsLeft, rank, group };
    });

    return rows.sort((a, b) => b.weight - a.weight || (num(b.player.overall) || 0) - (num(a.player.overall) || 0));
  }

  const api = { advise, playTime, teamGames, DEFAULTS, MIN_GAMES };
  root.RosterAdvice = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
