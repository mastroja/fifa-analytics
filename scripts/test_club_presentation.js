// node scripts/test_club_presentation.js — js/club_presentation.js: transfer window calendar, ticker CLUB items,
// team theme colours.
const assert = require('assert');
const C = require('../js/club_presentation.js');

// ---- dates ----
assert.strictEqual(C.longDate(C.toDate('20261015')), 'Thu 15 Oct 2026');
assert.strictEqual(C.toDate('junk'), null);

// ---- transfer windows ----
let w = C.transferWindow('2026-10-15');
assert.deepStrictEqual([w.open, w.name, w.daysUntil], [false, 'January', 78], 'autumn: January window ahead (crosses the year)');
w = C.transferWindow('2027-01-20');
assert.deepStrictEqual([w.open, w.name, w.daysLeft], [true, 'January', 11]);
assert.strictEqual(C.transferWindow('2027-01-31').daysLeft, 0, 'January deadline day');
w = C.transferWindow('2027-03-01');
assert.deepStrictEqual([w.open, w.name, w.daysUntil], [false, 'summer', 122]);
assert.strictEqual(C.transferWindow('2027-07-01').open, true, 'summer window opens 1 July');
assert.strictEqual(C.transferWindow('2027-09-01').daysLeft, 0, 'summer deadline day');
w = C.transferWindow('2027-09-02');
assert.deepStrictEqual([w.open, w.name], [false, 'January'], 'day after the summer deadline');
assert.strictEqual(C.transferWindow(null), null);

// ---- ticker items ----
const months = y => (parseInt(y, 10) - 2026) * 12 - 4; // as of Oct 2026: 2027 -> 8 months
const squad = [{ name: 'Lewis', injury: 1, contract_expiry: 2027 }, { name: 'Turner', injury: 1, contract_expiry: 2029 },
  { name: 'Walker', injury: 0, contract_expiry: 2027 }, { name: 'Smith', injury: 0, contract_expiry: 2030 }];
let items = C.clubTickerItems({ date: '20261015', squad, monthsUntil: months });
assert.deepStrictEqual(items.map(i => i.text), ['📅 Thu 15 Oct 2026', '🔁 The January transfer window opens in 78 days',
  '📋 2 contracts expire within 12 months', '🚑 2 injured: Lewis, Turner']);
items = C.clubTickerItems({ date: '2027-01-31', squad: squad.map(p => ({ ...p, injury: 0 })), monthsUntil: months });
assert(items[1].text.startsWith('🚨 Deadline day') && items[1].tone === 'alert');
assert(items.some(i => i.text === '✅ Full squad fit'));
items = C.clubTickerItems({ date: '2027-01-28', squad: [], monthsUntil: months });
assert.strictEqual(items[1].tone, 'warn', 'last week of a window');
assert.strictEqual(items.length, 2, 'no squad -> just date + window, no fake "full squad fit"');
const many = Array.from({ length: 5 }, (_, i) => ({ name: 'P' + i, injury: 1 }));
assert(C.clubTickerItems({ date: '20261015', squad: many }).find(i => i.text.startsWith('🚑')).text.endsWith('+2'));
assert.deepStrictEqual(C.clubTickerItems({ date: null, squad }), [], 'no in-game date -> no CLUB group');

// ---- team theme ----
const hueOf = v => Number(v.match(/hsl\((\d+)/)[1]);
const lOf = v => Number(v.match(/(\d+)%\)$/)[1]);
const red = { r: 239, g: 1, b: 7 }, white = { r: 255, g: 255, b: 255 }, black = { r: 0, g: 0, b: 0 }, navy = { r: 3, g: 70, b: 148 };
let t = C.teamThemeVars([red, white, black]);
assert(hueOf(t['--accent-color']) <= 2 || hueOf(t['--accent-color']) >= 358, 'red club -> red accent');
assert(lOf(t['--bg-color']) <= 8, 'background stays dark');
t = C.teamThemeVars([white, black, black]);
assert.strictEqual(t['--accent-color'], '#e6edf3', 'black-and-white kit -> white accent, neutral background');
t = C.teamThemeVars([navy, white]);
assert(lOf(t['--accent-color']) >= 50, 'dark navy lifted so it reads on dark: ' + t['--accent-color']);
assert(hueOf(t['--accent-color']) > 200 && hueOf(t['--accent-color']) < 220, 'still blue');
t = C.teamThemeVars('#6CABDD');
assert(hueOf(t['--accent-color']) > 195 && hueOf(t['--accent-color']) < 215, 'hex override (sky blue)');
assert.strictEqual(C.teamThemeVars([black, black, black]), null, 'all-zero export (no colours read) -> no team theme');
assert.strictEqual(C.teamThemeVars('nope'), null);
assert.strictEqual(C.teamThemeVars(undefined), null);
assert.deepStrictEqual(C.kitColours({ primary: red, secondary: white, tertiary: black }), [red, white, black]);
Object.values(C.teamThemeVars([red])).forEach(v => assert(!/NaN/.test(v), 'no NaN in ' + v));

console.log('club presentation tests passed');
