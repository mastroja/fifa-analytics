# Academy tracker + regen watchlist

Squad tab toggle: List / Depth / **Academy**. Code: `js/academy_tracker.js` (UI), `getAcademyTracker` / `getAcademyWatchlist` / `toggleAcademyWatch` / `setAcademyWatchNote` in `main.js`, table `academy_watchlist` in `schema.sql`.

- Tracker: every prospect ever in `youth_academy_snapshot` for the save, one history point per season. Status: In academy (in the current roster), Promoted (has a senior row in any season), Left (neither).
- Row: age, months in academy, OVR with change since first seen, potential (same display rules as the Home academy list), readiness = OVR vs the weakest senior player at the same natural position. Click a row for season history.
- Watchlist: star a prospect. Their OVR and potential range at that moment are frozen, so alerts can say: OVR +/-3 since added, potential range narrowed, ceiling +/-3, promoted, left the academy. Optional note per player.
- Range-based history and alerts only show while `SHOW_TRUE_POTENTIAL` is on, so they never leak a range the app is hiding.
- Limits: history is per season (the importer upserts one row per player and season), and only the user's own academy is visible; there is no data on other clubs' regens.

Squad readiness column: a verdict badge plus the one comparison behind it. Ready = OVR level with or above your weakest senior player at the same natural position; Close = within 3 below; Developing = further below; Open spot = no senior player at that position. A legend sits above the tables.
