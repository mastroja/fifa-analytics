// node scripts/test_legacy_data.js — the fifa-career-companion -> fifa-analytics data-folder carry-over copies once, never overwrites, never moves.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importLegacyUserData } = require('../js/legacy_data');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
const legacyDir = path.join(base, 'fifa-career-companion'), userDir = path.join(base, 'fifa-analytics');
fs.mkdirSync(legacyDir);
fs.writeFileSync(path.join(legacyDir, 'companion.sqlite'), 'OLD-DB');
fs.writeFileSync(path.join(legacyDir, 'boot_links.json'), '{}');
fs.writeFileSync(path.join(legacyDir, 'license.json'), '{"token":"x"}');
fs.writeFileSync(path.join(legacyDir, 'Cookies'), 'ignore me');

let copied = importLegacyUserData({ legacyDir, userDir });
assert.deepStrictEqual(copied.sort(), ['boot_links.json', 'companion.sqlite'], 'copies the db and json, skips license and other files');
assert.strictEqual(fs.readFileSync(path.join(userDir, 'companion.sqlite'), 'utf8'), 'OLD-DB');
assert(fs.existsSync(path.join(legacyDir, 'companion.sqlite')), 'the old folder is left untouched');

fs.writeFileSync(path.join(userDir, 'companion.sqlite'), 'NEW-DB');
assert.deepStrictEqual(importLegacyUserData({ legacyDir, userDir }), [], 'does nothing once the new folder has its own db');
assert.strictEqual(fs.readFileSync(path.join(userDir, 'companion.sqlite'), 'utf8'), 'NEW-DB', 'never overwrites');
assert.deepStrictEqual(importLegacyUserData({ legacyDir: path.join(base, 'missing'), userDir: path.join(base, 'other') }), [], 'no old folder, nothing to do');
assert.deepStrictEqual(importLegacyUserData({ legacyDir, userDir: legacyDir }), [], 'same folder is ignored');
console.log('legacy data tests passed');
