// node scripts/bump-version.js minor|patch|<x.y.z>
// Version scheme: 27.minor.patch — the major number is the game (FC 27). A large change (a new feature or a rework)
// bumps the minor (27.1.0); a smaller one (fixes, polish, tweaks) bumps the patch (27.0.1). Updates package.json, the
// package-lock.json root entries and the version table in README.md.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(root, f), s);

const pkg = JSON.parse(read('package.json'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const arg = process.argv[2];
let next;
if (arg === 'minor') next = `${maj}.${min + 1}.0`;
else if (arg === 'patch') next = `${maj}.${min}.${pat + 1}`;
else if (/^\d+\.\d+\.\d+$/.test(arg || '')) next = arg;
else { console.error('Usage: node scripts/bump-version.js minor|patch|<x.y.z>'); process.exit(1); }

const setJsonVersion = (file, fn) => {
  const raw = read(file);
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const obj = JSON.parse(raw);
  fn(obj);
  write(file, JSON.stringify(obj, null, 2).replace(/\n/g, eol) + eol);
};
setJsonVersion('package.json', o => { o.version = next; });
setJsonVersion('package-lock.json', o => { o.version = next; if (o.packages && o.packages['']) o.packages[''].version = next; });
write('README.md', read('README.md').replace(/(\| FIFA Analytics \| `)[\d.]+(` \|)/, `$1${next}$2`));
console.log(`${pkg.version} -> ${next}`);
