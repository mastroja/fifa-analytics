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

const FEATURE_DEFAULTS = { hair: true, beard: true, colour: true, boots: true, accessories: true, growth: false };

// ---------------- height, growth and weight ----------------
// Every player gets their own genetic adult height, drawn once from a normal distribution that depends on position
// (keepers and centre-backs are taller, wingers shorter) and fixed for good by the player id. Growth then follows a
// normal adolescent curve, shifted by a personal "tempo" so some players are early or late bloomers. The numbers are
// tuned so the whole population averages about 5'10.5" with roughly 5% under 5'7" and very few over 6'4".
const HEIGHT_MEAN = 178.6;            // cm, before the position offset
const HEIGHT_SD = 4.7;                // cm, spread within a position
const HEIGHT_MIN = 162, HEIGHT_MAX = 204;
const POSITION_OFFSET = { gk: 8, cb: 3.5, fb: -1.5, dm: 1, cm: 0, wide: -2.5, fw: -0.5, st: 1.5 };
// share of adult height reached at a given age (years); linear in between. After 19 everyone is fully grown.
const GROWTH_CURVE = [[10, 0.78], [12, 0.84], [13, 0.88], [14, 0.92], [15, 0.955], [16, 0.98], [17, 0.99], [18, 0.997], [19, 1]];
const BMI_BY_BUILD = { lean: 21.8, normal: 23.2, stocky: 24.8 };

function positionGroup(pos) {
  if (pos === 0) return 'gk';
  if ([1, 4, 5, 6].includes(pos)) return 'cb';
  if ([2, 3, 7, 8].includes(pos)) return 'fb';
  if ([9, 10, 11].includes(pos)) return 'dm';
  if ([13, 14, 15].includes(pos)) return 'cm';
  if ([12, 16, 17, 18, 19, 23, 24].includes(pos)) return 'wide';
  if ([20, 21, 22].includes(pos)) return 'fw';
  return 'st';
}
function gaussian(playerId, tag) { // seeded standard normal
  const u1 = Math.max(unit(`${playerId}:${tag}a`), 1e-9), u2 = unit(`${playerId}:${tag}b`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function drawAdultHeight(playerId, position) {
  const h = HEIGHT_MEAN + POSITION_OFFSET[positionGroup(position)] + HEIGHT_SD * gaussian(playerId, 'height');
  return Math.round(Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, h)));
}
// -1 (early bloomer) .. +1.5 (late bloomer), in years
function drawTempo(playerId) { return Math.round((-1 + unit(`${playerId}:tempo`) * 2.5) * 100) / 100; }
function growthShare(ageYears, tempo) {
  const a = ageYears - tempo; // a late bloomer behaves like a younger player
  if (a >= GROWTH_CURVE[GROWTH_CURVE.length - 1][0]) return 1;
  if (a <= GROWTH_CURVE[0][0]) return GROWTH_CURVE[0][1];
  for (let i = 1; i < GROWTH_CURVE.length; i++) {
    const [a1, s1] = GROWTH_CURVE[i];
    if (a <= a1) { const [a0, s0] = GROWTH_CURVE[i - 1]; return s0 + (s1 - s0) * (a - a0) / (a1 - a0); }
  }
  return 1;
}
function heightAt(targetCm, ageYears, tempo) { return Math.round(targetCm * growthShare(ageYears, tempo)); }

function buildOf(bodyType) {
  if ([1, 4, 7, 11].includes(bodyType)) return 'lean';
  if ([3, 6, 9].includes(bodyType)) return 'stocky';
  return 'normal';
}
// Body type follows height (short / average / tall) and keeps the player's own lean / normal / stocky build.
function bodyTypeFor(heightCm, bodyType) {
  if (!(bodyType >= 1 && bodyType <= 11)) return bodyType; // special real-player body types are left alone
  const build = buildOf(bodyType);
  if (heightCm <= 171) return { lean: 7, normal: 8, stocky: 9 }[build];
  if (heightCm <= 186) return { lean: 1, normal: 2, stocky: 3 }[build];
  if (heightCm <= 195) return { lean: 4, normal: 5, stocky: 6 }[build];
  return { lean: 11, normal: 5, stocky: 6 }[build];
}
// Weight from height and build (a body-mass index), a bit lighter while young.
function weightFor(playerId, heightCm, bodyType, ageYears, tempo) {
  const youth = Math.max(0, Math.min(1.6, (19 - (ageYears - tempo)) * 0.3));
  const bmi = BMI_BY_BUILD[buildOf(bodyType)] + (unit(`${playerId}:bmi`) - 0.5) * 1.6 - youth;
  const m = heightCm / 100;
  return Math.round(Math.max(45, Math.min(110, bmi * m * m)));
}

/**
 * The height model for one player at one moment.
 * @returns {{ changes:object, record:object }}  changes use game columns (height, weight, bodytypecode)
 */
function planGrowth({ playerId, state, ageYears, record }) {
  const rec = Object.assign({ target_cm: null, tempo: null, applied_cm: null, prev_cm: null, locked: 0 }, record || {});
  // A height set by hand stays as it is, but a weight that makes no sense for it is still corrected (only when it is
  // clearly off, 6 kg or more, so a weight chosen on purpose is not fought over).
  const weightOnly = () => {
    const tempo = rec.tempo !== null ? rec.tempo : drawTempo(playerId);
    const w = weightFor(playerId, state.height, state.bodytypecode, ageYears, tempo);
    return Math.abs(w - state.weight) >= 6 ? { weight: w } : {};
  };
  if (rec.locked) return { changes: weightOnly(), record: rec };
  // The height should be what the model last wrote (applied_cm) or, if that write never reached the game, what it was
  // before (prev_cm). Anything else means somebody changed it by hand (the editor): respect that for good.
  if (rec.applied_cm !== null && state.height !== rec.applied_cm && state.height !== rec.prev_cm) { rec.locked = 1; return { changes: weightOnly(), record: rec }; }
  if (rec.target_cm === null) { rec.target_cm = drawAdultHeight(playerId, state.preferredposition1); rec.tempo = drawTempo(playerId); }
  // A player who is already taller than their drawn adult height (the game made them tall, or they were set that way) simply
  // IS that tall: their adult height is at least their current height, so the numbers never contradict each other.
  if (state.height > rec.target_cm) rec.target_cm = state.height;
  // The model only ever raises a height: a player already taller than the model says (or that the game made taller) keeps it.
  const height = Math.max(state.height, heightAt(rec.target_cm, ageYears, rec.tempo));
  const bodytype = bodyTypeFor(height, state.bodytypecode);
  const weight = weightFor(playerId, height, bodytype, ageYears, rec.tempo);
  const changes = {};
  // grow in whole-cm steps but skip tiny wobbles, except for the first application
  if (height > state.height) changes.height = height;
  // weight (and body type) follow the height: whenever the height moves, on the first application, or if the weight has
  // drifted 2 kg or more from what suits this height and age
  if (changes.height !== undefined || rec.applied_cm === null || Math.abs(weight - state.weight) >= 2) {
    if (weight !== state.weight) changes.weight = weight;
    if (bodytype !== state.bodytypecode) changes.bodytypecode = bodytype;
  }
  if (changes.height !== undefined) { rec.prev_cm = rec.applied_cm !== null ? rec.applied_cm : state.height; rec.applied_cm = height; }
  else if (rec.applied_cm === null) { rec.applied_cm = state.height; rec.prev_cm = state.height; }
  return { changes, record: rec };
}

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
function ageYearsAt(dob, monthKey) { // fractional age in years at the middle of a month
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(dob || '');
  if (!m) return null;
  const [y, mo] = monthKey.split('-').map(Number);
  return (y * 12 + (mo - 1) + 0.5 - (Number(m[3]) * 12 + (Number(m[1]) - 1) + Number(m[2]) / 31)) / 12;
}
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
    const stored = r && r.features_json ? JSON.parse(r.features_json) : {};
    const scope = stored._scope === 'selected' ? 'selected' : 'all';
    delete stored._scope;
    return {
      enabled: !!(r && r.enabled),
      features: Object.assign({}, FEATURE_DEFAULTS, stored),
      scope,
      lastMonth: (r && r.last_month) || null
    };
  }

  setSettings(saveId, { enabled, features, scope }) {
    const cur = this.getSettings(saveId);
    const next = {
      enabled: enabled === undefined ? cur.enabled : !!enabled,
      features: Object.assign({}, cur.features, features || {}),
      scope: scope === 'selected' || scope === 'all' ? scope : cur.scope
    };
    this.ctx.getDb().run(`INSERT INTO dynamic_look_settings (save_id, enabled, features_json, last_month, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(save_id) DO UPDATE SET enabled = excluded.enabled, features_json = excluded.features_json, updated_at = CURRENT_TIMESTAMP`,
    [saveId, next.enabled ? 1 : 0, JSON.stringify(Object.assign({}, next.features, { _scope: next.scope })), cur.lastMonth]);
    this.ctx.saveDatabaseToDisk();
    return this.getSettings(saveId);
  }

  // Every editable player with whether they are picked (used when the scope is "selected players only").
  getPlayerPicks(saveId) {
    return this.rows(`SELECT s.player_id, s.name, s.source, CASE WHEN d.player_id IS NULL THEN 0 ELSE 1 END AS selected
      FROM player_editor_state s LEFT JOIN dynamic_look_selected d ON d.save_id = s.save_id AND d.player_id = s.player_id
      WHERE s.save_id = ? AND s.editable = 1 ORDER BY s.name`, [saveId]);
  }

  setPlayerPicks(saveId, playerIds, selected) {
    const db = this.ctx.getDb();
    (playerIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0).forEach(pid => {
      if (selected) db.run('INSERT OR IGNORE INTO dynamic_look_selected (save_id, player_id) VALUES (?, ?)', [saveId, pid]);
      else db.run('DELETE FROM dynamic_look_selected WHERE save_id = ? AND player_id = ?', [saveId, pid]);
    });
    this.ctx.saveDatabaseToDisk();
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

  loadHeightRecords(saveId) {
    return new Map(this.rows('SELECT player_id, target_cm, tempo, applied_cm, prev_cm, locked FROM dynamic_look_height WHERE save_id = ?', [saveId])
      .map(r => [r.player_id, { target_cm: r.target_cm, tempo: r.tempo, applied_cm: r.applied_cm === undefined ? null : r.applied_cm, prev_cm: r.prev_cm === undefined ? null : r.prev_cm, locked: r.locked || 0 }]));
  }

  saveHeightRecord(saveId, playerId, rec) {
    this.ctx.getDb().run(`INSERT INTO dynamic_look_height (save_id, player_id, target_cm, tempo, applied_cm, prev_cm, locked) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(save_id, player_id) DO UPDATE SET target_cm = excluded.target_cm, tempo = excluded.tempo, applied_cm = excluded.applied_cm, prev_cm = excluded.prev_cm, locked = excluded.locked`,
    [saveId, playerId, rec.target_cm, rec.tempo, rec.applied_cm, rec.prev_cm, rec.locked ? 1 : 0]);
  }

  // Players the height model would act on right now (respects the "selected players" scope), with their age.
  heightCandidates(saveId, monthKey) {
    const settings = this.getSettings(saveId);
    const picked = settings.scope === 'selected'
      ? new Set(this.rows('SELECT player_id FROM dynamic_look_selected WHERE save_id = ?', [saveId]).map(r => r.player_id)) : null;
    return this.rows(`SELECT s.player_id, s.name, s.state_json, p.dob FROM player_editor_state s
      LEFT JOIN players p ON p.player_id = s.player_id WHERE s.save_id = ? AND s.editable = 1`, [saveId])
      .filter(r => !picked || picked.has(r.player_id))
      .map(r => { let st = null; try { st = JSON.parse(r.state_json); } catch (e) { /* skip */ } return { row: r, state: st, ageYears: ageYearsAt(r.dob, monthKey) }; })
      .filter(c => c.state && c.ageYears !== null);
  }

  // What the height model would do to the squad right now, without changing anything.
  previewHeights(saveId, currentDate) {
    const month = monthKeyOf(currentDate) || this.getSettings(saveId).lastMonth;
    if (!month) return { error: 'The in-game date is not known yet. Press Refresh first.' };
    const records = this.loadHeightRecords(saveId);
    const before = [], after = [], sample = [], wBefore = [], wAfter = [];
    for (const c of this.heightCandidates(saveId, month)) {
      const plan = planGrowth({ playerId: c.row.player_id, state: c.state, ageYears: c.ageYears, record: records.get(c.row.player_id) });
      if (plan.record.locked) continue;
      const h = plan.changes.height !== undefined ? plan.changes.height : c.state.height;
      const w = plan.changes.weight !== undefined ? plan.changes.weight : c.state.weight;
      before.push(c.state.height); after.push(h); wBefore.push(c.state.weight); wAfter.push(w);
      sample.push({ name: c.row.name, age: Math.floor(c.ageYears), before: c.state.height, after: h, adult: plan.record.target_cm, wBefore: c.state.weight, wAfter: w });
    }
    const stats = arr => arr.length ? {
      n: arr.length, mean: arr.reduce((a, b) => a + b, 0) / arr.length,
      under: arr.filter(h => h < 170.2).length, over: arr.filter(h => h > 193).length
    } : { n: 0, mean: 0, under: 0, over: 0 };
    sample.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
    const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const withW = (s, w) => Object.assign(s, { meanWeight: avg(w) });
    const changing = sample.filter(s => s.before !== s.after || s.wBefore !== s.wAfter);
    return { month, before: withW(stats(before), wBefore), after: withW(stats(after), wAfter), changing: changing.length, total: sample.length, sample: changing.slice(0, 12) };
  }

  // The model's height / weight / body type for ONE player right now (the editor's Body tab button). Nothing is queued:
  // the editor applies the values to its form and the user saves them like any other edit.
  planPlayerGrowth(saveId, playerId, currentDate) {
    const month = monthKeyOf(currentDate) || this.getSettings(saveId).lastMonth;
    if (!month) return { error: 'The in-game date is not known yet. Press Refresh first.' };
    const row = this.rows(`SELECT s.player_id, s.name, s.state_json, p.dob FROM player_editor_state s
      LEFT JOIN players p ON p.player_id = s.player_id WHERE s.save_id = ? AND s.player_id = ? AND s.editable = 1`, [saveId, playerId])[0];
    if (!row) return { error: 'No editor data for this player yet.' };
    const ageYears = ageYearsAt(row.dob, month);
    if (ageYears === null) return { error: 'This player has no birth date on file.' };
    const state = JSON.parse(row.state_json);
    const rec = this.loadHeightRecords(saveId).get(playerId) || null;
    // a manual lock does not apply when the user explicitly asks for the model's values
    const plan = planGrowth({ playerId, state, ageYears, record: rec ? Object.assign({}, rec, { locked: 0, applied_cm: null, prev_cm: null }) : null });
    const fresh = plan.record;
    this.saveHeightRecord(saveId, playerId, { target_cm: fresh.target_cm, tempo: fresh.tempo, applied_cm: fresh.applied_cm, prev_cm: fresh.prev_cm, locked: 0 });
    this.ctx.saveDatabaseToDisk();
    return { changes: plan.changes, adult: fresh.target_cm, age: Math.floor(ageYears) };
  }

  // ---- undo ----
  // 'shrunk': put back height, weight and body type for players who ended up SHORTER than they started.
  // 'all':    put back every column any applied edit changed (editor saves, dynamic look, height model), turn the monthly
  //           look and growth off and forget the height model's records, so nothing re-applies itself.
  previewUndo(saveId) {
    const pe = this.ctx.playerEditor;
    const all = pe.planRestore(saveId);
    const shrunk = pe.planRestore(saveId, { onlyShrunk: true, columns: ['height', 'weight', 'bodytypecode'] });
    return { all: { players: all.length, columns: all.reduce((s, p) => s + Object.keys(p.changes).length, 0) }, shrunk: { players: shrunk.length } };
  }

  async undo(saveId, mode) {
    if (this.running) return { success: false, error: 'A look update is already running.' };
    if (saveId !== this.ctx.getActiveSaveId()) return { success: false, error: 'That save is not the active one.' };
    this.running = true;
    try {
      if (!(await this.ctx.pressSync())) return { success: false, error: 'Could not reach the game (is it running, and F11 bound to player_editor_sync.lua?).' };
      const pe = this.ctx.playerEditor;
      const plan = mode === 'shrunk' ? pe.planRestore(saveId, { onlyShrunk: true, columns: ['height', 'weight', 'bodytypecode'] }) : pe.planRestore(saveId);
      const lastEdit = this.rows('SELECT COALESCE(MAX(id), 0) AS id FROM player_edits WHERE save_id = ?', [saveId])[0].id;
      let restored = 0;
      for (const p of plan) {
        const res = pe.queueEdit(p.playerId, p.changes, { source: 'model' }); // restoring is not a manual edit: no height lock
        if (res.success) restored++; else this.ctx.log(`[DynamicLook] could not restore ${p.name}: ${res.error}`);
      }
      const db = this.ctx.getDb();
      if (mode === 'all') {
        db.run("UPDATE player_edits SET status = 'undone' WHERE save_id = ? AND status = 'applied' AND id <= ?", [saveId, lastEdit]);
        db.run('DELETE FROM dynamic_look_height WHERE save_id = ?', [saveId]);
        db.run('DELETE FROM dynamic_look_players WHERE save_id = ?', [saveId]);
        this.setSettings(saveId, { enabled: false, features: { growth: false } });
      }
      this.ctx.saveDatabaseToDisk();
      let presses = 0;
      while (presses < 6 && this.rows("SELECT COUNT(*) AS n FROM player_edits WHERE save_id = ? AND status = 'queued'", [saveId])[0].n > 0) {
        presses++;
        if (!(await this.ctx.pressApply())) break;
      }
      this.ctx.notify({ saveId, changed: restored });
      return { success: true, restored };
    } catch (err) {
      this.ctx.log(`[DynamicLook] undo failed: ${err && err.stack ? err.stack : err}`);
      return { success: false, error: String((err && err.message) || err) };
    } finally { this.running = false; }
  }

  // Apply the height model once, to everybody (this is the "rebalance heights" button).
  async applyHeights(saveId, currentDate) {
    const month = monthKeyOf(currentDate) || this.getSettings(saveId).lastMonth;
    if (!month) return { success: false, error: 'The in-game date is not known yet. Press Refresh first.' };
    if (this.running) return { success: false, error: 'A look update is already running.' };
    if (saveId !== this.ctx.getActiveSaveId()) return { success: false, error: 'That save is not the active one.' };
    this.running = true;
    try {
      if (!(await this.ctx.pressSync())) return { success: false, error: 'Could not reach the game (is it running, and F11 bound to player_editor_sync.lua?).' };
      const records = this.loadHeightRecords(saveId);
      let changed = 0;
      for (const c of this.heightCandidates(saveId, month)) {
        const plan = planGrowth({ playerId: c.row.player_id, state: c.state, ageYears: c.ageYears, record: records.get(c.row.player_id) });
        this.saveHeightRecord(saveId, c.row.player_id, plan.record);
        if (!Object.keys(plan.changes).length) continue;
        const res = this.ctx.playerEditor.queueEdit(c.row.player_id, plan.changes, { source: 'dynamic' });
        if (!res.success) { this.ctx.log(`[DynamicLook] height skipped for ${c.row.name}: ${res.error}`); continue; }
        const last = this.rows('SELECT MAX(id) AS id FROM player_edits WHERE player_id = ? AND save_id = ?', [c.row.player_id, saveId])[0];
        this.ctx.getDb().run('INSERT INTO dynamic_look_log (save_id, player_id, player_name, game_month, summary, edit_id) VALUES (?, ?, ?, ?, ?, ?)',
          [saveId, c.row.player_id, c.row.name || '', month, 'height set by growth model', last ? last.id : null]);
        changed++;
      }
      this.ctx.saveDatabaseToDisk();
      let presses = 0;
      while (presses < 6 && this.rows("SELECT COUNT(*) AS n FROM player_edits WHERE save_id = ? AND status = 'queued'", [saveId])[0].n > 0) {
        presses++;
        if (!(await this.ctx.pressApply())) break;
      }
      this.ctx.notify({ saveId, changed });
      return { success: true, changed };
    } catch (err) {
      this.ctx.log(`[DynamicLook] height run failed: ${err && err.stack ? err.stack : err}`);
      return { success: false, error: String((err && err.message) || err) };
    } finally { this.running = false; }
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
      const settings = this.getSettings(saveId);
      const features = settings.features;
      const picked = settings.scope === 'selected'
        ? new Set(this.rows('SELECT player_id FROM dynamic_look_selected WHERE save_id = ?', [saveId]).map(r => r.player_id)) : null;
      const players = this.rows(`SELECT s.player_id, s.name, s.state_json, p.dob FROM player_editor_state s
        LEFT JOIN players p ON p.player_id = s.player_id WHERE s.save_id = ? AND s.editable = 1`, [saveId])
        .filter(r => !picked || picked.has(r.player_id));
      const records = new Map(this.rows('SELECT player_id, natural_haircolor, dyed_until FROM dynamic_look_players WHERE save_id = ?', [saveId])
        .map(r => [r.player_id, { natural_haircolor: r.natural_haircolor, dyed_until_index: r.dyed_until === null || r.dyed_until === undefined ? null : Number(r.dyed_until) }]));

      const heightRecords = this.loadHeightRecords(saveId);

      // 2. plan every month for every player, carrying the state forward month to month
      const queued = [];
      for (const row of players) {
        let state;
        try { state = JSON.parse(row.state_json); } catch (e) { continue; }
        const startState = Object.assign({}, state);
        let record = records.get(row.player_id) || null;
        let heightRec = heightRecords.get(row.player_id) || null;
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
          if (features.growth) {
            const ageYears = ageYearsAt(row.dob, month);
            if (ageYears !== null) {
              const g = planGrowth({ playerId: row.player_id, state, ageYears, record: heightRec });
              heightRec = g.record;
              if (Object.keys(g.changes).length) {
                Object.assign(state, g.changes);
                notes.push(g.changes.height !== undefined && g.changes.height > startState.height ? 'grew' : 'height adjusted');
                lastMonth = month;
              }
            }
          }
        }
        if (features.growth && heightRec) this.saveHeightRecord(saveId, row.player_id, heightRec);
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
        const res = this.ctx.playerEditor.queueEdit(q.row.player_id, q.changes, { source: 'dynamic' });
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
    return { settings: instance.getSettings(saveId), log: instance.getLog(saveId), players: instance.getPlayerPicks(saveId) };
  });
  ipcMain.handle('set-dynamic-look-players', (_e, ids, selected) => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { success: false };
    instance.setPlayerPicks(saveId, ids, !!selected);
    return { success: true, players: instance.getPlayerPicks(saveId) };
  });
  ipcMain.handle('set-dynamic-look', (_e, patch) => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { success: false };
    return { success: true, settings: instance.setSettings(saveId, patch || {}) };
  });
  ipcMain.handle('preview-height-model', () => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { error: 'No active save.' };
    return instance.previewHeights(saveId, ctx().getCurrentDate());
  });
  ipcMain.handle('preview-undo', () => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { error: 'No active save.' };
    return instance.previewUndo(saveId);
  });
  ipcMain.handle('undo-customization', async (_e, mode) => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { success: false, error: 'No active save.' };
    return instance.undo(saveId, mode === 'shrunk' ? 'shrunk' : 'all');
  });
  ipcMain.handle('plan-player-growth', (_e, playerId) => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { error: 'No active save.' };
    return instance.planPlayerGrowth(saveId, Number(playerId), ctx().getCurrentDate());
  });
  ipcMain.handle('apply-height-model', async () => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { success: false, error: 'No active save.' };
    return instance.applyHeights(saveId, ctx().getCurrentDate());
  });
  ipcMain.handle('run-dynamic-look-now', async () => {
    const saveId = ctx().getActiveSaveId();
    if (!saveId) return { success: false, error: 'No active save.' };
    return instance.runNow(saveId, ctx().getCurrentDate());
  });
}

module.exports = {
  instance, register, planMonth, planGrowth, profile, monthKeyOf, monthIndexOf, keyOfIndex, ageAt, ageYearsAt,
  drawAdultHeight, drawTempo, growthShare, heightAt, bodyTypeFor, weightFor, FEATURE_DEFAULTS
};
