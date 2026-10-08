# Assets rights audit (before any public release)

Audited 2026-10-08 by looking at the files themselves (sample images from every folder, EXIF, file names, how the code uses them) and comparing the Lua scripts with Live Editor's bundled examples. This is a risk review, not legal advice. `assets/**/*` is bundled into the installer (`package.json` build `files` and `asarUnpack`), so everything below ships to every user, and is public if the repo is.

Nothing in the repo records where any of these files came from. For each category the first thing to do is write down the real source.

## Red: very likely someone else's, do not ship as-is

| Folder | Files | What it is | Why it is a problem |
|---|---|---|---|
| `player_customization/hair`, `facial_hair` | 780 | Renders of EA FC characters (game-engine heads, club kits visible) | EA's game assets. Taking them from the game and redistributing them is the clearest infringement here (and against EA's EULA) |
| `playstyles` | 72 | EA FC's PlayStyle icons (UI art, base and + variants) | EA UI art |
| `player_customization/boots` | 210 images (+ `boots_index.csv`, `data/boots_data.json`) | Product pictures / game renders of Nike, Adidas, Puma, Mizuno, Umbro, New Balance, Lotto, Skechers boots | Brand trademarks plus whoever made the pictures (the sampled one looks like a game render on a flat background) |
| `news` | 42 | Photographs of real matches and players (one shows a real player at Wembley with EFL, Castrol and BetOnline sponsor boards; some carry a Google Lens button from a screenshot). File names are phone `IMG_xxxx.JPG` | Press / agency photographs plus the real players' likeness. High risk, easy for the owner to spot |
| `trophies` (+ `display-case`, `trophy-lift`) | 36 | Official trophy photographs and renders (FA Cup with Emirates ribbons, Carabao Cup, Champions League, Ballon d'Or, PFA, EFL awards) and lift photos | Trademarked trophies, sponsor branding, and the photographers' copyright |
| `headshots/managers` | 1 (`rafa-benitez.png`) | A cropped real photograph of a real person | Photographer's copyright and personality rights |
| `competition-icons` | 14 | Official logos: Premier League, EFL Championship / League One / League Two, FA Cup, Carabao Cup, Vertu Trophy, UEFA Champions / Europa / Conference League | Registered trademarks. Fan tools often get away with nominative use, but not if monetised or if the logo suggests endorsement |

## Yellow: unknown provenance, decide per file

| Folder | Files | Notes |
|---|---|---|
| `headshots/15-20,20-28,28+` | 283 | 180x180 face portraits, grouped by age and ethnicity bucket. The sampled one looks AI-generated or game-render. If AI-generated with a tool whose terms allow it, fine; if taken from a game or website, red. Two leftover `iloveimg-resized.zip` files should be deleted either way |
| `app-icon` | 3 | Looks AI-generated. Check the generator's terms, and note the "FA" lettering is close to EA FC branding. Replace if you rename the app |
| `data/editor_labels.json` | 1 | Probably game localisation strings. Names / facts are fine; EA's text is not |
| `data/overall_formula.json`, `boots_id_map.json` | 2 | Derived from your own probes (facts about the game's maths), fine |

## Lua scripts

- `assets/lua/export_squad.lua`, `export_career_calendar.lua` and the structure of `export_transfers.lua` (and therefore `export_all.lua`) were derived from Live Editor's bundled example scripts of the same names (about 64% of `export_squad.lua`'s unique lines are identical to `lua/scripts/export_squad.lua`; `export_fixtures.lua` is the source of the standings struct reader). Those scripts are the Live Editor author's work. Ask him in the permission message (see the draft) or rewrite the shared parts.
- Your own probes, `player_editor_sync.lua`, the depth chart, academy tracker and everything in `js/` are yours.

## Names and branding
- App name "FIFA Analytics" / package `fifa-career-companion` uses the FIFA trademark. Pick a neutral name, add "Not affiliated with or endorsed by EA, FIFA, or any league, club or player", and avoid club or competition marks in the icon.

## What breaks if the red folders are removed
The app already falls back gracefully in several places, but check each before shipping:
- News images: falls back to an emoji badge (documented in `news/README.md`).
- Competition banners / logos and trophy images: `onerror` swaps to text or 🏆 in the Home widgets.
- Headshots: silhouette avatar.
- Player editor: hair, facial hair and boot tiles show a "no preview" box, but you could not pick a style visually. PlayStyle icons in the profile and editor need a text fallback.

## Recommended path
1. Public build ships **without** every red folder (exclude them in `package.json` `build.files`, e.g. `"!assets/news/**"`), and the public GitHub repo does not contain them either (or stays private and releases are installers only).
2. Add a documented "bring your own assets" step: the app already reads these folders by path, so let it also look in the user's data folder (`app.getPath('userData')/assets/...`) first. Users who own the game can drop in their own images; you never distribute them.
3. Replace the visuals you want to keep with things you can ship: your own screenshots-free icons for PlayStyles, text-only competition labels, generic silhouettes (or properly licensed / self-made headshots), and CC0 or self-drawn news art.
4. Write a short `CREDITS` / `LICENSE` file stating the sources and the disclaimer.
5. Get the Live Editor author's answer on the derived Lua scripts before release.
