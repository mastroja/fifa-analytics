// Builds assets/player_customization/catalog.json for the player editor's hair / facial-hair pickers.
//
//   node scripts/build_customization_catalog.js
//
// Folder layout it understands (file name hair_id_NNNN.png, NNNN = hairtypecode / facialhairtypecode):
//   hair/hair_cat<1|2|3|N>[_short|_med|_long]/   categorised hair  (cat1 light, cat2 dark, cat3 neutral)
//   hair/etc/FC26_Hair_Database/                 uncategorised hair (cat = null)
//   facial_hair/facial_hair_<short|med|long>/    facial hair
//   hair/etc/FC26_FacialHair_Database/           uncategorised facial hair
// When the same id appears more than once, a categorised/lengthed copy beats an "etc" copy.
// Re-run after adding images; the app reads the generated catalog.json, never the folders.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'assets', 'player_customization');
const OUT = path.join(ROOT, 'catalog.json');
const REL_BASE = 'assets/player_customization';

function listPngs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^hair_id_\d+\.png$/i.test(f));
}

function idOf(file) { return parseInt(file.match(/(\d+)/)[1], 10); }

function collect(sources) {
  const byId = new Map();
  const duplicates = [];
  for (const src of sources) {
    for (const file of listPngs(path.join(ROOT, src.dir))) {
      const id = idOf(file);
      const entry = { id, file: `${REL_BASE}/${src.dir}/${file}`, cat: src.cat, length: src.length, etc: !!src.etc };
      const existing = byId.get(id);
      if (!existing) { byId.set(id, entry); continue; }
      // rank: categorised/lengthed beats etc; otherwise first one wins
      if (existing.etc && !entry.etc) { duplicates.push({ id, kept: entry.file, dropped: existing.file }); byId.set(id, entry); }
      else duplicates.push({ id, kept: existing.file, dropped: entry.file });
    }
  }
  const list = [...byId.values()].sort((a, b) => a.id - b.id).map(({ etc, ...rest }) => rest);
  return { list, duplicates };
}

function hairSources() {
  const sources = [];
  const hairDir = path.join(ROOT, 'hair');
  for (const d of fs.existsSync(hairDir) ? fs.readdirSync(hairDir) : []) {
    const m = d.match(/^hair_cat(\d+)(?:_(short|med|long))?$/);
    if (m) sources.push({ dir: `hair/${d}`, cat: parseInt(m[1], 10), length: m[2] || null });
  }
  sources.push({ dir: 'hair/etc/FC26_Hair_Database', cat: null, length: null, etc: true });
  return sources;
}

function facialSources() {
  const sources = [];
  for (const len of ['short', 'med', 'long']) sources.push({ dir: `facial_hair/facial_hair_${len}`, cat: null, length: len });
  sources.push({ dir: 'hair/etc/FC26_FacialHair_Database', cat: null, length: null, etc: true });
  return sources;
}

// Styles whose picture is blank/unusable; kept out of the picker (a player who already has one still shows it as the
// current style, see hairGrid in player_editor_ui.js).
const HIDDEN_HAIR_IDS = new Set([157]);
const hair = collect(hairSources());
hair.list = hair.list.filter(h => !HIDDEN_HAIR_IDS.has(h.id));
const facial = collect(facialSources());

// Boots: the user's boot screenshots in assets/player_customization/boots/<brand>/boot_NNN_<name>.png, named from
// boots_index.csv when present. These pictures are NOT tied to game ids on their own: the editor links a picture to the
// game's shoetypecode (see boot links in player_editor.js). gameBoots is what the game defines, used for the link UI.
const BRAND_LABELS = { adidas: 'adidas', generic: 'Generic', lotto: 'Lotto', mizuno: 'Mizuno', new_balance: 'New Balance',
  nike: 'Nike', puma: 'Puma', skechers: 'Skechers', sokito: 'Sokito', umbro: 'Umbro', under_armor: 'Under Armour' };

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function buildBoots() {
  const bootsDir = path.join(ROOT, 'boots');
  if (!fs.existsSync(bootsDir)) return { images: [], warnings: [] };
  const names = new Map();
  const csvPath = path.join(bootsDir, 'boots_index.csv');
  if (fs.existsSync(csvPath)) {
    fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).slice(1).forEach(line => {
      if (!line.trim()) return;
      const cols = parseCsvLine(line);
      if (cols[0] && cols[4]) names.set(cols[0], cols[4]);
    });
  }
  const images = [];
  const warnings = [];
  for (const dir of fs.readdirSync(bootsDir)) {
    const full = path.join(bootsDir, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) {
      if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
      const m = f.match(/^boot_(\d+)_/);
      const pretty = f.replace(/\.[^.]+$/, '').replace(/^boot_(id_|\d+_)/, '').replace(/_/g, ' ');
      let name = names.get(f) || pretty;
      const label = BRAND_LABELS[dir] || dir.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
      const first = name.toLowerCase().replace(/[^a-z]/g, '');
      const want = dir.replace(/[^a-z]/g, '').slice(0, 5);
      // The folder is the source of truth for the brand. A few file/CSV names carry another brand's model name (the
      // pictures were filed by what they really are); show brand + colourway rather than the wrong model name.
      if (dir !== 'generic' && !first.startsWith(want)) {
        const colours = (name.match(/\(([^)]*)\)/) || [])[1];
        warnings.push(`${dir}/${f}: file name says "${name}", shown as ${label}${colours ? ` (${colours})` : ''}`);
        name = colours ? `${label} (${colours})` : `${label} boot`;
      }
      images.push({ key: `${dir}/${f}`, n: m ? parseInt(m[1], 10) : null, name, brand: dir, brandLabel: label, file: `${REL_BASE}/boots/${dir}/${f}` });
    }
  }
  images.sort((a, b) => a.brandLabel.localeCompare(b.brandLabel) || ((a.n ?? 9999) - (b.n ?? 9999)) || a.name.localeCompare(b.name));
  return { images, warnings };
}
const bootBuild = buildBoots();
const boots = bootBuild.images;

function loadGameBoots() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'boots_data.json'), 'utf8'));
    return data.boots.map(b => Object.assign({}, b, { usedBy: (data.usage && data.usage[String(b.id)]) || 0 }));
  } catch (e) { return []; }
}

const catalog = {
  generated: new Date().toISOString(),
  hair: hair.list,
  facialHair: facial.list,
  boots,
  gameBoots: loadGameBoots()
};
fs.writeFileSync(OUT, JSON.stringify(catalog));

const byCat = {};
hair.list.forEach(h => { const k = h.cat === null ? 'uncategorised' : 'cat' + h.cat; byCat[k] = (byCat[k] || 0) + 1; });
console.log(`hair: ${hair.list.length} ids`, byCat);
console.log(`facial hair: ${facial.list.length} ids`);
console.log(`boots: ${boots.length} pictures in ${new Set(boots.map(x => x.brand)).size} brands`);
if (bootBuild.warnings.length) console.log(`  ${bootBuild.warnings.length} boot names did not match their brand folder and were shown as brand + colours (folder wins)`);
[['hair', hair], ['facial hair', facial]].forEach(([label, r]) => {
  if (r.duplicates.length) console.log(`${label}: ${r.duplicates.length} duplicate ids resolved (kept the categorised copy):`, r.duplicates.slice(0, 5));
});
console.log('wrote', path.relative(process.cwd(), OUT));
