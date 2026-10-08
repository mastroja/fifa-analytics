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
