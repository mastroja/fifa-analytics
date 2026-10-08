# Squad Depth view

Squad tab toggle: **List** / **Depth** / **Academy** (see academy_tracker.md). Code: `js/depth_chart.js` (`window.SquadViews`). The lineup selector, formation and what-if controls sit in the toolbar next to the toggle.

- Lineups: **Starting XI** and **Reserves** (plus any made with ＋ New, deletable). Everything you drag or edit is saved to whichever lineup is selected, automatically (localStorage). Each lineup has its own formation. Reserves auto-fills without the Starting XI's starters, so it is naturally the next eleven.
- Layout: the pitch (about one screen tall, large cards) on the left; on the right a list of every senior player not in the selected lineup (labelled "Reserves" on the Starting XI, "Not in this eleven" on Reserves), two cards per row, no height limit. Drag a card onto a position to put that player there; the displaced player returns to the list. Cards show the avatar, name, position, age and OVR; players who start in the XI are tagged "XI" in the Reserves view.
- Formations: 8 shapes including "4-3-3 Holding" (2 CM + CAM).
- Strings: every position holds 1st, 2nd, 3rd... strings. 1st/2nd auto-fill (scarcest role first; an alt-position player needs +6 OVR to beat a natural one) unless pinned; 3rd and beyond are manual only.
- A player appears at most once in a lineup (any position, any string), and duplicate source rows are collapsed, so one spare can no longer back up several positions; a position without its own spare shows "no backup".
- Arranging: drag a player onto another to swap, or use the ✎ on a position: pick a string, then a player (natural / alt position / out of position, hover for details). "Reset order" clears the active lineup's pins.
- Avatar rings show fit for the position: green = one of their main positions, yellow = an alternative position, red = neither. Alternative positions are small outlined chips beside the main badge (the one that fits the slot is highlighted).
- Central midfield: a player at CDM, CM or CAM (main or alt) in any of those three slots is yellow (a close fit), not red, and can be auto-picked there at the usual alt-position penalty.
- Gap flags: vacant, no backup, starter's contract expiring (<= 12 months) with no backup and no prospect (red) or with cover (info), plus Team Needs reasons (Aging, Regression, Underperforming, Limited Minutes, Potential Reached).
- "What if I sell X": re-runs the assignment without X and highlights newly opened gaps.
- Hover summary: age, OVR, potential, the six category totals (PAC/SHO/PAS/DRI/DEF/PHY, or the goalkeeper set), preferred foot, height, weak foot, skill moves, alt positions.
- Right column: the reserves list, then a "Youth academy" list in the same two-wide card layout (prospects show OVR → potential; not draggable). The old "best in squad by position" table was removed.
- Home "Squad Gaps" card replaces Expiring Contracts + Team Needs and always reflects the Starting XI lineup.
- Depth ignores the List filters and season selector; it uses the live senior squad (not loaned out / transferred).

## All-Time XI
Small 🏆 button at the end of the Depth toolbar (hidden lineup `alltime`): the best players ever to play for the club, each represented by their peak-season overall (ties: most appearances), only players with at least one appearance (falls back to everyone if fewer than 11 qualify). Data: `getAllTimeXI` in main.js (peak season row + career totals). Same pitch, formation selector, drag and ✎ editing; no gap flags and no what-if. The right list is the all-time bench. Hover shows peak season and club career (apps / goals / assists).

## Position display
Every player card (pitch starters and backups, reserves, academy, edit dialog) shows a coloured natural-position badge, and "alt CDM, RB" for alternative positions.

## Height cap
Heights are capped at 6'9" (206 cm) on display, on import (main.js `capHeightCm`) and in the player editor limits (140-206 cm).

## Season selector
The season selector and search bar belong to the List view only; Depth and Academy hide them.
