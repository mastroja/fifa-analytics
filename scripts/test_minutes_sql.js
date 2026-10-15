// node scripts/test_minutes_sql.js — the minutes_played column end to end in SQL: new database, migrating an existing one,
// the sync upsert and the squad read. The SQL and the binding expression are extracted from main.js / schema.sql, not
// copied, so this fails if they drift. Needs sql.js (an app dependency); skips cleanly where it is not installed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let initSqlJs;
try { initSqlJs = require('sql.js'); } catch (e) { console.log('minutes sql: SKIPPED (sql.js is not installed here; run npm install)'); process.exit(0); }

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// ---- pull the real statements out of main.js --------------------------------------------------------------------
const insertSql = main.match(/db\.prepare\(`\s*(INSERT INTO player_season_stats[\s\S]*?)`\);/)[1];
const cols = insertSql.match(/INSERT INTO player_season_stats\s*\(([\s\S]*?)\)\s*VALUES/)[1].split(',').map(c => c.trim()).filter(Boolean);
const placeholders = (insertSql.match(/VALUES\s*\(([^)]*)\)/)[1].match(/\?/g) || []).length;
assert.strictEqual(placeholders, cols.length, `INSERT has ${cols.length} columns but ${placeholders} placeholders`);
assert(cols.includes('minutes_played'), 'INSERT writes minutes_played');
assert.strictEqual(cols.indexOf('minutes_played'), cols.indexOf('appearances') + 1, 'minutes sit right after appearances in the column list');

const migrations = [...main.match(/const seasonStatsMigrations = \[([\s\S]*?)\r?\n  \];/)[1].matchAll(/\['(\w+)',\s*'([^']+)'\]/g)].map(m => [m[1], m[2]]);
const minutesMigration = migrations.find(m => m[0] === 'minutes_played');
assert(minutesMigration, 'a migration adds minutes_played to existing databases');
assert.strictEqual(minutesMigration[1], 'INTEGER', 'no DEFAULT: a missing value must stay NULL, not 0');

const bindExpr = main.match(/p\.appearances \|\| 0,\r?\n\s*(Number\.isFinite[^\r\n]*?),\s*\/\/ null = not exported/)[1];
const bindMinutes = new Function('p', 'return ' + bindExpr);

const selectSql = main.match(/function getSquadFromDB[\s\S]*?db\.exec\(`\s*SELECT([\s\S]*?)FROM players p/)[1];
const selectCols = selectSql.split(',').map(c => c.trim()).filter(Boolean);
const mapped = main.match(/minutes: row\[(\d+)\]/);
assert(mapped, 'getSquadFromDB maps minutes');
assert.strictEqual(selectCols[Number(mapped[1])], 's.minutes_played', `row[${mapped[1]}] is the minutes_played column`);
assert.strictEqual(selectCols.length - 1, Number(mapped[1]), 'minutes is the last selected column, so no existing row index moved');

(async () => {
  const SQL = await initSqlJs();

  // ---- the binding expression ---------------------------------------------------------------------------------
  assert.strictEqual(bindMinutes({ minutes: 150 }), 150);
  assert.strictEqual(bindMinutes({ minutes: 0 }), 0, 'a real zero stays zero');
  assert.strictEqual(bindMinutes({}), null, 'an export without minutes binds NULL');
  assert.strictEqual(bindMinutes({ minutes: null }), null, 'JSON null (table unreadable) binds NULL');
  assert.strictEqual(bindMinutes({ minutes: '90' }), 90);
  assert.strictEqual(bindMinutes({ minutes: 12.6 }), 13);
  assert.strictEqual(bindMinutes({ minutes: -5 }), 0, 'never negative');
  assert.strictEqual(bindMinutes({ minutes: 'abc' }), null);

  const bindRow = (playerId, seasonId, minutes) => cols.map(c => {
    if (c === 'player_id') return playerId;
    if (c === 'season_id') return seasonId;
    if (c === 'minutes_played') return minutes;
    if (c === 'updated_at') return '2027-01-12';
    return /_json$/.test(c) ? '{}' : (/name|date|expiry|status/.test(c) ? '' : 0);
  });
  const readMinutes = (db, pid) => { const r = db.exec(`SELECT minutes_played FROM player_season_stats WHERE player_id = ${pid} AND season_id = 1`); return r[0].values[0][0]; };

  // ---- a brand new database -------------------------------------------------------------------------------------
  {
    const db = new SQL.Database(); db.run(schema);
    db.run('INSERT INTO seasons (id, save_id, year_label, is_current) VALUES (1, 1, "2026/27", 1);');
    ['1', '2', '3'].forEach(i => db.run('INSERT INTO players (player_id, name) VALUES (?, ?)', [Number(i), 'P' + i]));
    const stmt = db.prepare(insertSql);

    stmt.run(bindRow(1, 1, 150));
    assert.strictEqual(readMinutes(db, 1), 150, 'minutes are stored');
    stmt.run(bindRow(2, 1, null));
    assert.strictEqual(readMinutes(db, 2), null, 'no minutes in the export: NULL in the database, not 0');
    stmt.run(bindRow(3, 1, 0));
    assert.strictEqual(readMinutes(db, 3), 0, 'a real 0 is kept as 0');

    stmt.run(bindRow(1, 1, null));
    assert.strictEqual(readMinutes(db, 1), 150, 'a later sync without minutes does not erase them (COALESCE)');
    stmt.run(bindRow(1, 1, 330));
    assert.strictEqual(readMinutes(db, 1), 330, 'a later sync with minutes updates them');
    stmt.run(bindRow(2, 1, 90));
    assert.strictEqual(readMinutes(db, 2), 90, 'NULL becomes real minutes once an export has them');
    stmt.run(bindRow(3, 1, 0));
    assert.strictEqual(readMinutes(db, 3), 0);

    // the exact column list getSquadFromDB selects still runs, with minutes last
    const read = db.exec(`SELECT ${selectCols.join(', ')} FROM players p JOIN player_season_stats s ON s.player_id = p.player_id WHERE s.season_id = 1 ORDER BY s.overall DESC;`);
    assert.strictEqual(read[0].columns.length, selectCols.length);
    const row = read[0].values.find(r => r[0] === 1);
    assert.strictEqual(row[Number(mapped[1])], 330, 'the squad read returns minutes at the mapped index');
    assert.strictEqual(read[0].values.find(r => r[0] === 2)[Number(mapped[1])], 90);
  }

  // ---- an existing database from before this column ---------------------------------------------------------------
  {
    const old = new SQL.Database();
    old.run(schema.replace(/\n\s*minutes_played INTEGER,/, ''));
    assert(!old.exec('PRAGMA table_info(player_season_stats)')[0].values.some(r => r[1] === 'minutes_played'), 'fixture: the old table has no minutes_played');
    old.run('INSERT INTO seasons (id, save_id, year_label, is_current) VALUES (1, 1, "2025/26", 1);');
    old.run('INSERT INTO players (player_id, name) VALUES (1, "Old Row");');
    old.run('INSERT INTO player_season_stats (player_id, season_id, overall, appearances) VALUES (1, 1, 70, 12);');

    const runMigrations = () => migrations.forEach(([column, type]) => { try { old.run(`ALTER TABLE player_season_stats ADD COLUMN ${column} ${type};`); } catch (e) { /* already exists */ } });
    runMigrations();
    assert(old.exec('PRAGMA table_info(player_season_stats)')[0].values.some(r => r[1] === 'minutes_played'), 'the migration adds the column');
    assert.strictEqual(readMinutes(old, 1), null, 'existing rows read NULL (unknown), never 0: they must not look like players who never played');
    assert.strictEqual(old.exec('SELECT appearances FROM player_season_stats WHERE player_id = 1')[0].values[0][0], 12, 'existing data is untouched');
    assert.doesNotThrow(runMigrations, 'running the migrations again is harmless');

    // and the insert/upsert works on the migrated table
    old.prepare(insertSql).run(bindRow(1, 1, 400));
    assert.strictEqual(readMinutes(old, 1), 400);
  }

  console.log('minutes sql: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
