// Reserve squad numbers for academy promotions.
//
// Not an option: it runs exactly when the save has Youth Mode on (ctx.isYouthMode), and never otherwise.
// A player promoted from the youth academy always gets a "reserve" shirt number: a random one above 30 that nobody in
// the squad is wearing. It runs after a squad sync, finds academy graduates who are now in the senior squad and have
// not been handled yet, and queues a normal editor edit (jerseynumber) which Live Editor applies through the F11
// hotkey (assets/lua/player_editor_sync.lua writes it to teamplayerlinks, rejecting duplicates).
//
// The first sync of a save only records who is already in the squad (nobody is renumbered retroactively); from then on
// every newly promoted graduate gets a number once. A number you later change by hand is never touched again.

const RESERVE_MIN = 31;
const RESERVE_MAX = 99;

class SquadNumbers {
  constructor() { this.ctx = null; this.running = false; }

  // ctx: { getDb, saveDatabaseToDisk, isYouthMode(saveId), playerEditor, getGraduateIds(saveId), pressSync(), pressApply(), notify(), log() }
  configure(ctx) { this.ctx = ctx; }

  rows(sql, params) {
    const stmt = this.ctx.getDb().prepare(sql);
    try { stmt.bind(params || []); const out = []; while (stmt.step()) out.push(stmt.getAsObject()); return out; } finally { stmt.free(); }
  }

  isEnabled(saveId) { return !!(this.ctx && this.ctx.isYouthMode(saveId)); }

  isBaselined(saveId) {
    const r = this.rows('SELECT baselined FROM squad_number_settings WHERE save_id = ?', [saveId])[0];
    return !!(r && r.baselined);
  }

  markAssigned(saveId, playerId, number) {
    this.ctx.getDb().run(`INSERT OR IGNORE INTO squad_number_assigned (save_id, player_id, number) VALUES (?, ?, ?)`, [saveId, playerId, number === undefined ? null : number]);
  }

  assignedSet(saveId) {
    return new Set(this.rows('SELECT player_id FROM squad_number_assigned WHERE save_id = ?', [saveId]).map(r => r.player_id));
  }

  // Random free reserve number, or null when 31-99 are all taken.
  pickReserve(used) {
    const free = [];
    for (let n = RESERVE_MIN; n <= RESERVE_MAX; n++) if (!used.has(n)) free.push(n);
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  // players: the squad payload (player_id, jersey_number, on_loan ...). Safe to call on every sync.
  async onSquadSync({ saveId, players }) {
    if (!this.ctx || !saveId || !Array.isArray(players) || !this.isEnabled(saveId)) return;
    const graduates = this.ctx.getGraduateIds(saveId);
    const promoted = players.filter(p => p.player_id && graduates.has(p.player_id) && !p.on_loan);

    if (!this.isBaselined(saveId)) { // first sight of this save: remember who is already here, change nobody
      promoted.forEach(p => this.markAssigned(saveId, p.player_id, p.jersey_number));
      this.ctx.getDb().run(`INSERT INTO squad_number_settings (save_id, enabled, baselined) VALUES (?, 1, 1)
        ON CONFLICT(save_id) DO UPDATE SET baselined = 1`, [saveId]);
      this.ctx.saveDatabaseToDisk();
      return;
    }
    const done = this.assignedSet(saveId);
    const fresh = promoted.filter(p => !done.has(p.player_id));
    if (!fresh.length || this.running) return;
    await this.assign(saveId, fresh, players);
  }

  async assign(saveId, fresh, payloadPlayers) {
    this.running = true;
    try {
      if (!(await this.ctx.pressSync())) return; // game not reachable: try again at the next sync
      const pe = this.ctx.playerEditor;
      const used = pe.usedNumbers(saveId);
      (payloadPlayers || []).forEach(p => { if (p.jersey_number) used.add(p.jersey_number); });
      let queued = 0;
      for (const p of fresh) {
        const cur = pe.getState(p.player_id, saveId);
        if (!cur || !cur.editable || cur.source !== 'squad' || !Number.isInteger(cur.state.jerseynumber)) continue; // not exported yet; retry later
        const have = cur.state.jerseynumber;
        if (have >= RESERVE_MIN) { this.markAssigned(saveId, p.player_id, have); continue; } // already a reserve number
        const n = this.pickReserve(used);
        if (n === null) { this.ctx.log('[SquadNumbers] no free reserve number left (31-99 all taken)'); break; }
        const res = pe.queueEdit(p.player_id, { jerseynumber: n }, { source: 'dynamic' });
        if (!res.success) { this.ctx.log(`[SquadNumbers] could not number ${cur.name}: ${res.error}`); continue; }
        used.add(n);
        this.markAssigned(saveId, p.player_id, n);
        queued++;
        this.ctx.log(`[SquadNumbers] ${cur.name}: #${have} -> reserve #${n}`);
      }
      this.ctx.saveDatabaseToDisk();
      let presses = 0;
      while (presses < 4 && this.rows("SELECT COUNT(*) AS n FROM player_edits WHERE save_id = ? AND status = 'queued'", [saveId])[0].n > 0) {
        presses++;
        if (!(await this.ctx.pressApply())) break;
      }
      if (queued) this.ctx.notify({ saveId, changed: queued });
    } catch (err) {
      this.ctx.log(`[SquadNumbers] failed: ${err && err.stack ? err.stack : err}`);
    } finally { this.running = false; }
  }
}

const instance = new SquadNumbers();

module.exports = { instance, RESERVE_MIN, RESERVE_MAX };
