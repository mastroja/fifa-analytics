// node scripts/test_academy_tracker.js — logic and page wiring of js/academy_tracker.js (promotion readiness, row building,
// sorting, filters, the Academy page) against fake app.js globals and a fake DOM. Every expected value is worked out by
// hand from the fixture below, not computed from the code under test.
const assert = require('assert');
const fs = require('fs');
const PF = require('../js/player_filters.js');
globalThis.PlayerFilters = PF; // player_filters.js only attaches itself to the window outside CommonJS
const A = require('../js/academy_tracker.js');

// ---- fixtures -----------------------------------------------------------------------------------------------------
const SENIORS = [
  { player_id: 1, name: 'Tomás Reyes', position_id: 0, overall: 77, __clubStatus: 'normal' },
  { player_id: 2, name: 'Jamie Cole', position_id: 0, overall: 61, __clubStatus: 'normal' },
  { player_id: 3, name: 'Dan Whitfield', position_id: 5, overall: 78, __clubStatus: 'normal' },
  { player_id: 4, name: 'Ibrahim Sesay', position_id: 5, overall: 74, __clubStatus: 'normal' },
  { player_id: 5, name: 'Kai Okoro', position_id: 5, overall: 64, __clubStatus: 'normal' },
  { player_id: 6, name: 'Hugo Marsh', position_id: 14, overall: 78, __clubStatus: 'normal' },
  { player_id: 7, name: 'Loaned Guy', position_id: 3, overall: 50, __clubStatus: 'loan' }
];
const LABELS = { 0: 'GK', 2: 'RWB', 3: 'RB', 5: 'CB', 14: 'CM', 25: 'ST' }, GROUPS = { 0: 'GK', 2: 'DEF', 3: 'DEF', 5: 'DEF', 14: 'MID', 25: 'ATT' };
const ORDER = { GK: 1, RWB: 2, RB: 3, CB: 5, CM: 14, ST: 25 };
const POT = {}; // player_id -> displayed potential text (absent = hidden)
const env = () => ({
  labelOf: p => LABELS[p], groupOf: p => GROUPS[p], ageOf: dob => (dob ? 2027 - Number(String(dob).slice(0, 4)) : null),
  lastName: n => String(n).split(' ').pop(), positionOrder: l => ORDER[l] || 99, potText: t => (t.player_id in POT ? POT[t.player_id] : '—')
});
const hist = (...ovrs) => ovrs.map((o, i) => ({ season_id: i + 1, season: `${2024 + i}/${25 + i}`, overall: o, potential_low: 70, potential_high: 80, months_in_squad: 10 * (i + 1) }));
const T = (id, name, pos, age, status, ...ovrs) => ({ player_id: id, name, position_id: pos, dob: `${2027 - age}-03-15`, status, history: hist(...ovrs) });
const senior = () => SENIORS.filter(p => p.__clubStatus === 'normal');

// id   name           pos  age status    OVR by season   -> ovr  change  potential shown
// 101  Noah Ibarra    GK   17  academy   52 58 66          66    +14     70-80   GK: weakest senior 61 -> ready
// 102  Eli Mercer     ST   18  academy   55 61 67          67    +12     74-84   no senior ST -> position open
// 103  Ravi Chauhan   CB   18  academy   50 57 62          62    +12     72-82   weakest CB 64 -> close
// 104  Tobias Lund    CM   16  academy   44 50 56          56    +12     78-88   weakest CM 78 -> developing
// 130  Ollie Grant    CM   19  left      51 55 57          57    +6      66-72
// 7    Kai Okoro      CB   18  promoted  50 58 64          64    +14     (hidden)
// 140  No History     CM   ?   academy   (none)           -     0       (hidden)
const TRACKS = [
  T(101, 'Noah Ibarra', 0, 17, 'academy', 52, 58, 66), T(102, 'Eli Mercer', 25, 18, 'academy', 55, 61, 67),
  T(103, 'Ravi Chauhan', 5, 18, 'academy', 50, 57, 62), T(104, 'Tobias Lund', 14, 16, 'academy', 44, 50, 56),
  T(130, 'Ollie Grant', 14, 19, 'left', 51, 55, 57), T(7, 'Kai Okoro', 5, 18, 'promoted', 50, 58, 64),
  { player_id: 140, name: 'No History', position_id: 14, dob: null, status: 'academy', history: [] }
];
Object.assign(POT, { 101: '70-80', 102: '74-84', 103: '72-82', 104: '78-88', 130: '66-72' });
const rows = A.buildRows(TRACKS, senior(), env());
const by = id => rows.find(r => r.player_id === id);
const keyOf = r => (r.ready ? r.ready.key : '-');

// ---- ordinal ------------------------------------------------------------------------------------------------------
assert.deepStrictEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(A.ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th']);

// ---- readiness ----------------------------------------------------------------------------------------------------
{
  const gks = senior().filter(p => p.position_id === 0); // 77 and 61
  const up = A.readinessOf(66, 'GK', gks);
  assert.deepStrictEqual([up.key, up.verdict, up.gap, up.rank, up.total], ['ready', 'Ready for promotion', 5, 2, 3]);
  assert.strictEqual(up.detail, '5 above Jamie Cole (61) · would be 2nd of 3 GKs');
  assert.strictEqual(A.readinessOf(61, 'GK', gks).key, 'ready', 'level with the weakest counts as ready');
  assert(/^Level with Jamie Cole \(61\)/.test(A.readinessOf(61, 'GK', gks).detail));
  assert.strictEqual(A.readinessOf(58, 'GK', gks).key, 'close', 'exactly 3 below is still close');
  assert.strictEqual(A.readinessOf(57, 'GK', gks).key, 'dev', '4 below is developing');
  assert.strictEqual(A.readinessOf(57, 'GK', gks).detail, '4 below Jamie Cole (61)');
  assert.strictEqual(A.readinessOf(80, 'GK', gks).rank, 1, 'better than everyone: 1st');
  assert(/would be 1st of 3 GKs/.test(A.readinessOf(80, 'GK', gks).detail));
  const none = A.readinessOf(50, 'RWB', []);
  assert.deepStrictEqual([none.key, none.verdict, none.detail], ['open', 'Position open', 'No senior RWB in the squad']);
  assert.strictEqual(A.readinessOf(50, 'RWB', undefined).key, 'open', 'undefined squad list is treated as none');
  assert.strictEqual(A.readinessOf(undefined, 'GK', gks).key, 'dev', 'a missing overall never reads as ready');
  assert.strictEqual(A.readinessOf(null, 'GK', gks).gap, -61);
}

// ---- parsePotTop and summarise ------------------------------------------------------------------------------------
assert.deepStrictEqual(['70-78', '70–78', '74', '—', '', null, undefined, 'abc', '65 - 80'].map(A.parsePotTop), [78, 78, 74, null, null, null, null, null, 80]);
{
  assert.deepStrictEqual(A.summarise({ history: [] }), { first: {}, last: {}, ovrChange: 0, seasons: 0 });
  assert.strictEqual(A.summarise(undefined).seasons, 0);
  const s = A.summarise(T(1, 'X', 14, 17, 'academy', 50, 58, 66));
  assert.deepStrictEqual([s.ovrChange, s.seasons, s.first.overall, s.last.overall], [16, 3, 50, 66]);
}

// ---- buildRows ----------------------------------------------------------------------------------------------------
{
  assert.strictEqual(rows.length, 7, 'one row per track');
  assert.deepStrictEqual(rows.map(r => r.status), ['academy', 'academy', 'academy', 'academy', 'left', 'promoted', 'academy']);
  assert.deepStrictEqual([101, 102, 103, 104].map(i => by(i).ready.key), ['ready', 'open', 'close', 'dev']);
  assert.strictEqual(by(130).ready, null, 'only academy prospects get a promotion verdict');
  assert.strictEqual(by(7).ready, null);
  assert.strictEqual(by(130).readyRank, null);
  const a = by(101);
  assert.deepStrictEqual([a.ovr, a.ovrChange, a.seasons, a.months, a.age, a.potHigh, a.label, a.group], [66, 14, 3, 30, 17, 80, 'GK', 'GK']);
  assert.strictEqual(by(104).potHigh, 88);
  assert(!by(101).ready.detail.includes('Loaned Guy'), 'only the senior squad passed in is compared');
  const none = by(140);
  assert.deepStrictEqual([none.ovr, none.months, none.ovrChange, none.seasons, none.age], [null, null, 0, 0, null], 'a track with no history does not throw');
  assert.strictEqual(none.ready.key, 'dev', 'and is never ready');
  assert.deepStrictEqual(A.buildRows(undefined, undefined, env()), []);
  assert.strictEqual(A.buildRows([T(150, 'One Season', 14, 17, 'academy', 60)], senior(), env())[0].ovrChange, 0, 'no change is claimed from a single season');
  assert.strictEqual(by(101).track, TRACKS[0], 'rows carry their track for the history view');
}

// ---- hidden potential never leaks ---------------------------------------------------------------------------------
{
  const hidden = A.buildRows(TRACKS.slice(0, 4), senior(), { ...env(), potText: () => '—' });
  assert(hidden.every(r => r.potHigh === null && r.potText === '—'), 'no displayed potential -> no sortable / filterable number');
  // overall 66, 67, 62, 56: with no potential to go on, "by potential" falls back to overall (high to low)
  assert.deepStrictEqual(hidden.slice().sort(A.compareRows('pot', false, env())).map(r => r.player_id), [102, 101, 103, 104]);
  assert(hidden.every(r => !PF.fieldMatches(A.filterFields().find(f => f.id === 'pot'), { min: 1 }, r)), 'a potential filter matches nobody when nothing is displayed');
}

// ---- sorting ------------------------------------------------------------------------------------------------------
{
  const ids = (col, asc) => rows.slice().sort(A.compareRows(col, asc, env())).map(r => r.player_id);
  // overall: 102=67, 101=66, 7=64, 103=62, 130=57, 104=56, 140=none
  assert.deepStrictEqual(ids('ovr', false), [102, 101, 7, 103, 130, 104, 140], 'overall high to low, missing last');
  assert.deepStrictEqual(ids('ovr', true), [104, 130, 103, 7, 101, 102, 140], 'low to high: the missing value is STILL last');
  // age: 104=16, 101=17, then 18s (102 pot 84, 103 pot 82, 7 hidden), 130=19, 140=unknown
  assert.deepStrictEqual(ids('age', true), [104, 101, 102, 103, 7, 130, 140], 'youngest first, unknown last, ties by potential');
  assert.deepStrictEqual(ids('age', false), [130, 102, 103, 7, 101, 104, 140], 'oldest first, unknown STILL last');
  // last names: Chauhan, Grant, History, Ibarra, Lund, Mercer, Okoro
  assert.deepStrictEqual(ids('name', true), [103, 130, 140, 101, 104, 102, 7], 'by last name A-Z');
  assert.deepStrictEqual(ids('name', false), [7, 102, 104, 101, 140, 130, 103], 'and Z-A');
  // position order GK(1) CB(5) CM(14) ST(25); ties by potential: CBs 103 (82) then 7 (hidden); CMs 104 (88), 130 (72), 140 (hidden)
  assert.deepStrictEqual(ids('position', true), [101, 103, 7, 104, 130, 140, 102]);
  assert.deepStrictEqual(ids('status', true), [104, 102, 103, 101, 140, 7, 130], 'academy, then promoted, then left; within a status by potential 88 84 82 80, hidden last');
  // promotion: ready(101) close(103) open(102) dev(104 pot 88, 140 hidden) then non-academy (130 pot 72, 7 hidden)
  assert.deepStrictEqual(ids('ready', true), [101, 103, 102, 104, 140, 130, 7]);
  assert.deepStrictEqual(ids('ready', false).slice(-2), [130, 7], 'non-academy rows stay last when the order is reversed');
  assert.deepStrictEqual(ids('pot', false), [104, 102, 103, 101, 130, 7, 140], 'potential 88 84 82 80 72, hidden last');
  assert.deepStrictEqual(ids('months', false).slice(0, 2), [104, 102], 'equal months (30) fall back to potential, then overall');
  assert.strictEqual(ids('months', false).pop(), 140, 'no months: last');
  assert.deepStrictEqual(ids('bogus', true).length, 7, 'an unknown column does not throw');
  assert.strictEqual(rows.slice().sort(A.compareRows('name', true)).length, 7, 'works without an env');
  // equal OVR: the higher potential first
  const tie = A.buildRows([T(201, 'Zed Alpha', 14, 17, 'academy', 60), T(202, 'Amy Beta', 14, 17, 'academy', 60)], senior(), { ...env(), potText: t => (t.player_id === 201 ? '70-90' : '70-80') });
  assert.deepStrictEqual(tie.sort(A.compareRows('ovr', false, env())).map(r => r.player_id), [201, 202]);
  assert.deepStrictEqual(['name', 'position', 'status', 'ready'].map(A.defaultAsc), [true, true, true, true]);
  assert.deepStrictEqual(['age', 'months', 'ovr', 'pot'].map(A.defaultAsc), [false, false, false, false]);
  assert.deepStrictEqual(A.COLUMNS.map(c => c[0]), ['name', 'position', 'age', 'status', 'months', 'ovr', 'pot', 'ready']);
}

// ---- filters (through the shared PlayerFilters component) ----------------------------------------------------------
{
  const fields = A.filterFields();
  const match = state => rows.filter(r => PF.matchesAll(fields, state, r)).map(r => r.player_id).sort((a, b) => a - b);
  assert.deepStrictEqual(match({}), [7, 101, 102, 103, 104, 130, 140], 'no filter: everyone');
  assert.deepStrictEqual(match({ group: ['GK'] }), [101]);
  assert.deepStrictEqual(match({ group: ['DEF', 'GK'] }), [7, 101, 103]);
  assert.deepStrictEqual(match({ ready: ['ready'] }), [101], 'promotion chips: only ready (rows with no verdict are excluded)');
  assert.deepStrictEqual(match({ ready: ['ready', 'close'] }), [101, 103]);
  assert.deepStrictEqual(match({ ready: ['open'] }), [102]);
  assert.deepStrictEqual(match({ ready: ['dev'] }), [104, 140], 'the Developing chip never matches promoted / left rows (they have no verdict)');
  assert.deepStrictEqual(match({ age: { max: 17 } }), [101, 104], 'unknown age is excluded from an age range');
  assert.deepStrictEqual(match({ age: { min: 18, max: 18 } }), [7, 102, 103]);
  assert.deepStrictEqual(match({ ovr: { min: 62 } }), [7, 101, 102, 103]);
  assert.deepStrictEqual(match({ pot: { min: 82 } }), [102, 103, 104], 'potential 82+ as displayed: 84, 82, 88');
  assert.deepStrictEqual(match({ months: { min: 30 } }), [7, 101, 102, 103, 104, 130]);
  A.FILTER_PRESETS.forEach(p => Object.keys(p.set).forEach(id => assert(fields.some(f => f.id === id), `preset "${p.label}" uses the real field "${id}"`)));
  const preset = label => A.FILTER_PRESETS.find(p => p.label === label).set;
  assert.deepStrictEqual(match(preset('Ready for promotion')), [101]);
  assert.deepStrictEqual(match(preset('Ready or close')), [101, 103]);
  assert.deepStrictEqual(match(preset('Under 18')), [101, 104]);
  assert.deepStrictEqual(match(preset('High ceiling (78+)')), [101, 102, 103, 104], 'potentials 80, 84, 82, 88');
  assert.strictEqual(PF.countActive(fields, { ready: ['ready'], age: { max: 17 } }), 2);
  assert.deepStrictEqual(fields.map(f => f.id), ['group', 'ready', 'age', 'ovr', 'pot', 'months'], 'six filters: no "OVR gained since first seen"');
  assert.deepStrictEqual(A.FILTER_PRESETS.map(p => p.label), ['Ready for promotion', 'Ready or close', 'Under 18', 'High ceiling (78+)']);
}

// ---- readyProspects (the Home card) -------------------------------------------------------------------------------
{
  const live = [
    { player_id: 1, name: 'A', position_id: 0, overall: 66 },  // GK +5: ready
    { player_id: 2, name: 'B', position_id: 0, overall: 62 },  // GK +1: ready
    { player_id: 3, name: 'C', position_id: 5, overall: 62 },  // CB -2: close
    { player_id: 4, name: 'D', position_id: 14, overall: 50 }, // CM -28: developing, left out
    { player_id: 5, name: 'E', position_id: 25, overall: 70 }  // ST: no senior there, left out
  ];
  const out = A.readyProspects(live, senior(), env());
  assert.deepStrictEqual(out.map(x => x.player.player_id), [1, 2, 3], 'ready first (biggest margin first), then close');
  assert.deepStrictEqual(out.map(x => x.ready.key), ['ready', 'ready', 'close']);
  assert.deepStrictEqual(A.readyProspects([], senior(), env()), []);
  assert.deepStrictEqual(A.readyProspects(undefined, undefined, env()), []);
}

// ---- the page markup the code depends on ---------------------------------------------------------------------------
{
  const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
  ['squad-academy-view', 'academy-status', 'academy-search', 'academy-ready-chip', 'academy-filter-mount', 'academy-head', 'academy-body', 'academy-footnote'].forEach(id => assert(html.includes(`id="${id}"`), `index.html has #${id}`));
  assert(html.includes("squad-academy-view") && /mode === 'academy' \? ''/.test(fs.readFileSync(__dirname + '/../js/depth_chart.js', 'utf8')), 'depth_chart.js shows and hides the Academy container');
  assert(!/at-star|at-alert|AcademyWatch|academy-watchlist|toggleWatch|regen watchlist/i.test(html + fs.readFileSync(__dirname + '/../js/academy_tracker.js', 'utf8') + fs.readFileSync(__dirname + '/../js/preload.js', 'utf8')), 'the regen watchlist is gone from the UI and the preload');
  const main = fs.readFileSync(__dirname + '/../main.js', 'utf8');
  assert(!/getAcademyWatchlist|toggleAcademyWatch|setAcademyWatchNote|academy-watch/.test(main), 'and from the main process');
  assert(/getAcademyTracker/.test(main) && /academy_watchlist/.test(fs.readFileSync(__dirname + '/../schema.sql', 'utf8')), 'the tracker query stays and the old table is kept so no data is lost');
}

// ---- the page: fake DOM + app.js globals ---------------------------------------------------------------------------
(async () => {
  const els = {};
  const el = id => (els[id] = els[id] || { id, innerHTML: '', value: '', style: { display: '' }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  ['academy-body', 'academy-head', 'academy-status', 'academy-ready-chip', 'academy-footnote', 'academy-search', 'academy-filter-mount', 'squad-academy-view'].forEach(el);
  globalThis.document = { getElementById: id => els[id] || null };
  const opened = [];
  Object.assign(globalThis, {
    currentPlayers: SENIORS, currentSaveId: 1,
    currentYouthAcademy: [{ player_id: 101, name: 'Noah Ibarra', position_id: 0, overall: 66, potential_low: 70, potential_high: 80 }], // only 101 has a live row
    getPositionInfo: p => ({ label: LABELS[p], group: GROUPS[p] }), computeAge: dob => (dob ? 2027 - Number(String(dob).slice(0, 4)) : null),
    getLastName: n => String(n).split(' ').pop(), POSITION_SORT_ORDER: ORDER,
    formatAcademyPotentialDisplay: a => `${a.potential_low}-${a.potential_high}`, SHOW_TRUE_POTENTIAL: false,
    openPlayerProfile: id => opened.push(id), deltaBadge: d => (d ? `<small>${d > 0 ? '+' : ''}${d}</small>` : ''), buildPlayerAvatarHtml: () => '<i class="av"></i>',
    api: { getAcademyTracker: async () => TRACKS }
  });
  const body = () => els['academy-body'].innerHTML;
  const order = () => [...body().matchAll(/rowClick\(event, '(\d+)'\)/g)].map(m => Number(m[1]));
  const setTracks = t => { A.setData(t); A.render(); };

  A.invalidate(); A.render();
  assert(/Loading academy/.test(body()), 'the loading state before data arrives');

  await A.show();
  assert.deepStrictEqual(order(), [101, 103, 102, 104, 140], 'default tab is In academy, ready for promotion first');
  assert(/>Ready for promotion</.test(body()) && /5 above Jamie Cole \(61\) · would be 2nd of 3 GKs/.test(body()), 'verdict and its reason');
  assert(/<i class="av">/.test(body()) && /class="expand-icon"/.test(body()) && /class="rating-badge"/.test(body()), 'uses the Squad list row structure');
  assert(/<small>\+14<\/small>/.test(body()), 'OVR change badge');
  assert(body().includes('70-80'), 'a prospect with a live academy row shows its displayed potential');
  assert(!/>72-82</.test(body()), 'with the true range hidden, a prospect with no live row shows no potential');
  assert(/1 ready for promotion · 1 close/.test(els['academy-ready-chip'].innerHTML) && /showReady/.test(els['academy-ready-chip'].innerHTML), 'the ready chip');
  const chips = els['academy-status'].innerHTML;
  assert(/In academy <span[^>]*>5<\/span>/.test(chips) && /Promoted <span[^>]*>1<\/span>/.test(chips) && /Left <span[^>]*>1<\/span>/.test(chips) && /All <span[^>]*>7<\/span>/.test(chips), 'status counts');
  assert(/class="home-toggle-btn active"[^>]*>In academy/.test(chips));
  assert(/Ready for promotion<\/strong> = /.test(els['academy-footnote'].innerHTML), 'the footnote explains the rule');

  assert(!/>Status[^<]*</.test(els['academy-head'].innerHTML) && !/at-status/.test(body()), 'no Status column on a single-status tab: it would repeat the tab name');
  assert.deepStrictEqual(A.visibleColumns('academy').map(c => c[0]), ['name', 'position', 'age', 'months', 'ovr', 'pot', 'ready']);
  assert.deepStrictEqual(A.visibleColumns('all').map(c => c[0]), A.COLUMNS.map(c => c[0]), 'the All tab shows every column');
  assert(/colspan="7"/.test(body()), 'detail rows span the visible columns');
  A.setStatus('promoted'); assert.deepStrictEqual(order(), [7], 'Promoted tab'); assert(!/>Ready for promotion</.test(body()), 'a promoted player has no verdict');
  A.setStatus('left'); assert.deepStrictEqual(order(), [130]);
  A.setStatus('all'); assert.deepStrictEqual(order(), [101, 103, 102, 104, 140, 7, 130], 'All tab; the two non-academy rows have no verdict, no shown potential, so overall decides (64 before 57)');
  assert(/>Status/.test(els['academy-head'].innerHTML) && /class="at-status st-promoted"/.test(body()) && /class="at-status st-left"/.test(body()), 'the All tab shows the Status column and each row\'s status');
  assert(/colspan="8"/.test(body()), 'detail rows span all eight columns on the All tab');
  globalThis.SHOW_TRUE_POTENTIAL = true; A.render();
  assert(/>70-80</.test(body()) && body().split('70-80').length >= 4, 'with the true range allowed, prospects without a live row show their stored range');
  globalThis.SHOW_TRUE_POTENTIAL = false; A.setStatus('academy');
  A.setStatus('all'); A.sort('status'); assert(/Status ▲/.test(els['academy-head'].innerHTML), 'sorting by status works on the All tab');
  A.setStatus('academy'); assert(/Promotion ▲/.test(els['academy-head'].innerHTML) && !/Status/.test(els['academy-head'].innerHTML), 'leaving the All tab while sorted by Status falls back to the default sort instead of sorting by a hidden column');

  A.sort('age'); assert.deepStrictEqual(order(), [102, 103, 101, 104, 140], 'age: oldest first, unknown last');
  A.sort('age'); assert.deepStrictEqual(order(), [104, 101, 102, 103, 140], 'the same header again reverses (unknown still last)');
  A.sort('name'); assert(/Player ▲/.test(els['academy-head'].innerHTML), 'a text column starts A-Z, arrow shown'); assert.deepStrictEqual(order(), [103, 140, 101, 104, 102]);
  A.sort('ovr'); assert(/OVR ▼/.test(els['academy-head'].innerHTML), 'a number column starts high-to-low'); assert.deepStrictEqual(order(), [102, 101, 103, 104, 140]);
  A.sort('ready'); assert.deepStrictEqual(order(), [101, 103, 102, 104, 140]);

  els['academy-search'].value = 'lund'; A.render(); assert.deepStrictEqual(order(), [104], 'search by name');
  els['academy-search'].value = 'LUND'; A.render(); assert.deepStrictEqual(order(), [104], 'case-insensitive');
  els['academy-search'].value = 'zzz'; A.render(); assert(/No prospects match your search and filters/.test(body()), 'empty search message');
  els['academy-search'].value = ''; A.render();

  A.setStatus('all'); // the chip must also leave the All / Promoted / Left tabs: a ready prospect is, by definition, still in the academy
  A.showReady(); assert.deepStrictEqual(order(), [101], 'the ready chip narrows to the ready prospects (via the shared filter)');
  assert(/class="home-toggle-btn active"[^>]*>In academy/.test(els['academy-status'].innerHTML), 'and switches back to the In academy tab');
  assert(/Filters/.test(els['academy-filter-mount'].innerHTML), 'the shared filter control is drawn');
  A.clearFilters(); assert.deepStrictEqual(order(), [101, 103, 102, 104, 140], 'clearing the filters restores the list');

  A.rowClick({ target: { closest: s => (s === '.player-name' ? {} : null) } }, 101);
  assert(/class="detail-row open"/.test(body()) && /Season<\/th>/.test(body()) && /2026\/27/.test(body()), 'a name click expands the season history');
  assert.strictEqual(opened.length, 0);
  A.rowClick({ target: { closest: () => null } }, 101);
  assert.deepStrictEqual(opened, ['101'], 'any other click opens the profile');
  A.toggleOpen(101); assert(!/class="detail-row open"/.test(body()), 'toggling again collapses');

  setTracks([T(301, '<img src=x onerror=1>', 14, 17, 'academy', 55, 60)]);
  assert(!/<img src=x/.test(body()) && /&lt;img src=x/.test(body()), 'names are escaped');
  setTracks([]); assert(/No academy history yet/.test(body()), 'no tracks at all');
  setTracks([T(302, 'Only Left', 14, 19, 'left', 50, 52)]); assert(/No prospects match\./.test(body()), 'the chosen tab is empty');
  assert.strictEqual(els['academy-ready-chip'].innerHTML, '', 'no academy prospects: no ready chip');
  setTracks([T(303, 'Low Guy', 14, 16, 'academy', 40, 44)]); assert(/No one ready for promotion yet/.test(els['academy-ready-chip'].innerHTML), 'academy but nobody ready: says so');

  globalThis.currentYouthAcademy = [{ player_id: 1, name: 'Live Prospect', position_id: 0, overall: 66, dob: '2010-01-01' }];
  const live = A.liveReady();
  assert.deepStrictEqual(live.map(x => x.player.name), ['Live Prospect']); assert.strictEqual(live[0].ready.key, 'ready');
  globalThis.currentYouthAcademy = undefined; assert.deepStrictEqual(A.liveReady(), [], 'no academy data: empty');
  const mute = console.error; console.error = () => {}; const gp = globalThis.getPositionInfo; globalThis.getPositionInfo = () => { throw new Error('boom'); };
  globalThis.currentYouthAcademy = [{ player_id: 1, name: 'X', position_id: 0, overall: 66 }];
  assert.deepStrictEqual(A.liveReady(), [], 'a failure yields an empty list, never an exception'); globalThis.getPositionInfo = gp;

  A.invalidate(); globalThis.api = { getAcademyTracker: async () => { throw new Error('db gone'); } };
  await A.reload(); console.error = mute;
  assert(!/Loading academy/.test(body()), 'a failed load settles instead of hanging');

  console.log('academy tracker: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
