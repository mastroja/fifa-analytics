# FC 27 port status

Audited 2026-10-08 against the app database (the two FC 27 saves, Swansea 2026/27 and Man City 2026/27, synced with Live Editor v27.1.3) and the probe reports in `assets/lua/fc27_probes/`.

| Area | FC 27 status | Notes / next step |
|---|---|---|
| Squad identity, bio, positions, alt positions, nationality, photo | Works | `players`, `teamplayerlinks` unchanged |
| Overall / potential, attributes, skill moves, weak foot | Works | 34/34 and 25/25 rows have attributes |
| PlayStyles / traits | Works | decoded from `players.trait1/2` + `icontrait1/2` bitmasks |
| Loans (on loan, from team, end date, loan-to-buy) | Works | `playerloans` |
| Wage, contract end year, jersey number | Works | wage now on `players`; `contractvaliduntil` |
| Contract start / duration / squad role | Missing | no FC 27 source (`career_playercontract` is gone); exported as empty defaults |
| Injuries | Works (none seen yet) | `teamplayerlinks.injury` |
| Youth academy snapshot, tracker, watchlist | Works | `career_youthplayers`; 17 / 13 rows in the two saves |
| Player editor (appearance, attributes, positions, PlayStyles, height) | Works | `player_editor_sync.lua`, F11 flow |
| Appearances + average rating | Approximate | restored from `career_playermatchratinghistory` (new fallback in `export_all.lua`): whole-number ratings, so the average is ~0.2 off the in-game one |
| Goals, assists, clean sheets, cards, saves | Missing | `GetPlayersStats` exists in v27.1.3 but returns 0 rows; no table has current-season counts (`prevcompetitionstats` = last season only) |
| Dynamic overall | Missing | only base `overallrating` is readable; see `project_fc27_dynamic_overall` notes |
| Standings / league table, fixtures, results, calendar | Missing | memory only; FC 26 offsets are wrong. Stages 5-7 of the probe hunt found no list (see `fc27_probes/README.md`) |
| Transfers / negotiations | Missing | memory only (`TransferManager+0x1DD0` unverified, export skipped) |
| League stats (top scorers league-wide), competition names, trophies / competition results | Missing | depend on `GetPlayersStats`, `GetCompetitionNameByObjID` and the fixture list |
| Manager info | Works | `manager` table |

## Consequences in the app
- Home widgets that need standings, fixtures, league stats or goals/assists stay empty on FC 27 saves; the squad, depth chart, academy tracker, editor, contracts and challenge dashboard are fully usable.
- Team Needs reasons that depend on stats (Limited Minutes, Underperforming) now work again from the approximate appearances / rating.

## Blocked on Live Editor
Everything marked Missing except contract fields and dynamic overall is blocked on either a newer Live Editor (re-bind `GetPlayersStats`, competition names, add real standings / fixtures access) or finding the FC 27 memory layout. Check each new Live Editor release's `changelog.txt`, then re-run `inspect_fc27_api_availability.lua` and compare against this table.

## "Not available in FC 27 yet" notes
`export_all.lua` now tags its squad export with `"game":"FC27"`; `importFifaData` stores it in `saves.game_version` (migration in main.js, column in schema.sql) and the renderer exposes it as `currentSaveGame` / `isFc27Save()` (`js/app.js`). On an FC 27 save, these Home widgets say why they are empty instead of a bare "No data": Upcoming Match, League Table, Team Record, PPG, Trophies, Top Goals, Top Assists. Appearances is not flagged (it has the approximate match-rating fallback). A save only becomes "FC27" after its next F10 sync with the updated script; saves from before that keep the generic messages.
