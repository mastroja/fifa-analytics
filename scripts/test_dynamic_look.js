// node scripts/test_dynamic_look.js — js/dynamic_look.js: the realism rules of the monthly look changes and the height model.
//   hair:    automatic changes only ever pick styles from the categories suggested for the player's skin tone, never an
//            uncategorised ("Other") style, and players already wearing one keep it
//   colour:  automatic dyes never use the wild colours (green / blue / pink)
//   heights: varied, realistic spread, never lowered, growth never goes backwards
const assert = require('assert');
const DL = require('../js/dynamic_look.js');
const catalog = require('../assets/player_customization/catalog.json');

const WILD = new Set([10, 11, 14]); // green, blue, pink
const hairById = new Map(catalog.hair.map(h => [h.id, h]));
const categorised = catalog.hair.filter(h => h.cat !== null);
const other = catalog.hair.filter(h => h.cat === null);
assert(categorised.length > 100 && other.length > 100, 'catalog has both categorised and "Other" styles');

// the editor's "Suggested for skin tone" filter and the dynamic look must agree
assert.deepStrictEqual(DL.suggestedCats(30), [1, 3]);
assert.deepStrictEqual(DL.suggestedCats(55), [1, 2, 3]);
assert.deepStrictEqual(DL.suggestedCats(90), [2, 3]);

function baseState(id, tone, hair) {
  return {
    hairtypecode: hair, haircolorcode: 0, facialhairtypecode: 0, facialhaircolorcode: 0, skintonecode: tone,
    shoetypecode: 0, accessorycode1: 0, accessorycode2: 0, accessorycode3: 0, accessorycode4: 0,
    accessorycolourcode1: 0, accessorycolourcode2: 0, accessorycolourcode3: 0, accessorycolourcode4: 0,
    height: 180, weight: 74, bodytypecode: 2, preferredposition1: 14
  };
}

// ---- hair: 600 players x 36 months, every change checked ----
let hairChanges = 0, colourChanges = 0, dyes = 0;
const tones = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
for (let i = 0; i < 600; i++) {
  const id = 900000 + i;
  const tone = tones[i % tones.length];
  const cats = DL.suggestedCats(tone);
  const startPool = categorised.filter(h => cats.includes(h.cat));
  const wearsOther = i % 5 === 0;
  let state = baseState(id, tone, wearsOther ? other[i % other.length].id : startPool[i % startPool.length].id);
  state.haircolorcode = [0, 3, 5, 6, 1, 7][i % 6];
  const age = 16 + (i % 22);
  let record = null;
  for (let m = 0; m < 36; m++) {
    const monthIndex = 2026 * 12 + 6 + m;
    const before = Object.assign({}, state);
    const plan = DL.planMonth({ state, age, month: (monthIndex % 12) + 1, monthIndex, playerId: id, seedExtra: '', record, catalog, boots: null, features: { boots: false, accessories: false, growth: false } });
    record = plan.record;
    if (plan.changes.hairtypecode !== undefined) {
      hairChanges++;
      const next = hairById.get(plan.changes.hairtypecode);
      assert(next, 'the new style is in the catalog');
      assert.notStrictEqual(next.cat, null, `never an "Other" style (player ${id}, style ${next.id})`);
      assert(cats.includes(next.cat), `style ${next.id} (cat ${next.cat}) is not suggested for skin tone ${tone}`);
      assert(!hairById.get(before.hairtypecode) || hairById.get(before.hairtypecode).cat !== null, `a player wearing an "Other" style keeps it (${id})`);
    }
    if (plan.changes.haircolorcode !== undefined) {
      colourChanges++;
      assert(!WILD.has(plan.changes.haircolorcode), `no wild hair colour (${plan.changes.haircolorcode})`);
      if (plan.notes.includes('dyed hair')) dyes++;
    }
    Object.assign(state, plan.changes);
  }
  if (wearsOther) assert.strictEqual(state.hairtypecode, other[i % other.length].id, 'an "Other" style is never replaced automatically');
}
assert(hairChanges > 200, `hair does change over three years (${hairChanges})`);
assert(colourChanges > 0 && dyes > 0, 'dyes and grow-outs still happen');
for (const [c] of DL.DYES_FOR_DARK.concat(DL.DYES_FOR_LIGHT)) assert(!WILD.has(c), `dye table has no wild colour (${c})`);

// ---- heights: the adult-height draw is varied and realistic ----
const heights = [];
for (let id = 1; id <= 4000; id++) heights.push(DL.drawAdultHeight(id, [0, 5, 7, 14, 18, 25][id % 6]));
const mean = heights.reduce((s, h) => s + h, 0) / heights.length;
const sd = Math.sqrt(heights.reduce((s, h) => s + (h - mean) ** 2, 0) / heights.length);
assert(mean > 177 && mean < 181, `mean adult height is realistic (${mean.toFixed(1)})`);
assert(sd > 4.5 && sd < 7, `heights are spread out, not all alike (sd ${sd.toFixed(1)})`);
assert(new Set(heights).size >= 35, 'many different heights');
assert(heights.filter(h => h < 170).length / heights.length < 0.12, 'few players under 5\'7"');
assert(heights.filter(h => h > 193).length / heights.length < 0.04, 'very few players over 6\'4"');
const keepers = [], wingers = [];
for (let id = 1; id <= 2000; id++) { keepers.push(DL.drawAdultHeight(id, 0)); wingers.push(DL.drawAdultHeight(id, 18)); }
assert(keepers.reduce((s, h) => s + h, 0) / 2000 > wingers.reduce((s, h) => s + h, 0) / 2000 + 6, 'keepers are taller than wingers');
assert.strictEqual(DL.drawAdultHeight(77, 14), DL.drawAdultHeight(77, 14), 'a player\'s adult height is fixed');

// ---- growth never goes backwards and never lowers a height ----
for (let id = 1; id <= 200; id++) {
  const tempo = DL.drawTempo(id);
  let prev = 0;
  for (let a = 10; a <= 21; a += 0.25) {
    const h = DL.heightAt(185, a, tempo);
    assert(h >= prev, `growth is monotonic (player ${id}, age ${a})`);
    prev = h;
  }
  assert.strictEqual(DL.heightAt(185, 21, tempo), 185, 'fully grown by 21');
}
let raised = 0, same = 0;
for (let id = 1; id <= 400; id++) {
  const state = baseState(id, 50, 1);
  state.height = 160 + (id % 45); state.weight = 60 + (id % 20);
  const g = DL.planGrowth({ playerId: id, state, ageYears: 15 + (id % 5), record: null });
  if (g.changes.height !== undefined) { assert(g.changes.height > state.height, 'a height is only ever raised'); raised++; } else same++;
}
assert(raised > 0 && same > 0, 'some players grow, some stay');
// a nonsense height from the game is repaired
const bad = DL.planGrowth({ playerId: 5, state: Object.assign(baseState(5, 50, 1), { height: 256 }), ageYears: 16, record: null });
assert(bad.changes.height !== undefined && bad.changes.height <= 206, 'an impossible height is repaired');

// ---- set pieces: penalties and free-kick accuracy ----
{
  // Malik Kane-like: PEN target (60+52)/2 = 56, FK target 0.5*50 + 0.3*52 + 0.2*52 = 51
  const s = { finishing: 60, composure: 52, curve: 50, longshots: 52, penalties: 51, freekickaccuracy: 35 };
  const sp = DL.planSetPieces(s);
  assert.strictEqual(sp.targets.penalties, 56);
  assert.strictEqual(sp.targets.freekickaccuracy, 51);
  assert.strictEqual(sp.changes.penalties, 53, 'gap 5 -> +2 a month');
  assert.strictEqual(sp.changes.freekickaccuracy, 38, 'gap 16 -> +3 a month');
  assert.strictEqual(DL.setPieceStep(1), 1); assert.strictEqual(DL.setPieceStep(4), 1);
  assert.strictEqual(DL.setPieceStep(5), 2); assert.strictEqual(DL.setPieceStep(11), 2); assert.strictEqual(DL.setPieceStep(12), 3);
  // never lowered: a specialist above his target keeps his rating
  const spec = DL.planSetPieces({ finishing: 40, composure: 40, curve: 40, longshots: 40, penalties: 80, freekickaccuracy: 85 });
  assert.deepStrictEqual(spec.changes, {}, 'never lowered');
  // never past the target, never past 99
  const near = DL.planSetPieces({ finishing: 70, composure: 71, curve: 60, longshots: 60, penalties: 70, freekickaccuracy: 59 });
  assert.strictEqual(near.changes.penalties, 71, 'stops at the target (70.5 rounds to 71)');
  assert.strictEqual(near.changes.freekickaccuracy, 60);
  const top = DL.planSetPieces({ finishing: 99, composure: 99, curve: 99, longshots: 99, penalties: 98, freekickaccuracy: 90 });
  assert(top.changes.penalties <= 99 && top.changes.freekickaccuracy <= 99, 'capped at 99');
  // missing inputs: no guess
  assert.deepStrictEqual(DL.planSetPieces({ penalties: 40, freekickaccuracy: 40 }).changes, {}, 'no inputs, no change');
  // repeated months converge on the target and stop there
  let st = Object.assign({}, s);
  for (let m = 0; m < 24; m++) Object.assign(st, DL.planSetPieces(st).changes);
  assert.strictEqual(st.penalties, 56); assert.strictEqual(st.freekickaccuracy, 51);
  assert(!DL.FEATURE_DEFAULTS.setpieces, 'set pieces are opt-in');
}

// ---- the runner: set pieces apply once per in-game month, with one log note ----
(async () => {
  const initSqlJs = require('sql.js');
  const fs = require('fs');
  const path = require('path');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  try { db.run('ALTER TABLE player_editor_state ADD COLUMN save_uid TEXT;'); } catch (e) { /* already in schema */ }
  const state = Object.assign(baseState(77, 50, 0), { finishing: 60, composure: 52, curve: 50, longshots: 52, penalties: 51, freekickaccuracy: 35 });
  db.run("INSERT INTO player_editor_state (player_id, save_id, editable, name, source, state_json) VALUES (77, 1, 1, 'Test Kane', 'squad', ?)", [JSON.stringify(state)]);
  db.run("INSERT INTO players (player_id, name, dob) VALUES (77, 'Test Kane', '03-10-2009')");
  const queued = [];
  const look = new DL.instance.constructor();
  look.configure({
    getDb: () => db, getActiveSaveId: () => 1, saveDatabaseToDisk: () => {},
    pressSync: async () => true, pressApply: async () => true, getCatalog: () => ({ hair: [], facialHair: [], boots: [] }), getBootLinks: () => ({}),
    notify: () => {}, log: m => { throw new Error(m); },
    playerEditor: {
      queueEdit: (pid, changes) => {
        queued.push(changes);
        db.run("INSERT INTO player_edits (player_id, save_id, old_json, new_json, status) VALUES (?, 1, '{}', ?, 'applied')", [pid, JSON.stringify(changes)]);
        // what Live Editor would do on F11: the new values become the player's state
        const cur = JSON.parse(db.exec('SELECT state_json FROM player_editor_state WHERE player_id = 77')[0].values[0][0]);
        db.run('UPDATE player_editor_state SET state_json = ? WHERE player_id = 77', [JSON.stringify(Object.assign(cur, changes))]);
        return { success: true };
      }
    }
  });
  look.setSettings(1, { enabled: true, features: { hair: false, beard: false, colour: false, boots: false, accessories: false, setpieces: true } });
  look.setLastMonth(1, '2026-09');

  await look.onSquadSync({ saveId: 1, currentDate: '2026-10-24' });
  assert.deepStrictEqual(queued[0], { penalties: 53, freekickaccuracy: 38 }, 'October: one step each');
  const note = db.exec('SELECT summary FROM dynamic_look_log')[0].values[0][0];
  assert.strictEqual(note, 'PEN 51 → 53, FK 35 → 38');

  await look.runNow(1, '2026-10-24');
  assert.strictEqual(queued.length, 1, '"Run this month now" does not add a second step in the same month');

  await look.onSquadSync({ saveId: 1, currentDate: '2027-01-02' });
  // Nov, Dec, Jan caught up: FK 38 -> 41 -> 43 -> 45 (gaps 13, 10, 8), PEN 53 -> 54 -> 55 -> 56 (gaps 3, 2, 1: target reached)
  assert.deepStrictEqual(queued[1], { penalties: 56, freekickaccuracy: 45 }, 'three missed months caught up');

  console.log('dynamic look tests passed');
})().catch(err => { console.error(err); process.exit(1); });
