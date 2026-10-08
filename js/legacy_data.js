// One-time carry-over of the data folder used by the FC 26 releases (version 1.x) into this app's own data folder.
//
// The FC 27 app has its own identity (package name, appId, installer folder) so that installing it never replaces an
// FC 26 install and the two never share a database. Anyone moving over from the FC 26 version, and the developer's own
// dev data, gets their saves copied (never moved) the first time the new app starts with an empty data folder.
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
