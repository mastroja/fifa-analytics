// Issues a manual license key (lifetime keys, gifts, testers). Patreon members get theirs automatically from the
// license server instead.
//   node scripts/license/issue-key.js --sub "alice@example.com" [--days 30] [--max-build 2027-12-31] [--key path/to/private.pem]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { signToken } = require('../../js/license');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.sub) { console.error('Usage: node scripts/license/issue-key.js --sub <who> [--days N] [--max-build YYYY-MM-DD] [--key private.pem]'); process.exit(1); }
const keyPath = args.key || path.join(os.homedir(), '.career-companion-license', 'private.pem');
const payload = { sub: args.sub, src: 'manual' };
if (args.days) payload.exp = new Date(Date.now() + Number(args.days) * 86400000).toISOString();
if (args['max-build']) payload.maxBuild = args['max-build'];
console.log(signToken(payload, fs.readFileSync(keyPath, 'utf8')));
