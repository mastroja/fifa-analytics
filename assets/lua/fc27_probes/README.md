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
| `inspect_fc27_find_standings.lua` | Stages 5-6: scans the schedule-related managers' big pools for fixture-shaped runs (YYYYMMDD dates at a 0x18 stride) and standings-shaped runs (the user's league team ids at a 0x18 stride) | medium (reads only inside arena-bounded vectors, chunked, flushed) |
| `inspect_fc27_next_match.lua` | Stage 7: dumps the small result/next-match managers (NextMatchManager, SimResultsManager, InterestingResultManager, StandingsViewManager, ...) and their pointer targets, tagging league team ids and dates in four encodings, to find where one fixture lives | medium (arena / near-object pointers only) |

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

## Standings / fixtures hunt (stages 5-6)

Stage 4: `FCEDataManager` (0x68166E40) has 19 arena pointers but no list-shaped object (count@+0x1C, begin@+0x28), so
FC 26's `+0x60` fixtures / `+0x88` standings are not just shifted.

Stage 5 (2026-09-01 save, user team 10 = Man City) scanned FixtureManager (46), StandingsViewManager (108),
ActiveCompetitionsManager (20), CalendarManager (24), NextMatchManager (67), SeasonSituationSystem (101),
SeasonStatsManager (102), InterestingResultManager (51), MatchImportanceManager (62), FCEDataObjectManager (42),
EndOfSeasonManager (37), CompetitionObjectivesManager (132): **no list with team ids at a constant stride.**
FixtureManager, CalendarManager and (almost) all the "view" managers hold no arena pointers or vectors at all, so
they are thin wrappers. The only big pools are FCEDataObjectManager (+0x188 10 MB, +0x1E8 4.9 MB), NextMatchManager
(+0x10, 10 MB) and MatchImportanceManager (+0x1C0->+0x8, 3.8 MB). FCEDataObjectManager +0x1E8 contains qwords with two
team ids packed (e.g. 1797|1807, 1962, 1803...) which looks like home|away pairs - the best lead so far. LeagueUtils /
FixtureUtils / TeamUtils have no instance.

Stage 6 (the current script) stops looking for single ids and detects the lists by SHAPE over those pools in full:
fixtures = a run of >= 8 valid YYYYMMDD dates at a 0x18 stride (`mDate` is a YYYYMMDD int, as the app parses it), standings =
a run of >= 6 league team ids at a 0x18 stride. It prints the decoded first items of every candidate. Once a candidate
matches reality (Man City's fixtures / the real table), derive the path from the manager (or the pool's address pattern),
put it into `MEM_LAYOUT` in `export_all.lua` (the struct reads are written there), run standalone, and only then set
`FC27_MEMORY_OFFSETS_VERIFIED = true`. Expect a minute or two of run time (up to 9M qword reads).

**Stage 6 result (2026-10-08, save dated 2026-09-01):** scanned FCEDataObjectManager +0x188/+0x1E8, NextMatchManager +0x10 and
MatchImportanceManager +0x1C0 in full (3.7M qword reads). No run of YYYYMMDD dates at a 0x18 stride anywhere (no fixture
list in that encoding/stride), and the single STANDINGS-shaped hit (0x67B520FC, FCEDataObjectManager +0x188) is a false
positive: a team-id-sorted array of 8-byte (team id, ~62) pairs (127/62, 135/61, 143/62, 1797/61, 1802/62 ...), i.e. a
team rating table, not standings. So standings and fixtures are not in those pools in the FC 26 shapes. Stage 7 goes at
it from the other end: dump the small next-match / results managers and see how one fixture is stored.
