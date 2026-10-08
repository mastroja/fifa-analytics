# FC 27 Live Editor probes

Standalone Lua scripts used to work out what FC 27's Live Editor (v27.1.2) exposes, since
`assets/export_all.lua` was written against FC 26. **Never bind these to F10** — run them from
Live Editor's Lua Engine (Features -> Lua Engine -> execute) in a career save. Each writes a
report to `%USERPROFILE%\Desktop\FC Tests\` and flushes after every step, so a crash still
leaves a partial report showing the last read.

They follow the data-safety rule: table/field metadata first, memory reads only inside the
heap range the manager objects live in (0x66000000-0x6B000000), pointer-following capped.

| Script | What it does | Risk |
|---|---|---|
| `inspect_fc27_db_schema.lua` | Dumps every DB table + field (268 tables), checks the tables/fields `export_all.lua` uses | low (metadata only) |
| `inspect_fc27_data_sample.lua` | Samples real values from standings/fixtures/transfers/events/calendar and contract+playstyle fields | low (table reads) |
| `inspect_fc27_api_availability.lua` | `type()` check of the v1 globals the export depends on, one safe call each | low |
| `inspect_fc27_cmplayers_compare.lua` | players vs cmplayers side by side + every match-rating row for two test players | low (table reads) |
| `inspect_fc27_appearance.lua` | Player-editor step 1: academy players' appearance columns, which Cranium tables hold their `headassetid`, per-column value tallies, accessory/tattoo/hair lookup tables | low (table reads, assetid column only on morph tables) |
| `inspect_fc27_playstyle_rules.lua` | Player editor: PlayStyle+ subset-of-base rule, per-player counts, valid bit masks | low (table reads) |
| `inspect_fc27_overall_recalc.lua` | Player editor: dumps attributeprefpositionformula + ~600 players (attrs, pos, overall) to fit the overall formula offline | low (table reads) |
| `inspect_fc27_memory_offsets.lua` | FC 26 standings/fixtures (`FCEDataManager+0x60/+0x88`) and transfer (`+0x1DD0`) offsets, carried over | **higher** (raw offsets) |
| `inspect_fc27_stats_memory.lua` | Stage 1: raw layout of the stats/dynamic-overall managers (own bytes only) | medium |
| `inspect_fc27_stats_memory_stage2.lua` | Stage 2: follows arena pointers one level, flags squad ids | medium |
| `inspect_fc27_find_player_records.lua` | Stage 3: searches 16 more managers' vectors for squad ids | medium |
| `inspect_fc27_find_fce_lists.lua` | Stage 4: looks for list objects under `FCEDataManager`; also tallies the match-rating table | medium |
| `inspect_fc27_find_standings.lua` | Stage 5: scans the fixture / standings / competition / calendar managers for the user's league team ids (a standings list = many different team ids at a regular stride) | medium |

## What was learned (v27.1.2, tested 2026-10-05/06)

**Works as in FC 26:** `players`, `playerloans`, `teamplayerlinks`, `career_youthplayers`, `teams`,
`manager`, `cm_teamsheets`; globals `IsInCM`, `GetSaveUID`, `GetCurrentDate`, `GetUserTeamID`,
`GetTeamName`, `GetPlayerName`.

**Moved:** contracts are on `players` (`wage`, `releaseclause`, `contractvaliduntil`); playstyles are
bitmasks in `players.trait1/trait2` (+ `icontrait1/2` for PlayStyle+); `career_playercontract`,
`playertraits`, `playerplaystyles`, `career_users`, `career_managerhistory` no longer exist.

**Missing (native functions not ported to FC 27 yet):** `GetPlayersStats`, `GetPlayerStats`,
`GetTeamIdFromPlayerId`, `GetCompetitionNameByObjID`, `GetCompetitionNameByID`.
`export_all.lua` stubs the first and fourth only when they are nil, so they start working
automatically if a later Live Editor release re-adds them.

**Not live:** `fixtures` and `leagueteamlinks` hold stale default data (fixtures dated 2021, standings
all zero) — live standings/fixtures are memory-only, and the FC 26 offsets are wrong
(`FC27_MEMORY_OFFSETS_VERIFIED = false` in `export_all.lua` keeps those reads off).

**Dynamic overall:** `players.overallrating` is the **base** overall (Mark Breese: table 57 = base 57,
in-game dynamic 54). The dynamic value was not located: not in any table (`cmplayers` has 245
unrelated rows, `players.modifier` doesn't explain it), and not in `SeasonStats`/`ProfileStats`/
`DynamicOverall` (config + monthly deltas) or 16 other managers. Untested idea: it may be computed
in-engine from attributes/form for the position played (`attributeprefpositionformula` table).

**Season stats (goals/assists/apps/cards/rating):** not located in memory either. The DB table
`career_playermatchratinghistory` has live per-match rows (minutes, whole-number rating) but no
competition column and no goals/assists, so it only approximates apps and average rating.

## Re-testing after a Live Editor update

1. Run `inspect_fc27_api_availability.lua` first — if `GetPlayersStats` is no longer nil, stats may
   just work in the existing export.
2. Re-run `inspect_fc27_db_schema.lua` and diff against the previous report for table changes.
3. Only then consider the memory scripts (set `FC27_MEMORY_OFFSETS_VERIFIED` back to `true` in
   `export_all.lua` only after new offsets are confirmed standalone).

## Standings / fixtures hunt (stage 5)

State: `FCEDataManager` (0x68166E40 in the stage 4 run) has 19 arena pointers but no list-shaped object
(count@+0x1C, begin@+0x28), so FC 26's `+0x60` fixtures / `+0x88` standings are not just shifted. The lists are
probably owned by a different manager. `inspect_fc27_find_standings.lua` scans `FixtureManager` (46),
`StandingsViewManager` (108), `ActiveCompetitionsManager` (20), `CalendarManager` (24), `NextMatchManager` (67),
`SeasonSituationSystem` (101) and a few others. **What to look for in the report:** a vector whose hits are
many different league team ids at one constant stride (FC 26 stride was 0x18 with the team id at +0x04).
Once found, put the manager / offsets into `MEM_LAYOUT` in `export_all.lua` (the standings struct reads are already
written there), run it standalone, and only then set `FC27_MEMORY_OFFSETS_VERIFIED = true`.
