
## 13. Implementation status (2026-10-07)

Built: `assets/lua/export_player_editor.lua`, `assets/lua/apply_player_edits.lua`, `player_editor.js`
(backend/IPC), `player_editor_ui.js` (Edit-player dialog), `scripts/build_customization_catalog.js`
(-> `assets/player_customization/catalog.json`), tables `player_editor_state` + `player_edits`.
Deviations from the design above: state is stored as JSON (not explicit columns); the editor is a dialog
opened from an "Edit player" button on the profile (fields are unlocked inside it) rather than unlocking
the profile page in place; eyebrows are a numeric code input (no preset list yet).
Not built yet: Phase B apply hotkey + Settings opt-in; folding the export into the F10 export.

### Update (later the same day): one-key sync, names, redesign
- `export_player_editor.lua` + `apply_player_edits.lua` were merged into **`assets/lua/player_editor_sync.lua`**
  (apply queued edits, then export). Bound to its own hotkey **F11**; F10 stays read-only. The app presses F11
  when the editor opens and on Save (`triggerLiveEditorRefresh(isManual, key)` in `main.js`), and waits for the
  export / write-log file to change. There is no other trigger channel into Live Editor (it only has hotkeys and
  career-mode event handlers, which do not fire on a button press).
- Colour, accessory, body-type and skin-tone names come from Live Editor's own `loc/eng_us/localize.json`
  (saved to `assets/data/editor_labels.json`). Hair colours 0-14 are named; 15-27 appear in game data but have no
  localised name and are shown as "Custom N".
- Editor UI is now a tabbed dialog (Look, Body, Ratings, Positions, Playstyles, History) with swatch pickers.
- Exports are attributed to the save whose `save_uid` matches (not the app's active save).

