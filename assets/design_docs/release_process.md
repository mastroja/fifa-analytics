# Releasing the app

The app is **FIFA Analytics** (package `fifa-analytics`), published to GitHub releases of `mastroja/fifa-companion-app`. Installed copies update themselves from the latest published release, so shipping 27.x there moves everyone, including people still on the FC 26 (1.x) versions, onto the FC 27 build. That is the intended plan ("roll over FC 26"): the FC 26 line stays available on the `fc26-stable` branch and the old v1.x releases, but it gets no further updates.

## Every release
1. `npm test` and `npm run check`.
2. Version: `npm run bump -- minor` (large change) or `patch`; update `BUILD_DATE` in `js/license_config.js`.
3. Set `GH_TOKEN` (a token with `repo` access) and run `npm run release`. electron-builder uploads the NSIS installer and `latest.yml` as a **draft** release: add notes on GitHub and click **Publish**. The updater only sees published, non-pre-release releases.

## What carries over for people updating from the FC 26 versions
- Same `appId` and install folder, so the installer upgrades in place.
- The package was renamed `fifa-career-companion` -> `fifa-analytics`, which moves the data folder from `%APPDATA%\fifa-career-companion` to `%APPDATA%\fifa-analytics`. `js/legacy_data.js` copies the old saves across on the first launch (the old folder is left as a backup).
- Live Editor's F10 / F11 hotkeys keep pointing at the same install folder, but their game must be FC 27 now; an FC 26 save will not export correctly with these scripts.

## Heads-up for the release notes
Tell FC 26 players that this update is for FC 27 only, and that FC 26 is not supported by it. If you ever want a softer rollover, give FC 27 a new `appId` / `productName` / publish repo (see git history of this file for the setup that was tried).

## Updater requirements (found while testing the 27.0.3 installer)
- The update check is unauthenticated, so the releases repo **must be public**. `mastroja/fifa-companion-app` is currently private, so the packaged app logs `[AutoUpdater] Update check failed: 404` and never updates. Make the repo public, or publish releases to a separate public repo (change `build.publish`).
- Each release needs both the installer and `latest.yml` as assets (electron-builder uploads both with `npm run release`).
- A failed check is only a log line; it never blocks the app.

## Installer test checklist (done for 27.0.3)
Build with `npm run dist`; silent install (`/S /D=<folder>`), start menu and desktop shortcuts, uninstall registry entry, app starts and loads the migrated database, uninstall removes everything but the user's data folder. The installer is not code-signed, so Windows SmartScreen will warn on first run.
