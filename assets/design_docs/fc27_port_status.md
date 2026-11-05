# FC 27 port status

Audited 2026-10-08 against the app database (the two FC 27 saves, Swansea 2026/27 and Man City 2026/27, synced with Live Editor v27.1.3) and the probe reports in `assets/lua/fc27_probes/`.

| Area | FC 27 status | Notes / next step |
|---|---|---|
| Squad identity, bio, positions, alt positions, nationality, photo | Works | `players`, `teamplayerlinks` unchanged |
| Overall / potential, attributes, skill moves, weak foot | Works | 34/34 and 25/25 rows have attributes. Until 2026-11-05 the export read only 32 of the 34 attributes (no `reactions` / `composure`); both are now exported and shown under Dribbling (confirmed in the app). Their season-change badges start next season |
| PlayStyles / traits | Works | decoded from `players.trait1/2` + `icontrait1/2` bitmasks |
| Loans (on loan, from team, end date, loan-to-buy) | Works | `playerloans` |
| Wage, contract end year, jersey number | Works | wage now on `players`; `contractvaliduntil` |
| Contract start / duration / squad role | Missing | no FC 27 source (`career_playercontract` is gone); exported as empty defaults |
| Injuries | Works (none seen yet) | `teamplayerlinks.injury` |
| Youth academy snapshot and Academy page (sort, filter, promotion readiness) | Works | `career_youthplayers`; 17 / 13 rows in the two saves |
| Player editor (appearance, attributes, positions, PlayStyles, height) | Works | `player_editor_sync.lua`, F11 flow |
| Appearances + average rating | Approximate | restored from `career_playermatchratinghistory` (new fallback in `export_all.lua`): whole-number ratings, so the average is ~0.2 off the in-game one |
| Minutes played | Approximate, **not yet verified against the game** | summed from the same `career_playermatchratinghistory` rows (`minsplayed`) in `export_all.lua`, stored in `player_season_stats.minutes_played` (NULL = the export had no minutes, 0 = a real zero), read as `minutes` on each squad row. `js/roster_advice.js` uses it as the best play-time signal and falls back to appearances. See the checklist below. |
| Goals, assists, clean sheets, cards, saves | **Source works on LE v27.1.8** (probe 2026-11-05); export not yet checked after an F10 | v27.1.3 - v27.1.4: `GetPlayersStats` returned 0 rows. v27.1.8: native, 17,506 rows, every row has `teamid`, `playerid`, `compname`, `compobjid`, `app`, `goals`, `assists`, `avg`, `clean_sheets`, `saves`, `goals_conceded`, `yellow`, `red`, `two_yellow`, `motm`. See "v27.1.8 probe results" below |
| Dynamic overall | Missing | only base `overallrating` is readable; see `project_fc27_dynamic_overall` notes |
| Standings / league table, fixtures, results, calendar | Missing | memory only; FC 26 offsets are wrong. Stages 5-7 of the probe hunt found no list (see `fc27_probes/README.md`) |
| Transfers / negotiations | Missing | memory only (`TransferManager+0x1DD0` unverified, export skipped) |
| League stats (top scorers league-wide), competition names | **Source works on LE v27.1.8**; export not yet checked after an F10 | `export_all.lua` no longer needs fixtures for these: league teams come from `leagueteamlinks` membership, the league competition is the one named `GetCompetitionNameByID(user leagueid)` (fallback: best team overlap, fewest outside teams). Coverage is far wider than DOC.MD says: 26 competitions / 368 teams (see below), enough for an "Around the World" view of those leagues |
| Trophies / competition results | Missing | still need the fixture list (memory only; v27.1.7's Team Editor League Standings / Fixtures have no Lua binding) |
| Manager info | Works | `manager` table |

## Consequences in the app
- Home widgets that need standings, fixtures, league stats or goals/assists stay empty on FC 27 saves; the squad, depth chart, academy tracker, editor, contracts and challenge dashboard are fully usable.
- Team Needs reasons that depend on stats (Limited Minutes, Underperforming) now work again from the approximate appearances / rating.

## Blocked on Live Editor
Everything marked Missing except contract fields and dynamic overall is blocked on either a newer Live Editor (re-bind `GetPlayersStats`, competition names, add real standings / fixtures access) or finding the FC 27 memory layout. Check each new Live Editor release's `changelog.txt`, then re-run `inspect_fc27_api_availability.lua` and compare against this table.

## "Not available in FC 27 yet" notes
`export_all.lua` now tags its squad export with `"game":"FC27"`; `importFifaData` stores it in `saves.game_version` (migration in main.js, column in schema.sql) and the renderer exposes it as `currentSaveGame` / `isFc27Save()` (`js/app.js`). On an FC 27 save, these Home widgets say why they are empty instead of a bare "No data": Upcoming Match, League Table, Team Record, PPG, Trophies, Top Goals, Top Assists. Appearances is not flagged (it has the approximate match-rating fallback). A save only becomes "FC27" after its next F10 sync with the updated script; saves from before that keep the generic messages.


## Minutes played: first-sync checklist (needs the game)
The Lua change ran in a stand-alone Lua runtime against a fake match-ratings table and the SQL / import side is covered by `scripts/test_minutes_sql.js`, but nothing has run against a real Live Editor session yet. After the first F10 sync with the updated `export_all.lua`:
1. Open `C:\Users\Public\ea_fc_*.json` and check a squad player has `"minutes":<number>` next to `"appearances"` (a number for everyone, never missing; `null` means the match-rating table could not be read).
2. A regular starter should be roughly 90 x appearances (a little less with substitute appearances). If every player shows `0`, the date filter (`season_start`) or the `minsplayed` field name needs checking against `fc27_probes/inspect_fc27_cmplayers_compare.lua`.
3. Insights > Roster Moves: the footnote should read "Play time uses minutes played" and the Play time column should say "of minutes" instead of "of games".
4. A sync from `export_squad.lua` (which has no minutes) must not wipe the stored minutes: the upsert keeps the previous value when the new one is NULL.


## Live Editor v27.1.1 - v27.1.6 release-note triage (2026-10-29)
Source: xAranaktu's release notes. The app is still only **tested against v27.1.4**; nothing below is verified in game.

| Release | Item | Effect on the app | Next step |
|---|---|---|---|
| 27.1.5 | Player Editor: **Contract role** | Possible source for the missing squad role (`player_role_` is exported as 0). No `role`/`squadrole` field was in the v27.1.2 schema dump. | Re-run `inspect_fc27_db_schema.lua` (new PHASE 3 keyword scan) on v27.1.6 and look for a contract-role field on `players`/`teamplayerlinks`. |
| 27.1.5 | Fixed loading of player injury status | `teamplayerlinks.injury` read in `export_all.lua` may now be reliable; `inspect_fc27_injury.lua` found it unreliable earlier. | Re-test with an injured player. |
| 27.1.4 | Transfer History (undo, CPU only) | Possible Lua-visible source for the Missing transfers data. | Run `inspect_fc27_transfer_history_api.lua` on v27.1.6. |
| 27.1.4 / 27.1.5 | Undo-transfers corrupted saves (fixed in 27.1.5) | None, but never use undo transfers on a real save with v27.1.4. | - |
| 27.1.4 | Fixed team transfer budgets, user-team wages, invalid potential shown in squad hub | Wage and budget reads are more trustworthy on 27.1.4+. | - |
| 27.1.3 / 27.1.6 | Disable Dynamic OVR, Reveal Player Data | Only the base `overallrating` is exported either way. | Watch whether potential/OVR differ from the in-game display. |
| 27.1.6 | Transfer Bans, jersey name outline, personality picker, Contract Objectives Bypass | New team/player fields; none are read by the export yet. | The PHASE 3 scan shows whether they are DB fields. |
| 27.1.1 - 27.1.2 | Player Career support, Database Editor, remove suspension | No change to the export. | - |

Not changed: `export_all.lua` and the README's tested-version table, because no field source is confirmed. Bump them once a run on v27.1.6 passes.


## Live Editor v27.1.7 - v27.1.8 triage (2026-11-05)
Source: `changelog.txt` in the v27.1.8 download, plus a string diff of `FCLiveEditor.DLL` v27.1.4 vs v27.1.8 (the Lua libs only changed enum files). New **native Lua bindings** in v27.1.8: `GetPlayersStats`, `GetPlayerStats`, `GetTeamIdFromPlayerId`, `GetCompetitionNameByObjID`, `GetCompetitionNameByID`, `SetSquadRole`, `IsPlayerTransferListed` / `IsPlayerLoanListed`, `AddPlayerToTransferList` / `AddPlayerToLoanList` / `RemovePlayerFrom*List`, `AddTransferBan` / `RemoveTransferBan`, `PlayerDevelopmentManagerLoad/Save/AddPlayer/RemovePlayer`, `CreatePlayer` / `DeletePlayer`, `Get/SetGameLocString`. There is still **no** Lua binding for standings or fixtures.

| Release | Item | Effect on the app | Next step |
|---|---|---|---|
| 27.1.8 | Player Editor: Season Statistics (+ native `GetPlayersStats`) | Goals / assists / clean sheets / cards / MOTM for the squad and the league-wide leaderboards. `export_all.lua` updated (below). | Run `inspect_fc27_season_stats.lua`, then the checklist below. |
| 27.1.8 | Development Exp Bonus / Multiplier / No Decline | Stored per save in `C:\FC 27 Live Editor\extensions\careers\<save uid>\players_development.json` (v2 lib `PlayerDevelopmentManager`), so the app can read it straight from disk for the academy watchlist. | The probe's section 7 prints the file after one player is edited in Player Editor. |
| 27.1.8 | Manager Editor: Unsackable, Job Security, Fire / Transfer Manager; Disable Manager Market | Challenge dashboard should flag Unsackable as active (board-patience rule). No Lua getter found; strings only (`is_unsackable_tooltip`). | Look for a `manager`/`career_*` DB field in a schema re-run. |
| 27.1.8 | Team selection bias | Depth chart starters may differ from who actually plays. | UI note on the depth chart. |
| 27.1.8 | Youth Academy: multiple scouts per country, Force player tier | Academy tracker could group intake by scout country. | - |
| 27.1.7 | Team Editor: League Standings, Fixtures, Match-fixing | Proves Live Editor knows the FC 27 standings/fixture layout, but nothing is exposed to Lua. | Ask xAranaktu for a `GetStandings`/`GetFixtures` binding; until then standings stay Missing. |
| 27.1.7 | Player Editor: Is Transfer/Loan Listed (+ native `IsPlayerTransferListed`) | Could mark listed players on the squad page. | - |
| 27.1.6 | Fixed autorun scripts using career mode events | Event ids in `career_mode/enums.lua` were renumbered in this range; no app script uses numeric event ids. | - |

### What `export_all.lua` now does with real stats rows
- `get_all_stats()` calls `GetPlayersStats()` once per F10 (pcall'd) for both the squad and league blocks.
- `stat_comp_name()` takes `compname` (FC 26) or resolves `compobjid` (FC 27, cached). Unnamed competitions show as "Competition #<id>".
- Minutes always come from `career_playermatchratinghistory`; its appearances / rating fallback row is only added when `GetPlayersStats()` returns nothing, so appearances are never counted twice.
- GK saves default to 0 (it was `or 5`, an FC 26 leftover that added 5 saves per competition row without the key).
- League block: when the calendar block found no fixtures, league teams = `leagueteamlinks` rows sharing the user team's `leagueid`, and the league competition = the stats competition named `GetCompetitionNameByID(leagueid)`; if none matches, the one with the largest overlap, then the fewest teams from outside the league, then most appearances (appearances alone would pick the Carabao Cup in August). Players are credited to `stat.teamid` when present.
- Tested in a stand-alone Lua 5.4 runtime against a mocked session (FC 27 rows, FC 26 rows, no rows, unresolved names). Nothing has run in the game yet.

### v27.1.8 probe results (`inspect_fc27_season_stats.lua`, 2026-11-05, Man City save in EFL League Two, in-game 2026-10-24)
- Native: `GetPlayersStats`, `GetPlayerStats`, `GetTeamIdFromPlayerId`, `GetCompetitionNameByObjID`, `GetCompetitionNameByID`, `SetSquadRole`, `PlayerDevelopmentManagerLoad`, `PlayerHasDevelopementPlan`. `IsPlayerTransferListed` / `IsPlayerLoanListed` are wrappers in `lua/libs/v1/live_editor.lua` (return `false` for unlisted players). `AddTransferBan` / `RemoveTransferBan` are not globals (the v2 `transfer_ban_manager` lib wraps them).
- 17,506 rows, 10,387 players, 368 teams, 26 competitions. Rows carry **both** `compname` and `compobjid`; the names match `GetCompetitionNameByObjID`.
- Leagues covered: Premier League, EFL Championship, League One, League Two, LALIGA, Serie A, Bundesliga, Ligue 1, Liga Portugal, Eredivisie, MLS. Cups: Carabao Cup, EFL Trophy, Coppa Italia, DFB-Pokal, U.S. Open Cup, Taça Portuguesa, the super cups / Community Shield. Europe: UCL, UEL, UECL, UWCL, EC Qualifiers, European Shield. Why exactly these leagues (simulated leagues at career start?) is unconfirmed.
- Rows exist with `app=0` for competitions a player is registered in but has not played.
- `GetPlayerStats(pid)` returns exactly that player's `GetPlayersStats()` rows, one per competition.
- `avg / app / 10` gives plausible ratings (e.g. 933 / 12 apps = 7.78). Not yet compared with the in-game screen.
- League pick: Carabao Cup (92 teams) and EFL Trophy (48) both overlap League Two 24/24, so overlap alone can't tell them apart. `GetCompetitionNameByID(61)` = "EFL League Two" = the stats compname, so the exporter matches on the name first.
- `players_development.json` does not exist until a player gets a development plan in Player Editor.

### First F10 sync on v27.1.8 (2026-11-05 09:42, same save)
- `ea_fc_squad_export.json`: matches the probe row for row (e.g. Malik Kane League Two 8 apps / 8 goals / 1 assist / 7.21). Minutes present; GK saves real (Ed Morgan 53).
- `ea_fc_league_stats_export.json`: `league_name` "EFL League Two", 649 players from all 24 teams, 358 goals / 199 assists / 3,782 apps = the probe's League Two totals exactly.
- Loaned-out players have stats elsewhere but no `career_playermatchratinghistory` rows (that table only covers the user's club), so they now export `minutes: null` instead of a false 0.
- App import: verified in the real `companion.sqlite` after the sync: save 6 tagged `FC27`, season 2026/27 named "EFL League Two", Kane 9 apps / 437 min / 8 goals / 1 assist / 7.08, and 649 `season_league_stats` rows (358 goals, 199 assists, 3,782 apps, Tshimanga top on 10).

### Fixtures and team records on v27.1.8 (2026-11-05)
- **Fixtures: still no source.** No Lua binding (the DLL's `standing_*`, `fixtures_table_container`, `edit_fixture`, `reschedule_fixture` strings are Team Editor UI, read from memory inside the DLL). The `fixtures` DB table is stale default data (334 rows, the one "user" fixture carries the old league id). Best route: ask xAranaktu for `GetFixtures()` / `GetStandings()` Lua bindings, since v27.1.7 already reads both for the Team Editor.
- **Team records: partly.** `leagueteamlinks` had live `currenttableposition`, `nummatchesplayed`, `teamform`, `lastgameresult` and `unbeaten*` in the Oct sample, with W/D/L, goals and points all 0. GF per team = sum of the league competition's player goals (misses own goals); GA / clean sheets from goalkeepers' `goals_conceded` / `clean_sheets`. W/D/L and points have no source. `inspect_fc27_standings_sources.lua` checks all of this mid-season plus any other table we missed.
- Other Lua-readable features: transfer bans (`transfer_ban_manager:GetAllBans()` -> `cGetTransferBans`; the lib reads `ban.id` but its own test prints `ban.member_id`, so the probe dumps the keys; its `RemovePlayer` passes the TEAM enum, a Live Editor bug), `IsPlayerTransferListed` / `IsPlayerLoanListed` (v1 wrappers, take `teamid`), `IsPlayerLoanedOut`, `IsPlayerPresigned`, `GetPlayersStats` `goals_conceded` / `two_yellow`.
- UI-only (no getter found): Unsackable / Job Security, Team selection bias, Development Exp Bonus / Multiplier / No Decline (writes via `PlayerDevelopmentManager*`, file only after a plan is set), Force player tier, multiple scouts per country, Reveal Player Data, match-fixing, Contract role (`SetSquadRole` writes; no read).

### Standings probe results (`inspect_fc27_standings_sources.lua`, 2026-11-05, in-game 2026-10-24)
- `leagueteamlinks` is a **stale snapshot**, not live: it says 6 played (Man City 4) when the stats show 12 league games for every team, position 2 appears twice and 15 is missing, and W/D/L / goals / points are all 0. `teamform` (e.g. `2222` for City's 4 games, `21112`) matches the snapshot's game count, so it is stale too. Not usable.
- Stats-rebuilt totals are consistent: league player goals sum to 358 and goalkeeper `goals_conceded` sums to 358 (no own goals yet), and every team's GK appearances = 12 = games played. So P, GF, GA, GD and clean sheets per team are reliable. W/D/L and points are not derivable from season totals.
- No other table holds live standings (`clubcoefficients.points` is the European coefficient; the rest are formations/mentalities).
- `IsPlayerLoanedOut` works (19 loaned-out players true). `IsPlayerLoanListed` was true for 2 of them; `IsPlayerTransferListed` false for all (nobody was listed). Transfer bans: 0 rows, so the row keys are still unconfirmed.
- Workaround for W/D/L / points / past results: a `pre__CareerModeEvent` handler on `DAY_PASSED` (event 15) that diffs each team's league goals / goals conceded / appearances day by day. One league match per team per day, so a change = one result. Exact except own goals; complete only from the day it starts recording. Upcoming fixtures still need a Live Editor binding.

### Season stats: first-sync checklist (needs the game, LE v27.1.8)
1. Restart the game, load the career, and run `fc27_probes/inspect_fc27_season_stats.lua` **before** F10. Section 1 must say NATIVE for `GetPlayersStats`; section 2 lists the row keys (expect `teamid`, `compobjid`).
2. Section 3: the user's league should appear with ~20 teams, the domestic cups and Europe with fewer rows. If competition names are `nil`, unnamed ones still work but show as "Competition #<id>".
3. Section 4: the league competition should overlap the user's league fully (e.g. 20/20). If leagueteamlinks is stale after a promotion, the overlap drops; tell Claude.
4. Section 5: compare the top scorers with the in-game stats screen. Check `avg_raw / apps / 10` gives the in-game average rating.
5. Press F10, then check `C:\Users\Public\ea_fc_league_stats_export.json` has `league_name` and players from every league team, and the app's Top Goals / Top Assists widgets fill.
