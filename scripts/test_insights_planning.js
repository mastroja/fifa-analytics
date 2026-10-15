// node scripts/test_insights_planning.js — renders the Roster Moves / Progression / Contract Plan views (js/insights_planning.js)
// in node: the HTML builders with an explicit env, then the live wiring against fake app.js globals.
const assert = require('assert');

require('../js/charts.js');
require('../js/squad_analytics.js');                 // defines the real Insights + SquadAnalytics; replaced by a fake below
const realInsights = globalThis.Insights;            // kept to draw the real Home Contracts card in the live section
const registered = {}, wageSections = {}; let refreshes = 0, renders = 0;
globalThis.Insights = { addView(k, fn) { registered[k] = fn; }, addWagesSection(slot, fn) { (wageSections[slot] = wageSections[slot] || []).push(fn); }, refresh() { refreshes++; }, render() { renders++; } };
require('../js/roster_advice.js');
require('../js/progression.js');
require('../js/contract_planner.js');
const V = require('../js/insights_planning.js');

assert(/\.planning-wrap\s*\{\s*overflow-x:\s*auto/.test(require('fs').readFileSync(__dirname + '/../index.html', 'utf8')), 'index.html styles the scrolling table wrapper');
assert(/\.planning-table td\s*\{[^}]*white-space:\s*normal/.test(require('fs').readFileSync(__dirname + '/../index.html', 'utf8')), 'cells must wrap: the app inherits nowrap, which made the Why column 500px wide');
assert.deepStrictEqual(Object.keys(registered).sort(), ['advice', 'progress'], 'registers the two views');
assert.deepStrictEqual(Object.keys(wageSections).sort(), ['cards', 'table'], 'fills both Wages & Contracts slots');
const ids = require('fs').readFileSync(__dirname + '/../index.html', 'utf8');
['advice', 'progress'].forEach(k => assert(ids.includes(`id="insights-view-${k}"`) && ids.includes(`Insights.setView('${k}')`), `index.html has the ${k} button`));
assert(!ids.includes('insights-view-contracts') && !ids.includes('Contract Plan</button>'), 'there is no separate Contract Plan tab: wages and contracts are one view');
assert.strictEqual((ids.match(/id="insights-view-wages"/g) || []).length, 1);
const tag = f => `<script src="js/${f}.js"></script>`;
['roster_advice', 'progression', 'contract_planner', 'insights_planning'].forEach(f => assert(ids.includes(tag(f)), `index.html loads ${f}.js`));
['roster_advice', 'progression', 'contract_planner', 'squad_analytics', 'charts'].forEach(f => assert(ids.indexOf(tag(f)) < ids.indexOf(tag('insights_planning')), `${f}.js loads before insights_planning.js`));

// id, name, group, age, ovr, pot, wage, expiry, apps, minutes
const P = (id, name, group, age, ovr, pot, wage, expiry, apps, minutes, extra) =>
  Object.assign({ player_id: id, name, group, age, overall: ovr, potential: pot, wage, contract_expiry: expiry, appearances: apps, minutes, overall_delta: 0, __clubStatus: 'normal' }, extra);
const squad = () => [
  P(1, 'Star Mid', 'MID', 26, 80, 80, 50000, 2029, 20, 1800),
  P(2, 'Second Mid', 'MID', 27, 78, 78, 40000, 2029, 19, 1700),
  P(3, 'Third Mid', 'MID', 25, 76, 77, 30000, 2029, 18, 1600),
  P(4, 'Young <b>Kid</b>', 'MID', 19, 64, 82, 5000, 2029, 1, 90),            // loan, and a name that must be escaped
  P(5, 'Old Timer', 'MID', 32, 70, 70, 90000, 2027, 3, 200),                 // sell, expires this summer
  P(6, 'Key Expiring', 'MID', 28, 79, 79, 45000, 2027, 20, 1750)             // regular on an expiring deal
];
const env = extra => Object.assign({
  players: squad(), filter: 'all', transferBan: false, seasonEndYear: 2027,
  ageOf: p => p.age, groupOf: p => p.group, posLabel: p => p.group,
  wageFmt: v => '€' + Math.round(v).toLocaleString(), wageShort: v => '€' + Math.round(v / 1000) + 'K',
  expectedWageOf: p => p.wage * 1.1, barsHtml: rows => globalThis.Charts.barsHtml(rows), histories: null, seasonLabel: null
}, extra);
const noRawTags = html => assert(!/<b>Kid<\/b>/.test(html) && /&lt;b&gt;Kid&lt;\/b&gt;/.test(html), 'player names are escaped');

// --- Roster Moves ---------------------------------------------------------------------------------------------
{
  const h = V.adviceHtml(env());
  assert(h.includes('Sell / keep / loan') && h.includes('Old Timer') && h.includes('Star Mid'));
  assert(h.includes('planning-wrap') && h.includes('planning-table'), 'wide table sits in a scrolling wrapper');
  assert(/>Sell</.test(h) && />Loan</.test(h) && />Keep</.test(h), 'verdict badges are drawn');
  assert(/>Renew\?</.test(h), 'an expiring key player reads "Renew?" on the row');
  noRawTags(h);
  assert(h.includes('% <span') && h.includes('of minutes'), 'minutes-based play time is labelled');
  assert(h.includes('uses') || h.includes('Play time uses'), 'footnote present');
  assert(/Play time uses\s+minutes played/.test(h), 'footnote names the source in use');

  const filtered = V.adviceHtml(env({ filter: 'sell' }));
  assert(filtered.includes('Old Timer') && !filtered.includes('Star Mid'), 'the filter narrows the table');
  assert(filtered.includes('show all'));
  assert(V.adviceHtml(env({ filter: 'bogus' })).includes('Star Mid'), 'unknown filter falls back to all');
  assert(/Nobody is currently a "Develop"/.test(V.adviceHtml(env({ filter: 'develop' }))), 'empty filter says so');

  const ban = V.adviceHtml(env({ transferBan: true }));
  assert(ban.includes('transfer ban is active') && ban.includes('blocked'), 'ban banner and blocked marker');
  assert(!V.adviceHtml(env()).includes('transfer ban is active'));

  const noStats = V.adviceHtml(env({ players: squad().map(p => ({ ...p, appearances: undefined, minutes: undefined })) }));
  assert(noStats.includes('estimated') && /marked "estimated"/.test(noStats), 'no stats: estimated play time is called out');
  const appsOnly = V.adviceHtml(env({ players: squad().map(p => ({ ...p, minutes: undefined })) }));
  assert(/Play time uses\s+appearances/.test(appsOnly) && appsOnly.includes('of games'));

  assert(V.adviceHtml(env({ players: [] })).includes('No squad loaded'));
}

// --- Progression ----------------------------------------------------------------------------------------------
{
  assert(V.progressHtml(env()).includes('Not enough history'), 'no history and zero deltas: says so instead of an empty board');
  assert(V.progressHtml(env({ players: [] })).includes('No squad loaded'));

  const row = (season, overall, potential) => ({ season, overall, potential });
  const players = [
    P(1, 'Rocket', 'MID', 19, 71, 85, 1, 2029, 10, 800),
    P(2, 'Slowpoke', 'MID', 19, 64, 76, 1, 2029, 10, 800),
    P(3, 'Fading <i>Star</i>', 'MID', 31, 76, 76, 1, 2029, 10, 800),
    P(4, 'Steady', 'MID', 27, 80, 80, 1, 2029, 10, 800)
  ];
  const histories = new Map([
    [1, [row('2025/26', 64, 84), row('2026/27', 70, 85)]], [2, [row('2025/26', 64, 76), row('2026/27', 64, 76)]],
    [3, [row('2025/26', 80, 80), row('2026/27', 76, 76)]], [4, [row('2025/26', 80, 80), row('2026/27', 80, 80)]]
  ]);
  const h = V.progressHtml(env({ players, histories, seasonLabel: '2026/27' }));
  assert(h.includes('planning-wrap') && h.includes('planning-table'), 'wide table sits in a scrolling wrapper');
  assert(h.includes('Biggest risers') && h.includes('Stalling prospects') && h.includes('Biggest fallers') && h.includes('Whole squad'));
  assert(/Rocket/.test(h) && /Slowpoke/.test(h) && /Steady/.test(h));
  assert(!/<i>Star<\/i>/.test(h) && /&lt;i&gt;Star&lt;\/i&gt;/.test(h), 'names escaped');
  assert(/>Rising</.test(h) && />Stalling</.test(h) && />Declining</.test(h) && />On track</.test(h), 'each status badge appears');
  const risers = h.slice(h.indexOf('Biggest risers'), h.indexOf('Stalling prospects'));
  assert(risers.includes('Rocket') && !risers.includes('Slowpoke'), 'risers list holds the riser only');
  assert(h.includes('+7'), 'shows the +7 change: 64 -> the live 71, which replaces the stored 70');
  // without the current label the live value is appended and read as a second change: still renders
  assert(V.progressHtml(env({ players, histories })).includes('Whole squad'));
}

// --- Wages & Contracts sections (projection card + decisions table) ------------------------------------------------
{
  const card = V.planCardHtml(env()), table = V.planTableHtml(env());
  assert(card.includes('Projected wage bill') && card.includes('2026/27') && card.includes('2027/28'), 'projection card with season labels');
  assert(!card.includes('Wage bill now') && !table.includes('Wage bill now'), 'no duplicate tiles: the wage view already has them');
  assert(table.includes('Contract decisions') && table.includes('Old Timer') && table.includes('Key Expiring'), 'expiring players are listed');
  assert(table.includes('planning-wrap') && table.includes('planning-table'), 'wide table sits in a scrolling wrapper');
  assert(!table.includes('Star Mid'), 'players with years left are not');
  assert(table.includes('this summer'));
  assert(/>Sell now</.test(table), 'the advised sale on an expiring deal is "Sell now"');
  assert(/>Renew</.test(table), 'the expiring regular is a renewal, not "Review"');
  assert(!/>Review</.test(table), 'no key player is left undecided');
  const oldRow = table.slice(table.indexOf('Old Timer'), table.indexOf('</tr>', table.indexOf('Old Timer')));
  assert(!/€99,000/.test(oldRow), 'no renewal wage is quoted for a player being sold');
  const keyRow = table.slice(table.indexOf('Key Expiring'), table.indexOf('</tr>', table.indexOf('Key Expiring')));
  assert(keyRow.includes('€49,500') && keyRow.includes('+€4,500'), 'renewal is priced at the curve and the rise shown');
  assert(table.includes('estimates'), 'footnote says renewal wages are estimates');

  // nothing to plan with: sections vanish quietly (the wage view itself shows its own empty states)
  assert.strictEqual(V.planCardHtml(env({ seasonEndYear: NaN })), '');
  assert.strictEqual(V.planTableHtml(env({ players: [] })), '');
  assert.strictEqual(V.planCardHtml(env({ players: squad().map(p => ({ ...p, contract_expiry: null })) })), '', 'no contract dates at all: no projection');
  const quiet = V.planTableHtml(env({ players: squad().map(p => ({ ...p, contract_expiry: 2031 })) }));
  assert(quiet.includes('runs out in the planning window'), 'nothing expiring: friendly empty state');
  const unk = V.planCardHtml(env({ players: squad().concat([P(9, 'No Date', 'MID', 25, 70, 70, 1000, null, 5, 400)]) }));
  assert(unk.includes('no contract date') && unk.includes('left out'), 'players without a date are called out');
  noRawTags(V.planTableHtml(env({ players: [P(4, 'Young <b>Kid</b>', 'MID', 19, 64, 82, 5000, 2027, 1, 90)].concat(squad().slice(0, 3)) })));
}

// --- Player profile card ------------------------------------------------------------------------------------------
{
  const e = env();
  const seasons = [{ year_label: '2025/26', overall: 61, potential: 82 }, { year_label: '2026/27', overall: 64, potential: 82 }];
  const kid = squad()[3];
  const card = V.profileCardHtml(e, kid, seasons);
  assert(card.includes('<h3') && card.includes('Planning') && /Roster Moves/.test(card), 'card with a link to Roster Moves');
  assert(/>Loan</.test(card) && /prospect who needs minutes/.test(card), 'the prospect is a loan with the reason');
  assert(/Progression:/.test(card) && /OVR since last season/.test(card), 'progression line from the season rows');
  assert(!/Contract:/.test(card), 'no contract action for a deal with years left');
  assert(/Rule-of-thumb/.test(card));
  assert(!/<b>/.test(card) && !card.includes('Kid</b>'), 'nothing unescaped leaks into the card');

  // the live current-season row must not be double counted: 61 -> 64 is +3, not 0
  assert(/\+3 OVR since last season/.test(card), 'current season row is refreshed, not duplicated');
  const noLabel = V.profileCardHtml(e, kid, [{ overall: 61 }, { overall: 64 }]);
  assert(noLabel.includes('Planning'), 'season rows without labels still render the card');

  const vet = squad()[4];                                   // Old Timer: sell, expires this summer
  const vc = V.profileCardHtml(e, vet, [{ year_label: '2025/26', overall: 72, potential: 72 }, { year_label: '2026/27', overall: 70, potential: 70 }]);
  assert(/>Sell</.test(vc) && /Contract:/.test(vc) && />Sell now</.test(vc), 'verdict and the contract action');
  assert.strictEqual((vc.match(/sell now or lose him/g) || []).length, 1, 'the expiring-sale reason is shown once');
  assert(!/est\. €/.test(vc), 'no renewal wage for a player being sold');
  const key = V.profileCardHtml(e, squad()[5], seasons);
  assert(/>Renew</.test(key) && /est\. €49,500/.test(key), 'a key expiring player shows the renewal estimate');

  assert.strictEqual(V.profileCardHtml(e, { player_id: 999, name: 'Not In Squad' }, seasons), '', 'not a senior squad player: nothing');
  assert.strictEqual(V.profileCardHtml(e, null, seasons), '');
  assert.strictEqual(V.profileCardHtml(e, kid, undefined).includes('Planning'), true, 'no season rows at all still renders');
  const ban = V.profileCardHtml(env({ transferBan: true }), kid, seasons);
  assert(/blocked/.test(ban), 'blocked marker under a transfer ban');
}

// --- Home: Roster Moves card and Contracts pills ------------------------------------------------------------------
{
  const h = V.homeMovesHtml(env());
  assert(/<strong>1<\/strong> to sell/.test(h) && /<strong>1<\/strong> to loan out/.test(h), 'counts');
  assert(h.indexOf('Old Timer') < h.indexOf('Young'), 'sells come before loans');
  assert(h.includes('home-list-full'), 'uses the full-height list, not the 160px scroll box');
  assert(/Age 32 and no longer a regular/.test(h), 'first reason shown under each move');
  assert(/2 contracts end this summer/.test(h), 'summer expiries are mentioned');
  assert(!h.includes('Star Mid'), 'keep/develop players are not listed');
  assert(/&lt;b&gt;Kid&lt;\/b&gt;/.test(h) && !h.includes('<b>Kid'), 'names escaped');
  assert(V.homeMovesHtml(env({ transferBan: true })).includes('Transfer ban active'));
  assert(!h.includes('Transfer ban active'));

  // more than five moves: list is capped with a "+n more"
  const many = Array.from({ length: 8 }, (_, i) => P(200 + i, 'Vet' + i, 'MID', 33, 68, 68, 90000 + i, 2029, 2, 100)).concat(squad().slice(0, 3));
  const mh = V.homeMovesHtml(env({ players: many }));
  assert((mh.match(/<li /g) || []).length === 5 && /\+3 more/.test(mh), 'capped at five with +n more');

  const calm = V.homeMovesHtml(env({ players: squad().slice(0, 3).map(p => ({ ...p, contract_expiry: 2031 })) }));
  assert(/No sales or loans recommended/.test(calm) && !/contracts? end this summer/.test(calm), 'quiet squad: friendly message');
  assert(V.homeMovesHtml(env({ players: [] })).includes('No squad loaded'));

  const acts = V.homeActionsFor(env());
  assert(acts instanceof Map && acts.size === 2, 'one pill per contract decision (here: the two deals ending by 2028)');
  assert(/Sell now/.test(acts.get('5')) && /Renew/.test(acts.get('6')), 'keyed by string player id');
  assert(!acts.has('1'), 'players with years left have no pill');
  assert.strictEqual(V.homeActionsFor(env({ seasonEndYear: NaN })).size, 0, 'no plan: no pills');
}

// --- live wiring: fake app.js globals, async Progression load, error guard, invalidation ---------------------------
(async () => {
  const live = squad();
  Object.assign(globalThis, {
    currentPlayers: live.concat([P(99, 'Loaned Out', 'MID', 22, 60, 70, 100, 2027, 0, 0, { __clubStatus: 'loan' })]),
    currentSaveId: 7, currentIngameDate: '2027-01-10', challengeStatus: { ban: { active: { id: 1 } } },
    getPositionInfo: () => ({ group: 'MID', label: 'CM' }), computeAge: dob => dob,
    formatWageAmount: v => '€' + v, currencySymbol: () => '€', convertFromEur: v => v,
    parseBirthDate: s => new Date(s)
  });
  live.forEach(p => { p.dob = p.age; });

  const advice = registered.advice();
  assert(advice.includes('Old Timer') && !advice.includes('Loaned Out'), 'live advice view uses the senior squad only');
  assert(advice.includes('transfer ban is active'), 'reads the live transfer-ban state');
  const secCard = wageSections.cards[0](), secTable = wageSections.table[0]();
  assert(secCard.includes('Projected wage bill') && secTable.includes('Old Timer'), 'live wages sections');
  assert.strictEqual(V.seasonEndYearNow(), 2027, 'January 2027 is the 2026/27 season');
  globalThis.currentIngameDate = '2026-09-01'; assert.strictEqual(V.seasonEndYearNow(), 2027, 'September 2026 too');
  globalThis.currentIngameDate = '2027-07-01'; assert.strictEqual(V.seasonEndYearNow(), 2028, 'July starts the next season');
  globalThis.currentIngameDate = '2027-01-10';

  // the real Home Contracts card (squad_analytics) picks the planner's pills up through InsightsPlanning.homeActions
  const els = { 'home-contracts-body': { innerHTML: '' }, 'home-roster-moves-body': { innerHTML: '' } };
  globalThis.document = { getElementById: id => els[id] || null };
  globalThis.computeMonthsUntilExpiry = y => (parseInt(y, 10) - 2027) * 12 + 5;
  realInsights.renderHomeWidget();
  assert(/Sell now/.test(els['home-contracts-body'].innerHTML) && /Renew/.test(els['home-contracts-body'].innerHTML), 'Contracts card shows the action pills');
  assert(els['home-contracts-body'].innerHTML.includes('home-list-full'));
  V.renderHomeWidget();
  assert(/to sell/.test(els['home-roster-moves-body'].innerHTML), 'live Roster Moves card');
  const keep = globalThis.InsightsPlanning.homeActions; globalThis.InsightsPlanning.homeActions = () => { throw new Error('nope'); };
  const mute0 = console.error; console.error = () => {};
  realInsights.renderHomeWidget();
  console.error = mute0; globalThis.InsightsPlanning.homeActions = keep;
  assert(!/Sell now/.test(els['home-contracts-body'].innerHTML) && /expiring within 12 months/.test(els['home-contracts-body'].innerHTML), 'a failing pill lookup still draws the card, without pills');
  els['home-roster-moves-body'] = null; assert.doesNotThrow(() => V.renderHomeWidget(), 'no Home card in the page: nothing to do');
  els['home-roster-moves-body'] = { innerHTML: '' };
  const mute1 = console.error; console.error = () => {}; const kp = globalThis.getPositionInfo; globalThis.getPositionInfo = () => { throw new Error('boom'); };
  V.renderHomeWidget(); console.error = mute1; globalThis.getPositionInfo = kp;
  assert(/Could not draw this card/.test(els['home-roster-moves-body'].innerHTML), 'a failure shows a message instead of throwing');

  const liveKid = globalThis.currentPlayers[3];
  assert(V.profileHtml(liveKid, [{ year_label: '2026/27', overall: 64, potential: 82 }]).includes('Planning'), 'live profile card');
  assert.strictEqual(V.profileHtml({ ...liveKid, __clubStatus: 'loan' }, []), '', 'a loaned-out player gets no card');
  assert.strictEqual(V.profileHtml(undefined, []), '');
  const mute = console.error; console.error = () => {};
  const keepPos = globalThis.getPositionInfo; globalThis.getPositionInfo = () => { throw new Error('boom'); };
  assert.strictEqual(V.profileHtml(liveKid, []), '', 'the profile still opens if the card cannot be drawn');
  globalThis.getPositionInfo = keepPos; console.error = mute;

  // no window.api: Progression draws from in-season data without hanging on a loader
  assert(!registered.progress().includes('Loading'), 'no api: no endless loading state');

  // with an api: first call shows the loader and starts the load; once it lands the view refreshes and renders
  let historyCalls = 0;
  globalThis.api = {
    getSeasonsList: async () => [{ id: 1, year_label: '2025/26', is_current: false }, { id: 2, year_label: '2026/27', is_current: true }],
    getPlayerHistory: async id => { historyCalls++; return id === 4 ? [] : [{ season: '2025/26', overall: 60, potential: 80 }, { season: '2026/27', overall: 64, potential: 80 }]; }
  };
  const before = refreshes;
  assert(registered.progress().includes('Loading season history'), 'first draw shows the loader');
  registered.progress(); // a second draw while loading must not start a second load
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(historyCalls, live.length, 'one history fetch per senior player, started once');
  assert(refreshes > before, 'asks Insights to redraw when the history arrives');
  const done = registered.progress();
  assert(!done.includes('Loading') && done.includes('Whole squad'), 'renders once loaded');
  assert.strictEqual(historyCalls, live.length, 'cached: drawing again does not refetch');

  V.invalidate();
  assert(registered.progress().includes('Loading season history'), 'invalidate() makes the next draw reload');
  await new Promise(r => setTimeout(r, 20));
  globalThis.currentSaveId = 8;
  assert(registered.progress().includes('Loading season history'), 'a different save is never served the old cache');
  await new Promise(r => setTimeout(r, 20));

  // a failing history call does not break the view
  globalThis.currentSaveId = 9;
  globalThis.api.getPlayerHistory = async () => { throw new Error('db gone'); };
  registered.progress(); await new Promise(r => setTimeout(r, 20));
  assert(!registered.progress().includes('Loading'), 'failed history load settles instead of looping');

  // the guard: a throwing global turns into a message, never an exception in Insights.render
  globalThis.getPositionInfo = () => { throw new Error('boom'); };
  const silence = console.error; console.error = () => {};
  const broken = registered.advice();
  console.error = silence;
  assert(broken.includes('Could not draw this view') && broken.includes('boom'));

  // filter setter re-renders the Insights view
  const r0 = renders; V.setAdviceFilter('sell'); assert.strictEqual(renders, r0 + 1);
  V.setAdviceFilter('nonsense');

  console.log('insights_planning: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
