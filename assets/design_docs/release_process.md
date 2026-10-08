# Releasing the FC 27 app (and keeping FC 26 users safe)

## Why this is set up the way it is
Installed FC 26 apps (1.x) update themselves from the GitHub repo `mastroja/fifa-companion-app`: they install whatever its **latest published release** is. Publishing 27.0.0 there would put an FC 27 build on every FC 26 user's machine. That cannot be undone from here, because old installs run their old updater code. So the FC 27 app is a separate product:

| | FC 26 app (1.x) | FC 27 app (27.x) |
|---|---|---|
| Releases published to | `mastroja/fifa-companion-app` (frozen, `fc26-stable`) | `mastroja/fifa-analytics-fc27` (new repo, see below) |
| `appId` | `com.fifa.companion` | `com.fifa.companion.fc27` |
| Installer / install folder | `FIFA Analytics` | `FIFA Analytics FC27` (installs side by side) |
| Data folder (`%APPDATA%`) | `fifa-career-companion` | `fc27-career-companion` (FC 26 saves are copied in on first launch, see `js/legacy_data.js`) |

FC 26 installs keep looking at the old repo, whose latest release stays v1.9.2, so they never see an FC 27 build. The FC 27 app also refuses to download any update whose major version differs from its own (`setupAutoUpdater` in `main.js`).

## One-time setup
1. Create the releases repo (public, can be empty): `gh repo create mastroja/fifa-analytics-fc27 --public` (the name is set in `package.json` -> `build.publish.repo`; change both together if you prefer another name). Until it exists, `npm run release` fails with a 404 instead of publishing anywhere, which is the safe failure.
2. Set `GH_TOKEN` (a token with `repo` access to that repo) in the shell you release from.

## Every release
1. `npm test` and `npm run check`.
2. Version: `npm run bump -- minor` (large change) or `patch`; update `BUILD_DATE` in `js/license_config.js`.
3. `npm run release` builds the NSIS installer and uploads it plus `latest.yml` to the new repo. electron-builder creates the release as a **draft**: open it on GitHub, add notes, then **Publish**. Only published, non-pre-release releases are seen by the updater.
4. Never publish an FC 27 release to `mastroja/fifa-companion-app`.

## Things to know
- Both apps read the same export files (`C:\Users\Public\ea_fc_*.json`) and Live Editor binds one script path per game, so run only the app that matches the game you are playing.
- If a future FC 28 app is made, give it the same treatment (new `appId`, `productName`, package `name`, publish repo, major 28).
