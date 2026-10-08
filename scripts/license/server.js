// License server for "Sign in with Patreon". Run it somewhere with HTTPS (a small VPS, Render, Fly, a Cloudflare worker
// ported from this file...). The desktop app never sees the Patreon client secret or your private signing key; both live
// only here. No npm dependencies.
//
// Environment:
//   PATREON_CLIENT_ID, PATREON_CLIENT_SECRET   from https://www.patreon.com/portal/registration/register-clients
//   PATREON_CAMPAIGN_ID                        your campaign id (members of any other campaign do not count)
//   BASE_URL                                   public URL of this server, e.g. https://license.example.com
//                                              (register BASE_URL + /callback as the redirect URI in Patreon)
//   PRIVATE_KEY_PATH                           the PEM written by scripts/license/gen-keys.js
//   MIN_CENTS (optional, default 1)            minimum currently-entitled pledge to count as Pro
//   TOKEN_DAYS (optional, default 35)          how long an issued token works if the app cannot reach this server
//   DATA_FILE (optional, default ./license-data.json)  Patreon refresh tokens for renewals
//   PORT (optional, default 8787)
//
// Flow: app opens /login?state=S in the browser -> Patreon -> /callback (checks the membership, stores the result under
// S) -> app polls /poll?state=S and receives a signed token plus a session id; later the app calls /renew?session=ID,
// which re-checks the membership with the stored refresh token and issues a fresh token, or says "lapsed".
//
// Patreon API calls follow https://docs.patreon.com (OAuth2 v2: authorize, token exchange with the client secret,
// GET /api/oauth2/v2/identity?include=memberships with the identity.memberships scope). Verify the field names against
// the current docs before going live.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');
const { signToken } = require('../../js/license');

// Pure: given Patreon's identity response (JSON:API) returns { active, cents, name } for the member record that belongs
// to `campaignId`. A patron of some other campaign must not unlock anything.
function findActiveMembership(identity, campaignId, minCents) {
  const members = (identity.included || []).filter(x => x.type === 'member');
  const mine = members.find(m => m.relationships && m.relationships.campaign && m.relationships.campaign.data
    && String(m.relationships.campaign.data.id) === String(campaignId));
  const name = identity.data && identity.data.attributes && identity.data.attributes.full_name || '';
  if (!mine) return { active: false, cents: 0, name };
  const a = mine.attributes || {};
  const cents = Number(a.currently_entitled_amount_cents || 0);
  return { active: a.patron_status === 'active_patron' && cents >= (minCents || 1), cents, name, memberId: mine.id };
}

function request(urlString, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const req = https.request({ method, hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'career-companion-license-server', ...headers } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data) }); } catch (e) { resolve({ status: res.statusCode, json: null, raw: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function start() {
  const env = process.env;
  for (const k of ['PATREON_CLIENT_ID', 'PATREON_CLIENT_SECRET', 'PATREON_CAMPAIGN_ID', 'BASE_URL', 'PRIVATE_KEY_PATH']) {
    if (!env[k]) { console.error(`Missing environment variable ${k}`); process.exit(1); }
  }
  const privateKey = fs.readFileSync(env.PRIVATE_KEY_PATH, 'utf8');
  const redirectUri = env.BASE_URL.replace(/\/$/, '') + '/callback';
  const minCents = Number(env.MIN_CENTS || 1);
  const tokenDays = Number(env.TOKEN_DAYS || 35);
  const dataFile = env.DATA_FILE || path.join(process.cwd(), 'license-data.json');
  let data = { sessions: {} };
  try { data = { sessions: {}, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) }; } catch (e) { /* first run */ }
  const persist = () => fs.writeFileSync(dataFile, JSON.stringify(data));
  const pending = new Map(); // state -> { status, token, session, message, at }

  const issue = (sub, extra) => signToken({ sub, src: 'patreon', exp: new Date(Date.now() + tokenDays * 86400000).toISOString(), ...extra }, privateKey);

  async function tokenRequest(params) {
    const body = new URLSearchParams({ client_id: env.PATREON_CLIENT_ID, client_secret: env.PATREON_CLIENT_SECRET, ...params }).toString();
    const r = await request('https://www.patreon.com/api/oauth2/token', {
      method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    });
    return r.json;
  }
  async function identity(accessToken) {
    const q = 'include=memberships&fields%5Bmember%5D=patron_status,currently_entitled_amount_cents&fields%5Buser%5D=full_name';
    const r = await request(`https://www.patreon.com/api/oauth2/v2/identity?${q}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    return r.json || {};
  }

  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const page = (res, msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;max-width:480px;margin:60px auto"><h2>${msg}</h2><p>You can close this window and go back to the app.</p></body>`); };

  http.createServer(async (req, res) => {
    const u = new URL(req.url, env.BASE_URL);
    try {
      if (u.pathname === '/login') {
        const state = u.searchParams.get('state') || '';
        if (!/^[a-f0-9]{16,64}$/.test(state)) return send(res, 400, { error: 'bad state' });
        const q = new URLSearchParams({ response_type: 'code', client_id: env.PATREON_CLIENT_ID, redirect_uri: redirectUri, scope: 'identity identity.memberships', state });
        res.writeHead(302, { Location: `https://www.patreon.com/oauth2/authorize?${q}` }); return res.end();
      }
      if (u.pathname === '/callback') {
        const state = u.searchParams.get('state') || '';
        const code = u.searchParams.get('code');
        if (!code || !state) return page(res, 'Sign-in was cancelled.');
        const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
        if (!t || !t.access_token) { pending.set(state, { status: 'denied', message: 'Patreon did not accept the sign-in.', at: Date.now() }); return page(res, 'Sign-in failed.'); }
        const m = findActiveMembership(await identity(t.access_token), env.PATREON_CAMPAIGN_ID, minCents);
        if (!m.active) { pending.set(state, { status: 'denied', message: 'No active membership was found for this Patreon account.', at: Date.now() }); return page(res, 'No active membership found.'); }
        const session = crypto.randomBytes(24).toString('hex');
        data.sessions[session] = { refresh_token: t.refresh_token, name: m.name, created: new Date().toISOString() };
        persist();
        pending.set(state, { status: 'ok', token: issue(m.memberId || m.name), session, at: Date.now() });
        return page(res, `Thanks${m.name ? ', ' + String(m.name).replace(/[<>&]/g, '') : ''} — you're signed in.`);
      }
      if (u.pathname === '/poll') {
        const state = u.searchParams.get('state') || '';
        const p = pending.get(state);
        if (!p) return send(res, 200, { status: 'pending' });
        pending.delete(state); // one-time
        return send(res, 200, p);
      }
      if (u.pathname === '/renew') {
        const s = data.sessions[u.searchParams.get('session') || ''];
        if (!s) return send(res, 200, { status: 'unknown' });
        const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh_token });
        if (!t || !t.access_token) return send(res, 200, { status: 'error' });
        s.refresh_token = t.refresh_token || s.refresh_token; persist();
        const m = findActiveMembership(await identity(t.access_token), env.PATREON_CAMPAIGN_ID, minCents);
        return send(res, 200, m.active ? { status: 'ok', token: issue(m.memberId || m.name) } : { status: 'lapsed' });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      console.error(e);
      send(res, 500, { error: 'server error' });
    }
  }).listen(Number(env.PORT || 8787), () => console.log(`License server on :${env.PORT || 8787}`));

  setInterval(() => { for (const [k, v] of pending) if (Date.now() - (v.at || 0) > 10 * 60 * 1000) pending.delete(k); }, 60 * 1000).unref();
}

module.exports = { findActiveMembership };
if (require.main === module) start();
