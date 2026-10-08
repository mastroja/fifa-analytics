// Generates the Ed25519 key pair used to sign licenses. The PRIVATE key is written outside the repo
// (default: ~/.career-companion-license/private.pem, or pass a folder) and must never be committed or shipped.
// Paste the printed PUBLIC key into js/license_config.js (PUBLIC_KEY_PEM).
//   node scripts/license/gen-keys.js [folder]
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = process.argv[2] || path.join(os.homedir(), '.career-companion-license');
const target = path.join(dir, 'private.pem');
if (fs.existsSync(target)) { console.error(`Refusing to overwrite ${target}. Move it first if you really want a new key pair (old keys stop working).`); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
console.log(`Private key written to ${target}  (back it up; keep it secret)\n`);
console.log('Public key — paste into js/license_config.js as PUBLIC_KEY_PEM:\n');
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
