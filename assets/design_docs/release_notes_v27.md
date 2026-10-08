# FIFA Analytics v27 — first release for EA SPORTS FC 27

The companion app for Career Mode, rebuilt for FC 27. It reads your save through Live Editor and turns it into a Home dashboard, squad tools, a depth chart, an academy tracker and an in-app player editor. Everything stays on your PC.

**Works with:** EA SPORTS FC 27 build `1.0.141.12554` and FC 27 Live Editor `v27.1.3`. Live Editor reads game memory, so a different game build can break it. Pin your game version first (see the README).

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

### Academy tracker and regen watchlist
- Every academy prospect the app has seen, with a per-season history, a status (In academy, Promoted, Left) and a plain-language **squad readiness** badge: Ready, Close, Developing or Open spot, compared with your weakest senior player in that position.
- Star a prospect to add them to the **regen watchlist**: their numbers at that moment are remembered, so you get alerts such as "OVR +5 since added", "ceiling +3", "Promoted" or "Left the academy", plus an optional note.

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
- The Live Editor download link in the README still points to an FC 26 post.
- No FC 26 support in this version.

## Credits
Built on top of **FC 27 Live Editor** by xAranaktu. This project is not affiliated with or endorsed by EA, FIFA or any league, club or player.
