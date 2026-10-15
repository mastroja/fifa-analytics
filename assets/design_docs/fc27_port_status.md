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
| Minutes played | Approximate, **not yet verified against the game** | summed from the same `career_playermatchratinghistory` rows (`minsplayed`) in `export_all.lua`, stored in `player_season_stats.minutes_played` (NULL = the export had no minutes, 0 = a real zero), read as `minutes` on each squad row. `js/roster_advice.js` uses it as the best play-time signal and falls back to appearances. See the checklist below. |
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


## Minutes played: first-sync checklist (needs the game)
The Lua change ran in a stand-alone Lua runtime against a fake match-ratings table and the SQL / import side is covered by `scripts/test_minutes_sql.js`, but nothing has run against a real Live Editor session yet. After the first F10 sync with the updated `export_all.lua`:
1. Open `C:\Users\Public\ea_fc_*.json` and check a squad player has `"minutes":<number>` next to `"appearances"` (a number for everyone, never missing; `null` means the match-rating table could not be read).
2. A regular starter should be roughly 90 x appearances (a little less with substitute appearances). If every player shows `0`, the date filter (`season_start`) or the `minsplayed` field name needs checking against `fc27_probes/inspect_fc27_cmplayers_compare.lua`.
3. Insights > Roster Moves: the footnote should read "Play time uses minutes played" and the Play time column should say "of minutes" instead of "of games".
4. A sync from `export_squad.lua` (which has no minutes) must not wipe the stored minutes: the upsert keeps the previous value when the new one is NULL.
