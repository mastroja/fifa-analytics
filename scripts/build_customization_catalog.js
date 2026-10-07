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

const hair = collect(hairSources());
const facial = collect(facialSources());

// Boots: every boot the game defines (assets/data/boots_data.json, from the FC 27 boots probe) merged with
// whatever images exist in assets/player_customization/boots/. Images are named boot_id_NNNN.png where NNNN is
// the game's shoetypecode (the playerboots.shoetype id); boots without an image still appear, as a numbered tile.
function buildBoots() {
  const dataPath = path.join(__dirname, '..', 'assets', 'data', 'boots_data.json');
  if (!fs.existsSync(dataPath)) return [];
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const bootsDir = path.join(ROOT, 'boots');
  const files = new Map();
  for (const f of fs.existsSync(bootsDir) ? fs.readdirSync(bootsDir) : []) {
    const m = f.match(/^boot_?(?:id_)?(\d+)\.(png|jpg|jpeg|webp)$/i);
    if (m) files.set(parseInt(m[1], 10), `${REL_BASE}/boots/${f}`);
  }
  return data.boots.map(b => Object.assign({}, b, {
    file: files.get(b.id) || null,
    usedBy: (data.usage && data.usage[String(b.id)]) || 0
  }));
}
const boots = buildBoots();

const catalog = {
  generated: new Date().toISOString(),
  hair: hair.list,
  facialHair: facial.list,
  boots,
  bootsRgb: (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'boots_data.json'), 'utf8')).shoeColorRgb; } catch (e) { return {}; } })()
};
fs.writeFileSync(OUT, JSON.stringify(catalog));

const byCat = {};
hair.list.forEach(h => { const k = h.cat === null ? 'uncategorised' : 'cat' + h.cat; byCat[k] = (byCat[k] || 0) + 1; });
console.log(`hair: ${hair.list.length} ids`, byCat);
console.log(`facial hair: ${facial.list.length} ids`);
console.log(`boots: ${boots.length} defined, ${boots.filter(b => b.file).length} with an image`);
[['hair', hair], ['facial hair', facial]].forEach(([label, r]) => {
  if (r.duplicates.length) console.log(`${label}: ${r.duplicates.length} duplicate ids resolved (kept the categorised copy):`, r.duplicates.slice(0, 5));
});
console.log('wrote', path.relative(process.cwd(), OUT));
