# Quick Setup: FIFA Analytics (Windows only)

## Requirements

- EA FC 27 on Steam, build `1.0.141.12554`
- FC 27 Live Editor `v27.1.4`

> These versions must match exactly, or nothing works.

## Steps

1. **Pin the game version.** In Steam, go to FC 27 → Properties → Updates and choose "Only update this game when I launch it." A Steam patch will break Live Editor.
2. **Install Live Editor.**
   - Download v27.1.4 from xAranaktu's Patreon and extract it.
   - Check that `GAME_VER` in `le_offsets.json` matches your game build.
3. **Install the app.** Run `FIFA Analytics Setup <version>.exe` and choose "for me (user)". There's no auto-update, so to update, run the new installer over the old one.
4. **Launch the game via Live Editor's `Launcher.exe`**, not through Steam. Then load your Career Mode save.
5. **Bind the export script.**
   - In Live Editor's Lua Engine, add `export_all.lua`:
     `%LOCALAPPDATA%\Programs\FIFA Analytics\resources\app.asar.unpacked\assets\lua\export_all.lua`
   - Bind it to **F10**.
   - *Optional:* bind `player_editor_sync.lua` (same folder) to **F11** for the in-app player editor.
6. **Verify.** Press F10 in-game, open the app, and click **Refresh**. Your club and squad should appear on the Home tab.

## Troubleshooting

- **Crash after F10:** the game and Live Editor versions don't match.
- **No data in the app:** check for fresh `ea_fc_*.json` files in `C:\Users\Public\`. If they're missing, F10 isn't bound properly.

## Run from source (dev)

```bash
npm install
npm start       # run the app
npm test        # run tests
npm run dist    # build the installer
```

Your data lives in `%APPDATA%\fifa-analytics\companion.sqlite`.
