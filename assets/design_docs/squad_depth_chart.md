# Squad Depth / Age views

Squad tab toggle: **List** (existing table + filters) / **Depth**. Code: `js/depth_chart.js` (`window.SquadViews`).

- Depth: formation picker (7 shapes, remembered). Each slot stacks starter / backup / best academy prospect.
  Slots are filled scarcest-role-first; an alt-position player needs +6 OVR to beat a natural one. A backup may cover several slots.
- Age rings: green under 21, orange 30+.
- Gap flags: vacant, no backup, starter's contract expiring (<= 12 months) with no backup and no prospect (red) or with cover (info).
- "What if I sell X": re-runs the assignment without X and highlights newly opened gaps.
- Drag a player onto another (or onto a vacant row) to swap; arrangement is pinned per formation, saved locally, "Reset order" clears it. Hover a name for age, OVR, base stat total, height, weak foot, skill moves, alt positions.
- "Top players by position" and academy pipeline panels sit under the pitch (top players are draggable onto slots). The Age view was removed (the List filters cover it).
- Depth/Age ignore the list filters and season selector; they use the live senior squad (not loaned out / transferred).

Home: the Expiring Contracts and Team Needs cards are replaced by one Squad Gaps card (same flags, chosen formation). Team Needs reasons (Aging, Regression, Underperforming, Limited Minutes, Potential Reached) show as flags on the starter, via `computeTeamNeeds()` in app.js.
