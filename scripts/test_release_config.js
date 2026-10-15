// node scripts/test_release_config.js — release hygiene: the version is the same everywhere, auto-update is really off
// (and loads nothing), and the README does not over-claim about privacy or updates.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const readme = read('README.md');
const main = read('main.js');
const notes = read('assets/design_docs/release_notes_v27.md');

// ---- one version everywhere ---------------------------------------------------------------------------------------
assert(/^27\.\d+\.\d+$/.test(pkg.version), `version ${pkg.version} follows 27.minor.patch`);
assert.strictEqual(lock.version, pkg.version, 'package-lock.json matches package.json');
assert.strictEqual(lock.packages[''].version, pkg.version, 'and its root package entry');
assert(readme.includes(`| FIFA Analytics | \`${pkg.version}\` |`), 'the README version table matches');
assert(new RegExp(`^## New in ${pkg.version.replace(/\./g, '\\.')}\\b`, 'm').test(notes), 'the release notes have a section for this version');
assert(/BUILD_DATE:\s*'\d{4}-\d{2}-\d{2}'/.test(read('js/license_config.js')), 'BUILD_DATE is a date');

// ---- auto-update is off and loads nothing -------------------------------------------------------------------------
assert(/const AUTO_UPDATE_ENABLED = false;/.test(main), 'AUTO_UPDATE_ENABLED is false');
const requireAt = main.indexOf("require('electron-updater')");
assert(requireAt > 0 && requireAt === main.lastIndexOf("require('electron-updater')"), 'electron-updater is required exactly once');
const fnAt = main.indexOf('function setupAutoUpdater()'), guardAt = main.indexOf('if (!AUTO_UPDATE_ENABLED) return;');
assert(fnAt > 0 && guardAt > fnAt && requireAt > guardAt, 'the require sits inside setupAutoUpdater, after the guard: while it is off the module is never loaded');
assert(!/^\s*const \{ autoUpdater \} = require/m.test(main.slice(0, fnAt)), 'no top-level require of the updater');

// ---- the README says what the app really does ---------------------------------------------------------------------
assert(!/nothing sent anywhere/i.test(readme) && !/all offline/i.test(readme), 'no "offline / nothing sent anywhere" claim');
assert(/TheSportsDB/.test(readme) && /club name/.test(readme) && /flagcdn\.com/.test(readme) && /Google Fonts/.test(readme), 'it names every outside site the app loads things from, and what each one receives');
assert(/never uploaded/.test(readme), 'and says the save data is never uploaded');
assert(/no automatic update check/i.test(readme) && !/later updates install automatically/i.test(readme), 'it does not promise automatic updates');
assert(/Not available in FC 27 yet/.test(readme) && /\*\*Beta\.\*\*/.test(readme), 'it says it is a beta and what is missing');

// Every outside host the app loads from automatically must be named in the README. Links the user clicks (docs, Patreon,
// GitHub) and XML namespaces are not loads, so they are ignored.
const files = ['index.html', 'main.js'].concat(fs.readdirSync(path.join(__dirname, '..', 'js')).filter(f => f.endsWith('.js')).map(f => `js/${f}`));
const IGNORE = /(^|\.)(w3\.org|example\.com|github\.com|patreon\.com|electronjs\.org|nodejs\.org)$/;
const found = new Set();
files.forEach(f => read(f).split('\n').forEach(line => {
  if (/^\s*(\/\/|\*|<!--)/.test(line)) return;                                      // comments
  [...line.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].forEach(m => { if (!IGNORE.test(m[1])) found.add(m[1].toLowerCase()); });
}));
assert.deepStrictEqual([...found].sort(), ['flagcdn.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.thesportsdb.com'], `the outside hosts the app talks to (found: ${[...found].join(', ')}). A new one must be added to the README before this test is updated`);
const deps = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies));
assert.deepStrictEqual(deps.filter(d => /sentry|segment|mixpanel|amplitude|posthog|analytics|telemetry|firebase|bugsnag/i.test(d)), [], 'no analytics, telemetry or crash-reporting packages');

console.log('release config: all checks passed');
