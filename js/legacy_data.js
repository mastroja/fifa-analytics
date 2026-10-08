// One-time carry-over of the data folder used before the app was renamed (package name "fifa-career-companion", now
// "fifa-analytics"). Electron derives the data folder from the package name, so the rename moves it; without this,
// everyone updating would open the app to an empty database. Saves are copied (never moved) the first time the app
// starts with an empty new folder, so the old folder stays as a backup.
'use strict';
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['license.json']); // a license belongs to the app that activated it

// Returns the list of copied file names ([] when nothing was copied).
function importLegacyUserData({ legacyDir, userDir, dbFileName = 'companion.sqlite' }) {
  try {
    if (!legacyDir || !userDir || path.resolve(legacyDir) === path.resolve(userDir)) return [];
    if (fs.existsSync(path.join(userDir, dbFileName))) return [];            // already has its own data
    if (!fs.existsSync(path.join(legacyDir, dbFileName))) return [];         // nothing to carry over
    fs.mkdirSync(userDir, { recursive: true });
    const copied = [];
    for (const name of fs.readdirSync(legacyDir)) {
      const src = path.join(legacyDir, name);
      if (SKIP.has(name) || !/\.(sqlite|json)$/i.test(name) || !fs.statSync(src).isFile()) continue;
      fs.copyFileSync(src, path.join(userDir, name));
      copied.push(name);
    }
    return copied;
  } catch (e) {
    console.error('[LegacyData] Could not carry over the old data folder:', e.message);
    return [];
  }
}

module.exports = { importLegacyUserData };
