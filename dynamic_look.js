// Dynamic player look: once per in-game month, every editable (generic / regen / academy) player may change
// appearance a little: haircuts, beard growth and shaving, hair dye and greying, boot switches, accessories.
//
//   planMonth()   pure function: (player state, age, month, catalog, ...) -> proposed column changes + notes
//   DynamicLook   runs it for a save when the in-game month rolls over, queues the changes as normal editor edits
//                 (player_editor.js) and presses F11 so Live Editor applies them (player_editor_sync.lua).
//
// Everything is seeded per player and month, so a month always plays out the same way for the same player, and each
// player has fixed personality traits (how fashionable, how likely to grow a beard) that keep their behaviour consistent.
// Realism rules are in the constants at the top; they are meant to be tuned.

// ---------------- seeded randomness ----------------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const unit = (seed) => mulberry32(hashStr(seed))();

function pickWeighted(rng, items) { // [[value, weight], ...]
  const total = items.reduce((s, it) => s + it[1], 0);
  let r = rng() * total;
  for (const [v, w] of items) { r -= w; if (r <= 0) return v; }
  return items[items.length - 1][0];
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

// ---------------- realism tuning ----------------
// Chance per month that a player changes hairstyle, by age (younger players experiment more).
function hairChangeRate(age) {
  if (age <= 19) return 0.10;
  if (age <= 24) return 0.08;
  if (age <= 29) return 0.05;
  if (age <= 34) return 0.035;
  return 0.02;
}
// Where a haircut tends to go next, by current length: a long head of hair usually gets cut short, short hair grows out slowly.
const HAIR_LENGTH_NEXT = {
  short: [['short', 60], ['med', 30], ['long', 10]],
  med: [['short', 45], ['med', 35], ['long', 20]],
  long: [['short', 40], ['med', 30], ['long', 30]]
};
// Beard state machine, per month: [grow, trim, shave] chances from each state.
const BEARD_CHANCES = {
  short: { grow: 0.20, trim: 0, shave: 0.06 },
  med: { grow: 0.06, trim: 0.06, shave: 0.04 },
  long: { grow: 0, trim: 0.06, shave: 0.04 }
};
const BEARD_START_RATE = 0.05;       // monthly chance a clean-shaven adult starts growing one, times beardiness
const BEARD_MIN_AGE = 18;
const NATURAL_COLOURS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 12, 13]);
const DARK_COLOURS = new Set([0, 3, 5, 6]);
const DYE_RATE = 0.006;               // monthly, age <= 27, times fashion
const DYE_MONTHS = [2, 6];            // a dye job lasts this many months, then it grows out to the natural colour
const DYES_FOR_DARK = [[1, 40], [4, 20], [7, 15], [12, 10], [14, 5], [11, 4], [10, 3], [8, 3]];
const DYES_FOR_LIGHT = [[0, 30], [3, 20], [7, 15], [14, 10], [11, 10], [10, 5], [8, 5], [9, 5]];
const GREY_MIN_AGE = 35;
const GREY_RATE_PER_YEAR = 0.002;     // monthly chance = (age - 34) * this
const SILVER = 9;
const BOOT_SWITCH_RATE = { summer: 0.18, january: 0.06, other: 0.02 };
const BOOT_SAME_BRAND = 0.8;          // sponsorship loyalty
const ACCESSORY_IDS = [6, 7, 8, 9, 16, 22, 23, 24, 25, 26, 27];
const ACCESSORY_REMOVE_RATE = 0.08;
const ACCESSORY_ADD_RATE = 0.015;
const MAX_CHANGES_PER_MONTH = 2;      // never a total makeover in one month

const FEATURE_DEFAULTS = { hair: true, beard: true, colour: true, boots: true, accessories: true };

function suggestedCats(tone) {
  if (tone <= 40) return [1, 3];
  if (tone >= 70) return [2, 3];
  return [1, 2, 3];
}

// Fixed per-player personality in 0.5..1.5 (fashion) and 0..2 (beardiness; about a third never grow one).
function profile(playerId) {
  return {
    fashion: 0.5 + unit(`${playerId}:fashion`),
    beardiness: unit(`${playerId}:beard0`) < 0.33 ? 0 : 0.5 + unit(`${playerId}:beard1`) * 1.5,
    dyeLover: unit(`${playerId}:dye`)
  };
}

/**
 * Plan one month for one player.
 * @param {object} p
 *   state:   the player's current editor columns (hairtypecode, haircolorcode, facialhair*, shoetypecode, accessory*, skintonecode)
 *   age, month (1-12), monthIndex (a number that grows by one per in-game month, for dye expiry)
 *   playerId, seedExtra (string; empty for automatic runs)
 *   record:  { natural_haircolor, dyed_until_index } from earlier months (or null)
 *   catalog: { hair:[{id,cat,length}], facialHair:[{id,length}] }
 *   boots:   { byBrand:{brand:[gameId]}, brandOf:{gameId:brand}, all:[gameId] }
 *   features: which kinds of change are on
 * @returns {{ changes:object, notes:string[], record:object }}
 */
function planMonth(p) {
  const features = Object.assign({}, FEATURE_DEFAULTS, p.features || {});
  const rng = mulberry32(hashStr(`${p.playerId}:${p.monthIndex}:${p.seedExtra || ''}`));
  const prof = profile(p.playerId);
  const state = p.state;
  const age = p.age;
  const changes = {};
  const notes = [];
  let budget = MAX_CHANGES_PER_MONTH;
  const record = Object.assign({ natural_haircolor: state.haircolorcode, dyed_until_index: null }, p.record || {});
  let colour = state.haircolorcode;
  const hairById = new Map(((p.catalog && p.catalog.hair) || []).map(h => [h.id, h]));
  const facialById = new Map(((p.catalog && p.catalog.facialHair) || []).map(h => [h.id, h]));

  // --- hair colour: dye jobs grow out, rare new dye jobs for the young, greying for veterans ---
  if (features.colour) {
    if (record.dyed_until_index !== null && p.monthIndex >= record.dyed_until_index) {
      colour = record.natural_haircolor;
      record.dyed_until_index = null;
      changes.haircolorcode = colour;
      notes.push('dye grew out');
    } else if (record.dyed_until_index === null && budget > 0) {
      if (age <= 27 && rng() < DYE_RATE * prof.fashion * (0.5 + prof.dyeLover) && NATURAL_COLOURS.has(colour)) {
        colour = pickWeighted(rng, DARK_COLOURS.has(record.natural_haircolor) ? DYES_FOR_DARK : DYES_FOR_LIGHT);
        record.dyed_until_index = p.monthIndex + DYE_MONTHS[0] + Math.floor(rng() * (DYE_MONTHS[1] - DYE_MONTHS[0] + 1));
        if (colour !== state.haircolorcode) { changes.haircolorcode = colour; notes.push('dyed hair'); budget--; }
      } else if (age >= GREY_MIN_AGE && colour !== SILVER && NATURAL_COLOURS.has(colour) && rng() < (age - GREY_MIN_AGE + 1) * GREY_RATE_PER_YEAR) {
        colour = SILVER;
        record.natural_haircolor = SILVER; // greying is permanent
        changes.haircolorcode = colour;
        notes.push('going grey');
        budget--;
      }
    }
    // keep the beard the same shade as the hair for natural changes (not for dye jobs)
    if (changes.haircolorcode !== undefined && state.facialhairtypecode !== 0 && !notes.includes('dyed hair')) {
      changes.facialhaircolorcode = changes.haircolorcode;
    }
  }

  // --- haircut / new style, always within the styles suggested for the skin tone ---
  if (features.hair && budget > 0 && state.hairtypecode !== 0 && rng() < hairChangeRate(age) * prof.fashion) {
    const cats = suggestedCats(state.skintonecode || 50);
    const pool = ((p.catalog && p.catalog.hair) || []).filter(h => h.cat !== null && cats.includes(h.cat) && h.id !== state.hairtypecode);
    const curLen = (hairById.get(state.hairtypecode) || {}).length || null;
    let candidates = pool;
    if (curLen && HAIR_LENGTH_NEXT[curLen]) {
      const target = pickWeighted(rng, HAIR_LENGTH_NEXT[curLen]);
      const sameLen = pool.filter(h => h.length === target);
      if (sameLen.length) candidates = sameLen;
    }
    if (candidates.length) {
      const next = pick(rng, candidates);
      changes.hairtypecode = next.id;
      notes.push(next.length === 'short' && curLen === 'long' ? 'got a haircut' : 'new hairstyle');
      budget--;
    }
  }

  // --- facial hair: clean-shaven -> stubble -> medium -> long, with trims and shaves ---
  if (features.beard && budget > 0 && age >= BEARD_MIN_AGE) {
    const cur = state.facialhairtypecode;
    const curLen = cur === 0 ? 'none' : ((facialById.get(cur) || {}).length || 'short');
    let target = null;
    if (curLen === 'none') {
      if (prof.beardiness > 0 && rng() < BEARD_START_RATE * prof.beardiness) target = 'short';
    } else {
      const ch = BEARD_CHANCES[curLen] || BEARD_CHANCES.short;
      const r = rng();
      if (r < ch.shave) target = 'none';
      else if (r < ch.shave + ch.trim) target = curLen === 'long' ? 'med' : 'short';
      else if (r < ch.shave + ch.trim + ch.grow) target = curLen === 'short' ? 'med' : 'long';
    }
    if (target === 'none') {
      changes.facialhairtypecode = 0;
      notes.push('shaved');
      budget--;
    } else if (target) {
      const styles = ((p.catalog && p.catalog.facialHair) || []).filter(h => h.length === target && h.id !== cur);
      if (styles.length) {
        changes.facialhairtypecode = pick(rng, styles).id;
        if (curLen === 'none') changes.facialhaircolorcode = colour; // a new beard matches the hair
        notes.push(curLen === 'none' ? 'started growing a beard' : (target === 'short' || (curLen === 'long' && target === 'med') ? 'trimmed beard' : 'beard grew'));
        budget--;
      }
    }
  }

  // --- boots: mostly at the start of the season, mostly staying with the same brand ---
  if (features.boots && budget > 0 && p.boots && p.boots.all.length) {
    const rate = (p.month === 7 || p.month === 8) ? BOOT_SWITCH_RATE.summer : p.month === 1 ? BOOT_SWITCH_RATE.january : BOOT_SWITCH_RATE.other;
    if (rng() < rate) {
      const brand = p.boots.brandOf[state.shoetypecode];
      let pool = brand && p.boots.byBrand[brand] && rng() < BOOT_SAME_BRAND ? p.boots.byBrand[brand] : p.boots.all;
      pool = pool.filter(id => id !== state.shoetypecode);
      if (pool.length) { changes.shoetypecode = pick(rng, pool); notes.push('new boots'); budget--; }
    }
  }

  // --- accessories (tape, bands, gloves) come and go ---
  if (features.accessories && budget > 0) {
    const slots = [1, 2, 3, 4].filter(n => state['accessorycode' + n] !== 0);
    if (slots.length && rng() < ACCESSORY_REMOVE_RATE) {
      const n = pick(rng, slots);
      changes['accessorycode' + n] = 0;
      changes['accessorycolourcode' + n] = 0;
      notes.push('dropped an accessory');
      budget--;
    } else if (slots.length < 4 && rng() < ACCESSORY_ADD_RATE * (age <= 30 ? 1.5 : 1)) {
      const used = new Set(slots.map(n => state['accessorycode' + n]));
      const free = [1, 2, 3, 4].find(n => state['accessorycode' + n] === 0);
      const options = ACCESSORY_IDS.filter(id => !used.has(id));
      if (free && options.length) {
        changes['accessorycode' + free] = pick(rng, options);
        changes['accessorycolourcode' + free] = pickWeighted(rng, [[0, 60], [1, 30], [2, 4], [3, 4], [4, 2]]);
        notes.push('added an accessory');
        budget--;
      }
    }
  }

  // drop no-ops
  Object.keys(changes).forEach(k => { if (changes[k] === state[k]) delete changes[k]; });
  return { changes, notes, record };
}

// ---------------- the runner ----------------
function monthKeyOf(dateStr) { // 'YYYY-MM-DD' -> 'YYYY-MM'
  const m = /^(\d{4})-(\d{2})/.exec(dateStr || '');
  return m ? `${m[1]}-${m[2]}` : null;
}
function monthIndexOf(key) { const [y, m] = key.split('-').map(Number); return y * 12 + (m - 1); }
function keyOfIndex(i) { const y = Math.floor(i / 12); return `${y}-${String((i % 12) + 1).padStart(2, '0')}`; }
function ageAt(dob, monthKey) { // dob 'MM-DD-YYYY'
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(dob || '');
  if (!m) return null;
  const [y, mo] = monthKey.split('-').map(Number);
  let age = y - Number(m[3]);
  if (mo < Number(m[1])) age--;
  return age;
}

class DynamicLook {
  constructor() { this.ctx = null; this.running = false; }

  // ctx: { getDb, getActiveSaveId, saveDatabaseToDisk, playerEditor, pressSync(), getCatalog(), getBootLinks(), notify(), log() }
  configure(ctx) { this.ctx = ctx; }

  rows(sql, params) {
    const stmt = this.ctx.getDb().prepare(sql);
    try { stmt.bind(params || []); const out = []; while (stmt.step()) out.push(stmt.getAsObject()); return out; } finally { stmt.free(); }
  }

  getSettings(saveId) {
    const r = this.rows('SELECT enabled, features_json, last_month FROM dynamic_look_settings WHERE save_id = ?', [saveId])[0];
    return {
      enabled: !!(r && r.enabled),
      features: Object.assign({}, FEATURE_DEFAULTS, r && r.features_json ? JSON.parse(r.features_json) : {}),
      lastMonth: (r && r.last_month) || null
    };
  }

  setSettings(saveId, { enabled, features }) {
    const cur = this.getSettings(saveId);
    const next = { enabled: enabled === undefined ? cur.enabled : !!enabled, features: Object.assign({}, cur.features, features || {}) };
    this.ctx.getDb().run(`INSERT INTO dynamic_look_settings (save_id, enabled, features_json, last_month, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(save_id) DO UPDATE SET enabled = excluded.enabled, features_json = excluded.features_json, updated_at = CURRENT_TIMESTAMP`,
    [saveId, next.enabled ? 1 : 0, JSON.stringify(next.features), cur.lastMonth]);
    this.ctx.saveDatabaseToDisk();
    return this.getSettings(saveId);
  }

  getLog(saveId, limit = 60) {
    return this.rows(`SELECT l.id, l.player_id, l.player_name, l.game_month, l.summary, l.edit_id, e.status, l.created_at
      FROM dynamic_look_log l LEFT JOIN player_edits e ON e.id = l.edit_id
      WHERE l.save_id = ? ORDER BY l.id DESC LIMIT ?`, [saveId, limit]);
  }

  // Called after every squad sync with the in-game date. Runs once per newly started month.
  async onSquadSync({ saveId, currentDate }) {
    if (!this.ctx || !saveId) return;
    const month = monthKeyOf(currentDate);
    if (!month) return;
    const s = this.getSettings(saveId);
    if (!s.enabled) return;
    if (!s.lastMonth) { this.setLastMonth(saveId, month); return; } // first sight of this save: start counting from now
    if (monthIndexOf(month) <= monthIndexOf(s.lastMonth)) return;
    const from = Math.max(monthIndexOf(s.lastMonth) + 1, monthIndexOf(month) - 2); // catch up at most three months
    const months = [];
    for (let i = from; i <= monthIndexOf(month); i++) months.push(keyOfIndex(i));
    await this.run(saveId, months, { manual: false });
  }

  setLastMonth(saveId, month) {
    this.ctx.getDb().run(`INSERT INTO dynamic_look_settings (save_id, enabled, features_json, last_month, updated_at) VALUES (?, 0, NULL, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(save_id) DO UPDATE SET last_month = excluded.last_month, updated_at = CURRENT_TIMESTAMP`, [saveId, month]);
    this.ctx.saveDatabaseToDisk();
  }

  // Manual "run now": plays the current in-game month again with fresh randomness.
  async runNow(saveId, currentDate) {
    const month = monthKeyOf(currentDate) || this.getSettings(saveId).lastMonth;
    if (!month) return { success: false, error: 'The in-game date is not known yet. Sync with the game first (Refresh).' };
    return this.run(saveId, [month], { manual: true });
  }

  buildBootInfo() {
    const catalog = this.ctx.getCatalog();
    const links = this.ctx.getBootLinks();
    const byBrand = {}, brandOf = {}, all = new Set();
    ((catalog && catalog.boots) || []).forEach(img => {
      const id = links[img.key];
      if (!Number.isInteger(id)) return;
      all.add(id);
      (byBrand[img.brand] = byBrand[img.brand] || new Set()).add(id);
      if (!brandOf[id]) brandOf[id] = img.brand;
    });
    Object.keys(byBrand).forEach(b => { byBrand[b] = [...byBrand[b]]; });
    return { byBrand, brandOf, all: [...all] };
  }

  async run(saveId, months, { manual }) {
    if (this.running) return { success: false, error: 'A look update is already running.' };
    if (saveId !== this.ctx.getActiveSaveId()) return { success: false, error: 'That save is not the active one.' };
    this.running = true;
    try {
      // 1. fresh values from the game
      const synced = await this.ctx.pressSync();
      if (!synced) return { success: false, error: 'Could not reach the game (is it running, and F11 bound to player_editor_sync.lua?).' };

      const catalog = this.ctx.getCatalog();
      const boots = this.buildBootInfo();
      const features = this.getSettings(saveId).features;
      const players = this.rows(`SELECT s.player_id, s.name, s.state_json, p.dob FROM player_editor_state s
        LEFT JOIN players p ON p.player_id = s.player_id WHERE s.save_id = ? AND s.editable = 1`, [saveId]);
      const records = new Map(this.rows('SELECT player_id, natural_haircolor, dyed_until FROM dynamic_look_players WHERE save_id = ?', [saveId])
        .map(r => [r.player_id, { natural_haircolor: r.natural_haircolor, dyed_until_index: r.dyed_until === null || r.dyed_until === undefined ? null : Number(r.dyed_until) }]));

      // 2. plan every month for every player, carrying the state forward month to month
      const queued = [];
      for (const row of players) {
        let state;
        try { state = JSON.parse(row.state_json); } catch (e) { continue; }
        const startState = Object.assign({}, state);
        let record = records.get(row.player_id) || null;
        const notes = [];
        let lastMonth = null;
        for (const month of months) {
          const age = ageAt(row.dob, month);
          if (age === null) break;
          const plan = planMonth({
            state, age, month: Number(month.slice(5)), monthIndex: monthIndexOf(month), playerId: row.player_id,
            seedExtra: manual ? String(Date.now()) : '', record, catalog, boots, features
          });
          record = plan.record;
          if (Object.keys(plan.changes).length) {
            Object.assign(state, plan.changes);
            plan.notes.forEach(n => notes.push(n));
            lastMonth = month;
          }
        }
        if (record) {
          this.ctx.getDb().run(`INSERT INTO dynamic_look_players (save_id, player_id, natural_haircolor, dyed_until) VALUES (?, ?, ?, ?)
            ON CONFLICT(save_id, player_id) DO UPDATE SET natural_haircolor = excluded.natural_haircolor, dyed_until = excluded.dyed_until`,
          [saveId, row.player_id, record.natural_haircolor, record.dyed_until_index]);
        }
        const changes = {};
        Object.keys(state).forEach(k => { if (state[k] !== startState[k]) changes[k] = state[k]; });
        if (Object.keys(changes).length) queued.push({ row, changes, notes, month: lastMonth || months[months.length - 1] });
      }

      // 3. queue them as normal editor edits (validated, undoable) and remember what happened
      const edits = [];
      for (const q of queued) {
        const res = this.ctx.playerEditor.queueEdit(q.row.player_id, q.changes);
        if (!res.success) { this.ctx.log(`[DynamicLook] skipped ${q.row.name}: ${res.error}`); continue; }
        const last = this.rows('SELECT MAX(id) AS id FROM player_edits WHERE player_id = ? AND save_id = ?', [q.row.player_id, saveId])[0];
        this.ctx.getDb().run('INSERT INTO dynamic_look_log (save_id, player_id, player_name, game_month, summary, edit_id) VALUES (?, ?, ?, ?, ?, ?)',
          [saveId, q.row.player_id, q.row.name || '', q.month, q.notes.join(', '), last ? last.id : null]);
        edits.push(q);
      }
      {
        const last = months[months.length - 1];
        this.ctx.getDb().run(`INSERT INTO dynamic_look_settings (save_id, enabled, features_json, last_month, updated_at) VALUES (?, 0, NULL, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(save_id) DO UPDATE SET last_month = CASE WHEN excluded.last_month > COALESCE(last_month, '') THEN excluded.last_month ELSE last_month END`, [saveId, last]);
      }
      this.ctx.saveDatabaseToDisk();

      // 4. let Live Editor apply them (25 per press, so loop until nothing is queued)
      let presses = 0;
      while (presses < 6 && this.rows("SELECT COUNT(*) AS n FROM player_edits WHERE save_id = ? AND status = 'queued'", [saveId])[0].n > 0) {
        presses++;
        const ok = await this.ctx.pressApply();
        if (!ok) break;
      }
      this.ctx.notify({ saveId, changed: edits.length });
      return { success: true, changed: edits.length, months };
    } catch (err) {
      this.ctx.log(`[DynamicLook] run failed: ${err && err.stack ? err.stack : err}`);
      return { success: false, error: String((err && err.message) || err) };
    } finally {
      this.running = false;
    }
  }
}

const instance = new DynamicLook();

function register(ipcMain) {
  const ctx = () => instance.ctx;
  ipcMain.handle('get-dynamic-look', () => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { settings: null, log: [] };
    return { settings: instance.getSettings(saveId), log: instance.getLog(saveId) };
  });
  ipcMain.handle('set-dynamic-look', (_e, patch) => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { success: false };
    return { success: true, settings: instance.setSettings(saveId, patch || {}) };
  });
  ipcMain.handle('run-dynamic-look-now', async () => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { success: false, error: 'No active save.' };
    return instance.runNow(saveId, ctx().getCurrentDate());
  });
}

module.exports = { instance, register, planMonth, profile, monthKeyOf, monthIndexOf, keyOfIndex, ageAt, FEATURE_DEFAULTS };
