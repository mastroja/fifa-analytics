// node scripts/license/test_license.js — exercises sign / verify / expiry / build limit / tampering and the manager.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { signToken, verifyToken, create } = require('../../js/license');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' });

// verifyToken
let t = signToken({ sub: 'a' }, priv);
assert.strictEqual(verifyToken(t, pub).pro, true, 'plain key unlocks');
assert.strictEqual(verifyToken(t, other).valid, false, 'wrong public key rejected');
const [body, sig] = t.split('.');
const forged = Buffer.from(JSON.stringify({ v: 1, plan: 'pro', sub: 'evil', exp: '2999-01-01' })).toString('base64').replace(/=+$/, '') + '.' + sig;
assert.strictEqual(verifyToken(forged, pub).valid, false, 'edited payload rejected');
assert.strictEqual(verifyToken('garbage', pub).valid, false);
t = signToken({ sub: 'a', exp: '2026-01-01T00:00:00Z' }, priv);
assert.strictEqual(verifyToken(t, pub, { now: '2026-06-01' }).pro, false, 'expired key does not unlock');
assert.strictEqual(verifyToken(t, pub, { now: '2025-12-01' }).pro, true, 'unexpired key unlocks');
t = signToken({ sub: 'a', maxBuild: '2026-12-31' }, priv);
assert.strictEqual(verifyToken(t, pub, { buildDate: '2026-10-01' }).pro, true, 'older build still covered');
assert.strictEqual(verifyToken(t, pub, { buildDate: '2027-02-01' }).pro, false, 'newer build not covered');

// manager
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
const cfg = { PUBLIC_KEY_PEM: pub, SERVER_URL: '', MEMBERSHIP_URL: '', BUILD_DATE: '2026-10-08', PRO_FEATURES: { 'player-editor': 'Editor' } };
let lic = create({ userDataPath: dir, config: cfg });
assert.strictEqual(lic.isPro('player-editor'), false, 'locked without a key');
assert.strictEqual(lic.isPro('squad'), true, 'unlisted features are free');
assert.strictEqual(lic.activate('nope').ok, false);
assert.strictEqual(lic.activate(signToken({ sub: 'a' }, priv)).ok, true);
assert.strictEqual(lic.isPro('player-editor'), true, 'unlocked after activation');
lic = create({ userDataPath: dir, config: cfg });                        // survives a restart
assert.strictEqual(lic.isPro('player-editor'), true, 'key persisted');
lic.clear();
assert.strictEqual(lic.isPro('player-editor'), false, 'cleared');
const off = create({ userDataPath: dir, config: { ...cfg, PUBLIC_KEY_PEM: '' } });
assert.strictEqual(off.isPro('player-editor'), true, 'licensing off = everything unlocked');

// Patreon membership parsing (server.js)
const { findActiveMembership } = require('./server');
const doc = (campaign, status, cents) => ({
  data: { type: 'user', id: '1', attributes: { full_name: 'Pat' }, relationships: { memberships: { data: [{ id: 'm1', type: 'member' }] } } },
  included: [{ type: 'member', id: 'm1', attributes: { patron_status: status, currently_entitled_amount_cents: cents }, relationships: { campaign: { data: { id: campaign, type: 'campaign' } } } }]
});
assert.strictEqual(findActiveMembership(doc('42', 'active_patron', 500), '42').active, true, 'active patron of my campaign');
assert.strictEqual(findActiveMembership(doc('42', 'former_patron', 0), '42').active, false, 'former patron');
assert.strictEqual(findActiveMembership(doc('99', 'active_patron', 500), '42').active, false, 'patron of a different campaign');
assert.strictEqual(findActiveMembership(doc('42', 'active_patron', 100), '42', 300).active, false, 'below the minimum pledge');
assert.strictEqual(findActiveMembership({ data: {}, included: [] }, '42').active, false, 'no memberships');
console.log('license tests passed');
