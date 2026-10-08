# Squad Depth view

Squad tab toggle: **List** / **Depth** / **Academy** (see academy_tracker.md). Code: `js/depth_chart.js` (`window.SquadViews`). The lineup, formation and what-if controls sit in the toolbar next to the toggle.

- Lineups: Default (auto-generated, locked), Starting XI, Rotation / Reserves, plus any the user creates (＋ New, optional "reserves" flag). Each has its own formation and manual arrangement, saved automatically in localStorage. Reserves auto-fill without the Starting XI's starters, so it is naturally the next eleven. Custom lineups can be deleted.
- Formations: 8 shapes including "4-3-3 Holding" (2 CM + CAM).
- Strings: every position holds 1st, 2nd, 3rd... strings. 1st/2nd auto-fill (scarcest role first; an alt-position player needs +6 OVR to beat a natural one) unless pinned; 3rd and beyond are manual only.
- Arranging: drag a player onto another to swap, or use the ✎ on a position: pick a string, then a player from the squad (natural / alt position / out of position, hover for details). "Reset order" clears the active lineup's pins.
- Age rings: green under 21, orange 30+.
- Gap flags: vacant, no backup, starter's contract expiring (<= 12 months) with no backup and no prospect (red) or with cover (info), plus Team Needs reasons (Aging, Regression, Underperforming, Limited Minutes, Potential Reached).
- "What if I sell X": re-runs the assignment without X and highlights newly opened gaps.
- Hover summary: age, OVR, potential, the six category totals (PAC/SHO/PAS/DRI/DEF/PHY, or the goalkeeper set), preferred foot, height, weak foot, skill moves, alt positions.
- Bottom section: one table, a row per position with the best three senior players and the academy prospects.
- Home "Squad Gaps" card replaces Expiring Contracts + Team Needs and always reflects the Starting XI lineup.
- Depth ignores the List filters and season selector; it uses the live senior squad (not loaned out / transferred).
