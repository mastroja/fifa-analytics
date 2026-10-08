# Pro licensing

One app, Pro features unlock. Licensing is **off** (everything unlocked, the Settings > Pro section hidden) until a public key is put in `js/license_config.js`, so nothing changes for a development build.

## Pieces
- `js/license.js` (main process): signs / verifies tokens (Ed25519, Node `crypto`, no dependencies), stores the token in `userData/license.json`, runs the Patreon sign-in poll and background renewal.
- `js/license_config.js`: public key, license server URL, membership URL, build date, and the list of Pro features (`PRO_FEATURES`; anything not listed is free).
- `js/license_ui.js` (renderer): `License.isPro(feature)`, `License.upsell(feature)`, 🔒 markers (`data-pro="feature"` + `.pro-locked`), the upgrade dialog and the Settings > Pro section.
- `scripts/license/gen-keys.js` / `issue-key.js` / `test_license.js` / `server.js`.

## Token
`base64url(payload).base64url(signature)`; payload `{ v, sub, plan, src: 'patreon'|'manual', iat, exp?, maxBuild? }`. `exp` = membership period; `maxBuild` = the key keeps unlocking any build released on or before that date (perpetual fallback), compared with `BUILD_DATE` in the config. **Update `BUILD_DATE` on every release.**

## Sign in with Patreon
Patreon's token exchange needs the client secret, so it runs on a small server (`scripts/license/server.js`), never in the app: app opens `SERVER_URL/login?state=S` in the browser -> Patreon -> server `/callback` checks that the user is an `active_patron` of **your** campaign -> app polls `/poll?state=S` and gets a signed 35-day token plus a session id -> every 12 h (and at launch) the app calls `/renew?session=ID`; if the membership lapsed the token simply runs out. Offline, the existing token keeps working until `exp`.
Server setup: register a client at Patreon (redirect URI = `BASE_URL/callback`, scopes `identity identity.memberships`), set `PATREON_CLIENT_ID`, `PATREON_CLIENT_SECRET`, `PATREON_CAMPAIGN_ID`, `BASE_URL`, `PRIVATE_KEY_PATH`, run `node scripts/license/server.js` behind HTTPS. Not yet run against the real Patreon API: check the field names against docs.patreon.com first.

## Going live
1. `node scripts/license/gen-keys.js` (private key goes to `~/.career-companion-license/`, outside the repo; back it up).
2. Paste the public key into `PUBLIC_KEY_PEM`; set `SERVER_URL` and `MEMBERSHIP_URL`.
3. Hand out manual keys with `node scripts/license/issue-key.js --sub someone --max-build 2027-12-31`.

## What is gated (checked in the UI and, for the editor and watchlist, in the main-process handlers)
youth-mode (Youth Mode enable, Challenge dashboard) · academy-tracker (Academy view, watchlist writes) · depth-extras (Reserves, custom lineups, All-Time XI, what-if) · player-editor (the Edit player button and `queue-player-edit`). If the license lapses while a Pro lineup or the Academy view is open, the app falls back to Starting XI / List.
