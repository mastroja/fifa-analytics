# FIFA Analytics v27 — first release for EA SPORTS FC 27

The companion app for Career Mode, rebuilt for FC 27. It reads your save through Live Editor and turns it into a Home dashboard, squad tools, a depth chart, an academy tracker and an in-app player editor. Your save data stays on your PC.

**Works with:** EA SPORTS FC 27 build `1.0.141.12554` and FC 27 Live Editor `v27.1.4`. Live Editor reads game memory, so a different game build can break it. Pin your game version first (see the README).

## New in 27.1.0: planning tools
- **Roster Moves** (Insights): a sell / keep / loan call for every player with the reasons behind it (age, overall vs potential, play time, wage against your squad, contract length). Click a tile to filter. Respects a Youth Mode transfer ban.
- **Contract planning** (Insights > Wages & Contracts): the weekly wage bill projected season by season, an estimated renewal wage for each expiring contract, and one recommended action per player (renew, short extension, let go, sell now).
- **Progression** (Insights): a chart of who is ahead of or behind what is typical for their age, with a **Season** picker to look at earlier years. Click a row for the reasoning.
- **Academy:** now laid out like the Squad list (sortable columns, the shared filter panel, search), with a **Ready for promotion** verdict for each prospect compared with your weakest senior player at that position. The regen watchlist was removed.
- **Home and profiles:** a Roster Moves card next to Squad Gaps, contract actions on the Contracts card, a Ready badge in the Youth Pipeline list, and Planning / Promotion cards on player profiles.
- **Minutes played** is carried from the game export (when the match-rating table is readable) and used as the best play-time signal; otherwise appearances are used.
- **No automatic updates for now.** The app no longer checks for updates; download new installers by hand. Your save data is never uploaded; the app only loads club badges (TheSportsDB, which receives the club name), country flags (flagcdn.com) and fonts (Google Fonts) from the internet.
- All of the above are rules of thumb built from your own squad's numbers, not predictions.

## Read this first
- **This release is for FC 27 only.** If you are still playing FC 26, stay on your current version; this update is not for you.
- **Updating from an older version:** the installer upgrades in place. The app was renamed, so your data folder moved from `%APPDATA%\fifa-career-companion` to `%APPDATA%\fifa-analytics`. On the first launch your saves are **copied** across and the old folder is left untouched as a backup.
- **Live Editor hotkeys:** bind `assets/lua/export_all.lua` to **F10** (read-only export) and, for the player editor, `assets/lua/player_editor_sync.lua` to **F11**. The script paths are now under `assets\lua\`. See README sections 5 and 5b.
- **Windows may show a SmartScreen warning** the first time you run the installer (it is not code-signed yet). Choose "More info", then "Run anyway".

## What's new

### Squad tab: List, Depth and Academy
- **Filters on the squad list and Former Players:** position, age, overall, potential, OVR change, appearances, goals, assists, G+A, clean sheets, rating, cards, contract year, injured; and for former players club, fee, value, years at club, joined and departed season. One-click presets, an active-filter count and "Showing X of Y", remembered per view.
- **Depth chart:** a full pitch with 8 formations (including 4-3-3 Holding). Each position holds 1st, 2nd, 3rd... strings. Drag players to rearrange, or use the ✎ on a position to pick each string. Hover a player for age, overall, potential, the six category totals, preferred foot, height, weak foot, skill moves and alternative positions.
- **Starting XI, Reserves and your own lineups:** every change is saved to the lineup you have selected. Reserves auto-fill with the players the XI doesn't use. A two-wide list on the right shows everyone not in the lineup, with the youth academy beneath it.
- **Position fit at a glance:** the ring around each avatar is green for a main position, yellow for an alternative (CDM, CM and CAM count as close fits for each other) and red for neither. Alternative positions show as small chips beside the main badge.
- **Gap flags:** vacant positions, no backup, expiring contracts with no cover, and the Team Needs reasons (aging, regression, underperforming, limited minutes, potential reached). A player appears at most once per lineup, and you can remove anyone from the chart.
- **What if I sell…:** see which gaps would open if you sold a player.
- **All-Time XI:** a tucked-away 🏆 button builds a lineup of the best players ever to play for your club, ranked by peak overall.

### Academy
- The Academy page is laid out like the Squad list: **sortable columns**, the same **filter panel** (position, promotion verdict, age, overall, potential, months in academy) with one-click presets, search, and In academy / Promoted / Left / All tabs. Click a prospect's name to see their season-by-season history; click anywhere else on the row to open the profile.
- **Ready for promotion:** each prospect in the academy gets a plain verdict compared with your weakest senior player at the same position: **Ready for promotion** (level or better), Close (within 3), Developing, or Position open (no senior player there), with the comparison and where they would rank in the squad (for example "5 above Jamie Cole (61) · would be 2nd of 3 GKs"). A chip counts the ones who are ready, and the Home Roster Moves card lists them.
- Sorting and filtering by potential only ever use the number the app shows, so a potential hidden in Youth Mode stays hidden.
- The regen watchlist (starring prospects, alerts and notes) has been removed. Nothing was deleted from your saves.

### Home page
- **Squad Gaps** replaces the separate Expiring Contracts and Team Needs cards and follows your Starting XI.
- **Youth Pipeline** (Future Stars and Academy in one card) and a single, tidier Youth Mode strip for the challenge status, over-the-cap warning and Overall Cap Watch. The header is cleaner.
- **Not available in FC 27 yet** notes explain why a widget is empty instead of leaving a blank box (see below).

### Youth Squad Career Mode
- **Challenge dashboard** with obligations, a transfer-ban tracker (flags incoming deals dated inside a ban) and the rules reference, opened from Settings.
- Reserve squad numbers now run whenever Youth Mode is on.

### Player editor and customization
- **Edit player** for generic, regen and academy players: appearance, attributes, positions, PlayStyles and height, written to the game through the F11 hotkey, with undo and edit history.
- **Dynamic look:** monthly automatic look changes, realistic heights and growth, and undo, for the whole team.
- **Real player faces (needs Live Editor v27.1.4 or newer):** Settings > Player customization > Player faces > "Generate for squad" has Live Editor render a real face for each squad player (about 2 s each, game running, F11 bound to `player_editor_sync.lua`). These replace the stand-in photos. When you save an appearance edit in the player editor (hair, colour, eyes, skin and so on), that player's face is re-rendered automatically so it matches.
- Hair filtering follows skin tone: "Suggested for skin tone" now counts only styles in the suggested categories, with the rest under "Other". Heights are capped at 6'9" (206 cm).

## FC 27 limitations (Live Editor does not provide these yet)
The game's data for these is not exposed by Live Editor v27.1.3, so these parts of the app stay empty. Each affected Home widget says "Not available in FC 27 yet".
- Current-season **goals, assists, clean sheets and cards** (and so the Top Goals / Top Assists widgets).
- **League standings, fixtures, results and the calendar.**
- **Transfers and negotiations**, trophies won, league-wide stats and competition names.
- **Contract start date, length and squad role.** Wage and contract end year work.
- **Dynamic (in-game) overall:** the app shows the player's base overall.

What does work: squad, attributes, PlayStyles, loans, wage and contract end, injuries, the youth academy, manager data and the player editor. **Appearances and an approximate average rating** are rebuilt from the game's per-match rating table (ratings are whole numbers, so the average can be about 0.2 off the in-game figure). If a future Live Editor release exposes the missing data, the app will pick it up. See `assets/design_docs/fc27_port_status.md`.

## Other changes
- The app is now simply **FIFA Analytics** (`fifa-analytics`), and versions follow `27.minor.patch`: the major number is the game, minor is a larger change, patch a smaller one.
- **Connected Career has been removed** from this release.
- Behind-the-scenes groundwork for optional Pro features exists but is switched off; everything in this release is unlocked.
- Fixes and polish: updater failures are logged instead of raising errors, duplicate squad rows can no longer put a player on the pitch twice, and README and setup instructions are refreshed.

## Known issues
- The installer is unsigned (SmartScreen warning).
- No automatic updates: download new versions by hand.
- Several stats are missing until Live Editor exposes them for FC 27 (see the limitations above).
- No FC 26 support in this version.

## Credits
Built on top of **FC 27 Live Editor** by xAranaktu. This project is not affiliated with or endorsed by EA, FIFA or any league, club or player.
