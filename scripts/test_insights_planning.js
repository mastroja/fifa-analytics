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
require('../js/academy_tracker.js');                 // AcademyTracker: readiness for the Home card and prospect profiles
const V = require('../js/insights_planning.js');

assert(/\.planning-wrap\s*\{\s*overflow-x:\s*auto/.test(require('fs').readFileSync(__dirname + '/../index.html', 'utf8')), 'index.html styles the scrolling table wrapper');
assert(/\.planning-table td\s*\{[^}]*white-space:\s*normal/.test(require('fs').readFileSync(__dirname + '/../index.html', 'utf8')), 'cells must wrap: the app inherits nowrap, which made the Why column 500px wide');
assert.deepStrictEqual(Object.keys(registered).sort(), ['advice', 'progress'], 'registers the two views');
assert.deepStrictEqual(Object.keys(wageSections).sort(), ['cards', 'table'], 'fills both Wages & Contracts slots');
const ids = require('fs').readFileSync(__dirname + '/../index.html', 'utf8');
['advice', 'progress'].forEach(k => assert(ids.includes(`id="insights-view-${k}"`) && ids.includes(`Insights.setView('${k}')`), `index.html has the ${k} button`));
assert(!ids.includes('insights-view-growth') && !ids.includes('Growth Graph'), 'there is no Growth Graph tab');
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
  const base = { players, histories, seasonLabel: '2026/27', progressMode: 'list' };
  const h = V.progressHtml(env(base));
  // statuses: Rocket rising (+7 vs +3), Slowpoke stalling (flat at 19), Fading Star declining (-4 at 31), Steady on track
  assert(h.includes('planning-wrap') && h.includes('planning-table'), 'table sits in a scrolling wrapper');
  assert(/Rocket/.test(h) && /Slowpoke/.test(h), 'attention players are shown');
  assert(!/Steady/.test(h), 'the default view leaves out players who are simply on track');
  assert(!/<i>Star<\/i>/.test(h) && /&lt;i&gt;Star&lt;\/i&gt;/.test(h), 'names escaped');
  assert(/>Rising</.test(h) && />Stalling</.test(h) && />Declining</.test(h), 'status badges and group headings');
  assert(h.indexOf('Rocket') < h.indexOf('Slowpoke') && h.indexOf('Slowpoke') < h.indexOf('Fading'), 'grouped: rising, then stalling, then declining');
  assert(/Needs attention <span[^>]*>3<\/span>/.test(h) && /Everyone <span[^>]*>4<\/span>/.test(h), 'the two toggles with counts');
  assert(/1 more is on track/.test(h) && /Show everyone/.test(h), 'says how many were left out and offers them');
  assert(h.includes('+7'), 'one number per player: 64 -> the live 71, which replaces the stored 70');
  assert(/title="\+7 OVR"[^>]*>↑</.test(h) && /title="0 OVR"[^>]*>→</.test(h) && /title="-4 OVR"[^>]*>↓</.test(h), 'a compact arrow per player: up, flat, down');
  assert(!/<svg/.test(h), 'no trend lines');
  assert(!/Biggest risers|Whole squad|Outlook/.test(h), 'the old duplicate lists and the Outlook column are gone');
  assert(/home-toggle-btn active"[^>]*>Chart/.test(V.progressHtml(env({ ...base, progressMode: undefined }))) && /home-toggle-btn active"[^>]*>List/.test(h), 'the chart is the default view; the list is the alternative');
  assert(!/OVR so far this season[^(<]*\(typical for/.test(h), 'the reasoning stays hidden until a row is opened');
  assert(/InsightsPlanning\.toggleProgress\('1'\)/.test(h), 'each row has an expand control');
  assert(/setProgressFilter\('rising'\)/.test(h) && /setProgressFilter\('declining'\)/.test(h), 'the tiles are filters');
  assert(h.length < 14000, 'the default view stays small');

  // opening a row shows the reasons for that player only
  const opened = V.progressHtml(env({ ...base, progressOpen: new Set(['1']) }));
  assert(/OVR so far this season[^(<]*\(typical for/.test(opened) && /class="detail-row open"/.test(opened) && /player-row expanded/.test(opened), 'reasons appear for the opened row');
  assert((opened.match(/class="detail-row open"/g) || []).length === 1, 'and only for it');

  // everyone / one status
  const all = V.progressHtml(env({ ...base, progressFilter: 'all' }));
  assert(/Steady/.test(all) && />On track</.test(all) && !/more is on track/.test(all), 'Everyone includes the on-track players');
  const rising = V.progressHtml(env({ ...base, progressFilter: 'rising' }));
  assert(/Rocket/.test(rising) && !/Slowpoke/.test(rising) && !/Steady/.test(rising), 'a tile filters to one status');
  assert(/outline: 2px solid/.test(rising), 'and shows it is active');
  assert(/Nobody is "Declining"/.test(V.progressHtml(env({ players: players.slice(0, 2), histories, seasonLabel: '2026/27', progressFilter: 'declining', progressMode: 'list' }))), 'an empty status says so');
  assert(/moving about as expected/.test(V.progressHtml(env({ players: [players[3]], histories, seasonLabel: '2026/27', progressMode: 'list' }))), 'nobody needs attention: says so');
  assert(V.progressHtml(env({ ...base, progressFilter: 'bogus' })).includes('Rocket'), 'an unknown filter falls back to the default');

  // the trend arrow: direction of the overall, colour supplied by the caller
  const arrow = (n, c) => V.trendArrow(n, c || '#fff');
  assert.deepStrictEqual([7, 3, 2, 1, 0, -1, -2, -3, -9].map(n => (arrow(n).match(/>([↑↗→↘↓])</) || [])[1]), ['↑', '↑', '↗', '↗', '→', '↘', '↘', '↓', '↓'], 'arrow thresholds: 3+ up, 1-2 up-right, flat, 1-2 down-right, 3+ down');
  assert(/color: #3fb950/.test(arrow(2, '#3fb950')) && /title="\+2 OVR"/.test(arrow(2)), 'the colour is the one given; the hover text has the number');
  assert.deepStrictEqual([null, undefined, 'abc', NaN].map(n => /–/.test(arrow(n)) && !/↑|↗|→|↘|↓/.test(arrow(n))), [true, true, true, true], 'no change known: a dash, never a made-up arrow');
  assert.strictEqual(V.pathText([{ overall: 60 }, { overall: 66 }, { overall: 71 }]), '60 → 66 → 71');
  assert.deepStrictEqual([[{ overall: 70 }], [], undefined, [{ overall: 'x' }, { overall: null }]].map(V.pathText), ['', '', '', ''], 'fewer than two usable seasons: nothing');
  // without the current label the live value is appended and read as a second change: still renders
  assert(V.progressHtml(env({ players, histories, progressMode: 'list' })).includes('Needs attention'));
}

// --- Progression chart ---------------------------------------------------------------------------------------
{
  const row = (season, overall, potential) => ({ season, overall, potential });
  const ps = [
    P(1, 'Rocket', 'MID', 19, 71, 85, 1, 2029, 10, 800),
    P(2, 'Slowpoke', 'MID', 19, 64, 76, 1, 2029, 10, 800),
    P(3, 'Fading <i>Star</i>', 'MID', 31, 76, 76, 1, 2029, 10, 800),
    P(4, 'Steady', 'MID', 27, 80, 80, 1, 2029, 10, 800),
    P(5, 'No History', 'MID', 25, 70, 75, 1, 2029, 10, 800)
  ];
  const hs = new Map([
    [1, [row('2025/26', 64, 84), row('2026/27', 70, 85)]], [2, [row('2025/26', 64, 76), row('2026/27', 64, 76)]],
    [3, [row('2025/26', 80, 80), row('2026/27', 76, 76)]], [4, [row('2025/26', 80, 80), row('2026/27', 80, 80)]]
  ]);
  const base = { players: ps, histories: hs, seasonLabel: '2026/27' };
  // vs typical for their age: Rocket +7 vs +4 = +3, Steady 0 vs 0 = 0, Fading Star -4 vs -1 = -3, Slowpoke 0 vs +4 = -4
  const c = V.progressHtml(env(base));
  const barRows = [...c.matchAll(/class="pl-chart-row"/g)].length;
  assert.strictEqual(barRows, 4, 'one bar per player with a history; the player with no history is left out');
  assert(/1 player has no history yet and is not shown/.test(c), 'and the chart says so');
  assert(c.indexOf('Rocket') < c.indexOf('Steady') && c.indexOf('Steady') < c.indexOf('Fading') && c.indexOf('Fading') < c.indexOf('Slowpoke'), 'best at the top, worst at the bottom');
  // bar geometry: the biggest gap is 4 -> scale 4 -> Slowpoke fills half the track to the left, Rocket 3/4 of the right half
  const barOf = name => { const i = c.indexOf(name); const j = c.indexOf('background:', c.indexOf('position: absolute; top: 2px', i)); return c.slice(c.indexOf('position: absolute; top: 2px', i), j + 40); };
  assert(/right: 50%; width: 50\.0%/.test(barOf('Slowpoke')), 'behind for their age: grows left from the centre');
  assert(/left: 50%; width: 37\.5%/.test(barOf('Rocket')), 'ahead: grows right, scaled to the biggest gap');
  assert(/left: 50%; width: 0\.0%; min-width: 3px/.test(barOf('Steady')), 'as expected: a short tick, never invisible');
  assert(/#3fb950/.test(barOf('Rocket')) && /#d29922/.test(barOf('Slowpoke')) && /#f85149/.test(barOf('Fading')) && /var\(--text-dim\)/.test(barOf('Steady')), 'colour follows the status (rising, stalling, declining, on track)');
  assert(/>\+3<\/div>/.test(c) && />-4<\/div>/.test(c) && />-3<\/div>/.test(c) && />0<\/div>/.test(c), 'one number per bar');
  assert(!/Needs attention/.test(c) && /home-toggle-btn active"[^>]*>Chart/.test(c), 'the attention toggle belongs to the list view');
  assert(/border-left: 3px solid #3fb950/.test(c) && /border-left: 3px solid #f85149/.test(c), 'the status tiles are tinted so they double as the colour key');
  assert(/behind for their age/.test(c) && /ahead for their age/.test(c) && /as expected/.test(c), 'the axis says what left and right mean');
  assert(!/OVR so far this season[^(<]*\(typical for/.test(c) && !/<svg/.test(c), 'reasoning and trend line stay hidden until a row is opened');
  assert(/!?[^"]*toggleProgress\('1'\)/.test(c), 'rows expand on click');
  assert(/event\.stopPropagation\(\); openPlayerProfile\('1'\)/.test(c), 'the name opens the profile without toggling the row');
  assert(!c.includes('Fading <i>') && /Fading &lt;i&gt;Star&lt;\/i&gt;/.test(c), 'names escaped');
  assert(/title="\+7 OVR so far this season, typical \+4\./.test(c), 'hovering a row gives the raw numbers');

  // one extreme outlier must not flatten everyone else: the scale is capped at 8 and the long bar stops at the edge
  const withOutlier = V.progressHtml(env({ ...base, histories: new Map([...hs, [1, [row('2025/26', 40, 84), row('2026/27', 70, 85)]]]) }));
  assert(/left: 50%; width: 50\.0%/.test(withOutlier.slice(withOutlier.indexOf('Rocket'))) && />\+27<\/div>/.test(withOutlier), 'a 40 -> 71 jump (+27 vs the +4 typical): the bar stops at the edge but the label keeps the real number');
  assert(/right: 50%; width: 25\.0%/.test(withOutlier.slice(withOutlier.indexOf('Slowpoke'))), 'the scale is capped at 8, so Slowpoke (4 behind) takes a quarter of the track instead of vanishing');

  // filters and opening a row
  const onlyDown = V.progressHtml(env({ ...base, progressFilter: 'declining' }));
  assert(/Fading/.test(onlyDown) && !/Rocket/.test(onlyDown) && !/Steady/.test(onlyDown), 'a tile focuses the chart on one status');
  assert(/outline: 2px solid/.test(onlyDown));
  assert(/Nobody is "At potential"/.test(V.progressHtml(env({ ...base, progressFilter: 'maxed' }))), 'an empty group says so');
  assert(V.progressHtml(env({ ...base, progressFilter: 'attention' })).includes('Steady') && V.progressHtml(env({ ...base, progressFilter: 'all' })).includes('Steady'), 'Needs attention / Everyone mean the whole squad here');
  const open1 = V.progressHtml(env({ ...base, progressOpen: new Set(['1']) }));
  assert(/64 → 71 OVR/.test(open1) && />↑</.test(open1) && /OVR so far this season[^(<]*\(typical for/.test(open1), 'opening a row shows the arrow, the seasons it went through and the reasoning');
  assert((open1.match(/OVR so far this season[^(<]*\(typical for/g) || []).length === 1, 'for that player only');
  assert(/Not enough history/.test(V.progressHtml(env({ players: [ps[4]], histories: new Map() }))), 'nobody with history: the existing message');
}

// --- Progression: the season picker ----------------------------------------------------------------------------
{
  const row = (season, overall, potential) => ({ season, overall, potential });
  const ps = [P(1, 'Rocket', 'MID', 19, 71, 85, 1, 2029, 10, 800), P(2, 'Slowpoke', 'MID', 19, 64, 76, 1, 2029, 10, 800), P(4, 'Steady', 'MID', 27, 80, 80, 1, 2029, 10, 800)];
  const hs = new Map([
    [1, [row('2024/25', 58, 84), row('2025/26', 64, 84), row('2026/27', 70, 85)]],
    [2, [row('2024/25', 64, 76), row('2025/26', 64, 76), row('2026/27', 64, 76)]],
    [4, [row('2024/25', 80, 80), row('2025/26', 80, 80), row('2026/27', 80, 80)]]
  ]);
  const seasons = [{ back: 0, label: '2026/27', current: true }, { back: 1, label: '2025/26', current: false }];
  const base = { players: ps, histories: hs, seasonLabel: '2026/27', progressSeasons: seasons };
  const now = V.progressHtml(env({ ...base, progressBack: 0 }));
  const prev = V.progressHtml(env({ ...base, progressBack: 1 }));
  assert(/<select[^>]*setProgressSeason\(this\.value\)/.test(now), 'a Season picker');
  assert(/<option value="0" selected>2026\/27 \(so far\)<\/option>/.test(now) && /<option value="1">2025\/26<\/option>/.test(now), 'the current season is marked "so far" and selected by default');
  assert(/<option value="1" selected>2025\/26<\/option>/.test(prev) && /<option value="0">2026\/27 \(so far\)<\/option>/.test(prev), 'the chosen season is the selected one');
  // Rocket: now +7 vs +4 typical (+3), in 2025/26 +6 vs +4.5 typical (+1.5); Slowpoke: now 0 vs +4 (-4), in 2025/26 0 vs +4.5 (-4.5)
  assert(/title="\+7 OVR so far this season, typical \+4\./.test(now) && />\+3<\/div>/.test(now), 'current season: the live numbers');
  assert(/title="\+6 OVR in 2025\/26, typical \+4\.5\./.test(prev) && />\+1\.5<\/div>/.test(prev) && />-4\.5<\/div>/.test(prev), 'an earlier season: that season\'s change, against the norm for the age then');
  assert(/the change so far this season compared/.test(now) && /the change in 2025\/26 compared/.test(prev), 'the note says which season the bars are for');
  assert(/Use Season to look at an earlier year/.test(now));
  // no choice to make: no picker
  const one = V.progressHtml(env({ ...base, progressSeasons: [seasons[0]] }));
  assert(!/<select/.test(one) && !/Use Season/.test(one), 'with one season there is nothing to pick');
  assert(!/<select/.test(V.progressHtml(env({ players: ps, histories: hs, seasonLabel: '2026/27' }))), 'and none without the options');
  // an unknown choice falls back to the current season instead of failing
  const bad = V.progressHtml(env({ ...base, progressBack: 7 }));
  assert(/<option value="0" selected>/.test(bad) && />\+3<\/div>/.test(bad), 'an unknown season is treated as the current one');
  // list view: the sub-line names the season
  const list = V.progressHtml(env({ ...base, progressBack: 1, progressMode: 'list', progressFilter: 'all' }));
  assert(/2025\/26<\/div>/.test(list.replace(/&nbsp;/g, '')) || /white-space: nowrap;">2025\/26/.test(list), 'list rows say 2025/26 under the number');
  assert(/white-space: nowrap;">this season/.test(V.progressHtml(env({ ...base, progressMode: 'list', progressFilter: 'all' }))), 'and "this season" for the current one');
  // a player with no history for the chosen season is left out of the chart with the usual note
  const short = V.progressHtml(env({ ...base, players: ps.concat([P(9, 'Newcomer', 'MID', 22, 60, 70, 1, 2029, 1, 50)]), progressBack: 1 }));
  assert(!/Newcomer/.test(short.replace(/has no history yet.*/, '')) || /1 player has no history yet/.test(short), 'a newcomer is not drawn for a season he was not here');
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
  assert(/Progression:/.test(card) && /OVR so far this season[^(<]*\(typical for/.test(card), 'progression line from the season rows');
  assert(!/Contract:/.test(card), 'no contract action for a deal with years left');
  assert(/Rule-of-thumb/.test(card));
  assert(!/<b>/.test(card) && !card.includes('Kid</b>'), 'nothing unescaped leaks into the card');

  // the live current-season row must not be double counted: 61 -> 64 is +3, not 0
  assert(/\+3 OVR so far this season[^(<]*\(typical for/.test(card), 'current season row is refreshed, not duplicated');
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

  // ready-for-promotion section (env.promotions comes from AcademyTracker.liveReady in the app)
  const promo = (id, name, detail) => ({ player: { player_id: id, name, overall: 66 }, ready: { key: 'ready', verdict: 'Ready for promotion', detail } });
  assert(!/Ready for promotion/.test(h), 'no section without ready prospects');
  const withPromo = V.homeMovesHtml(env({ promotions: [promo(901, 'Kid <b>One</b>', '5 above Jamie Cole (61) · would be 2nd of 3 GKs'), promo(902, 'Kid Two', '1 above X (66)')] }));
  assert(/Ready for promotion<\/span>/.test(withPromo) && /Academy →/.test(withPromo), 'the section and its link to the Academy page');
  assert(/<strong style="color: #3fb950;">2<\/strong>[^<]*<span[^>]*>ready for promotion/.test(withPromo), 'the summary line counts them');
  assert(/5 above Jamie Cole \(61\) · would be 2nd of 3 GKs/.test(withPromo), 'each shows the comparison behind the verdict');
  assert(/openPlayerProfile\('901'\)/.test(withPromo) && /class="at-ready rd-ready"/.test(withPromo), 'clickable, with the green pill');
  assert(/&lt;b&gt;One&lt;\/b&gt;/.test(withPromo) && !withPromo.includes('Kid <b>'), 'names escaped');
  assert(withPromo.indexOf('Old Timer') < withPromo.indexOf('Ready for promotion</span>'), 'sales and loans come first, promotions after');
  const five = V.homeMovesHtml(env({ promotions: [1, 2, 3, 4, 5].map(i => promo(900 + i, 'Kid' + i, 'd')) }));
  assert((five.match(/class="at-ready rd-ready"/g) || []).length === 3 && /\+2 more/.test(five), 'capped at three with +n more');
  const onlyPromo = V.homeMovesHtml(env({ players: squad().slice(0, 3), promotions: [promo(903, 'Solo', 'd')] }));
  assert(/No sales or loans recommended right now/.test(onlyPromo) && /Solo/.test(onlyPromo), 'promotions still show when there is nothing to sell or loan');
  assert(!/Transfer ban active/.test(V.homeMovesHtml(env({ transferBan: true, players: squad().slice(0, 3), promotions: [promo(904, 'P', 'd')] }))), 'the ban note is only for sales and loans');

  // the academy prospect's profile card
  const card = V.promotionCardHtml({ key: 'close', verdict: 'Close', detail: '2 below Kai Okoro (64) · would be 4th of 4 CBs' });
  assert(/<h3[^>]*>[\s\S]*Promotion/.test(card) && /rd-close/.test(card) && />Close</.test(card) && /2 below Kai Okoro/.test(card) && /Academy →/.test(card));
  assert.strictEqual(V.promotionCardHtml(null), '');
  assert(!/<b>/.test(V.promotionCardHtml({ key: 'dev', verdict: 'Developing', detail: '<b>x</b>' })), 'escaped');

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

  // academy prospects: Home card section and profile card, from the live academy rows
  globalThis.currentYouthAcademy = [
    { player_id: 7001, name: 'Ready Prospect', position_id: 14, overall: 66, dob: '2010-01-01' }, // weakest senior CM is the 64 kid: ready
    { player_id: 7002, name: 'Far Off Prospect', position_id: 14, overall: 50, dob: '2010-01-01' }
  ];
  V.renderHomeWidget();
  assert(/Ready Prospect/.test(els['home-roster-moves-body'].innerHTML) && !/Far Off Prospect/.test(els['home-roster-moves-body'].innerHTML), 'only the ready prospect is listed on Home');
  const prospectCard = V.profileHtml({ player_id: 7001, name: 'Ready Prospect', position_id: 14, overall: 66 }, []);
  assert(/Ready for promotion/.test(prospectCard) && /2 above/.test(prospectCard), 'an academy prospect\'s profile gets the Promotion card');
  assert(/Developing/.test(V.profileHtml({ player_id: 7002, name: 'Far', position_id: 14, overall: 50 }, [])));
  assert.strictEqual(V.profileHtml({ player_id: 9999, name: 'Not Anywhere', position_id: 14, overall: 66 }, []), '', 'not a senior and not in the academy: nothing');
  globalThis.License = { isPro: f => f !== 'academy-tracker' };
  V.renderHomeWidget();
  assert(!/Ready Prospect/.test(els['home-roster-moves-body'].innerHTML), 'locked Academy feature: no promotions on Home');
  assert.strictEqual(V.profileHtml({ player_id: 7001, name: 'Ready Prospect', position_id: 14, overall: 66 }, []), '', 'and no Promotion card on the profile');
  assert(/Planning/.test(V.profileHtml(globalThis.currentPlayers[3], [{ year_label: '2026/27', overall: 64, potential: 82 }])), 'the senior Planning card is not affected by the Academy lock');
  delete globalThis.License;
  globalThis.currentYouthAcademy = undefined;
  V.renderHomeWidget();
  assert(!/Ready for promotion/.test(els['home-roster-moves-body'].innerHTML), 'no academy data: no section');

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
  assert(!done.includes('Loading') && done.includes('pl-chart-row'), 'renders once loaded (the chart is the default view)');
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

  // progression clicks: a tile filters, the arrow opens one player's reasons, both redraw the Insights view
  globalThis.getPositionInfo = () => ({ group: 'MID', label: 'CM' });
  const NOW = { 1: 80, 2: 78, 3: 76, 4: 64, 5: 70, 6: 79 }, WAS = { 4: 58, 5: 75 };      // the 19yo gained 6, the 32yo lost 5, the rest are flat
  globalThis.currentSaveId = 10;
  globalThis.api = {
    getSeasonsList: async () => [{ id: 2, year_label: '2026/27', is_current: true }],
    getPlayerHistory: async id => [{ season: '2024/25', overall: (WAS[id] || NOW[id]) - 2, potential: 85 }, { season: '2025/26', overall: WAS[id] || NOW[id], potential: 85 }, { season: '2026/27', overall: NOW[id], potential: 85 }]
  };
  V.setProgressMode('list');
  registered.progress(); await new Promise(r => setTimeout(r, 20));
  {
    const def = registered.progress();
    assert(/Kid/.test(def) && /Old Timer/.test(def) && !/Star Mid/.test(def), 'default: the riser and the decliner, not the flat players');
    const r1 = renders; V.setProgressFilter('declining'); assert.strictEqual(renders, r1 + 1, 'a tile click redraws');
    const dec = registered.progress(); assert(/Old Timer/.test(dec) && !/Kid/.test(dec), 'the declining filter is applied to the live view');
    V.setProgressFilter('nonsense'); assert(/Kid/.test(registered.progress()), 'an unknown filter resets to the default');
    V.setProgressFilter('all'); assert(/Star Mid/.test(registered.progress()), 'Everyone shows the flat players too');
    const r2 = renders; V.toggleProgress(globalThis.currentPlayers[3].player_id); assert.strictEqual(renders, r2 + 1, 'opening a row redraws');
    assert((registered.progress().match(/class="detail-row open"/g) || []).length === 1, 'exactly that row\'s reasons are open');
    V.toggleProgress(globalThis.currentPlayers[3].player_id); assert(!/class="detail-row open"/.test(registered.progress()), 'and they close again');
    V.setProgressFilter('attention');
    // the season picker, live
    assert(/<select/.test(registered.progress()) && /2026\/27 \(so far\)/.test(registered.progress()), 'the live view offers the stored seasons');
    const rs = renders; V.setProgressSeason(1); assert.strictEqual(renders, rs + 1, 'choosing a season redraws');
    assert(/<option value="1" selected>2025\/26/.test(registered.progress()) && /2025\/26 · typical/.test(registered.progress()), 'and shows that season (the list names it under each number)');
    V.toggleProgress(globalThis.currentPlayers[3].player_id);
    V.setProgressSeason(0); assert(!/class="detail-row open"/.test(registered.progress()), 'changing season closes any opened row (it described another season)');
    V.setProgressSeason('abc'); assert(/<option value="0" selected>/.test(registered.progress()), 'junk means the current season');
    V.setProgressSeason(-3); assert(/<option value="0" selected>/.test(registered.progress()));
    V.setProgressSeason(1); V.invalidate();
    registered.progress(); await new Promise(r => setTimeout(r, 20));            // reload the history after the "sync"
    assert(/<option value="0" selected>/.test(registered.progress()) && !/<option value="1" selected>/.test(registered.progress()), 'a new sync goes back to the current season');
    const r3 = renders; V.setProgressMode('chart'); assert.strictEqual(renders, r3 + 1, 'switching view redraws');
    assert(/pl-chart-row/.test(registered.progress()) && !/Needs attention/.test(registered.progress()), 'chart view');
    V.setProgressMode('nonsense'); assert(/pl-chart-row/.test(registered.progress()), 'an unknown mode falls back to the chart');
    V.setProgressMode('list'); assert(/Needs attention/.test(registered.progress()), 'list view');
    V.setProgressMode('chart');
  }

  // filter setter re-renders the Insights view
  const r0 = renders; V.setAdviceFilter('sell'); assert.strictEqual(renders, r0 + 1);
  V.setAdviceFilter('nonsense');

  console.log('insights_planning: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
