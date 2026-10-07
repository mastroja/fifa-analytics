// Player editor UI (generic / regen / academy players only). Loaded after app.js; relies on app.js
// globals available at call time: currentUnits ('imperial' | 'metric'), POSITION_MAP.
// Backend: player_editor.js (IPC). Design: PLAYER_EDITOR_DESIGN.md.
//
// Flow: profile "Edit player" -> sync from game (F11) -> tabbed editor dialog -> Save queues only the
// CHANGED game columns and presses F11 again so assets/lua/player_editor_sync.lua writes them.
(function () {
  'use strict';

  // ---------- static labels / data ----------
  const ATTR_GROUPS = [
    ['Attacking', ['crossing', 'finishing', 'headingaccuracy', 'shortpassing', 'volleys']],
    ['Skill', ['dribbling', 'curve', 'freekickaccuracy', 'longpassing', 'ballcontrol']],
    ['Movement', ['acceleration', 'sprintspeed', 'agility', 'reactions', 'balance']],
    ['Power', ['shotpower', 'jumping', 'stamina', 'strength', 'longshots']],
    ['Mentality', ['aggression', 'interceptions', 'positioning', 'vision', 'penalties', 'composure']],
    ['Defending', ['defensiveawareness', 'standingtackle', 'slidingtackle']],
    ['Goalkeeping', ['gkdiving', 'gkhandling', 'gkkicking', 'gkpositioning', 'gkreflexes']]
  ];
  const ATTR_KEYS = ATTR_GROUPS.reduce((a, g) => a.concat(g[1]), []);
  const ATTR_LABEL = {
    crossing: 'Crossing', finishing: 'Finishing', headingaccuracy: 'Heading accuracy', shortpassing: 'Short passing',
    volleys: 'Volleys', dribbling: 'Dribbling', curve: 'Curve', freekickaccuracy: 'FK accuracy',
    longpassing: 'Long passing', ballcontrol: 'Ball control', acceleration: 'Acceleration', sprintspeed: 'Sprint speed',
    agility: 'Agility', reactions: 'Reactions', balance: 'Balance', shotpower: 'Shot power', jumping: 'Jumping',
    stamina: 'Stamina', strength: 'Strength', longshots: 'Long shots', aggression: 'Aggression',
    interceptions: 'Interceptions', positioning: 'Positioning', vision: 'Vision', penalties: 'Penalties',
    composure: 'Composure', defensiveawareness: 'Def. awareness', standingtackle: 'Standing tackle',
    slidingtackle: 'Sliding tackle', gkdiving: 'Diving', gkhandling: 'Handling', gkkicking: 'Kicking',
    gkpositioning: 'GK positioning', gkreflexes: 'Reflexes'
  };

  // [field, bit, name] — from assets/lua/export_all.lua (PLAYSTYLE_BITS_1/2, TRAIT_BITS_2)
  const PLAYSTYLES = [
    ['1', 1, 'Finesse Shot'], ['1', 2, 'Chip Shot'], ['1', 4, 'Power Shot'], ['1', 8, 'Dead Ball'],
    ['1', 16, 'Precision Header'], ['1', 32, 'Acrobatic'], ['1', 64, 'Low Driven Shot'], ['1', 128, 'Game Changer'],
    ['1', 256, 'Incisive Pass'], ['1', 512, 'Pinged Pass'], ['1', 1024, 'Long Ball Pass'], ['1', 2048, 'Tiki Taka'],
    ['1', 4096, 'Whipped Pass'], ['1', 8192, 'Inventive'], ['1', 16384, 'Jockey'], ['1', 32768, 'Block'],
    ['1', 65536, 'Intercept'], ['1', 131072, 'Anticipate'], ['1', 262144, 'Slide Tackle'], ['1', 524288, 'Aerial Fortress'],
    ['1', 1048576, 'Technical'], ['1', 2097152, 'Rapid'], ['1', 4194304, 'First Touch'], ['1', 8388608, 'Trickster'],
    ['1', 16777216, 'Press Proven'], ['1', 33554432, 'Quick Step'], ['1', 67108864, 'Relentless'],
    ['1', 134217728, 'Long Throw'], ['1', 268435456, 'Bruiser'], ['1', 536870912, 'Enforcer'],
    ['2', 1, 'Far Throw'], ['2', 2, 'Footwork'], ['2', 4, 'Cross Claimer'], ['2', 8, 'Rush Out'],
    ['2', 16, 'Far Reach'], ['2', 32, 'Deflector']
  ];
  const TRAITS2 = [
    [64, 'Long Shot Taker (AI)'], [128, 'Early Crosser (AI)'], [256, 'Solid Player'], [512, 'Team Player'],
    [1024, 'One Club Player'], [2048, 'Injury Prone'], [4096, 'Leadership'], [8192, 'Super Sub']
  ];

  // Codes actually seen in FC 27 data (probe reports), so only known-good values are offered.
  const HAIR_COLORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27];
  const FACIAL_COLORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27];
  const ACCESSORY_IDS = [0, 6, 7, 8, 9, 16, 22, 23, 24, 25, 26, 27];
  const ACCESSORY_COLORS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 99];
  const BODY_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11];
  const EYE_COLORS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const SKIN_TONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  // Swatch colours for the named game colours (names come from Live Editor's localize.json).
  const HAIR_SWATCH = {
    0: '#141414', 1: '#e3c56b', 2: '#b99a56', 3: '#3a291c', 4: '#f0dd9c', 5: '#7b5a39', 6: '#5b3e29', 7: '#a73b22',
    8: '#f1f1f1', 9: '#b9bdc6', 10: '#3fa34d', 11: '#3d6fd1', 12: '#c9622a', 13: '#6e1b1b', 14: '#e58bb4'
  };
  const EYE_SWATCH = { 1: '#3b7dd8', 2: '#86bdea', 3: '#7a4a21', 4: '#a8743a', 5: '#8a6a2f', 6: '#3f8f4f', 7: '#93d093', 8: '#4a86cf', 9: '#3a2314', 10: '#1fa845' };
  const SKIN_SWATCH = { 10: '#f6d9c5', 20: '#efc7a8', 30: '#e2b08a', 40: '#d19a6b', 50: '#bf8456', 60: '#a46f46', 70: '#8a5a38', 80: '#6e4529', 90: '#573520', 100: '#3f2616' };

  const TABS = [['look', 'Look'], ['body', 'Body'], ['boots', 'Boots'], ['ratings', 'Ratings'], ['pos', 'Positions'], ['play', 'Playstyles'], ['hist', 'History']];

  let ed = null; // open editor session
  let staticData = null;
  let catalog = null;
  let labels = {};
  const waiters = []; // { kind, resolve } waiting for a 'player-editor-updated' push

  // ---------- helpers ----------
  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const api = () => window.api;
  const units = () => (typeof currentUnits !== 'undefined' ? currentUnits : 'imperial');
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const hasBit = (v, bit) => Math.floor((v || 0) / bit) % 2 === 1;
  const setBit = (v, bit, on) => (hasBit(v, bit) === on ? (v || 0) : (v || 0) + (on ? bit : -bit));
  function countBits(n) { let c = 0; n = n || 0; while (n > 0) { c += n % 2; n = Math.floor(n / 2); } return c; }
  const L = (group, id, fallback) => (labels[group] && labels[group][id]) || fallback;
  const hairName = (id) => L('hairColor', id, 'Custom ' + id);
  const facialName = (id) => L('facialHairColor', id, 'Custom ' + id);
  const accName = (id) => (id === 0 ? 'None' : L('accessory', id, 'Accessory ' + id));
  const accColorName = (id) => L('accessoryColor', id, 'Colour ' + id);
  const eyeName = (id) => L('eyeColor', id, 'Eye ' + id);
  const bodyName = (id) => L('bodyType', id, 'Type ' + id);
  const skinName = (tone) => L('skinTone', tone / 10, 'Tone ' + tone);

  function posLabel(id) {
    const m = (typeof POSITION_MAP !== 'undefined' && POSITION_MAP[Number(id)]) || null;
    return m ? m.label : '#' + id;
  }

  // ---------- overall (PLAYER_EDITOR_DESIGN.md section 4) ----------
  function formulaOverall(state) {
    const f = staticData && staticData.formula && staticData.formula.positions[String(state.preferredposition1)];
    if (!f) return null;
    let sum = 0;
    for (const attr of Object.keys(f)) sum += (f[attr] * (state[attr] || 0));
    return Math.round(sum / 100);
  }
  // Keep whatever offset the game's stored overall has from the formula: only the CHANGE is applied.
  function autoOverall() {
    const a = formulaOverall(ed.orig), b = formulaOverall(ed.cur);
    if (a === null || b === null) return null;
    return clamp(ed.orig.overallrating + (b - a), 1, 99);
  }

  // ---------- skin-tone-aware hair filtering ----------
  function suggestedCats() {
    const t = ed.cur.skintonecode || 50;
    if (t <= 40) return [1, 3];
    if (t >= 70) return [2, 3];
    return [1, 2, 3];
  }
  function filterCatalog(list, kind, categoryOnly) {
    const f = ed.filters[kind];
    let out = list;
    if (f.cat === 'suggested') { const cats = suggestedCats(); out = out.filter(h => h.cat === null || cats.includes(h.cat)); }
    else if (f.cat === 'other') out = out.filter(h => h.cat === null);
    else if (f.cat !== 'all') out = out.filter(h => h.cat === Number(f.cat));
    if (!categoryOnly && f.length !== 'all') out = out.filter(h => h.length === f.length);
    return out;
  }

  // ---------- styles ----------
  function injectStyles() {
    if (document.getElementById('pe-styles')) return;
    const css = `
      #pe-dialog { width: min(1480px, 97vw); height: min(960px, 96vh); padding: 0; border: 1px solid var(--border-color); border-radius: 14px; background: var(--card-bg); color: var(--text-main, #e6edf3); overflow: hidden; }
      #pe-dialog::backdrop { background: rgba(0,0,0,.7); backdrop-filter: blur(2px); }
      .pe-shell { display: grid; grid-template-rows: auto 1fr auto; height: 100%; }
      .pe-top { display: flex; align-items: center; gap: 18px; padding: 16px 24px; border-bottom: 1px solid var(--border-color); }
      .pe-title { flex: 1; min-width: 0; }
      .pe-title h2 { margin: 0; font-size: 22px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .pe-title span { font-size: 12px; color: var(--text-dim); }
      .pe-score { display: flex; gap: 10px; }
      .pe-score div { text-align: center; padding: 6px 16px; border-radius: 10px; background: var(--expand-bg); border: 1px solid var(--border-color); min-width: 74px; }
      .pe-score b { display: block; font-size: 24px; line-height: 1.1; color: var(--accent-color); }
      .pe-score small { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-dim); }
      .pe-x { background: none; border: 0; color: var(--text-dim); font-size: 22px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
      .pe-x:hover { background: var(--expand-bg); color: inherit; }
      .pe-main { display: grid; grid-template-columns: 180px 1fr; min-height: 0; }
      .pe-nav { border-right: 1px solid var(--border-color); padding: 14px 10px; display: flex; flex-direction: column; gap: 4px; background: var(--expand-bg); }
      .pe-tab { text-align: left; padding: 10px 14px; border-radius: 8px; border: 0; background: none; color: var(--text-dim); font-size: 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
      .pe-tab:hover { background: var(--card-bg); color: inherit; }
      .pe-tab.on { background: var(--card-bg); color: inherit; font-weight: 600; box-shadow: inset 3px 0 0 var(--accent-color); }
      .pe-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-color); }
      .pe-panel { overflow-y: auto; padding: 24px 34px 34px; }
      .pe-card { margin-bottom: 26px; }
      .pe-card > h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
      .pe-card > p { margin: 0 0 12px; font-size: 12px; color: var(--text-dim); }
      .pe-row { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-start; margin-bottom: 12px; }
      .pe-field { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-dim); }
      .pe-field input { background: var(--expand-bg); color: var(--text-main, #e6edf3); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 10px; font-size: 14px; min-width: 90px; }
      .pe-field input:focus { outline: none; border-color: var(--accent-color); }
      .pe-dd { position: relative; min-width: 150px; }
      .pe-dd-btn { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--expand-bg); color: var(--text-main, #e6edf3); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 10px; font-size: 14px; cursor: pointer; text-align: left; }
      .pe-dd-btn:hover, .pe-dd.open .pe-dd-btn { border-color: var(--accent-color); }
      .pe-dd-btn span { color: var(--text-dim); font-size: 11px; }
      .pe-dd-list { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 100%; max-height: 260px; overflow-y: auto; background: var(--card-bg); border: 1px solid var(--accent-color); border-radius: 8px; box-shadow: 0 10px 28px rgba(0,0,0,.55); padding: 4px; }
      .pe-dd-opt { padding: 7px 10px; border-radius: 6px; font-size: 14px; cursor: pointer; white-space: nowrap; color: var(--text-main, #e6edf3); }
      .pe-dd-opt:hover { background: var(--expand-bg); }
      .pe-dd-opt.sel { background: color-mix(in srgb, var(--accent-color) 22%, transparent); font-weight: 600; }
      .pe-field.changed input, .pe-field.changed .pe-dd-btn { border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 10%, var(--expand-bg)); }
      .pe-swatches { display: flex; flex-wrap: wrap; gap: 10px; }
      .pe-sw { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--border-color); cursor: pointer; position: relative; padding: 0; }
      .pe-sw:hover { transform: scale(1.1); }
      .pe-sw.sel { border-color: var(--accent-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 35%, transparent); }
      .pe-sw.orig::after { content: ''; position: absolute; inset: -6px; border-radius: 50%; border: 1px dashed var(--text-dim); }
      .pe-sw.unnamed { background: repeating-linear-gradient(45deg, #444, #444 4px, #555 4px, #555 8px); font-size: 10px; color: #fff; display: flex; align-items: center; justify-content: center; }
      .pe-picked { margin-top: 8px; font-size: 13px; }
      .pe-picked b { color: var(--accent-color); }
      .pe-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
      .pe-chip { padding: 4px 12px; border-radius: 999px; border: 1px solid var(--border-color); background: var(--expand-bg); color: inherit; font-size: 12px; cursor: pointer; }
      .pe-chip:hover { border-color: var(--accent-color); }
      .pe-chip.on { background: var(--accent-color); color: #0d1117; border-color: var(--accent-color); font-weight: 600; }
      .pe-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; max-height: 560px; overflow-y: auto; padding: 4px 6px 4px 0; }
      .pe-grid.boots { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); max-height: 620px; }
      .pe-tile.boot img { aspect-ratio: 260 / 230; object-fit: contain; background: #0006; }
      .pe-boot-name { font-size: 12px; color: var(--text-main, #e6edf3); line-height: 1.25; min-height: 30px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .pe-boot-tag { font-size: 11px; margin-top: 3px; color: var(--text-dim); }
      .pe-boot-tag.ok { color: #3fb950; font-weight: 700; }
      .pe-unlink { cursor: pointer; color: #f85149; margin-left: 6px; }
      .pe-search { background: var(--expand-bg); color: var(--text-main, #e6edf3); border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 12px; font-size: 14px; min-width: 220px; }
      .pe-search:focus { outline: none; border-color: var(--accent-color); }
      .pe-tile { border: 2px solid transparent; border-radius: 12px; background: var(--expand-bg); padding: 5px; cursor: pointer; text-align: center; font-size: 12px; color: var(--text-dim); }
      .pe-tile:hover { border-color: var(--border-color); }
      .pe-tile img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 9px; display: block; margin-bottom: 3px; }
      .pe-tile.sel { border-color: var(--accent-color); color: inherit; }
      .pe-tile.orig { outline: 1px dashed var(--text-dim); outline-offset: 1px; }
      .pe-noimg { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 12px; background: #00000033; border-radius: 9px; margin-bottom: 3px; }
      .pe-acc { display: grid; grid-template-columns: 60px 1fr 1fr; gap: 10px; align-items: center; margin-bottom: 8px; }
      .pe-attr-wrap { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
      .pe-attr-card { background: var(--expand-bg); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 14px; }
      .pe-attr-card h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--text-dim); }
      .pe-attr { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 3px 0; font-size: 13px; }
      .pe-attr input { width: 58px; text-align: center; background: var(--card-bg); color: inherit; border: 1px solid var(--border-color); border-radius: 6px; padding: 4px; font-weight: 700; font-size: 14px; }
      .pe-attr input.lo { color: #f85149; } .pe-attr input.mid { color: #d4a72c; } .pe-attr input.hi { color: #3fb950; } .pe-attr input.top { color: #58d68d; }
      .pe-attr.changed input { border-color: var(--accent-color); background: color-mix(in srgb, var(--accent-color) 12%, var(--card-bg)); }
      .pe-ps-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
      .pe-ps { padding: 9px 12px; border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer; font-size: 13px; background: var(--expand-bg); user-select: none; display: flex; justify-content: space-between; align-items: center; }
      .pe-ps:hover { border-color: var(--text-dim); }
      .pe-ps.base { border-color: #3fb950; background: #3fb95020; }
      .pe-ps.plus { border-color: #d4a72c; background: #d4a72c30; font-weight: 700; }
      .pe-ps em { font-style: normal; font-size: 10px; text-transform: uppercase; opacity: .8; }
      .pe-legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-dim); margin-bottom: 10px; flex-wrap: wrap; }
      .pe-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
      .pe-hist-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background: var(--expand-bg); margin-bottom: 8px; font-size: 13px; }
      .pe-st { font-size: 11px; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
      .pe-st.queued { background: #d4a72c30; color: #d4a72c; } .pe-st.applied { background: #3fb95030; color: #3fb950; }
      .pe-st.failed { background: #f8514930; color: #f85149; } .pe-st.undone { background: #8b949e30; color: var(--text-dim); }
      .pe-hint { font-size: 12px; color: var(--text-dim); }
      .pe-banner { padding: 10px 14px; border-radius: 8px; background: #d4a72c20; border: 1px solid #d4a72c60; font-size: 13px; margin-bottom: 18px; }
      .pe-foot { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 24px; border-top: 1px solid var(--border-color); background: var(--expand-bg); flex-wrap: wrap; }
      .pe-msg { font-size: 13px; flex: 1; min-width: 200px; } .pe-msg.err { color: #f85149; } .pe-msg.ok { color: #3fb950; }
      .pe-auto { font-size: 12px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; cursor: pointer; }
      .pe-btn { padding: 9px 22px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--card-bg); color: inherit; cursor: pointer; font-size: 14px; }
      .pe-btn:hover:not(:disabled) { border-color: var(--text-dim); }
      .pe-btn.primary { background: var(--accent-color); color: #0d1117; border-color: var(--accent-color); font-weight: 700; }
      .pe-btn:disabled { opacity: .4; cursor: not-allowed; }
      .pe-edit-btn { margin-left: 8px; padding: 5px 14px; border-radius: 8px; border: 1px solid var(--accent-color); background: transparent; color: var(--accent-color); cursor: pointer; font-size: 13px; font-weight: 600; }
      .pe-edit-btn:hover:not(:disabled) { background: var(--accent-color); color: #0d1117; }
      .pe-edit-btn:disabled { opacity: .6; cursor: progress; }
    `;
    const style = document.createElement('style');
    style.id = 'pe-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------- small renderers ----------
  const isChanged = (key) => ed.cur[key] !== ed.orig[key];

  // In-page dropdown instead of a native <select>: the native popup is a separate OS widget that Electron
  // closes whenever the dialog is touched, so it never stayed open. This one stays open until you pick a
  // value or click elsewhere (ed.openDd remembers which one is open across re-renders).
  function dropdown(key, values, nameFn) {
    const cur = ed.cur[key];
    const list = values.includes(cur) ? values : [cur].concat(values);
    const labelOf = v => (nameFn ? nameFn(v) : String(v));
    const open = ed.openDd === key;
    return `<div class="pe-dd${open ? ' open' : ''}">
      <button type="button" class="pe-dd-btn" data-dd="${key}">${esc(labelOf(cur))}<span>▾</span></button>
      ${open ? `<div class="pe-dd-list">${list.map(v => `<div class="pe-dd-opt${v === cur ? ' sel' : ''}" data-set="${key}:${v}">${esc(labelOf(v))}</div>`).join('')}</div>` : ''}
    </div>`;
  }
  function selectField(label, key, values, nameFn) {
    return `<div class="pe-field${isChanged(key) ? ' changed' : ''}">${esc(label)}${dropdown(key, values, nameFn)}</div>`;
  }
  function numberField(label, key, lo, hi) {
    return `<label class="pe-field${isChanged(key) ? ' changed' : ''}">${esc(label)}<input type="number" data-num="${key}" min="${lo}" max="${hi}" value="${esc(ed.cur[key])}"></label>`;
  }

  function swatchPicker(key, values, nameFn, colorMap, title) {
    const cur = ed.cur[key], orig = ed.orig[key];
    const list = values.includes(cur) ? values : [cur].concat(values);
    const sw = list.map(v => {
      const color = colorMap[v];
      const style = color ? `background:${color}` : '';
      return `<button class="pe-sw${v === cur ? ' sel' : ''}${v === orig ? ' orig' : ''}${color ? '' : ' unnamed'}" style="${style}" data-set="${key}:${v}" title="${esc(nameFn(v))} (${v})">${color ? '' : v}</button>`;
    }).join('');
    return `<div class="pe-swatches">${sw}</div>
      <div class="pe-picked">${esc(title)}: <b>${esc(nameFn(cur))}</b> <span class="pe-hint">(code ${cur}${cur !== orig ? `, was ${esc(nameFn(orig))}` : ''})</span></div>`;
  }

  // Lengths / categories that actually exist in the catalog; filters only offer what exists.
  const CAT_LABEL = { 1: 'Light', 2: 'Dark', 3: 'Neutral' };
  const LENGTH_LABEL = { short: 'Short', med: 'Medium', long: 'Long' };

  // A dropdown whose options are filter values (data-filter="kind:group:value"); reuses the in-page dropdown styles.
  function filterDropdown(kind, group, options, current) {
    const id = `${kind}:${group}`;
    const open = ed.openDd === id;
    const label = (options.find(o => String(o.value) === String(current)) || options[0]).label;
    return `<div class="pe-dd${open ? ' open' : ''}" style="min-width:220px">
      <button type="button" class="pe-dd-btn" data-dd="${id}">${esc(label)}<span>▾</span></button>
      ${open ? `<div class="pe-dd-list">${options.map(o => `<div class="pe-dd-opt${String(o.value) === String(current) ? ' sel' : ''}" data-filter="${kind}:${group}:${o.value}">${esc(o.label)}</div>`).join('')}</div>` : ''}
    </div>`;
  }

  function hairGrid(kind, typeKey) {
    const list = kind === 'hair' ? catalog.hair : catalog.facialHair;
    const f = ed.filters[kind];

    // category dropdown: only categories that have styles (facial hair has none, so no dropdown there)
    const catCounts = {};
    list.forEach(h => { const k = h.cat === null ? 'other' : h.cat; catCounts[k] = (catCounts[k] || 0) + 1; });
    const catOptions = [];
    if (kind === 'hair') {
      const sug = suggestedCats();
      const sugCount = list.filter(h => h.cat === null || sug.includes(h.cat)).length;
      catOptions.push({ value: 'suggested', label: `Suggested for skin tone (${sugCount})` });
      catOptions.push({ value: 'all', label: `All (${list.length})` });
      [1, 2, 3].forEach(n => { if (catCounts[n]) catOptions.push({ value: n, label: `${CAT_LABEL[n]} (${catCounts[n]})` }); });
      if (catCounts.other) catOptions.push({ value: 'other', label: `Uncategorised (${catCounts.other})` });
    }

    // lengths that exist inside the chosen category; drop the length filter if it no longer applies
    const inCategory = filterCatalog(list, kind, true);
    const lengthCounts = {};
    inCategory.forEach(h => { if (h.length) lengthCounts[h.length] = (lengthCounts[h.length] || 0) + 1; });
    const lengths = ['short', 'med', 'long'].filter(l => lengthCounts[l]);
    if (f.length !== 'all' && !lengthCounts[f.length]) f.length = 'all';
    const chip = (value, label) => `<button class="pe-chip${String(f.length) === String(value) ? ' on' : ''}" data-filter="${kind}:length:${value}">${label}</button>`;
    const lenChips = lengths.length > 0
      ? chip('all', `Any length (${inCategory.length})`) + lengths.map(l => chip(l, `${LENGTH_LABEL[l]} (${lengthCounts[l]})`)).join('')
      : '';

    const shown = filterCatalog(list, kind);
    const cur = ed.cur[typeKey], origId = ed.orig[typeKey];
    const known = new Set(list.map(h => h.id));
    const tile = (id, img, extra) => `<div class="pe-tile${id === cur ? ' sel' : ''}${id === origId ? ' orig' : ''}" data-set="${typeKey}:${id}" title="Style #${id}">${
      img ? `<img loading="lazy" src="${esc(img)}" alt="">` : `<div class="pe-noimg">${extra}</div>`}#${id}</div>`;
    const tiles = [tile(0, null, 'None')];
    if (cur !== 0 && !known.has(cur)) tiles.push(tile(cur, null, 'No preview'));
    shown.forEach(h => tiles.push(tile(h.id, h.file)));
    const bar = (catOptions.length || lenChips)
      ? `<div class="pe-row" style="align-items:center;gap:12px;margin-bottom:12px">
          ${catOptions.length ? `<div class="pe-field" style="flex-direction:row;align-items:center;gap:8px">Category ${filterDropdown(kind, 'cat', catOptions, f.cat)}</div>` : ''}
          ${lenChips ? `<div class="pe-chips" style="margin:0">${lenChips}</div>` : ''}
        </div>`
      : '';
    return `${bar}<div class="pe-grid">${tiles.join('')}</div>
      <div class="pe-picked">Style <b>#${esc(cur)}</b>${cur !== origId ? ` <span class="pe-hint">(was #${esc(origId)})</span>` : ''} <span class="pe-hint">- ${shown.length} shown</span></div>`;
  }

  // ---------- tabs ----------
  function tabLook() {
    const acc = [1, 2, 3, 4].map(n => `<div class="pe-acc"><span class="pe-hint">Slot ${n}</span>
        ${selectField('', 'accessorycode' + n, ACCESSORY_IDS, accName)}
        ${selectField('', 'accessorycolourcode' + n, ACCESSORY_COLORS, accColorName)}</div>`).join('');
    return `
      <div class="pe-card"><h3>Skin</h3><p>Tone follows the game's ten-step scale; complexion and type fine-tune it.</p>
        ${swatchPicker('skintonecode', SKIN_TONES, skinName, SKIN_SWATCH, 'Skin tone')}
        <div class="pe-row" style="margin-top:14px">${selectField('Complexion', 'skincomplexion', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])}
          ${selectField('Skin type (advanced)', 'skintypecode', [0, 1, 2, 3, 4, 5, 6, 7])}</div></div>
      <div class="pe-card"><h3>Eyes</h3>
        ${swatchPicker('eyecolorcode', EYE_COLORS, eyeName, EYE_SWATCH, 'Eye colour')}
        <div class="pe-row" style="margin-top:14px">${selectField('Eye detail', 'eyedetail', [0, 1, 2, 3, 4, 5, 6])}${numberField('Eyebrow code', 'eyebrowcode', 0, 3000000)}</div>
        <div class="pe-hint">Eyebrows are a packed code (e.g. 240302); copy one from another generic player rather than inventing one.</div></div>
      <div class="pe-card"><h3>Hair style</h3>${hairGrid('hair', 'hairtypecode')}</div>
      <div class="pe-card"><h3>Hair colour</h3>${swatchPicker('haircolorcode', HAIR_COLORS, hairName, HAIR_SWATCH, 'Hair colour')}
        <div class="pe-hint" style="margin-top:6px">Striped swatches are game-internal colours without a name.</div></div>
      <div class="pe-card"><h3>Facial hair style</h3>${hairGrid('facial', 'facialhairtypecode')}</div>
      <div class="pe-card"><h3>Facial hair colour</h3>${swatchPicker('facialhaircolorcode', FACIAL_COLORS, facialName, HAIR_SWATCH, 'Facial hair colour')}</div>
      <div class="pe-card"><h3>Accessories</h3><p>Only accessories seen in the game's data are offered. Some can only be white.</p>${acc}</div>`;
  }

  function tabBody() {
    const c = ed.cur;
    let hInputs, wInputs;
    if (units() === 'metric') {
      hInputs = numberField('Height (cm)', 'height', 140, 220);
      wInputs = numberField('Weight (kg)', 'weight', 40, 120);
    } else {
      const totalIn = c.height / 2.54;
      let ft = Math.floor(totalIn / 12), inch = Math.round(totalIn - ft * 12);
      if (inch === 12) { ft += 1; inch = 0; }
      hInputs = `<label class="pe-field${isChanged('height') ? ' changed' : ''}">Height (ft / in)<span style="display:flex;gap:8px">
        <input type="number" data-imp="ft" min="4" max="7" value="${ft}" style="width:70px;min-width:0"><input type="number" data-imp="in" min="0" max="11" value="${inch}" style="width:70px;min-width:0"></span></label>`;
      wInputs = `<label class="pe-field${isChanged('weight') ? ' changed' : ''}">Weight (lbs)<input type="number" data-imp="lbs" min="88" max="265" value="${Math.round(c.weight * 2.20462262)}"></label>`;
    }
    const otherH = units() === 'metric' ? `${Math.floor(c.height / 2.54 / 12)}'${Math.round((c.height / 2.54) % 12)}"` : `${c.height} cm`;
    const otherW = units() === 'metric' ? `${Math.round(c.weight * 2.20462262)} lbs` : `${c.weight} kg`;
    return `<div class="pe-card"><h3>Size</h3><p>Shown in your ${units()} setting. The game stores whole cm and kg.</p>
        <div class="pe-row">${hInputs}${wInputs}</div>
        <div class="pe-hint">= ${esc(otherH)} / ${esc(otherW)}. Unchanged values are never rewritten.</div></div>
      <div class="pe-card"><h3>Build</h3>
        <div class="pe-row">${selectField('Body type', 'bodytypecode', BODY_TYPES, bodyName)}</div></div>`;
  }

  // ---------- boots ----------
  // The boot screenshots (assets/player_customization/boots/<brand>/) are not tied to game ids yet. A boot is
  // "linked" once a picture has been matched to the game's shoetypecode: turn on Link mode, then click the picture of
  // the boot this player wears in the game and it is remembered for every player. Only linked boots can be applied.
  function bootLinkOf(img) { const id = (ed.bootLinks || {})[img.key]; return Number.isInteger(id) ? id : null; }

  function tabBoots() {
    const imgs = (catalog && catalog.boots) || [];
    const f = ed.filters.boots;
    const cur = ed.cur.shoetypecode, gameId = ed.orig.shoetypecode;
    const gameBoots = (catalog && catalog.gameBoots) || [];
    const gb = gameBoots.find(b => b.id === gameId);
    const linkedHere = imgs.filter(i => bootLinkOf(i) === gameId);

    const q = (f.q || '').trim().toLowerCase();
    let inScope = imgs.filter(i => !q || i.name.toLowerCase().includes(q) || i.brandLabel.toLowerCase().includes(q));
    const linkedCount = inScope.filter(i => bootLinkOf(i) !== null).length;
    const views = [['all', 'All', inScope.length], ['linked', 'Linked', linkedCount], ['unlinked', 'Not linked', inScope.length - linkedCount]].filter(v => v[0] === 'all' || v[2] > 0);
    if (!views.some(v => v[0] === f.link)) f.link = 'all';
    if (f.link === 'linked') inScope = inScope.filter(i => bootLinkOf(i) !== null);
    else if (f.link === 'unlinked') inScope = inScope.filter(i => bootLinkOf(i) === null);

    // brand dropdown: only brands that have pictures in the current scope
    const brandCounts = {}, brandLabels = {};
    inScope.forEach(i => { brandCounts[i.brand] = (brandCounts[i.brand] || 0) + 1; brandLabels[i.brand] = i.brandLabel; });
    if (f.brand !== 'all' && !brandCounts[f.brand]) f.brand = 'all';
    const brandOptions = [{ value: 'all', label: `All brands (${inScope.length})` }].concat(
      Object.keys(brandCounts).sort((x, y) => brandLabels[x].localeCompare(brandLabels[y]))
        .map(b => ({ value: b, label: `${brandLabels[b]} (${brandCounts[b]})` })));
    const shown = f.brand === 'all' ? inScope : inScope.filter(i => i.brand === f.brand);

    const linkChip = (v, label, n) => `<button class="pe-chip${f.link === v ? ' on' : ''}" data-filter="boots:link:${v}">${label} (${n})</button>`;
    const tile = i => {
      const link = bootLinkOf(i);
      const isCur = link !== null && link === cur;
      return `<div class="pe-tile boot${isCur ? ' sel' : ''}${link !== null && link === gameId ? ' orig' : ''}" data-boot="${esc(i.key)}" title="${esc(i.name)}${link !== null ? ` · game boot #${link}` : ' · not linked to a game id yet'}">
        <img loading="lazy" src="${esc(i.file)}" alt="">
        <div class="pe-boot-name">${esc(i.name)}</div>
        <div class="pe-boot-tag${link !== null ? ' ok' : ''}">${link !== null ? `#${link}` : 'not linked'}${ed.linkMode && link !== null ? ` <span class="pe-unlink" data-unlink="${esc(i.key)}" title="Remove this link">✕</span>` : ''}</div>
      </div>`;
    };
    const status = linkedHere.length
      ? `Current game boot <b>#${esc(gameId)}</b> matches ${linkedHere.length} picture${linkedHere.length > 1 ? 's' : ''} (outlined in the grid).`
      : `Current game boot <b>#${esc(gameId)}</b>${gb && gb.usedBy ? ` (worn by ${gb.usedBy} players)` : ''} has no picture linked yet.`;
    const linkBox = ed.linkMode
      ? `<div class="pe-banner" style="margin-bottom:12px">Link mode is on. Click the picture of the boot this player wears in the game, and it will be linked to game boot <b>#${esc(gameId)}</b>. Click a linked picture's ✕ to remove its link.
          <button class="pe-chip" data-link-mode="off" style="margin-left:10px">Done linking</button></div>`
      : '';
    return `<div class="pe-card"><h3>Boot model</h3>
        <p>${status} Pictures that are not linked to a game id cannot be applied yet.</p>
        ${linkBox}
        <div class="pe-row" style="align-items:center;gap:12px;margin-bottom:12px">
          <div class="pe-field" style="flex-direction:row;align-items:center;gap:8px">Brand ${filterDropdown('boots', 'brand', brandOptions, f.brand)}</div>
          <input class="pe-search" type="search" placeholder="Search boots…" data-boot-q value="${esc(f.q || '')}">
          <div class="pe-chips" style="margin:0">${views.map(v => linkChip(v[0], v[1], v[2])).join('')}</div>
          ${ed.linkMode ? '' : `<button class="pe-chip" data-link-mode="on" title="Match pictures to the game's boot ids">Link pictures to game ids</button>`}
        </div>
        <div class="pe-grid boots">${shown.map(tile).join('') || '<div class="pe-hint">No boots match.</div>'}</div>
        <div class="pe-picked">${shown.length} shown · ${imgs.filter(i => bootLinkOf(i) !== null).length} of ${imgs.length} pictures linked</div></div>`;
  }

  function tabRatings() {
    const isGk = ed.cur.preferredposition1 === 0;
    const auto = autoOverall();
    const cards = ATTR_GROUPS.filter(([name]) => name !== 'Goalkeeping' || isGk || ed.showGk).map(([name, keys]) => `
      <div class="pe-attr-card"><h4>${name}</h4>${keys.map(k => {
        const v = ed.cur[k], cls = v >= 90 ? 'top' : v >= 75 ? 'hi' : v >= 55 ? 'mid' : 'lo';
        return `<div class="pe-attr${isChanged(k) ? ' changed' : ''}"><span>${ATTR_LABEL[k]}</span><input class="${cls}" type="number" min="1" max="99" data-num="${k}" value="${v}"></div>`;
      }).join('')}</div>`).join('');
    return `<div class="pe-card"><h3>Overall &amp; potential</h3>
        <p>${auto === null ? 'No rating formula for this position.' : `Overall moves with attribute changes (formula suggests ${auto}; the player's +${esc(ed.cur.modifier || 0)} modifier is kept). Type a value to override.`}</p>
        <div class="pe-row">${numberField('Overall', 'overallrating', 1, 99)}${numberField('Potential', 'potential', 1, 99)}</div></div>
      <div class="pe-card"><h3>Attributes</h3><div class="pe-attr-wrap">${cards}</div>
        ${isGk ? '' : `<div style="margin-top:12px"><button class="pe-chip" data-toggle-gk>${ed.showGk ? 'Hide' : 'Show'} goalkeeping attributes</button></div>`}</div>`;
  }

  function tabPositions() {
    const ids = Object.keys(typeof POSITION_MAP !== 'undefined' ? POSITION_MAP : {}).map(Number).sort((a, b) => a - b);
    const sel = (label, key, withNone) => {
      const cur = ed.cur[key];
      const opts = (withNone ? [-1] : []).concat(ids);
      const list = opts.includes(cur) ? opts : [cur].concat(opts);
      return `<div class="pe-field${isChanged(key) ? ' changed' : ''}">${label}${dropdown(key, list, v => (v === -1 ? '—' : posLabel(v)))}</div>`;
    };
    return `<div class="pe-card"><h3>Positions</h3><p>The primary position decides how overall is calculated. Positions must be unique.</p>
      <div class="pe-row">${sel('Primary', 'preferredposition1', false)}</div>
      <div class="pe-row">${[2, 3, 4, 5, 6].map(n => sel('Alternative ' + (n - 1), 'preferredposition' + n, true)).join('')}</div></div>`;
  }

  function psState(f, bit) {
    if (hasBit(ed.cur['icontrait' + f], bit)) return 'plus';
    if (hasBit(ed.cur['trait' + f], bit)) return 'base';
    return 'none';
  }
  const plusCount = () => countBits(ed.cur.icontrait1) + countBits(ed.cur.icontrait2);

  function tabPlaystyles() {
    const tiles = PLAYSTYLES.map(([f, bit, name]) => {
      const s = psState(f, bit);
      return `<div class="pe-ps ${s}" data-ps="${f}:${bit}"><span>${esc(name)}${s === 'plus' ? '+' : ''}</span>${s === 'none' ? '' : `<em>${s === 'plus' ? 'PlayStyle+' : 'Base'}</em>`}</div>`;
    }).join('');
    const traits = TRAITS2.map(([bit, name]) => `<label class="pe-ps ${hasBit(ed.cur.trait2, bit) ? 'base' : ''}">
      <span>${esc(name)}</span><input type="checkbox" data-trait2="${bit}"${hasBit(ed.cur.trait2, bit) ? ' checked' : ''}></label>`).join('');
    const base = countBits(ed.cur.trait1) + [1, 2, 4, 8, 16, 32].filter(b => hasBit(ed.cur.trait2, b)).length;
    return `<div class="pe-card"><h3>Playstyles</h3><p>Click a tile to cycle: none, base, then PlayStyle+. One PlayStyle+ per player (${plusCount()}/1 used, ${base} base).</p>
        <div class="pe-legend"><span><i style="background:#3fb950"></i>Base</span><span><i style="background:#d4a72c"></i>PlayStyle+</span></div>
        <div class="pe-ps-grid">${tiles}</div></div>
      <div class="pe-card"><h3>Personality &amp; AI traits</h3><div class="pe-ps-grid">${traits}</div></div>`;
  }

  function tabHistory() {
    if (!ed.edits.length) return `<div class="pe-card"><h3>History</h3><p>No edits yet for this player.</p></div>`;
    const rows = ed.edits.slice(0, 20).map(e => {
      const keys = Object.keys(e.new);
      const label = keys.slice(0, 4).join(', ') + (keys.length > 4 ? ` +${keys.length - 4} more` : '');
      return `<div class="pe-hist-row"><span>#${e.id} &nbsp;${esc(label)}${e.error ? `<br><span class="pe-hint" style="color:#f85149">${esc(e.error)}</span>` : ''}</span>
        <span style="display:flex;gap:10px;align-items:center"><span class="pe-st ${esc(e.status)}">${esc(e.status)}</span>
        ${e.status === 'applied' ? `<button class="pe-chip" data-undo="${e.id}">Undo</button>` : ''}</span></div>`;
    }).join('');
    return `<div class="pe-card"><h3>History</h3>${rows}</div>`;
  }

  function changedKeys() { return Object.keys(ed.cur).filter(k => ed.cur[k] !== ed.orig[k] && ed.limits[k]); }
  function tabHasChanges(tab) {
    const keys = changedKeys();
    const sets = {
      look: k => /^(skin|hair|facialhair|eye|accessory|sideburns)/.test(k),
      body: k => k === 'height' || k === 'weight' || k === 'bodytypecode',
      boots: k => /^shoe/.test(k),
      ratings: k => k === 'overallrating' || k === 'potential' || ATTR_KEYS.includes(k),
      pos: k => /^preferredposition/.test(k),
      play: k => /trait/.test(k)
    };
    return !!sets[tab] && keys.some(sets[tab]);
  }

  function render() {
    const dlg = document.getElementById('pe-dialog');
    const panel = dlg.querySelector('.pe-panel');
    const prevScroll = panel ? panel.scrollTop : 0;
    const prevTab = panel ? panel.dataset.tab : null;
    const changes = changedKeys();
    const body = { look: tabLook, body: tabBody, boots: tabBoots, ratings: tabRatings, pos: tabPositions, play: tabPlaystyles, hist: tabHistory }[ed.tab]();
    const staleBanner = ed.stale ? `<div class="pe-banner">${esc(ed.stale)}</div>` : '';
    dlg.innerHTML = `<div class="pe-shell">
      <div class="pe-top">
        <div class="pe-title"><h2>${esc(ed.name)}</h2><span>${esc(posLabel(ed.cur.preferredposition1))} · ${esc(ed.source === 'academy' ? 'Academy' : 'Squad')} · generic player</span></div>
        <div class="pe-score"><div><b>${esc(ed.cur.overallrating)}</b><small>Overall</small></div><div><b>${esc(ed.cur.potential)}</b><small>Potential</small></div></div>
        <button class="pe-x" data-close title="Close">✕</button>
      </div>
      <div class="pe-main">
        <nav class="pe-nav">${TABS.map(([id, label]) => `<button class="pe-tab${ed.tab === id ? ' on' : ''}" data-tab="${id}">${label}${tabHasChanges(id) ? '<span class="pe-dot"></span>' : ''}</button>`).join('')}</nav>
        <div class="pe-panel" data-tab="${ed.tab}">${staleBanner}${body}</div>
      </div>
      <div class="pe-foot">
        <span class="pe-msg ${ed.msgKind || ''}">${esc(ed.msg || (changes.length ? `${changes.length} unsaved change${changes.length > 1 ? 's' : ''}` : 'No changes'))}</span>
        <span style="display:flex;gap:10px"><button class="pe-btn" data-reset${changes.length ? '' : ' disabled'}>Reset</button>
        <button class="pe-btn primary" data-save${changes.length && !ed.saving ? '' : ' disabled'}>${ed.saving ? 'Saving…' : 'Save'}</button></span>
      </div></div>`;
    const np = dlg.querySelector('.pe-panel');
    if (np && prevTab === ed.tab) np.scrollTop = prevScroll;
    if (ed.focusBootQ) {
      ed.focusBootQ = false;
      const qi = dlg.querySelector('[data-boot-q]');
      if (qi) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    }
  }

  // ---------- state changes ----------
  function setValue(key, raw) {
    const lim = ed.limits[key];
    let v = Number(raw);
    if (!Number.isFinite(v)) return;
    v = Math.round(v);
    if (lim) v = clamp(v, lim[0], lim[1]);
    ed.cur[key] = v;
    afterChange(key);
  }

  function afterChange(key) {
    ed.msg = ''; ed.msgKind = '';
    if (key === 'preferredposition1' || ATTR_KEYS.includes(key)) {
      if (!ed.overallTouched) {
        const auto = autoOverall();
        if (auto !== null) ed.cur.overallrating = auto;
      }
    }
    if (key === 'overallrating') ed.overallTouched = true;
    render();
  }

  function cyclePlaystyle(f, bit) {
    const s = psState(f, bit);
    const tk = 'trait' + f, ik = 'icontrait' + f;
    if (s === 'none') ed.cur[tk] = setBit(ed.cur[tk], bit, true);
    else if (s === 'base') {
      ed.cur[tk] = setBit(ed.cur[tk], bit, false);
      if (plusCount() < 1) ed.cur[ik] = setBit(ed.cur[ik], bit, true); // free PlayStyle+ slot
    } else ed.cur[ik] = setBit(ed.cur[ik], bit, false);
    ed.msg = ''; render();
  }

  // ---------- talking to the game ----------
  // Resolves true when the main process pushes an update of `kind` ('export' | 'write-log'), false on timeout.
  function waitForUpdate(kind, timeoutMs) {
    return new Promise(resolve => {
      const w = { kind, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) { waiters.splice(i, 1); resolve(false); }
      }, timeoutMs);
    });
  }
  async function pressSync(kind, timeoutMs) {
    const arrived = waitForUpdate(kind, timeoutMs);
    let pressed = false;
    try { pressed = !!(await api().triggerEditorSync()); } catch (e) { pressed = false; }
    if (!pressed) return 'unreachable';
    return (await arrived) ? 'ok' : 'timeout';
  }

  async function reloadHistory() {
    const r = await api().getPlayerEditorState(ed.playerId);
    ed.edits = (r && r.edits) || [];
    return r;
  }

  async function save() {
    const changes = {};
    changedKeys().forEach(k => { changes[k] = ed.cur[k]; });
    ed.saving = true; ed.msg = 'Saving…'; ed.msgKind = ''; render();
    const res = await api().queuePlayerEdit(ed.playerId, changes);
    if (!res || !res.success) {
      ed.saving = false; ed.msg = (res && res.error) || 'Save failed.'; ed.msgKind = 'err'; render();
      return;
    }
    ed.orig = Object.assign({}, ed.cur);
    ed.baseline = Object.assign({}, ed.cur);
    const n = Object.keys(changes).length;
    ed.msg = 'Applying in the game…'; render();
    const result = await pressSync('write-log', 12000);
    ed.saving = false;
    await reloadHistory();
    const latest = ed.edits[0];
    if (result === 'ok' && latest && latest.status === 'applied') { ed.msg = `Applied ${n} change(s) in the game.`; ed.msgKind = 'ok'; }
    else if (result === 'ok' && latest && latest.status === 'failed') { ed.msg = `The game rejected the edit: ${latest.error || 'unknown error'}`; ed.msgKind = 'err'; }
    else if (result === 'unreachable') { ed.msg = 'Saved, but the game window could not be reached. It will be applied automatically the next time the editor syncs with the game.'; ed.msgKind = 'err'; }
    else { ed.msg = 'Saved, but Live Editor did not respond. Check that F11 is bound to player_editor_sync.lua. The edit stays queued and applies on the next sync.'; ed.msgKind = 'err'; }
    render();
  }

  // ---------- events ----------
  function bind(dlg) {
    dlg.addEventListener('click', async (e) => {
      if (!ed) return;
      const t = e.target.closest('[data-close],[data-save],[data-reset],[data-set],[data-filter],[data-ps],[data-undo],[data-tab],[data-toggle-gk],[data-dd],[data-boot],[data-unlink],[data-link-mode]');
      if (t && t.dataset.dd) { ed.openDd = ed.openDd === t.dataset.dd ? null : t.dataset.dd; render(); return; }
      if (ed.openDd && !e.target.closest('.pe-dd')) { ed.openDd = null; render(); if (!t) return; }
      if (!t) return;
      if (t.dataset.unlink) {
        const r = await api().setBootLink(t.dataset.unlink, null);
        if (r && r.success) ed.bootLinks = r.links;
        render(); return;
      }
      if (t.dataset.linkMode) { ed.linkMode = t.dataset.linkMode === 'on'; ed.msg = ''; render(); return; }
      if (t.dataset.boot) {
        const key = t.dataset.boot;
        const link = Number.isInteger(ed.bootLinks[key]) ? ed.bootLinks[key] : null;
        if (ed.linkMode) {
          const r = await api().setBootLink(key, ed.orig.shoetypecode);
          if (r && r.success) { ed.bootLinks = r.links; ed.msg = `Linked this picture to game boot #${ed.orig.shoetypecode}.`; ed.msgKind = 'ok'; }
          else { ed.msg = (r && r.error) || 'Could not save the link.'; ed.msgKind = 'err'; }
        } else if (link !== null) { ed.cur.shoetypecode = link; ed.msg = ''; ed.msgKind = ''; }
        else { ed.msg = 'That boot is not linked to a game id yet. Use "Link pictures to game ids", then click the picture of the boot this player wears in the game.'; ed.msgKind = 'err'; }
        render(); return;
      }
      if (t.hasAttribute('data-close')) { dlg.close(); return; }
      if (t.hasAttribute('data-save')) { await save(); return; }
      if (t.hasAttribute('data-toggle-gk')) { ed.showGk = !ed.showGk; render(); return; }
      if (t.hasAttribute('data-reset')) { ed.cur = Object.assign({}, ed.baseline); ed.orig = Object.assign({}, ed.baseline); ed.overallTouched = false; ed.msg = ''; render(); return; }
      if (t.dataset.tab) { ed.tab = t.dataset.tab; render(); return; }
      if (t.dataset.set) { const [k, v] = t.dataset.set.split(':'); ed.openDd = null; setValue(k, v); return; }
      if (t.dataset.filter) {
        const [kind, group, val] = t.dataset.filter.split(':');
        ed.filters[kind][group] = (['all', 'suggested', 'other'].includes(val) || group === 'length' || group === 'view' || kind === 'boots') ? val : Number(val);
        ed.openDd = null;
        render(); return;
      }
      if (t.dataset.ps) { const [f, bit] = t.dataset.ps.split(':'); cyclePlaystyle(f, Number(bit)); return; }
      if (t.dataset.undo) {
        const res = await api().undoPlayerEdit(Number(t.dataset.undo));
        if (res && res.success) {
          ed.msg = 'Undoing in the game…'; ed.msgKind = 'ok'; render();
          await pressSync('write-log', 12000);
          const r = await reloadHistory();
          if (r && r.state) { const s = r.state.state; ed.orig = Object.assign({}, s); ed.baseline = Object.assign({}, s); ed.cur = Object.assign({}, s); }
          ed.msg = 'Undo sent to the game.';
        } else { ed.msg = (res && res.error) || 'Undo failed.'; ed.msgKind = 'err'; }
        render();
      }
    });
    dlg.addEventListener('input', (e) => {
      if (!ed || !e.target.hasAttribute('data-boot-q')) return;
      ed.filters.boots.q = e.target.value;
      ed.focusBootQ = true;
      render();
    });
    dlg.addEventListener('change', (e) => {
      if (!ed) return;
      const el = e.target;
      if (el.dataset.num) setValue(el.dataset.num, el.value);
      else if (el.dataset.sel) setValue(el.dataset.sel, el.value);
      else if (el.dataset.trait2) { ed.cur.trait2 = setBit(ed.cur.trait2, Number(el.dataset.trait2), el.checked); ed.msg = ''; render(); }
      else if (el.dataset.imp) {
        const q = (s) => Number(dlg.querySelector(`[data-imp="${s}"]`).value);
        if (el.dataset.imp === 'lbs') setValue('weight', q('lbs') / 2.20462262);
        else setValue('height', (q('ft') * 12 + q('in')) * 2.54);
      }
    });
  }

  function ensureDialog() {
    let dlg = document.getElementById('pe-dialog');
    if (!dlg) {
      injectStyles();
      dlg = document.createElement('dialog');
      dlg.id = 'pe-dialog';
      document.body.appendChild(dlg);
      bind(dlg);
      dlg.addEventListener('close', () => { if (!dlg.open) ed = null; });
    }
    return dlg;
  }

  // Opens the editor. `fromButton` = the Edit button, which shows progress while it refreshes from the game.
  async function open(playerId, fromButton) {
    if (!api() || !api().getPlayerEditorState) return;
    let stale = '';
    if (fromButton) { fromButton.disabled = true; fromButton.textContent = 'Syncing with game…'; }
    try {
      if (api().triggerEditorSync) {
        const r = await pressSync('export', 6000);
        if (r === 'unreachable') stale = 'The game could not be reached, so these are the last values synced from Live Editor.';
        else if (r === 'timeout') stale = 'Live Editor did not answer (is F11 bound to player_editor_sync.lua?). Showing the last synced values.';
      }
      const [stateRes, cat, stat] = await Promise.all([
        api().getPlayerEditorState(playerId),
        catalog ? Promise.resolve(catalog) : api().getCustomizationCatalog(),
        staticData ? Promise.resolve(staticData) : api().getPlayerEditorStatic()
      ]);
      catalog = cat || { hair: [], facialHair: [], boots: [], gameBoots: [] };
      const bootLinks = api().getBootLinks ? await api().getBootLinks() : {};
      staticData = stat;
      labels = (stat && stat.labels) || {};
      if (staticData && !staticData.bootsRgb && catalog && catalog.bootsRgb) staticData.bootsRgb = catalog.bootsRgb;
      if (!stateRes || !stateRes.state || !stateRes.state.editable) return;
      const s = stateRes.state.state;
      ed = {
        playerId, name: stateRes.state.name || '', source: stateRes.state.source,
        orig: Object.assign({}, s), baseline: Object.assign({}, s), cur: Object.assign({}, s),
        limits: stateRes.limits || {}, edits: stateRes.edits || [], overallTouched: false, msg: '', msgKind: '', saving: false,
        tab: 'look', showGk: false, stale, linkMode: false, bootLinks: bootLinks || {},
        filters: { hair: { cat: 'suggested', length: 'all' }, facial: { cat: 'all', length: 'all' }, boots: { brand: 'all', link: 'all', q: '' } }
      };
      const dlg = ensureDialog();
      render();
      if (!dlg.open) dlg.showModal();
    } finally {
      if (fromButton) { fromButton.disabled = false; fromButton.textContent = 'Edit player'; }
    }
  }

  // Adds the "Edit player" button into `slot` on the profile page, only for editable players.
  async function attachButton(playerId, slot) {
    if (!slot || !api() || !api().getPlayerEditorState) return;
    try {
      const r = await api().getPlayerEditorState(playerId);
      if (!r || !r.state || !r.state.editable) return;
      const b = document.createElement('button');
      b.className = 'pe-edit-btn';
      b.textContent = 'Edit player';
      b.onclick = () => open(playerId, b);
      injectStyles();
      slot.appendChild(b);
    } catch (e) { /* editor data not available yet; no button */ }
  }

  if (window.api && window.api.onPlayerEditorUpdated) {
    window.api.onPlayerEditorUpdated(async (payload) => {
      const kind = payload && payload.kind;
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].kind === kind) { waiters[i].resolve(true); waiters.splice(i, 1); }
      }
      if (ed && kind === 'export' && !ed.saving) { await reloadHistory(); render(); }
    });
  }

  window.PlayerEditorUI = { open, attachButton };
})();
