# News feed images

One folder per news type, named exactly as below (matching the keys in
`NEWS_TYPE_META` in `index.html`). Drop as many images as you want into
a type's folder — the News tab picks one at random each time a story of
that type is shown, so repeated events don't all show the same picture.
Add more any time; nothing else needs to change. A type with no folder
(or an empty one) just falls back to a plain emoji badge.

| Folder | News type | Status |
| --- | --- | --- |
| `hat_trick/` | Hat-trick | ✅ populated |
| `brace/` | Brace (2 goals) | ✅ populated |
| `motm/` | Man of the Match | ✅ populated |
| `player_of_month/` | Player of the Month | ✅ populated |
| `injury/` | New injury | ✅ populated |
| `injury_recovery/` | Back from injury | ✅ populated |
| `competition_win/` | Won a competition | ✅ populated |
| `race_lead_change/` | Player of the Year race lead change (mid-season, April-June) | needed |
| `golden_boot_race/` | Golden Boot race lead change | ✅ populated |
| `playmaker_race/` | Playmaker race lead change | ✅ populated |
| `golden_glove_race/` | Golden Glove race lead change | ✅ populated |
| `ballon_dor/` | Ballon d'Or / Player of the Year — real end-of-season winner only (see generateSeasonAwardsIfNeeded in main.js) | ✅ populated |
| `transfer/` | Notable transfer | ✅ populated |
| `win_streak/` | Win streak | ✅ populated |
| `unbeaten_streak/` | Unbeaten streak | needed |
| `milestone/` | Season stat milestone (goals/assists/apps/clean sheets share this one folder) | ✅ populated (assists so far) |
| `contract_signed/` | Contract renewal | needed |
| `new_captain/` | New club captain | ✅ populated |
| `youth_promotion/` | Youth academy promotion | ✅ populated |
| `red_card/` | Player sent off | ✅ populated |
| `yellow_card_milestone/` | Every 5th yellow card of the season (suspension risk) | ✅ populated |
| `notable_goal/` | Generic single-goal highlight — only used to round an edition out to 3 stories when there isn't enough real news that matchweek | ✅ populated |
| `rivalry_battle/` | Generic "intense battle" filler for a close match (decided by a goal or less) | ✅ populated |
| `post_match_reaction/` | Generic post-match player reaction/quote filler | ✅ populated |
| `match_anticipation/` | Generic "big match coming up" filler — fires for the next upcoming league fixture when the opponent is within 3 places of us in the real table | ✅ populated |
| `contract_expiring/` | Club story: a first-team (or young high-potential) player's contract ends within 6 months | needed |
| `physio_concern/` | Club story: injury-prone player (3+ injuries or 60+ days out in 12 months) | needed |
| `scout_report/` | Club story: the scouts flag the worst hole in the squad balance | needed |
| `breakthrough/` | Club story: a player is up 5+ overall this season (academy wording for 21 and under) | needed |

`notable_goal`/`rivalry_battle`/`post_match_reaction`/`match_anticipation` are the four "generic" types — real match/scorer/scoreline/table position, but not tied to a specific detected achievement. They're ranked lowest in `NEWS_TYPE_PRIORITY` (main.js) so they only ever fill in when the week's real news doesn't already fill all 3 story slots.

## How editions are picked (js/news_rules.js)

One edition per in-game week, curated on the first sync of the week: up to 5 stories, one per type, best first.
Injuries, recoveries and youth promotions always get a slot when they happened; the generic types above only fill
in on a quiet week (and never the same one two weeks running); anything older than 14 in-game days expires instead
of turning up late. Award race stories are real overtakes only (a tie never counts), at most one per race every 3
weeks unless our own player takes the lead. The News card's ‹ › arrows browse older editions.
