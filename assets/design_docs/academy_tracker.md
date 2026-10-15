# Academy page

Squad tab toggle: List / Depth / **Academy** / All-Time. Code: `js/academy_tracker.js` (logic and page), `getAcademyTracker` in `main.js`, markup in `index.html` (`#squad-academy-view`, static so the shared filter control survives re-renders, the same pattern as the All-Time view). Tests: `scripts/test_academy_tracker.js`.

## The page
- Laid out like the Squad list: status tabs (In academy / Promoted / Left / All, each with a count), a search box, the shared **filter panel** (`js/player_filters.js`: position, promotion verdict, age, overall, potential as shown, months in academy, OVR gained since first seen) with presets, then a sortable table. Click a header to sort (a second click reverses it); a missing value always sorts last. Default sort: ready-for-promotion first, then by potential.
- Click a prospect's name to expand their season history (one row per season in `youth_academy_snapshot`); click anywhere else on the row to open the profile. The Status column only shows on the All tab.
- Status comes from `getAcademyTracker`: In academy (in the current roster), Promoted (has a senior row in any season), Left (neither). History is one point per season because the importer upserts one row per player and season. Only your own academy is visible; there is no data on other clubs' regens.
- **Potential is shown, sorted and filtered only as the app displays it** (`formatAcademyPotentialDisplay`, which can be a range or hidden in Youth Mode). A prospect with no displayed potential has no sortable number, so the page can never reveal a ceiling the rest of the app is hiding.

## Promotion readiness ("Ready for promotion")
Each prospect still in the academy is compared with the **weakest senior player at the same natural position** (loaned-out players are not counted):
- **Ready for promotion**: OVR level with or above that player.
- **Close**: up to 3 below. **Developing**: further below.
- **Position open**: no senior player at that position at all.
The detail line names the player compared with and where the prospect would rank among that position's senior players ("would be 2nd of 3 GKs"). A green chip above the table counts the ready prospects and filters to them. The Home **Roster Moves** card lists the ready ones (`AcademyTracker.liveReady()`).

This is a rule of thumb about current ability, not about fit, wage or Youth Mode transfer rules.

## History
The regen watchlist (starring a prospect, frozen baselines, alerts and notes) was removed. Its table, `academy_watchlist`, is kept in `schema.sql` so existing databases lose no data and the cleanup deletes in `main.js` keep working; nothing writes to it any more. (The unrelated "watchlist" that tracks *former* players after they leave, `readWatchlistStatus` in `main.js`, is a different feature and is untouched.)
