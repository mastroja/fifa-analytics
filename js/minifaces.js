// Minifaces: real in-game face renders made by Live Editor (v27.1.4+ PlayerCapture* API), shown in place of the
// bundled stand-in headshots.
//
// Live Editor writes p<playerid>.PNG (256x256, head and shoulders) to its heads folder when player_editor_sync.lua
// (F11) captures a player. This module copies those files into <userData>/minifaces/<playerid>.png (so they survive
// Live Editor reinstalls and the app owns what it shows), hands out image URLs for them, and drives the capture:
//   * the "Generate faces" button queues the squad via ea_fc_face_capture_pending.json and presses F11;
//   * the player editor needs no call: player_editor_sync.lua re-captures every player whose look it just edited,
//     and the folder watcher below imports the fresh PNG, so an edited hairstyle shows up on its own.
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const DEFAULT_SOURCE_DIR = 'C:\\FC 27 Live Editor\\mods\\legacy\\data\\ui\\imgAssets\\heads';
const PENDING_PATH = 'C:\\Users\\Public\\ea_fc_face_capture_pending.json';
const RESULT_PATH = 'C:\\Users\\Public\\ea_fc_face_capture_result.json';
const FILE_RE = /^p(\d+)\.png$/i;
const PREVIEW_PENDING = 'C:\\Users\\Public\\ea_fc_face_preview_pending.json';
const PREVIEW_RESULT = 'C:\\Users\\Public\\ea_fc_face_preview_result.json';
const PREVIEW_RESTORE_RESULT = 'C:\\Users\\Public\\ea_fc_face_preview_restore.json';
// the look columns the game accepts for a preview; keep in sync with PREVIEW_LIMITS in player_editor_sync.lua
const PREVIEW_FIELDS = ['skintonecode', 'skincomplexion', 'skintypecode', 'hairtypecode', 'haircolorcode',
  'facialhairtypecode', 'facialhaircolorcode', 'eyecolorcode', 'eyedetail', 'eyebrowcode'];

let ctx = { userDataPath: null, triggerF11: null, getSquadPlayerIds: null, onChanged: null, isPro: null, getAllFacePlayerIds: null };
let faceCache = null; // Map<playerId, mtimeMs> of the imported faces
let watcher = null;
let generating = false;
const previewHold = new Set(); // player ids whose heads-folder PNG is currently a preview render

function configure(c) { ctx = Object.assign(ctx, c); }

function facesDir() { return path.join(ctx.userDataPath, 'minifaces'); }
function configPath() { return path.join(facesDir(), 'config.json'); }

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')) || {}; } catch (e) { return {}; }
}
function getSourceDir() { return readConfig().sourceDir || DEFAULT_SOURCE_DIR; }

function setSourceDir(dir) {
  if (typeof dir !== 'string' || !dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { success: false, error: 'That folder does not exist.' };
  }
  fs.mkdirSync(facesDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ sourceDir: dir }));
  startWatching();
  return { success: true, sourceDir: dir, imported: importAll() };
}

function loadCache() {
  faceCache = new Map();
  try {
    fs.readdirSync(facesDir()).forEach(f => {
      const m = /^(\d+)\.png$/.exec(f);
      if (m) faceCache.set(Number(m[1]), fs.statSync(path.join(facesDir(), f)).mtimeMs);
    });
  } catch (e) { /* folder not created yet */ }
}

// Image URL for a player's generated face, or null if there is none. ?v= makes the renderer reload a face that was
// regenerated after an edit instead of showing its cached copy.
function faceUrl(playerId) {
  if (!ctx.userDataPath) return null;
  if (!faceCache) loadCache();
  const mtime = faceCache.get(Number(playerId));
  if (!mtime) return null;
  return 'file:///' + path.join(facesDir(), `${Number(playerId)}.png`).replace(/\\/g, '/') + '?v=' + Math.round(mtime);
}

// Copies one Live Editor file in if it is new or newer. Returns true when the stored face changed.
function importFile(srcDir, fileName) {
  const m = FILE_RE.exec(fileName);
  if (!m) return false;
  const id = Number(m[1]);
  if (previewHold.has(id)) return false; // a preview render must never replace the player's real face
  const src = path.join(srcDir, fileName);
  let st;
  try { st = fs.statSync(src); } catch (e) { return false; }
  if (!st.isFile() || st.size < 1000) return false; // still being written / empty
  if (!faceCache) loadCache();
  const have = faceCache.get(id);
  if (have && have >= st.mtimeMs) return false;
  fs.mkdirSync(facesDir(), { recursive: true });
  const dest = path.join(facesDir(), `${id}.png`);
  fs.copyFileSync(src, dest);
  faceCache.set(id, fs.statSync(dest).mtimeMs);
  return true;
}

function importAll() {
  const srcDir = getSourceDir();
  let n = 0;
  try {
    fs.readdirSync(srcDir).forEach(f => { if (importFile(srcDir, f)) n++; });
  } catch (e) { /* Live Editor folder missing */ }
  if (n > 0 && ctx.onChanged) ctx.onChanged(n);
  return n;
}

// Imports faces as Live Editor writes them (after a capture from the button or from a player editor save).
function startWatching() {
  if (watcher) { watcher.close().catch(() => {}); watcher = null; }
  const srcDir = getSourceDir();
  if (!fs.existsSync(srcDir)) return;
  watcher = chokidar.watch(srcDir, {
    persistent: true, usePolling: true, interval: 1000, depth: 0, ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 200 }
  });
  let pending = 0, timer = null;
  watcher.on('all', (event, filePath) => {
    if (event !== 'add' && event !== 'change') return;
    if (importFile(srcDir, path.basename(filePath))) {
      pending++;
      clearTimeout(timer);
      timer = setTimeout(() => { const n = pending; pending = 0; if (ctx.onChanged) ctx.onChanged(n); }, 400);
    }
  });
}

function status() {
  if (!faceCache) loadCache();
  const srcDir = getSourceDir();
  const ids = ctx.getAllFacePlayerIds ? [...new Set(ctx.getAllFacePlayerIds().map(Number).filter(n => n > 0))] : [];
  const have = ids.filter(id => faceCache.has(id)).length;
  return { sourceDir: srcDir, sourceExists: fs.existsSync(srcDir), faceCount: faceCache.size, generating, total: ids.length, have, missing: ids.length - have };
}

// One batch (the Lua side takes at most 60 players per run): write the request, press F11, wait for the renders.
async function captureBatch(ids, srcDir, manual, onProgress) {
  {
    try { fs.unlinkSync(RESULT_PATH); } catch (e) { /* none yet */ }
    fs.writeFileSync(PENDING_PATH, JSON.stringify({ written_at: new Date().toISOString(), player_ids: ids }));
    const startedAt = Date.now() - 1000;
    const pressed = await ctx.triggerF11(manual);
    if (!pressed) {
      try { fs.unlinkSync(PENDING_PATH); } catch (e) { /* ignore */ }
      return { success: false, error: 'Could not reach the game window. Is the game running, and F11 bound to player_editor_sync.lua?' };
    }
    let result = null;
    for (let waited = 0; waited < 20000 && !result; waited += 400) {
      await new Promise(r => setTimeout(r, 400));
      try {
        if (fs.statSync(RESULT_PATH).mtimeMs >= startedAt) result = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
      } catch (e) { /* not written yet */ }
    }
    if (!result) {
      try { fs.unlinkSync(PENDING_PATH); } catch (e) { /* ignore */ }
      return { success: false, error: 'Live Editor did not answer. Is F11 bound to player_editor_sync.lua?' };
    }
    if (result.error) return { success: false, error: result.error };
    const queued = (result.queued || []).map(Number);
    if (queued.length === 0) return { success: false, error: 'Live Editor queued no players.' };

    // PlayerCaptureStart returns at once and renders about 2 s per player; wait for the files to land.
    const deadline = Date.now() + Math.max(30000, queued.length * 4000);
    let found = 0;
    while (Date.now() < deadline) {
      found = queued.filter(id => {
        try { return fs.statSync(path.join(srcDir, `p${id}.PNG`)).mtimeMs >= startedAt; } catch (e) { return false; }
      }).length;
      if (onProgress) onProgress({ done: found, total: queued.length });
      if (found >= queued.length) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    importAll();
    queued.forEach(id => autoAttempts.set(id, (autoAttempts.get(id) || 0) + 1));
    return { success: true, requested: queued.length, found, skipped: (result.skipped || []).length };
  }
}


const BATCH_SIZE = 50;

// Captures faces for these players through Live Editor, in batches. Resolves { success, requested, found, error? }.
async function generate(playerIds, onProgress, opts) {
  const manual = !opts || opts.manual !== false; // false = background run that must not pull the game window forward
  if (generating) return { success: false, error: 'A face capture is already running.' };
  const ids = [...new Set((playerIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return { success: false, error: 'No players to capture.' };
  const srcDir = getSourceDir();
  if (!fs.existsSync(srcDir)) {
    return { success: false, error: `Live Editor's heads folder was not found (${srcDir}). Pick it with "Choose folder" in Dynamic look > Overview > Player faces.` };
  }
  generating = true;
  try {
    let requested = 0, found = 0, skipped = 0;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const base = found;
      const res = await captureBatch(batch, srcDir, manual, onProgress ? (p => onProgress({ done: base + p.done, total: ids.length })) : null);
      if (!res.success) {
        if (requested === 0) return res;
        return { success: true, requested: ids.length, found, skipped, partial: true, error: res.error };
      }
      requested += res.requested; found += res.found; skipped += res.skipped;
    }
    return { success: true, requested, found, skipped };
  } finally {
    generating = false;
  }
}


// ---- automatic capture ----
// Every sync (senior squad export, youth academy export) hands its player ids here. Anyone without a generated face is
// captured in the background, so a new signing, promotion or regen gets his face with no button press. Runs only while
// the game window already has focus (like the auto-refresh), is debounced into one batch, and gives up on a player
// after 2 tries so a player Live Editor cannot render never causes a loop.
const autoAttempts = new Map(); // playerId -> capture attempts this session
const MAX_AUTO_ATTEMPTS = 2;
const AUTO_BATCH = 60;
let autoTimer = null;
const autoWanted = new Set();

function missingFaceIds(ids, ignoreAttempts) {
  if (!faceCache) loadCache();
  return [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))]
    .filter(id => !faceCache.has(id) && (ignoreAttempts || (autoAttempts.get(id) || 0) < MAX_AUTO_ATTEMPTS));
}

function autoCapture(ids) {
  if (!ctx.userDataPath) return;
  missingFaceIds(ids).forEach(id => autoWanted.add(id));
  if (autoWanted.size === 0 || autoTimer) return;
  autoTimer = setTimeout(async () => {
    autoTimer = null;
    if (generating) { autoCapture([]); return; }
    const batch = missingFaceIds([...autoWanted]).slice(0, AUTO_BATCH);
    autoWanted.clear();
    if (batch.length === 0) return;
    try {
      const res = await generate(batch, null, { manual: false });
      if (!res.success) console.log('[Minifaces] auto capture skipped:', res.error);
    } catch (e) { console.error('[Minifaces] auto capture failed:', e); }
  }, 4000);
}

// ---- in-game preview ----
// Applies an UNSAVED look to one player in the game, captures his face, and reverts. player_editor_sync.lua does the
// game side (backup first, revert on the next F11 press). The render is kept as preview_<id>_<time>.png, separate from
// the real face, and the heads-folder PNG (which now holds the preview render) is put back to the real face so a later
// import cannot mistake it for the real one.
function previewUrlFor(file) {
  return 'file:///' + path.join(facesDir(), file).replace(/\\/g, '/');
}

function clearOldPreviews(playerId) {
  try {
    fs.readdirSync(facesDir()).forEach(f => { if (new RegExp(`^preview_${playerId}_`).test(f)) fs.unlinkSync(path.join(facesDir(), f)); });
  } catch (e) { /* nothing to clear */ }
}

async function waitForFile(file, notBefore, timeoutMs) {
  for (let waited = 0; waited < timeoutMs; waited += 400) {
    try {
      if (fs.statSync(file).mtimeMs >= notBefore) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { /* not written yet / still being written */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

async function preview(playerId, changes) {
  if (ctx.isPro && !ctx.isPro('player-editor')) return { success: false, error: 'The player editor is a Pro feature.' };
  const pid = Number(playerId);
  if (!Number.isInteger(pid) || pid <= 0) return { success: false, error: 'No player.' };
  if (generating) return { success: false, error: 'A face capture is already running.' };
  const fields = {};
  for (const f of PREVIEW_FIELDS) {
    const v = changes && changes[f];
    if (v === undefined || v === null) continue;
    if (!Number.isInteger(v)) return { success: false, error: `Bad value for ${f}.` };
    fields[f] = v;
  }
  if (Object.keys(fields).length === 0) return { success: false, error: 'Nothing to preview.' };
  const srcDir = getSourceDir();
  if (!fs.existsSync(srcDir)) return { success: false, error: `Live Editor's heads folder was not found (${srcDir}).` };

  generating = true;
  previewHold.add(pid);
  const heads = path.join(srcDir, `p${pid}.PNG`);
  const realFace = path.join(facesDir(), `${pid}.png`);
  let previewFile = null, reverted = false, error = null;
  try {
    const previewId = Date.now();
    try { fs.unlinkSync(PREVIEW_RESULT); } catch (e) { /* none yet */ }
    fs.writeFileSync(PREVIEW_PENDING, JSON.stringify({ preview_id: previewId, player_id: pid, fields }));
    const startedAt = Date.now() - 1000;
    if (!(await ctx.triggerF11(true))) {
      try { fs.unlinkSync(PREVIEW_PENDING); } catch (e) { /* ignore */ }
      return { success: false, error: 'Could not reach the game window. Is the game running, and F11 bound to player_editor_sync.lua?' };
    }
    const res = await waitForFile(PREVIEW_RESULT, startedAt, 20000);
    if (!res) {
      try { fs.unlinkSync(PREVIEW_PENDING); } catch (e) { /* ignore */ }
      return { success: false, error: 'Live Editor did not answer. Is F11 bound to player_editor_sync.lua?' };
    }
    if (!res.ok) return { success: false, error: res.error || 'The game refused the preview.' };

    // the capture renders in the background (about 2 s)
    let rendered = false;
    for (let waited = 0; waited < 30000 && !rendered; waited += 500) {
      try { rendered = fs.statSync(heads).mtimeMs >= startedAt && fs.statSync(heads).size > 1000; } catch (e) { /* not yet */ }
      if (!rendered) await new Promise(r => setTimeout(r, 500));
    }
    await new Promise(r => setTimeout(r, 600)); // let the file finish writing
    if (rendered) {
      fs.mkdirSync(facesDir(), { recursive: true });
      clearOldPreviews(pid);
      previewFile = `preview_${pid}_${Date.now()}.png`;
      fs.copyFileSync(heads, path.join(facesDir(), previewFile));
    } else {
      error = 'The game did not produce a preview image in time.';
    }

    // put the heads-folder file back to the real face (or remove it if there is none), so it is not imported later
    try {
      if (fs.existsSync(realFace)) fs.copyFileSync(realFace, heads); else fs.unlinkSync(heads);
    } catch (e) { /* best effort; importFile also skips held ids */ }

    // revert the look in the game: any F11 run starts by restoring the backup
    try { fs.unlinkSync(PREVIEW_RESTORE_RESULT); } catch (e) { /* none yet */ }
    const revertAt = Date.now() - 1000;
    if (await ctx.triggerF11(true)) {
      const rr = await waitForFile(PREVIEW_RESTORE_RESULT, revertAt, 15000);
      reverted = !!(rr && rr.ok);
      if (rr && !rr.ok) error = (error ? error + ' ' : '') + `The preview could not be reverted in the game (${rr.error}). Press F11 again or reload the save.`;
    }
    if (!reverted && !error) {
      error = 'The preview was shown, but reverting it in the game was not confirmed. It reverts on the next F11 sync; do not save the career before that.';
    }
    if (previewFile) return { success: true, url: previewUrlFor(previewFile) + '?v=' + Date.now(), reverted, warning: error || null };
    return { success: false, error: error || 'Preview failed.', reverted };
  } finally {
    // the grace period covers the watcher noticing the restored file
    setTimeout(() => previewHold.delete(pid), 3000);
    generating = false;
  }
}

function register(ipcMain, { dialog, getWindow }) {
  ipcMain.handle('minifaces-status', () => status());
  ipcMain.handle('minifaces-url', (_e, playerId) => faceUrl(playerId));
  ipcMain.handle('minifaces-preview', (_e, playerId, changes) => preview(playerId, changes));
  ipcMain.handle('minifaces-import', () => ({ success: true, imported: importAll() }));
  ipcMain.handle('minifaces-choose-folder', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: "Choose Live Editor's heads folder", defaultPath: getSourceDir(), properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths[0]) return { success: false, canceled: true };
    return setSourceDir(res.filePaths[0]);
  });
  ipcMain.handle('minifaces-generate-player', (_e, playerId) => {
    // the player editor's "Generate miniface" button: always re-renders, even if a face exists
    return generate([playerId], null, { manual: true });
  });
  ipcMain.handle('minifaces-generate-all', async (_e, mode) => {
    const all = ctx.getAllFacePlayerIds ? ctx.getAllFacePlayerIds() : [];
    const ids = mode === 'all' ? all : missingFaceIds(all.map(Number).filter(n => n > 0), true);
    if (ids.length === 0) return { success: true, requested: 0, found: 0, skipped: 0, nothing: true };
    return generate(ids, p => {
      const w = getWindow();
      if (w && !w.isDestroyed()) w.webContents.send('minifaces-progress', p);
    });
  });
  ipcMain.handle('minifaces-generate-squad', async () => {
    const ids = ctx.getSquadPlayerIds ? ctx.getSquadPlayerIds() : [];
    return generate(ids, p => {
      const w = getWindow();
      if (w && !w.isDestroyed()) w.webContents.send('minifaces-progress', p);
    });
  });
}

module.exports = { configure, register, faceUrl, importAll, startWatching, status, generate, autoCapture, preview };
