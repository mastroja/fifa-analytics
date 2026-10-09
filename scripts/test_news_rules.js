// node scripts/test_news_rules.js — js/news_rules.js: edition curation, weekly timing, award race rules, headlines,
// club stories.
const assert = require('assert');
const N = require('../js/news_rules.js');
const squadRules = require('../js/insights_squad.js');
const injuryRules = require('../js/insights_injuries.js');

// ---- dates / weeks ----
assert.strictEqual(N.weekKey('2026-10-15'), '2026-10-12', 'Thursday -> that Monday');
assert.strictEqual(N.weekKey('20261012'), '2026-10-12', 'Monday is its own week start, 8-digit dates work');
assert.strictEqual(N.weekKey('2026-10-18'), '2026-10-12', 'Sunday still belongs to the same week');
assert.strictEqual(N.weekKey('2026-10-19'), '2026-10-19');
assert.strictEqual(N.weekKey('2027-01-01'), '2026-12-28', 'week spanning the new year');
assert.strictEqual(N.weekKey('junk'), null);
assert.strictEqual(N.daysBetween('2026-10-01', '20261015'), 14);

// ---- curation ----
let id = 1;
const S = (type, date) => ({ id: id++, news_type: type, event_date: date });
const today = '2026-10-15';

// stale stories expire instead of queueing forever
let r = N.curateEdition([S('hat_trick', '2026-09-01'), S('injury', '2026-10-10'), S('brace', '2026-10-08')], { today });
assert.deepStrictEqual(r.expire.length, 1, 'only the 6-week-old story expires');
// match news can roll over about a week, never two; slow club stories wait for a quieter edition
r = N.curateEdition([S('brace', '2026-10-04'), S('brace', '2026-10-06'), S('contract_expiring', '2026-09-20'), S('physio_concern', '2026-09-10')], { today });
assert.strictEqual(r.expire.length, 2, '11-day-old brace and 35-day-old physio story expire: ' + r.expire);
assert.strictEqual(r.pick.length, 2, '9-day-old brace and 25-day-old contract story still run');
assert.strictEqual(r.pick.length, 2);

// at most MAX_STORIES, one per type
const many = [S('hat_trick', '2026-10-14'), S('hat_trick', '2026-10-13'), S('motm', '2026-10-14'), S('red_card', '2026-10-12'),
  S('transfer', '2026-10-11'), S('brace', '2026-10-11'), S('milestone', '2026-10-10'), S('contract_signed', '2026-10-09')];
r = N.curateEdition(many, { today });
assert.strictEqual(r.pick.length, N.MAX_STORIES);
const typesOf = ids => ids.map(i => [...many, ...pool].find(x => x.id === i).news_type);
var pool = [];
assert.strictEqual(new Set(typesOf(r.pick)).size, r.pick.length, 'no type twice');
assert.strictEqual(typesOf(r.pick)[0], 'hat_trick', 'best story leads the edition');

// injuries / recoveries / youth always get a slot, even in a packed week
pool = [S('injury', '2026-10-14'), S('injury_recovery', '2026-10-13'), S('youth_promotion', '2026-10-12')];
r = N.curateEdition(many.concat(pool), { today });
const t = typesOf(r.pick);
assert(t.includes('injury') && t.includes('injury_recovery') && t.includes('youth_promotion'), 'reserved types make it: ' + t);
assert.strictEqual(r.pick.length, N.MAX_STORIES);
assert(t.includes('hat_trick') && t.includes('red_card'), 'and the two biggest stories still lead');
assert.strictEqual(t[0], 'hat_trick', 'shown in news order, not reserved-first');

// filler: only in a quiet week, one at most, never the same kind as last edition
pool = [S('rivalry_battle', '2026-10-14'), S('post_match_reaction', '2026-10-14'), S('notable_goal', '2026-10-13')];
r = N.curateEdition([S('injury', '2026-10-14')].concat(pool), { today, lastFillerType: 'rivalry_battle' });
pool = pool.concat([]);
const quiet = r.pick.map(i => [...pool, { id: i }].find(x => x.id === i)).map(x => x && x.news_type).filter(Boolean);
assert.strictEqual(r.pick.length, 2, 'injury + one filler');
assert(!quiet.includes('rivalry_battle'), 'not the same filler as last week');
r = N.curateEdition(many.slice(0, 4).concat(pool), { today });
assert.strictEqual(typesOf(r.pick).filter(x => N.FILLER_TYPES.includes(x)).length, 0, 'busy week: no filler');
assert.deepStrictEqual(N.curateEdition([], { today }), { pick: [], expire: [] });
assert.strictEqual(N.curateEdition([S('motm', null)], { today }).pick.length, 1, 'undated stories are not expired');

// ---- award races ----
const P = (player_id, goals) => ({ player_id, goals });
assert.strictEqual(N.raceLeader([P(1, 5), P(2, 5)], 'goals', 2).player_id, 2, 'tie stays with the current leader');
assert.strictEqual(N.raceLeader([P(2, 5), P(1, 5)], 'goals', null).player_id, 1, 'tie with no leader: stable lowest id');
assert.strictEqual(N.raceLeader([P(1, 0)], 'goals', null), null, 'nobody on the board yet');
assert.strictEqual(N.raceLeader([P(1, 4), P(2, 6)], 'goals', 1).player_id, 2);

let d = N.raceDecision(null, { player_id: 1, stat: 1 }, { today });
assert.deepStrictEqual(d, { leaderChanged: true, announce: false }, 'first leader of the season is not news');
d = N.raceDecision({ player_id: 1, stat_value: 5 }, { player_id: 2, stat: 5 }, { today });
assert.deepStrictEqual(d, { leaderChanged: false, announce: false }, 'a tie is not an overtake');
d = N.raceDecision({ player_id: 1, stat_value: 5, announced_on: '2026-10-01' }, { player_id: 2, stat: 6 }, { today });
assert.deepStrictEqual(d, { leaderChanged: true, announce: false }, 'real overtake inside the cooldown: tracked, not announced');
d = N.raceDecision({ player_id: 1, stat_value: 5, announced_on: '2026-10-01' }, { player_id: 2, stat: 6 }, { today, isOurs: true });
assert.strictEqual(d.announce, true, 'our player taking the lead always makes news');
d = N.raceDecision({ player_id: 1, stat_value: 5, announced_on: '2026-09-01' }, { player_id: 2, stat: 6 }, { today });
assert.strictEqual(d.announce, true, 'after the cooldown');
d = N.raceDecision({ player_id: 1, stat_value: 5 }, { player_id: 2, stat: 6 }, { today });
assert.strictEqual(d.announce, true, 'never announced before');
d = N.raceDecision({ player_id: 1, stat_value: 9 }, { player_id: 2, stat: 3 }, { today, prevInPool: false });
assert.deepStrictEqual(d, { leaderChanged: true, announce: false }, 'leader left the league: quiet hand-over, race not frozen');
assert.deepStrictEqual(N.raceDecision({ player_id: 1, stat_value: 5 }, null, {}), { leaderChanged: false, announce: false });

// ---- headlines ----
const h0 = N.headline('injury', { name: 'Lewis' }, 0), h1 = N.headline('injury', { name: 'Lewis' }, 0.99);
assert(h0.includes('Lewis') && h1.includes('Lewis') && h0 !== h1, 'templates vary and fill the name');
assert(!/\{\w+\}/.test(N.headline('race_rival', { emoji: '👢', name: 'X', team: 'Y', label: 'Golden Boot', stat: 7, statLabel: 'goals' }, 0.5)), 'no placeholders left');
assert.strictEqual(N.headline('nope', {}), '');
Object.entries(N.HEADLINES).forEach(([k, list]) => assert(list.length >= 3, k + ' has at least 3 variants'));

// ---- club stories ----
const labels = { 0: 'GK', 5: 'CB', 3: 'RB', 7: 'LB', 10: 'CDM', 14: 'CM', 18: 'CAM', 23: 'RW', 27: 'LW', 25: 'ST' };
const sq = [
  { player_id: 1, name: 'Keeper', position_id: 0, overall: 75, contract_expiry: 2029, dob: '1995', overall_delta: 0 },
  { player_id: 2, name: 'Star', position_id: 25, overall: 82, contract_expiry: 2027, overall_delta: 1 },
  { player_id: 3, name: 'Kid', position_id: 14, overall: 66, potential: 85, contract_expiry: 2027, overall_delta: 7, age: 19 },
  { player_id: 4, name: 'Vet', position_id: 5, overall: 74, contract_expiry: 2029, overall_delta: 6, age: 30 },
  { player_id: 5, name: 'Fringe', position_id: 5, overall: 60, contract_expiry: 2027, overall_delta: 0 },
  { player_id: 6, name: 'Crock', position_id: 14, overall: 73, contract_expiry: 2030, overall_delta: 0 }
];
const injuries = new Map([[6, [{ start_date: '2026-01-01', end_date: '2026-03-15' }, { start_date: '2026-08-01', end_date: '2026-08-20' }]]]);
const ctx = { squad: sq, injuries, today: '2027-01-15', seasonId: 9, labelOf: id => labels[id] || 'SUB', ageOf: p => p.age ?? 25,
  squadRules, injuryRules, rand: () => 0 };
const stories = N.clubStories(ctx);
const of = type => stories.filter(s => s.newsType === type);
assert.deepStrictEqual(of('contract_expiring').map(s => s.playerId), [2, 3], 'top two by overall among first-team + young high-potential players: Star, then Kid');
assert(of('contract_expiring')[0].headline.includes('5 months'), of('contract_expiring')[0].headline);
assert.deepStrictEqual(of('physio_concern').map(s => s.playerId), [6]);
assert.strictEqual(of('scout_report').length, 1, 'one scout report: the worst hole');
assert(of('scout_report')[0].headline.includes('nobody plays there'), of('scout_report')[0].headline);
assert.deepStrictEqual(of('breakthrough').map(s => s.playerId), [3, 4], 'biggest risers first');
assert(of('breakthrough')[0].headline.startsWith('🌟') && of('breakthrough')[1].headline.startsWith('📈'), 'young vs senior wording');
assert.strictEqual(new Set(stories.map(s => s.dedupeKey)).size, stories.length, 'unique dedupe keys');
assert.deepStrictEqual(N.clubStories({ ...ctx, squad: [] }), []);
// an expired contract (past) is not "expiring"
assert.strictEqual(N.clubStories({ ...ctx, today: '2027-08-01' }).filter(s => s.newsType === 'contract_expiring').length, 0);

console.log('news rules tests passed');
