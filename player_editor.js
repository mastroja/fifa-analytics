// Player editor backend (generic / regen / academy players only).
//
// Data flow (see PLAYER_EDITOR_DESIGN.md):
//   game --assets/lua/export_player_editor.lua--> ea_fc_player_editor_export.json --> importEditorExport
//   Save --> queueEdit --> ea_fc_player_edits_pending.json --assets/lua/apply_player_edits.lua--> game
//   apply_player_edits.lua --> ea_fc_player_edits_write_log.json --> handleWriteLog
//
// There is no live RPC into Live Editor, so applying an edit is always "queue a file, then the
// Lua writer runs" (manually at first). Same configure() pattern as connected_career/app_bridge.js.

const fs = require('fs');
const path = require('path');

const EXPORT_PATH = 'C:\\Users\\Public\\ea_fc_player_editor_export.json';
const PENDING_PATH = 'C:\\Users\\Public\\ea_fc_player_edits_pending.json';
const WRITE_LOG_PATH = 'C:\\Users\\Public\\ea_fc_player_edits_write_log.json';
const CATALOG_PATH = path.join(__dirname, 'assets', 'player_customization', 'catalog.json');
const MAX_EDITS_PER_RUN = 25; // must match assets/lua/apply_player_edits.lua

const ATTRIBUTES = [
  'crossing', 'finishing', 'headingaccuracy', 'shortpassing', 'volleys', 'dribbling', 'curve',
  'freekickaccuracy', 'longpassing', 'ballcontrol', 'acceleration', 'sprintspeed', 'agility',
  'reactions', 'balance', 'shotpower', 'jumping', 'stamina', 'strength', 'longshots',
  'aggression', 'interceptions', 'positioning', 'vision', 'penalties', 'composure',
  'defensiveawareness', 'standingtackle', 'slidingtackle',
  'gkdiving', 'gkhandling', 'gkkicking', 'gkpositioning', 'gkreflexes'
];

// The only game columns the editor may change, with inclusive integer limits taken from the FC 27
// probe ranges (assets/lua/fc27_probes). KEEP IN SYNC with FIELD_LIMITS in apply_player_edits.lua.
const FIELD_LIMITS = {
  overallrating: [1, 99], potential: [1, 99],
  preferredposition1: [0, 27],
  preferredposition2: [-1, 27], preferredposition3: [-1, 27], preferredposition4: [-1, 27],
  preferredposition5: [-1, 27], preferredposition6: [-1, 27],
  trait1: [0, 1073741823], trait2: [0, 8191], icontrait1: [0, 1073741823], icontrait2: [0, 63],
  skintonecode: [10, 100], skincomplexion: [1, 10], skintypecode: [0, 7],
  hairtypecode: [0, 2100], haircolorcode: [0, 27],
  facialhairtypecode: [0, 400], facialhaircolorcode: [0, 27],
  eyecolorcode: [1, 10], eyedetail: [0, 6], eyebrowcode: [0, 3000000],
  accessorycode1: [0, 1100], accessorycode2: [0, 1100], accessorycode3: [0, 1100], accessorycode4: [0, 1100],
  accessorycolourcode1: [0, 99], accessorycolourcode2: [0, 99], accessorycolourcode3: [0, 99], accessorycolourcode4: [0, 99],
  bodytypecode: [1, 11], height: [140, 220], weight: [40, 120],
  shoetypecode: [0, 562],
  jerseyfit: [0, 2], jerseysleevelengthcode: [0, 4], jerseystylecode: [0, 1], socklengthcode: [0, 3]
};
ATTRIBUTES.forEach(a => { FIELD_LIMITS[a] = [1, 99]; });

let ctx = null; // { getDb, getActiveSaveId, saveDatabaseToDisk }

function configure(c) { ctx = c; }

let schemaChecked = false;
// One-time per launch: add player_editor_state.save_uid and drop rows imported before it existed
// (those were attributed to whatever save was active, not the save that exported them).
function ensureReady() {
  if (schemaChecked || !ctx.getDb()) return;
  schemaChecked = true;
  try { ctx.getDb().run('ALTER TABLE player_editor_state ADD COLUMN save_uid TEXT;'); } catch (e) { /* already there */ }
  ctx.getDb().run('DELETE FROM player_editor_state WHERE save_uid IS NULL;');
  ctx.saveDatabaseToDisk();
}

function rowsOf(sql, params) {
  const stmt = ctx.getDb().prepare(sql);
  try {
    stmt.bind(params || []);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally {
    stmt.free();
  }
}

function popcount(n) {
  let c = 0;
  while (n > 0) { c += n % 2; n = Math.floor(n / 2); }
  return c;
}

function andNonZero(a, b) { // true if a and b share any set bit (numbers up to 2^30)
  while (a > 0 && b > 0) {
    if (a % 2 === 1 && b % 2 === 1) return true;
    a = Math.floor(a / 2); b = Math.floor(b / 2);
  }
  return false;
}

// Returns an error string, or null when `changes` is valid to apply on top of `state`.
function validateChanges(state, changes) {
  const keys = Object.keys(changes || {});
  if (keys.length === 0) return 'No changes to save.';
  for (const k of keys) {
    const lim = FIELD_LIMITS[k];
    if (!lim) return `Field "${k}" is not editable.`;
    const v = changes[k];
    if (!Number.isInteger(v)) return `"${k}" must be a whole number.`;
    if (v < lim[0] || v > lim[1]) return `"${k}" must be between ${lim[0]} and ${lim[1]}.`;
  }
  const merged = Object.assign({}, state, changes);
  // playstyles: a PlayStyle+ lives only in icontrait, never also in trait; at most one PlayStyle+
  if (keys.some(k => /^(icon)?trait[12]$/.test(k))) {
    if (andNonZero(merged.trait1 || 0, merged.icontrait1 || 0) || andNonZero(merged.trait2 || 0, merged.icontrait2 || 0)) {
      return 'A playstyle cannot be both base and PlayStyle+.';
    }
    if (popcount(merged.icontrait1 || 0) + popcount(merged.icontrait2 || 0) > 1) {
      return 'A player can have at most one PlayStyle+.';
    }
  }
  // positions: alternates must be unique and not repeat the primary
  if (keys.some(k => /^preferredposition/.test(k))) {
    const seen = new Set([merged.preferredposition1]);
    for (let i = 2; i <= 6; i++) {
      const p = merged['preferredposition' + i];
      if (p === undefined || p === null || p < 0) continue;
      if (seen.has(p)) return 'Positions must be unique.';
      seen.add(p);
    }
  }
  return null;
}

function currentState(playerId, saveId) {
  ensureReady();
  const r = rowsOf('SELECT editable, name, source, state_json, updated_at FROM player_editor_state WHERE player_id = ? AND save_id = ?', [playerId, saveId]);
  if (!r.length) return null;
  return { editable: !!r[0].editable, name: r[0].name, source: r[0].source, state: JSON.parse(r[0].state_json), updated_at: r[0].updated_at };
}

function listEdits(playerId, saveId) {
  return rowsOf('SELECT id, old_json, new_json, status, error, created_at, applied_at FROM player_edits WHERE player_id = ? AND save_id = ? ORDER BY id DESC LIMIT 50', [playerId, saveId])
    .map(e => Object.assign({}, e, { old: JSON.parse(e.old_json), new: JSON.parse(e.new_json) }));
}

// Rewrite the pending file from every queued edit (oldest first, capped per run).
function writePendingFile() {
  const queued = rowsOf("SELECT id, player_id, save_id, old_json, new_json FROM player_edits WHERE status = 'queued' ORDER BY id ASC LIMIT ?", [MAX_EDITS_PER_RUN]);
  const payload = {
    written_at: new Date().toISOString(),
    edits: queued.map(e => ({ edit_id: e.id, player_id: e.player_id, old: JSON.parse(e.old_json), new: JSON.parse(e.new_json) }))
  };
  fs.writeFileSync(PENDING_PATH, JSON.stringify(payload, null, 1));
  return queued.length;
}

// changes: { gameColumn: integerValue }. Only changed columns are sent; unchanged ones never are.
function queueEdit(playerId, changes) {
  const saveId = ctx.getActiveSaveId();
  const cur = currentState(playerId, saveId);
  if (!cur) return { success: false, error: 'No editor data for this player yet. Run export_player_editor.lua in Live Editor first.' };
  if (!cur.editable) return { success: false, error: 'Only generic, regen and academy players can be edited.' };

  const real = {};
  Object.keys(changes || {}).forEach(k => { if (changes[k] !== cur.state[k]) real[k] = changes[k]; });
  const err = validateChanges(cur.state, real);
  if (err) return { success: false, error: err };

  const old = {};
  Object.keys(real).forEach(k => { old[k] = cur.state[k]; });
  ctx.getDb().run('INSERT INTO player_edits (player_id, save_id, old_json, new_json, status) VALUES (?, ?, ?, ?, ?)',
    [playerId, saveId, JSON.stringify(old), JSON.stringify(real), 'queued']);
  ctx.saveDatabaseToDisk();
  const queuedCount = writePendingFile();
  return { success: true, queued: queuedCount, pendingPath: PENDING_PATH };
}

// Queue the inverse of an applied edit and mark the original undone.
function undoEdit(editId) {
  const saveId = ctx.getActiveSaveId();
  const r = rowsOf('SELECT player_id, old_json, new_json, status FROM player_edits WHERE id = ? AND save_id = ?', [editId, saveId]);
  if (!r.length) return { success: false, error: 'Edit not found.' };
  if (r[0].status !== 'applied') return { success: false, error: 'Only applied edits can be undone.' };
  const result = queueEdit(r[0].player_id, JSON.parse(r[0].old_json));
  if (result.success) {
    ctx.getDb().run("UPDATE player_edits SET status = 'undone' WHERE id = ?", [editId]);
    ctx.saveDatabaseToDisk();
  }
  return result;
}

function importEditorExport(payload) {
  if (!ctx.getDb() || !payload || !Array.isArray(payload.players)) return 0;
  ensureReady();
  // Attribute the export to the save it came from (same GetSaveUID the squad sync uses), never to
  // whatever save is active in the app. An unknown uid means that career has not synced yet.
  const uid = payload.save_uid ? String(payload.save_uid) : '';
  const found = uid ? rowsOf('SELECT id FROM saves WHERE save_uid = ?', [uid]) : [];
  if (!found.length) {
    console.warn(`[PlayerEditor] Ignored export: save_uid "${uid}" is not a known save. Run a normal F10 sync in that career first, then export again.`);
    return 0;
  }
  const saveId = found[0].id;
  const db = ctx.getDb();
  db.run('DELETE FROM player_editor_state WHERE save_id = ?', [saveId]); // the export is the whole current set
  let n = 0;
  payload.players.forEach(p => {
    if (!p.playerid) return;
    const state = {};
    Object.keys(p).forEach(k => { if (k !== 'name' && k !== 'source' && k !== 'editable') state[k] = p[k]; });
    db.run(`INSERT INTO player_editor_state (player_id, save_id, name, source, editable, state_json, save_uid, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(player_id, save_id) DO UPDATE SET name = excluded.name, source = excluded.source,
              editable = excluded.editable, state_json = excluded.state_json, save_uid = excluded.save_uid, updated_at = CURRENT_TIMESTAMP;`,
      [p.playerid, saveId, p.name || '', p.source || '', p.editable ? 1 : 0, JSON.stringify(state), uid]);
    n++;
    reconcileEdits(p.playerid, saveId, state);
  });
  ctx.saveDatabaseToDisk();
  return n;
}

// A fresh export that already shows an edit's values means the game has it: close the loop even if
// the write log was missed (e.g. the log was never read because the app was closed).
function reconcileEdits(playerId, saveId, state) {
  rowsOf("SELECT id, new_json FROM player_edits WHERE player_id = ? AND save_id = ? AND status IN ('queued','failed')", [playerId, saveId])
    .forEach(e => {
      const nw = JSON.parse(e.new_json);
      if (Object.keys(nw).every(k => state[k] === nw[k])) {
        ctx.getDb().run("UPDATE player_edits SET status = 'applied', error = NULL, applied_at = CURRENT_TIMESTAMP WHERE id = ?", [e.id]);
      }
    });
}

// Optimistically fold an applied edit into the stored state (a later export overwrites it).
function patchStateWithEdit(editId) {
  const e = rowsOf('SELECT player_id, save_id, new_json FROM player_edits WHERE id = ?', [editId])[0];
  if (!e) return;
  const cur = currentState(e.player_id, e.save_id);
  if (!cur) return;
  const state = Object.assign({}, cur.state, JSON.parse(e.new_json));
  ctx.getDb().run('UPDATE player_editor_state SET state_json = ? WHERE player_id = ? AND save_id = ?', [JSON.stringify(state), e.player_id, e.save_id]);
}

// Write log from apply_player_edits.lua: { results: [ { edit_id, ok, error } ] }
function handleWriteLog(payload) {
  if (!payload || !Array.isArray(payload.results)) return 0;
  const db = ctx.getDb();
  let n = 0;
  payload.results.forEach(r => {
    if (!r.edit_id) return;
    if (r.ok) {
      db.run("UPDATE player_edits SET status = 'applied', error = NULL, applied_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'undone'", [r.edit_id]);
      patchStateWithEdit(r.edit_id); // keep the stored state current until the next export confirms it
    }
    else db.run("UPDATE player_edits SET status = 'failed', error = ? WHERE id = ?", [String(r.error || 'failed').slice(0, 500), r.edit_id]);
    n++;
  });
  ctx.saveDatabaseToDisk();
  try { writePendingFile(); } catch (e) { /* the next edit rewrites it */ } // the next batch (max 25 per run) of anything still queued
  return n;
}

// Boot pictures are not tied to game ids on their own. A link maps a picture (its catalog key, e.g.
// "nike/boot_006_....png") to the game's shoetypecode. User links live in boot_links.json in the app's data folder;
// assets/data/boots_id_map.json can ship defaults. A user value of null removes a shipped link.
function bootLinksPath() { return path.join(ctx.userDataPath || __dirname, 'boot_links.json'); }
function readJsonObject(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}
function getBootLinks() {
  const shipped = readJsonObject(path.join(__dirname, 'assets', 'data', 'boots_id_map.json'));
  const user = readJsonObject(bootLinksPath());
  const merged = Object.assign({}, shipped, user);
  Object.keys(merged).forEach(k => { if (merged[k] === null) delete merged[k]; });
  return merged;
}
function setBootLink(key, shoeId) {
  if (typeof key !== 'string' || !key || key.includes('..')) return { success: false, error: 'Bad picture key.' };
  const lim = FIELD_LIMITS.shoetypecode;
  if (shoeId !== null && (!Number.isInteger(shoeId) || shoeId < lim[0] || shoeId > lim[1])) return { success: false, error: 'Bad boot id.' };
  const user = readJsonObject(bootLinksPath());
  user[key] = shoeId; // null = unlink (also hides a shipped link)
  fs.writeFileSync(bootLinksPath(), JSON.stringify(user, null, 1));
  return { success: true, links: getBootLinks() };
}

function getCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  } catch (e) {
    return { hair: [], facialHair: [] };
  }
}

function register(ipcMain) {
  ipcMain.handle('get-player-editor-state', (_e, playerId) => {
    const saveId = ctx.getActiveSaveId();
    const cur = currentState(playerId, saveId);
    return { state: cur, edits: cur ? listEdits(playerId, saveId) : [], limits: FIELD_LIMITS };
  });
  ipcMain.handle('queue-player-edit', (_e, playerId, changes) => queueEdit(playerId, changes));
  ipcMain.handle('undo-player-edit', (_e, editId) => undoEdit(editId));
  ipcMain.handle('get-customization-catalog', () => getCatalog());
  ipcMain.handle('get-boot-links', () => getBootLinks());
  ipcMain.handle('set-boot-link', (_e, key, shoeId) => setBootLink(key, shoeId));
  ipcMain.handle('get-player-editor-static', () => {
    try {
      return {
        formula: JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'data', 'overall_formula.json'), 'utf8')),
        labels: JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'data', 'editor_labels.json'), 'utf8')),
        limits: FIELD_LIMITS
      };
    } catch (e) {
      return { formula: null, labels: null, limits: FIELD_LIMITS };
    }
  });
}

module.exports = {
  configure, register, importEditorExport, handleWriteLog, validateChanges, queueEdit, undoEdit, getCatalog, getBootLinks, writePendingFile,
  EXPORT_PATH, WRITE_LOG_PATH, PENDING_PATH, FIELD_LIMITS, ATTRIBUTES
};
