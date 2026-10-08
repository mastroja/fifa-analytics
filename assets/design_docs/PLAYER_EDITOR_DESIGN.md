# Player Editor — Design (DRAFT rev 2, for approval)

Status: design only, no app code written. Target: FC 27, Live Editor v27.1.2 (v2 `LE.db` API).
Scope: **generic / regen / academy players only.** Real (scanned) players never get an Edit button.
Editor covers: **appearance, attributes, positions, playstyles, height/weight.**

Rev 2 changes: Edit-player unlock + Save flow that triggers the Lua writer; attributes, positions and
playstyles added; height/weight follow the app's metric/imperial setting; skin tone + complexion + type.

## 1. What the probe established (2026-10-07, `LE_FC27_appearance_report.txt`)

- Academy regens: `headtypecode=0`, `headclasscode=1`, `hashighqualityhead=0`.
  `headassetid` (460000–471459) is a row in **`career_youth_skins`** (skin detail only).
  They are in none of the `highres_/dc_/cp_/slc_/spa_` morph tables; `basehead_*` is keyed by
  `headtypecode` and every regen shares row 0. **Face shape is not stored per player → not editable.**
- Editable appearance columns on `players` (observed ranges, 21,640 players):

| Column | Observed | Notes |
|---|---|---|
| skintonecode | 10,20…100 (+1 outlier 42) | game scale is 1–100; 10 lightest → 100 darkest |
| skincomplexion | 1–10 | separate second skin control |
| skintypecode | 0–7 | 87% are 0; "advanced" control |
| hairtypecode | 541 distinct, 0–2013 | image-backed subset, §5 |
| haircolorcode | 0–27 (gaps) | |
| facialhairtypecode | 81 distinct, 0–304 | separate id space from hair |
| facialhaircolorcode | 0–27 (gaps) | |
| eyecolorcode | 1–10 | |
| eyedetail | 0–6 | |
| eyebrowcode | 443 distinct, packed numbers (e.g. 240302) | opaque preset, §6 |
| accessorycode1–4 | ~12 ids in use (6–9,16,22–27) | §6 |
| accessorycolourcode1–4 | 0–12, 99 | |
| bodytypecode | 1–10 (higher = real-player specials) | |
| height / weight | 151–210 cm / 45–105 kg | stored metric in the game, §8 |

- **Out of scope (constant 0 for every player):** `hairstylecode`, `sideburnscode`, all `tattoo*`,
  `headvariation`. Tattoos live elsewhere; revisit only with a new probe.
- **To verify before building:** `schema.sql` documents `players.skintone_code` as "1–10", but the game
  column is 10–100 (step 10). Check how `export_*.lua` / `main.js` populate it (divide by 10?) so the
  editor, the hair-category filter and headshot bucketing agree. Editor writes the game's native value.

## 2. Architecture and the Edit → Save flow

No live RPC into Live Editor exists. Two proven channels: (a) the app focuses the game window and sends
a hotkey (`triggerLiveEditorRefresh` in `main.js`, F10 → `export_all.lua`), and (b) a JSON file that a
Lua script reads (`connected_career/apply_sync_updates.lua`). The editor combines them:

```
 Player page: [Edit player] ─▶ fields unlock ─▶ user edits ─▶ [Save] / [Cancel]
   Save: write player_edits row + C:\Users\Public\ea_fc_player_edits_pending.json
     Phase A (first): user runs assets/lua/apply_player_edits.lua by hand in Live Editor
     Phase B (after it has run cleanly many times, opt-in in Settings): the app focuses the game and
       sends a dedicated apply hotkey (default F9, configurable; user binds apply_player_edits.lua to it)
   Lua: validate ─▶ write ─▶ read-back ─▶ ea_fc_player_edits_write_log.json
   App: sees the log (chokidar) ─▶ marks edits applied/failed ─▶ triggers the normal F10 re-sync
```

- The apply script is **never bound to F10** (F10 stays read-only). It gets its own hotkey, enabled only
  after the user opts in — honouring the data-safety rule that write scripts run manually first.
- If the game can't be focused or isn't in career, Save still queues the edit and the UI says
  "Queued — run the apply script" instead of "Applied". Nothing is lost.
- Edit mode is per player and non-destructive: Cancel discards; unchanged fields are never sent.

Safety: only the `players` table is written (already iterated every sync by `export_squad.lua`);
hard cap 25 players/run; `pcall` around every read/write; log flushed per player; abort if
`not IsInCM()`; per-player abort if current game values ≠ the edit's `old` values (state drifted).

## 3. Data model (SQLite)

`CREATE TABLE IF NOT EXISTS` in `schema.sql` plus `ALTER TABLE` try/catch migrations in `main.js`
(existing pattern, ~line 137) because user DBs keep stale schemas.

```sql
-- Latest appearance/body read from the game, one row per player per save.
CREATE TABLE IF NOT EXISTS player_appearance (
    player_id INTEGER NOT NULL,
    save_id   INTEGER NOT NULL,
    editable  INTEGER NOT NULL DEFAULT 0,   -- 1 = generic/regen (hashighqualityhead=0)
    skintonecode INTEGER, skincomplexion INTEGER, skintypecode INTEGER,
    hairtypecode INTEGER, haircolorcode INTEGER,
    facialhairtypecode INTEGER, facialhaircolorcode INTEGER,
    eyecolorcode INTEGER, eyedetail INTEGER, eyebrowcode INTEGER,
    accessorycode1 INTEGER, accessorycode2 INTEGER, accessorycode3 INTEGER, accessorycode4 INTEGER,
    accessorycolourcode1 INTEGER, accessorycolourcode2 INTEGER,
    accessorycolourcode3 INTEGER, accessorycolourcode4 INTEGER,
    bodytypecode INTEGER, height_cm INTEGER, weight_kg INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (player_id, save_id),
    FOREIGN KEY(player_id) REFERENCES players(player_id)
);

-- One row per Save (any mix of appearance / attributes / positions / playstyles / body);
-- doubles as undo history.
CREATE TABLE IF NOT EXISTS player_edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    save_id   INTEGER NOT NULL,
    old_json  TEXT NOT NULL,   -- {game_column: value} before — changed columns only
    new_json  TEXT NOT NULL,   -- {game_column: value} requested — changed columns only
    status    TEXT NOT NULL DEFAULT 'queued',  -- queued | applied | failed | undone
    error     TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    applied_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_player_edits_player ON player_edits(player_id, save_id);
```

Attributes, positions and playstyles already live in the existing synced player data; the editor reads
them from there and stores only the diff in `player_edits` (game column names as keys, so the Lua side
needs no translation). `editable` is derived on export (`hashighqualityhead = 0` and a generic-range
`headassetid`); the IPC handler and the Lua script both re-check it.

## 4. Editable fields beyond appearance

**Attributes.** Same raw-field mechanism as `apply_sync_updates.lua`: `SetRecordFieldValue` on the
`players` row, plus `PlayerSetValueInDevelopementPlan` when the player has a development plan. Range 1–99.
**Overall is computable (probe result, 2026-10-07):** `overallrating = round(Σ weight% × attribute) + modifier`,
using the game's own `attributeprefpositionformula` weights for the player's `preferredposition1`. Fitted on
315 players with `modifier = 0`: 98.7% exact, 100% within 1. Players with `modifier` 1/2/3 sit about
+1/+2/+3 above the formula (the modifier is added on top). The formula + attribute order is stored in
`assets/data/overall_formula.json`. Consequences:
- The editor shows a **live "Overall" that updates as attributes change**, computed in the app, and writes
  `overallrating` along with the attributes (still an editable override; potential stays a manual field).
- **Do not clear `modifier`** (the legacy sync script sets it to 0, which would lower the overall by the
  modifier). Keep the existing modifier so the displayed overall stays consistent.
- Only the position-1 formula is used (matches how the stored overall behaves); the Lua script re-reads
  `overallrating` after writing and logs a mismatch against the app's value.

**Positions.** `preferredposition1` (primary) and `preferredposition2..6` (alternates, `-1` = unset),
using the same position-id numbering the app already uses (`position_id`, `alt_positions`). UI: primary
dropdown + up to five alternate chips; Lua rejects duplicates and ids outside the known set.

**Playstyles.** Bitmasks on `players`: `trait1` / `trait2` (base) and `icontrait1` / `icontrait2`
(PlayStyle+). Bit tables exist in `assets/lua/export_all.lua` (`PLAYSTYLE_BITS_1/2`) and Live Editor's
`playstyles_enum.lua`; the build step generates `playstyles.json` from them. **Probe result (21,640
players):**
- A PlayStyle+ is stored **only** in `icontrait`; its bit is **not** set in `trait` (all 184 PlayStyle+
  players "violate" the subset rule — it is exclusive, not additive). So a playstyle has three states:
  none / base (`trait` bit) / PlayStyle+ (`icontrait` bit, `trait` bit cleared).
- **At most 1 PlayStyle+ per player** (max observed 1). Base playstyles: max 9 per player.
- `trait1`/`icontrait1` use all 30 known bits; `trait2` uses bits up to 6975 and `icontrait2` up to 63
  (second group: 13 and 6 bits respectively). No unknown bits.
- Goalkeepers carry playstyles too (888 of 2,434), so no GK special-casing.
UI: grid of playstyle tiles (none / base / PlayStyle+), the UI enforces ≤1 PlayStyle+ (warn above ~9 base).
The Lua writer enforces the same and rejects a bit set in both fields. The existing
`player_manual_playstyles` table is a manual-tag feature for real players and stays separate.

**Body.** Height/weight written as cm/kg integers (§8).

## 5. Reference images

- Source: `assets/player_customization/` — `hair/hair_cat{1,2,3}[_short|_med|_long]/`,
  `facial_hair/facial_hair_{short,med,long}/`, plus uncategorised
  `hair/etc/FC26_Hair_Database` (280) and `FC26_FacialHair_Database` (47). Files are
  `hair_id_NNNN.png`, 250×250, NNNN = `hairtypecode` / `facialhairtypecode` (verified for 12/13
  academy hair ids).
- `scripts/build_customization_catalog.js` generates `assets/player_customization/catalog.json`:
  `{ hair: [{id, file, cat: 1|2|3|null, length: short|med|long|null}], facialHair: [...] }`. The picker
  reads the catalog; no folder scanning at runtime. Duplicate ids: category folder wins over `etc`
  (reported by the script).
- cat1 = light tones, cat2 = dark tones, cat3 = neutral. Picker defaults to the category matching
  `skintonecode` (≤40 → cat1+cat3, ≥70 → cat2+cat3, middle → all) with a "show all" toggle;
  categories are guidance, not a restriction (probe found tone 100 with a cat1 style).
- Hair ids in use with **no image** (e.g. 648): "No preview — #648" tile, still selectable.
- `hair_cat4` does not exist yet; the catalog accepts any `cat` number if added.
- Images must be included in the `electron-builder` `files` config (check `package.json`).

## 6. Decisions (defaults chosen — change before approval if you disagree)

| Question | Default |
|---|---|
| Which hair ids are offered | Image-backed ids + the player's current id; "show unlisted ids" toggle exposes every id seen in `players`. |
| Eyebrows | Opaque presets: the 443 values seen on generic players, no decoding. |
| Accessories | Only ids observed in `players` (6–9,16,22–27); labelled "Accessory A–D" until slot meaning is verified in game; colour 0–12 / 99. |
| Skin | Three controls: Skin tone (10 steps, native 10–100), Complexion (1–10), Skin type (0–7, under "Advanced"). |
| Scope of attributes/positions/playstyles | Same as appearance: generic/regen/academy only. (Say so if you want these editable for any player.) |
| Overall / potential | Overall is auto-computed from attributes (formula in §4, modifier preserved) and shown live; both overall and potential remain manually overridable. |

## 7. UI (index.html / app.js)

- Player page header: **Edit player** button (only when `editable = 1`). Click → page enters edit mode:
  inputs/pickers unlock, a sticky bar shows **Save** and **Cancel** plus a live diff (old → new).
- Edit-mode sections: Appearance (skin, hair grid + colour, facial hair grid + colour, eyes, accessories,
  body type), Body (height/weight), Attributes (grouped sliders/number boxes), Positions, Playstyles.
- After Save: status chip per edit (Queued / Applying / Applied / Failed + reason). Edit-history list per
  player with **Undo** (queues a swapped edit; original → `undone`).
- No head preview exists for generics; the panel says "confirm final look in game".

## 8. Height / weight and the units setting

- The app already has a per-machine setting (`currentUnits`, `'imperial'` | `'metric'`, key
  `displayUnits` in `localStorage`, `app.js` ~580 and ~4497) with `formatHeight*/formatWeight*` helpers.
  The editor **reuses `currentUnits`** and re-renders when it changes (same re-open hook used for
  currency/units at ~1426).
- **Storage and Lua always use game units: integer cm and kg.** Only the inputs convert.
  - Imperial: height = feet + inches inputs (1 in steps), weight = lbs input.
    cm = round(total inches × 2.54); kg = round(lbs ÷ 2.20462262).
  - Metric: cm / kg inputs.
  - A small caption always shows the other unit's equivalent ("= 178 cm") so nothing is hidden.
- Limits are expressed in the displayed unit and derived from the cm/kg range (151–210 cm ≈ 4'11"–6'11";
  45–105 kg ≈ 99–231 lbs); clamped after conversion.
- Imperial inputs can't hit every cm (1 in = 2.54 cm), so the app **only sends height/weight if the user
  changed that field**; an untouched value is never round-tripped through imperial and drifted.
- Display elsewhere in the app keeps using the existing formatters; the edit panel uses the same ones.

## 9. IPC / main.js

`get-player-edit-state(playerId, saveId)`, `queue-player-edit(payload)`, `get-player-edits(playerId,
saveId)`, `undo-player-edit(editId)`, `get-customization-catalog()`, `trigger-apply(isManual)`
(Phase B: same PowerShell focus + `SendKeys` approach as `triggerLiveEditorRefresh`, sending the apply
hotkey from Settings; refuses unless the opt-in is on). New path constants next to the existing
`C:\Users\Public\ea_fc_*` ones; the existing chokidar watcher picks up the write log.

## 10. Lua scripts (under `assets/lua/`)

1. **Export (read):** add the §3 columns + `editable` to the squad/youth export, after a standalone test
   (like `inspect_fc27_appearance.lua`) and before touching the F10-bound `export_all.lua`.
2. **`apply_player_edits.lua` (write):** read queue → ≤25 edits → verify generic → compare current to
   `old` (skip on drift) → whitelist + range check every column → write → attribute extras
   (dev-plan call, `modifier = 0`) → read back → log `ok / mismatch / skipped` per player and column.
   Whitelist is checked against `t.fields` at runtime; missing columns are skipped with a log line.
3. **`inspect_fc27_playstyle_rules.lua` (probe) — DONE:** results in §4.
4. **`inspect_fc27_overall_recalc.lua` (probe) — DONE:** results in §4; formula in `assets/data/overall_formula.json`.

## 11. Build order and verification

1. Verify/fix `skintone_code` scaling (§1).
2. Probes in §10 items 3–4 — DONE (2026-10-07).
3. Standalone Lua export test of the new columns → inspect JSON.
4. Schema + migrations + IPC read path; `catalog.json` + `playstyles.json` build scripts.
5. `apply_player_edits.lua`; test **manually on one** academy player (hair colour, then an attribute,
   then a playstyle) → confirm in game → F10 re-sync shows it → undo works.
6. UI: Edit/Save/Cancel flow, units-aware body inputs; widen to all fields.
7. Phase B: apply hotkey + Settings opt-in. Only after repeated clean manual runs.
8. Update README/memory; document the new scripts in `assets/lua/fc27_probes/README.md`.

## 12. Risks / open items

- Only attribute writes have been proven in this project; confirm appearance, position and playstyle
  writes actually take effect (the game may cache faces/roles until the save reloads).
- Position-set limits (how many alternates the game accepts) are unverified; the writer logs and skips invalid sets.
- The overall formula is 98.7% exact, not 100%; ~1% of players differ by 1 (rounding/other terms). The Lua read-back reports mismatches.
- Sending an automated hotkey that runs a *write* script is riskier than the read-only F10 refresh;
  hence the opt-in, the focus check, and the Lua-side drift check.
- `career_youth_skins` freckles/moles are shared per-asset rows and are not editable here.
- FC 27 Live Editor updates may rename columns; whitelist checks are runtime, not hard-coded.
