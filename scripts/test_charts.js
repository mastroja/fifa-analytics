// node scripts/test_charts.js — logic checks for js/charts.js (season/age maths, projection, SVG output).
const assert = require('assert');
const C = require('../js/charts.js');

assert.strictEqual(C.seasonEndYear('2026/27'), 2027);
assert.strictEqual(C.seasonEndYear('2026/2027'), 2027);
assert.strictEqual(C.seasonEndYear('1999/00'), 2000);
assert.strictEqual(C.seasonEndYear(null), null);

// born 2008-03-10 -> 18 on 30 Jun 2027, born 2008-09-01 -> 18 on 30 Jun 2027 is false (17)
assert.strictEqual(C.ageAtSeasonEnd(new Date(2008, 2, 10), '2026/27'), 19);
assert.strictEqual(C.ageAtSeasonEnd(new Date(2008, 8, 1), '2026/27'), 18);
assert.strictEqual(C.ageAtSeasonEnd(null, '2026/27'), null);
assert.strictEqual(C.ageAtSeasonEnd(new Date(2008, 2, 10), 'junk'), null);

// projection rises toward potential, never exceeds it, then declines
const proj = C.projectCurve(19, 65, 82, false);
assert(proj[0].age === 20 && proj[0].overall > 65, 'grows next year');
assert(Math.max(...proj.map(p => p.overall)) === 82, 'peaks at potential');
assert(proj[proj.length - 1].overall < 82, 'declines late');
assert.deepStrictEqual(C.projectCurve(35, 70, 70, false), [], 'no projection past the end age');
assert(C.projectCurve(30, 80, 70, false).every(p => p.overall <= 80), 'potential below overall never raises it');

// past the peak age, a gap to potential is not closed: no jump, just hold then decline
const late = C.projectCurve(29, 69, 85, false);
assert(late.every(p => p.overall <= 69), 'a 29-year-old does not jump toward potential');
assert(late[late.length - 1].overall < 69, 'and still declines later');

// empty / unusable data gives the empty state, not a broken svg
assert(/Not enough history/.test(C.developmentCurveSvg([], {})));
assert(/Not enough history/.test(C.developmentCurveSvg([{ age: null, overall: 70 }], {})));

// one season is enough to draw (single point + projection); text is escaped
let svg = C.developmentCurveSvg([{ age: 19, overall: 65, potential: 82, label: '<b>x</b>' }], {});
assert(svg.includes('<svg') && svg.includes('Projection'), 'single season draws');
assert(!svg.includes('<b>x</b>') && svg.includes('&lt;b&gt;'), 'labels escaped');
assert(!svg.includes('NaN') && !svg.includes('undefined'), 'no NaN in single-season svg');

// flat player (min == max age span) must not divide by zero
svg = C.developmentCurveSvg([{ age: 36, overall: 70, potential: 70 }], { showProjection: false });
assert(!svg.includes('NaN') && !svg.includes('Infinity'), 'no NaN/Infinity for a single flat point');

// multi-season, no projection for former players
svg = C.developmentCurveSvg([{ age: 18, overall: 60, potential: 80 }, { age: 19, overall: 66, potential: 80 }, { age: 20, overall: 70, potential: 80 }], { showProjection: false });
assert(!svg.includes('Projection') && svg.includes('Potential'), 'former-player chart has no projection');

console.log('charts tests passed');
