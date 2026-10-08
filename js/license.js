// Pro licensing (main process). A license is a signed token — base64url(payload JSON) + "." + base64url(Ed25519
// signature of that first part) — checked offline against the public key in license_config.js. The app never holds the
// private key. Tokens come from one of two places:
//   - "Sign in with Patreon": the license server (tools/license/server.js) verifies the patron's membership with
//     Patreon and hands back a short-lived token, which the app renews in the background while the membership is active;
//   - a token pasted by hand (tools/license/issue-key.js), for lifetime keys, gifts and testing.
//
// Payload: { v:1, sub, plan:'pro', src:'patreon'|'manual', iat, exp?, maxBuild? }
//   exp       ISO date after which the token stops unlocking (monthly membership)
//   maxBuild  ISO date: the token keeps unlocking any build released on or before it (perpetual fallback)
//
// With no public key configured licensing is OFF and isPro() is always true.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const defaultConfig = require('./license_config');

const b64u = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signToken(payload, privateKeyPem) {
  const body = b64u(JSON.stringify({ v: 1, plan: 'pro', iat: new Date().toISOString(), ...payload }));
  const sig = crypto.sign(null, Buffer.from(body), crypto.createPrivateKey(privateKeyPem));
  return `${body}.${b64u(sig)}`;
}

// Pure: no I/O, so it can be tested. Returns { valid, pro, payload, reason }.
function verifyToken(token, publicKeyPem, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const buildDate = opts.buildDate ? new Date(opts.buildDate) : null;
  try {
    const parts = String(token || '').trim().split('.');
    if (parts.length !== 2) return { valid: false, pro: false, reason: 'Not a license key.' };
    const ok = crypto.verify(null, Buffer.from(parts[0]), crypto.createPublicKey(publicKeyPem), fromB64u(parts[1]));
    if (!ok) return { valid: false, pro: false, reason: 'This key is not valid.' };
    const payload = JSON.parse(fromB64u(parts[0]).toString('utf8'));
    if (payload.v !== 1) return { valid: false, pro: false, reason: 'Unsupported key version.' };
    if (payload.exp && now > new Date(payload.exp)) return { valid: true, pro: false, payload, reason: 'Your membership key has expired.' };
    if (payload.maxBuild && buildDate && buildDate > new Date(payload.maxBuild)) {
      return { valid: true, pro: false, payload, reason: 'This key covers earlier versions only.' };
    }
    return { valid: true, pro: true, payload, reason: '' };
  } catch (e) {
    return { valid: false, pro: false, reason: 'Could not read this key.' };
  }
}

// deps: { userDataPath, openExternal(url), fetch?, config? }
function create(deps) {
  const config = deps.config || defaultConfig;
  const doFetch = deps.fetch || (typeof fetch === 'function' ? fetch : null);
  const file = path.join(deps.userDataPath, 'license.json');
  let stored = { token: '', session: '' };
  try { stored = { ...stored, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* no license yet */ }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(stored)); } catch (e) { /* ignore */ } };
  const enforced = () => !!config.PUBLIC_KEY_PEM;
  let loginCancelled = false;

  function status() {
    if (!enforced()) return { enforced: false, pro: true, source: 'dev', reason: 'Licensing is not configured in this build.' };
    if (!stored.token) return { enforced: true, pro: false, source: 'none', reason: '' };
    const v = verifyToken(stored.token, config.PUBLIC_KEY_PEM, { buildDate: config.BUILD_DATE });
    return {
      enforced: true, pro: v.pro, valid: v.valid, reason: v.reason,
      source: v.payload ? v.payload.src || 'manual' : 'invalid',
      expires: v.payload && v.payload.exp ? v.payload.exp : null,
      maxBuild: v.payload && v.payload.maxBuild ? v.payload.maxBuild : null,
      hasSession: !!stored.session
    };
  }
  const isPro = feature => {
    if (!(feature in config.PRO_FEATURES)) return true;
    return status().pro;
  };
  const info = () => ({ features: config.PRO_FEATURES, membershipUrl: config.MEMBERSHIP_URL, patreonLogin: !!config.SERVER_URL, ...status() });

  function activate(token) {
    if (!enforced()) return { ok: false, error: 'Licensing is not configured in this build.', ...status() };
    const v = verifyToken(token, config.PUBLIC_KEY_PEM, { buildDate: config.BUILD_DATE });
    if (!v.valid) return { ok: false, error: v.reason, ...status() };
    stored = { token: String(token).trim(), session: '' };
    save();
    return { ok: v.pro, error: v.pro ? '' : v.reason, ...status() };
  }
  function clear() { stored = { token: '', session: '' }; save(); return status(); }

  async function getJson(url) {
    const res = await doFetch(url, { headers: { 'User-Agent': 'career-companion-license' } });
    return res.json();
  }

  // Opens the browser on the license server's Patreon login page and waits for the result (polling, so no custom URL
  // protocol or local web server is needed). Resolves with the new status, or { error }.
  async function patreonLogin() {
    if (!enforced() || !config.SERVER_URL || !doFetch) return { error: 'Sign in with Patreon is not set up in this build.' };
    loginCancelled = false;
    const state = crypto.randomBytes(16).toString('hex');
    deps.openExternal(`${config.SERVER_URL}/login?state=${state}`);
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline && !loginCancelled) {
      await new Promise(r => setTimeout(r, 2000));
      let r;
      try { r = await getJson(`${config.SERVER_URL}/poll?state=${state}`); } catch (e) { continue; }
      if (r && r.status === 'ok') {
        const v = verifyToken(r.token, config.PUBLIC_KEY_PEM, { buildDate: config.BUILD_DATE });
        if (!v.valid) return { error: v.reason };
        stored = { token: r.token, session: r.session || '' };
        save();
        return { ok: true, ...status() };
      }
      if (r && r.status === 'denied') return { error: r.message || 'You are not an active member.', notMember: true };
    }
    return { error: loginCancelled ? 'Sign-in cancelled.' : 'Sign-in timed out.' };
  }
  function cancelLogin() { loginCancelled = true; }

  // Background renewal of a Patreon-issued token. Offline or a server hiccup changes nothing; the existing token
  // simply keeps working until its own expiry, which is the offline grace period.
  async function renew() {
    if (!enforced() || !config.SERVER_URL || !stored.session || !doFetch) return status();
    try {
      const r = await getJson(`${config.SERVER_URL}/renew?session=${encodeURIComponent(stored.session)}`);
      if (r && r.status === 'ok' && verifyToken(r.token, config.PUBLIC_KEY_PEM).valid) { stored.token = r.token; save(); }
    } catch (e) { /* offline: keep what we have */ }
    return status();
  }

  return { status, isPro, info, activate, clear, patreonLogin, cancelLogin, renew };
}

module.exports = { create, signToken, verifyToken };
