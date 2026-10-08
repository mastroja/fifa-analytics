# Squad Depth view

Squad tab toggle: **List** / **Depth** / **Academy** (see academy_tracker.md). Code: `js/depth_chart.js` (`window.SquadViews`). The lineup selector, formation and what-if controls sit in the toolbar next to the toggle.

- Lineups: **Starting XI** and **Reserves** (plus any made with ＋ New, deletable). Everything you drag or edit is saved to whichever lineup is selected, automatically (localStorage). Each lineup has its own formation. Reserves auto-fills without the Starting XI's starters, so it is naturally the next eleven.
- Layout: the pitch on the left; on the right a list of every senior player not in the selected lineup (labelled "Reserves" on the Starting XI, "Not in this eleven" on Reserves), two cards per row, no height limit. Drag a card onto a position to put that player there; the displaced player returns to the list. Cards show the avatar, name, position, age and OVR; players who start in the XI are tagged "XI" in the Reserves view.
- Formations: 8 shapes including "4-3-3 Holding" (2 CM + CAM).
- Strings: every position holds 1st, 2nd, 3rd... strings. 1st/2nd auto-fill (scarcest role first; an alt-position player needs +6 OVR to beat a natural one) unless pinned; 3rd and beyond are manual only.
- Arranging: drag a player onto another to swap, or use the ✎ on a position: pick a string, then a player (natural / alt position / out of position, hover for details). "Reset order" clears the active lineup's pins.
- Age rings: green under 21, orange 30+.
- Gap flags: vacant, no backup, starter's contract expiring (<= 12 months) with no backup and no prospect (red) or with cover (info), plus Team Needs reasons (Aging, Regression, Underperforming, Limited Minutes, Potential Reached).
- "What if I sell X": re-runs the assignment without X and highlights newly opened gaps.
- Hover summary: age, OVR, potential, the six category totals (PAC/SHO/PAS/DRI/DEF/PHY, or the goalkeeper set), preferred foot, height, weak foot, skill moves, alt positions.
- Bottom section: one table, a row per position with the best three senior players and the academy prospects.
- Home "Squad Gaps" card replaces Expiring Contracts + Team Needs and always reflects the Starting XI lineup.
- Depth ignores the List filters and season selector; it uses the live senior squad (not loaned out / transferred).
