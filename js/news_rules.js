// News rules: which stories make a weekly edition, when an edition is due, when an award race lead change is real
// news, headline variety, and the club stories (contracts, physio, scouts, breakthroughs) built from squad data.
// Pure functions over plain data, used by main.js (curateWeeklyEditionIfDue, checkRaceLeaderChanges,
// generateClubNews) and tested by scripts/test_news_rules.js.
//
// Why these rules (fixes for the old matchweek editions):
//  - stories expire instead of queueing forever (match news after FRESH_DAYS, slow club stories after
//    SLOW_FRESH_DAYS), so an August injury can no longer surface in October;
//  - editions are weekly by in-game date, so they also come out on FC 27 (no fixtures yet), in cup weeks and in the
//    off-season;
//  - up to MAX_STORIES, one per type, with injuries / recoveries / youth promotions always getting a slot when they
//    happened, and generic match filler only when there is little real news (never the same filler two weeks running);
//  - an award race is only news on a real overtake (ties never count, so two tied players can't ping-pong the lead),
//    at most once per RACE_COOLDOWN_DAYS per race unless our own player takes the lead.
(function (root) {
  'use strict';

  const DAY = 86400000;
  const MAX_STORIES = 5;
  // How long a story can wait for a slot. Match / event news: about one week of rollover, never two weeks late.
  // Club stories describe a situation that is still true next week (a contract running down), so they can wait for
  // a quieter edition.
  const FRESH_DAYS = 10;
  const SLOW_FRESH_DAYS = 28;
  const SLOW_TYPES = ['contract_expiring', 'physio_concern', 'scout_report', 'breakthrough'];
  const RACE_COOLDOWN_DAYS = 21;
  const FILLER_MIN_REAL = 3; // filler only when fewer real stories than this made the edition

  // Higher = more newsworthy. Types not listed rank 10.
  const NEWS_TYPE_PRIORITY = {
    competition_win: 100, ballon_dor: 96, hat_trick: 90, red_card: 85, player_of_month: 75, motm: 70,
    new_captain: 60, free_agent_signing: 58, youth_promotion: 55, win_streak: 50, unbeaten_streak: 48,
    breakthrough: 47, transfer: 45, brace: 45, contract_expiring: 44,
    race_lead_change: 42, golden_boot_race: 42, playmaker_race: 42, golden_glove_race: 42,
    milestone: 40, playstyle_eligible: 40, yellow_card_milestone: 38, contract_signed: 35,
    scout_report: 32, physio_concern: 30, injury_recovery: 25, injury: 20,
    notable_goal: 8, match_anticipation: 7, rivalry_battle: 6, post_match_reaction: 5, league_transfer: 3
  };
  // Always get a slot when they happened (the user's favourites, and too low-priority to win one otherwise).
  const RESERVED_TYPES = ['injury', 'injury_recovery', 'youth_promotion'];
  // Generic, not tied to a detected achievement.
  const FILLER_TYPES = ['notable_goal', 'match_anticipation', 'rivalry_battle', 'post_match_reaction', 'league_transfer'];

  // ---------------------------------------------------------------------------------------------------------
  // Dates
  // ---------------------------------------------------------------------------------------------------------

  // 'YYYY-MM-DD', 'YYYYMMDD' or a Date -> Date at local midnight; null if unreadable.
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    const m = String(v).match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);

  // The Monday that starts the in-game week containing `date`, as 'YYYY-MM-DD' (null if unreadable).
  function weekKey(date) {
    const d = toDate(date);
    if (!d) return null;
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Edition curation
  // ---------------------------------------------------------------------------------------------------------

  const priorityOf = t => (NEWS_TYPE_PRIORITY[t] != null ? NEWS_TYPE_PRIORITY[t] : 10);

  // pending: [{ id, news_type, event_date }] not yet in an edition; opts: { today, lastFillerType }.
  // -> { pick: [ids in display order], expire: [ids too old to ever run] }.
  // Undated stories count as fresh (they can't be aged).
  function curateEdition(pending, opts) {
    opts = opts || {};
    const today = toDate(opts.today);
    const expire = [], fresh = [];
    (pending || []).forEach(it => {
      const d = toDate(it.event_date);
      const limit = SLOW_TYPES.includes(it.news_type) ? SLOW_FRESH_DAYS : FRESH_DAYS;
      if (today && d && daysBetween(d, today) > limit) expire.push(it.id); else fresh.push(it);
    });
    const byNews = (a, b) => (priorityOf(b.news_type) - priorityOf(a.news_type)) || String(b.event_date || '').localeCompare(String(a.event_date || '')) || (b.id - a.id);
    const ranked = fresh.slice().sort(byNews);
    const seen = new Set(), pick = [];
    const take = it => { pick.push(it); seen.add(it.news_type); };

    // 1. reserved types first (one each), so they can never be crowded out
    RESERVED_TYPES.forEach(t => { const it = ranked.find(x => x.news_type === t); if (it) take(it); });
    // 2. the rest of the real news, best first, one per type
    ranked.forEach(it => { if (pick.length < MAX_STORIES && !seen.has(it.news_type) && !FILLER_TYPES.includes(it.news_type)) take(it); });
    // 3. at most one filler, only on a quiet week, never the same kind as last edition's
    if (pick.length < FILLER_MIN_REAL) {
      const filler = ranked.find(it => FILLER_TYPES.includes(it.news_type) && it.news_type !== opts.lastFillerType);
      if (filler) take(filler);
    }
    // reserved stories went in first only to guarantee their slot; show the edition in news order
    return { pick: pick.sort(byNews).map(it => it.id), expire };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Award races
  // ---------------------------------------------------------------------------------------------------------

  // The leader to store from a sorted-or-not pool: highest stat, ties going to the CURRENT leader (so a tie never
  // changes the leader), then lowest player_id for a stable pick. -> player row or null.
  function raceLeader(pool, statKey, prevLeaderId) {
    let best = null;
    (pool || []).forEach(p => {
      const v = Number(p[statKey]) || 0;
      if (v <= 0) return;
      if (!best) { best = p; return; }
      const bv = Number(best[statKey]) || 0;
      if (v > bv || (v === bv && (p.player_id === prevLeaderId || (best.player_id !== prevLeaderId && p.player_id < best.player_id)))) best = p;
    });
    return best;
  }

  // prev: { player_id, stat_value, announced_on } | null; next: { player_id, stat } (from raceLeader);
  // opts: { today, isOurs, prevInPool }. -> { leaderChanged, announce }. A change is only an overtake when the new leader's stat is strictly above the
  // stored leader's; it is announced unless another lead change in this race was announced within the cooldown,
  // except when our own player takes the lead.
  function raceDecision(prev, next, opts) {
    opts = opts || {};
    if (!next) return { leaderChanged: false, announce: false };
    if (!prev || prev.player_id == null) return { leaderChanged: true, announce: false }; // first leader: nothing overtaken
    if (prev.player_id === next.player_id) return { leaderChanged: false, announce: false };
    // the stored leader left the league's player pool (sold abroad, retired): hand over quietly, nobody overtook him
    if (opts.prevInPool === false) return { leaderChanged: true, announce: false };
    if (!(Number(next.stat) > Number(prev.stat_value))) return { leaderChanged: false, announce: false };
    const since = prev.announced_on && opts.today ? daysBetween(prev.announced_on, opts.today) : Infinity;
    return { leaderChanged: true, announce: !!opts.isOurs || since >= RACE_COOLDOWN_DAYS };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Headlines
  // ---------------------------------------------------------------------------------------------------------

  const HEADLINES = {
    injury: [
      '🚑 {name} has picked up an injury.',
      '🚑 Blow for the squad: {name} is out injured.',
      '🚑 {name} limps off and joins the treatment room.',
      '🚑 Injury news: {name} will be sidelined for now.',
      '🚑 The physios are assessing {name} after an injury.'
    ],
    injury_recovery: [
      '✅ {name} is back from injury.',
      '✅ Good news: {name} has returned to full training.',
      '✅ {name} is fit again and available for selection.',
      '✅ Back in contention: {name} has shaken off the injury.',
      '✅ The medical team have cleared {name} to play.'
    ],
    race_ours: [
      '{emoji} {name} takes the {label} lead with {stat} {statLabel}!',
      '{emoji} {name} moves top of the {label} race on {stat} {statLabel}!',
      '{emoji} One of ours leads the way: {name} tops the {label} standings with {stat} {statLabel}.'
    ],
    race_rival: [
      '{emoji} {name} ({team}) takes the {label} lead with {stat} {statLabel}.',
      '{emoji} {name} of {team} moves top of the {label} race on {stat} {statLabel}.',
      '{emoji} New {label} leader: {name} ({team}) with {stat} {statLabel}.'
    ],
    contract_expiring: [
      "📋 {name}'s contract runs out in {when}. Time to talk about a new deal?",
      "📋 {name}'s agent is waiting: the deal expires in {when}.",
      '📋 Contract watch: {name} is out of contract in {when}.'
    ],
    physio_concern: [
      '🩺 Physio concerned: {name} has been out {days} days in the last year.',
      '🩺 {name} keeps getting hurt: {count} injuries in twelve months.',
      "🩺 The medical team want to manage {name}'s workload after another injury."
    ],
    scout_report: [
      '🔍 Scouts flag {role} as a priority: {detail}.',
      '🔍 Scouting report: we need options at {role} ({detail}).',
      '🔍 The recruitment team are looking at {role}: {detail}.'
    ],
    breakthrough: [
      '📈 Breakthrough season for {name}: up {delta} to {overall} this season.',
      '📈 {name} is flying: +{delta} since the start of the season.',
      "📈 Nobody has improved more than {name} this year (+{delta}, now {overall})."
    ],
    breakthrough_young: [
      '🌟 Academy talent {name} is ahead of schedule: +{delta} this season, now {overall} at {age}.',
      '🌟 {name}, just {age}, has jumped {delta} points this season.',
      "🌟 The kids are alright: {name} (+{delta}) is developing faster than expected."
    ]
  };

  // Fills {key} placeholders; `rand` (0..1) picks the template, injectable for tests.
  function headline(kind, vars, rand) {
    const list = HEADLINES[kind];
    if (!list || !list.length) return '';
    const r = typeof rand === 'number' ? rand : Math.random();
    const t = list[Math.min(list.length - 1, Math.floor(r * list.length))];
    return t.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ''));
  }

  // ---------------------------------------------------------------------------------------------------------
  // Club stories
  // ---------------------------------------------------------------------------------------------------------

  const CONTRACT_NOTICE_MONTHS = 6, BREAKTHROUGH_DELTA = 5, YOUNG_MAX_AGE = 21;

  // Position id -> label, for the scout report in the main process (which has no access to app.js's POSITION_MAP;
  // kept identical to it).
  const POSITION_LABELS = ['GK', 'SW', 'RWB', 'RB', 'RCB', 'CB', 'LCB', 'LB', 'LWB', 'RDM', 'CDM', 'LDM', 'RM', 'RCM', 'CM',
    'LCM', 'LM', 'RAM', 'CAM', 'LAM', 'RF', 'CF', 'LF', 'RW', 'RS', 'ST', 'LS', 'LW'];

  // Months from `today` to 30 June of the expiry year (the same convention the app uses elsewhere); null if unknown.
  function monthsUntilExpiry(expiry, today) {
    const y = parseInt(expiry, 10), d = toDate(today);
    if (!Number.isFinite(y) || !d) return null;
    return (y - d.getFullYear()) * 12 + (5 - d.getMonth());
  }

  // ctx: { squad: own-club players [{ player_id, name, position_id, alt_positions, overall, potential, dob,
  //   contract_expiry, overall_delta }], injuries: Map(player_id -> episodes), today, seasonId, labelOf(posId),
  //   ageOf(player), squadRules: { bestElevenLevel, roleDepth }, injuryRules: { injurySummary, isInjuryProne }, rand }
  // -> [{ newsType, headline, playerId, dedupeKey }] — the dedupe keys make each story fire once (per contract, per
  // season, per role) however many times this runs.
  function clubStories(ctx) {
    const out = [];
    const squad = (ctx.squad || []).filter(p => p && p.player_id != null);
    if (squad.length === 0) return out;
    const rand = () => (typeof ctx.rand === 'function' ? ctx.rand() : Math.random());
    const level = ctx.squadRules.bestElevenLevel(squad);
    const ageOf = p => (ctx.ageOf ? ctx.ageOf(p) : null);

    // Contracts: important players (around the first team, or a young high-potential player) within 6 months.
    squad.map(p => ({ p, m: monthsUntilExpiry(p.contract_expiry, ctx.today) }))
      .filter(x => x.m != null && x.m >= 0 && x.m <= CONTRACT_NOTICE_MONTHS)
      .filter(x => (level.cutoff != null && Number(x.p.overall) >= level.cutoff - 3) || (ageOf(x.p) != null && ageOf(x.p) <= YOUNG_MAX_AGE && Number(x.p.potential) >= 80))
      .sort((a, b) => Number(b.p.overall) - Number(a.p.overall)).slice(0, 2)
      .forEach(({ p, m }) => out.push({ newsType: 'contract_expiring', playerId: p.player_id, dedupeKey: `contract_expiring:${p.player_id}:${p.contract_expiry}`,
        headline: headline('contract_expiring', { name: p.name, when: m <= 1 ? 'a matter of weeks' : `${m} months` }, rand()) }));

    // Physio: injury-prone by the Injuries view's rule; once per player per season.
    squad.forEach(p => {
      const sum = ctx.injuryRules.injurySummary(ctx.injuries ? ctx.injuries.get(p.player_id) || ctx.injuries.get(String(p.player_id)) || [] : [], ctx.today);
      if (ctx.injuryRules.isInjuryProne(sum)) {
        out.push({ newsType: 'physio_concern', playerId: p.player_id, dedupeKey: `physio_concern:${p.player_id}:${ctx.seasonId}`,
          headline: headline('physio_concern', { name: p.name, days: sum.recentDays, count: sum.recentCount }, rand()) });
      }
    });

    // Scouts: the worst real hole in the squad balance (empty role, or a weak starter with no natural backup).
    const holes = ctx.squadRules.roleDepth(squad, ctx.labelOf).map(r => {
      const starter = r.natural[0];
      if (!starter && !r.cover) return { role: r.role, detail: 'nobody plays there', sev: 3 };
      if (!starter) return { role: r.role, detail: `only ${r.cover.name} can cover`, sev: 2 };
      if (level.avg != null && Number(starter.overall) < level.avg - 8 && r.natural.length < 2) return { role: r.role, detail: `${starter.name} (${starter.overall}) has no backup`, sev: 1 };
      return null;
    }).filter(Boolean).sort((a, b) => b.sev - a.sev);
    if (holes[0]) out.push({ newsType: 'scout_report', playerId: null, dedupeKey: `scout_report:${ctx.seasonId}:${holes[0].role}`,
      headline: headline('scout_report', holes[0], rand()) });

    // Breakthroughs: +5 or more this season; academy-flavoured for 21 and under. Top two only.
    squad.filter(p => Number(p.overall_delta) >= BREAKTHROUGH_DELTA)
      .sort((a, b) => Number(b.overall_delta) - Number(a.overall_delta)).slice(0, 2)
      .forEach(p => {
        const age = ageOf(p), young = age != null && age <= YOUNG_MAX_AGE;
        out.push({ newsType: 'breakthrough', playerId: p.player_id, dedupeKey: `breakthrough:${p.player_id}:${ctx.seasonId}`,
          headline: headline(young ? 'breakthrough_young' : 'breakthrough', { name: p.name, delta: p.overall_delta, overall: p.overall, age }, rand()) });
      });
    return out;
  }

  const api = {
    MAX_STORIES, FRESH_DAYS, SLOW_FRESH_DAYS, SLOW_TYPES, RACE_COOLDOWN_DAYS, NEWS_TYPE_PRIORITY, RESERVED_TYPES, FILLER_TYPES, HEADLINES,
    toDate, weekKey, daysBetween, curateEdition, raceLeader, raceDecision, headline, monthsUntilExpiry, clubStories, POSITION_LABELS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NewsRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
