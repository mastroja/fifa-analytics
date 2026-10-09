// Squad tab alternate views: List (the existing table) / Depth (pitch) / Academy (js/academy_tracker.js).
//
// Depth view: named lineups (Starting XI, Reserves, plus any the user creates), each with
// its own formation and manual arrangement. Every slot is a list of "strings" (1st, 2nd, 3rd ...): the first two are
// auto-filled (scarcest role first, so one flexible player is not burned on a deep position) unless the user pinned
// someone by drag & drop or the slot's edit dialog; further strings are manual only.
// The pure logic (buildDepth / findGaps) takes plain arrays so it can be unit-tested via module.exports.
//
// Reads app.js globals at render time only (let/const ones by bare name, they are not window properties):
// currentPlayers, currentYouthAcademy, POSITION_SORT_ORDER; functions via window: getPositionInfo, computeAge,
// computeMonthsUntilExpiry, buildPlayerAvatarHtml, openPlayerProfile, calculate* (face stats), formatHeight.
(function (root) {
  'use strict';

  // Position-id numbering lives in app.js (POSITION_MAP); roles are matched by label so this file stays id-free.
  const FAMILY = {
    GK: ['GK'],
    RB: ['RB', 'RWB'], LB: ['LB', 'LWB'], RWB: ['RWB', 'RB'], LWB: ['LWB', 'LB'],
    CB: ['CB', 'LCB', 'RCB', 'SW'],
    CDM: ['CDM', 'RDM', 'LDM'], CM: ['CM', 'RCM', 'LCM'], CAM: ['CAM', 'RAM', 'LAM'],
    RM: ['RM', 'RW'], LM: ['LM', 'LW'],
    RW: ['RW', 'RM', 'RAM', 'RF'], LW: ['LW', 'LM', 'LAM', 'LF'],
    ST: ['ST', 'RS', 'LS', 'CF', 'RF', 'LF']
  };

  // [role, x%, y%] — y=0 is the opposition goal, y=100 is ours.
  const FORMATIONS = {
    '4-3-3': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['CM', 27, 52], ['CDM', 50, 58], ['CM', 73, 52], ['LW', 17, 24], ['ST', 50, 16], ['RW', 83, 24]],
    '4-3-3 Holding': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['CM', 33, 52], ['CM', 67, 52], ['CAM', 50, 38], ['LW', 17, 22], ['ST', 50, 15], ['RW', 83, 22]],
    '4-4-2': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['LM', 14, 48], ['CM', 38, 53], ['CM', 62, 53], ['RM', 86, 48], ['ST', 36, 20], ['ST', 64, 20]],
    '4-2-3-1': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['CDM', 31, 56], ['CDM', 69, 56], ['LM', 16, 36], ['CAM', 50, 38], ['RM', 84, 36], ['ST', 50, 15]],
    '4-1-4-1': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['CDM', 50, 58], ['LM', 14, 38], ['CM', 38, 38], ['CM', 62, 38], ['RM', 86, 40], ['ST', 50, 15]],
    '3-5-2': [['GK', 50, 91], ['CB', 26, 76], ['CB', 50, 78], ['CB', 74, 76], ['LWB', 10, 52], ['CM', 32, 52], ['CDM', 50, 58], ['CM', 68, 52], ['RWB', 90, 52], ['ST', 37, 20], ['ST', 63, 20]],
    '3-4-3': [['GK', 50, 91], ['CB', 26, 76], ['CB', 50, 78], ['CB', 74, 76], ['LM', 12, 52], ['CM', 38, 54], ['CM', 62, 54], ['RM', 88, 52], ['LW', 20, 24], ['ST', 50, 16], ['RW', 80, 24]],
    '5-3-2': [['GK', 50, 91], ['LWB', 9, 68], ['CB', 28, 77], ['CB', 50, 77], ['CB', 72, 77], ['RWB', 91, 68], ['CM', 28, 48], ['CM', 50, 52], ['CM', 72, 48], ['ST', 37, 20], ['ST', 63, 20]]
  };
  const DEFAULT_FORMATION = '4-3-3';
  const EMPTY = '-'; // pin value meaning "leave this string vacant" (a player was removed from the chart)

  const OVR_ALT_PENALTY = 6; // an off-position (alt_positions) player must be this much better to beat a natural one
  const STRING_NAMES = ['1st', '2nd', '3rd'];
  const stringName = i => STRING_NAMES[i] || `${i + 1}th`;
  const SHOWN_STRINGS = 3;   // strings drawn on a pitch card; the rest are "+n more"

  function labelOf(posId) { return root.getPositionInfo(posId).label; }
  function altLabels(p) {
    return String(p.alt_positions || '').split(',').map(s => s.trim()).filter(Boolean).map(labelOf);
  }
  // 0 = natural position, 1 = listed alternative, null = cannot play the role
  // The three central-midfield roles are interchangeable enough that a player listed at any of them (main or alt)
  // counts as a "close" (tier 1, yellow) fit for the others, rather than out of position.
  const CENTRAL_MID_ROLES = ['CDM', 'CM', 'CAM'];
  const CENTRAL_MID_LABELS = CENTRAL_MID_ROLES.flatMap(r => FAMILY[r]);
  function tierFor(p, role) {
    const fam = FAMILY[role];
    if (fam.includes(labelOf(p.position_id))) return 0;
    if (altLabels(p).some(l => fam.includes(l))) return 1;
    if (CENTRAL_MID_ROLES.includes(role) && [labelOf(p.position_id), ...altLabels(p)].some(l => CENTRAL_MID_LABELS.includes(l))) return 1;
    return null;
  }
  const scoreOf = (p, tier) => Number(p.overall || 0) - tier * OVR_ALT_PENALTY;
  const prospectScore = a => Number(a.potential_high || a.potential || 0) * 1000 + Number(a.overall || 0);

  // seniors: player rows; academy: academy rows; exclude: Set of player_ids treated as sold.
  // needs: optional Map player_id -> watchlist player (computeTeamNeeds in app.js) so the Team Needs reasons become flags.
  // pins: optional { slotId: { stringIndex: player_id } } manual arrangement, honoured before the auto fill.
  // autoExclude: optional Set of player_ids the AUTO fill must not use (a pin can still place them) — Reserves lineups.
  function buildDepth(formation, seniors, academy, exclude, needs, pins, autoExclude) {
    const slots = (FORMATIONS[formation] || FORMATIONS[DEFAULT_FORMATION]).map(([role, x, y], i) => ({
      id: i, role, x, y, starter: null, backup: null, backupShared: false, prospect: null, strings: [null, null], pinned: new Set()
    }));
    // one row per player: a duplicated source row must never put someone on the pitch twice
    const seenPool = new Set();
    const pool = seniors.filter(p => {
      if (exclude && exclude.has(p.player_id)) return false;
      const k = String(p.player_id); if (seenPool.has(k)) return false;
      seenPool.add(k); return true;
    });
    const eligible = slots.map(s => pool
      .map(p => ({ p, tier: tierFor(p, s.role) }))
      .filter(e => e.tier !== null)
      .sort((a, b) => scoreOf(b.p, b.tier) - scoreOf(a.p, a.tier)));
    const auto = eligible.map(list => autoExclude ? list.filter(e => !autoExclude.has(e.p.player_id)) : list);

    const order = slots.map((s, i) => i).sort((a, b) => auto[a].length - auto[b].length || a - b);
    // Every player appears at most once in the whole lineup (any slot, any string): `used` holds the ids placed so far.
    const used = new Set();
    const idOf = p => String(p.player_id);
    const byId = id => pool.find(p => String(p.player_id) === String(id));
    const rawPin = (sl, idx) => pins && pins[sl.id] ? pins[sl.id][idx] : undefined;
    const pinOf = (sl, idx) => { const r = rawPin(sl, idx); return r != null && r !== EMPTY ? byId(r) : null; };

    slots.forEach(sl => {
      if (rawPin(sl, 0) === EMPTY) { sl.pinned.add(0); return; }
      const st = pinOf(sl, 0);
      if (st && !used.has(idOf(st))) { sl.starter = st; sl.pinned.add(0); used.add(idOf(st)); }
    });
    slots.forEach(sl => {
      if (rawPin(sl, 1) === EMPTY) { sl.pinned.add(1); return; }
      const bk = pinOf(sl, 1);
      if (bk && !used.has(idOf(bk))) { sl.backup = bk; sl.pinned.add(1); used.add(idOf(bk)); }
    });
    // 3rd string and beyond: manual only
    const extras = [];
    slots.forEach(sl => {
      const pin = pins && pins[sl.id]; if (!pin) return;
      Object.keys(pin).map(Number).filter(i => i >= 2).sort((a, b) => a - b).forEach(i => {
        const p = pin[i] === EMPTY ? null : byId(pin[i]);
        if (p && !used.has(idOf(p))) { extras.push({ sl, i, p }); used.add(idOf(p)); }
      });
    });
    order.forEach(i => {
      if (slots[i].pinned.has(0)) return;
      const pick = auto[i].find(e => !used.has(idOf(e.p)));
      if (pick) { slots[i].starter = pick.p; used.add(idOf(pick.p)); }
    });
    order.forEach(i => {
      if (slots[i].pinned.has(1)) return;
      const pick = auto[i].find(e => !used.has(idOf(e.p)));
      if (pick) { slots[i].backup = pick.p; used.add(idOf(pick.p)); }
    });
    slots.forEach(sl => { sl.strings[0] = sl.starter; sl.strings[1] = sl.backup; });
    extras.forEach(({ sl, i, p }) => {
      while (sl.strings.length <= i) sl.strings.push(null);
      sl.strings[i] = p; sl.pinned.add(i);
    });

    const usedAcademy = new Set();
    const academyUnique = (academy || []).filter((a, i, arr) => arr.findIndex(b => String(b.player_id) === String(a.player_id)) === i);
    order.forEach(i => {
      const fam = FAMILY[slots[i].role];
      const open = academyUnique
        .filter(a => fam.includes(labelOf(a.position_id)))
        .sort((a, b) => prospectScore(b) - prospectScore(a));
      const pick = open.find(a => !usedAcademy.has(String(a.player_id))) || null;
      if (pick) { slots[i].prospect = pick; usedAcademy.add(String(pick.player_id)); }
    });

    slots.forEach(s => { s.flags = findGaps(s, needs); });
    return slots;
  }

  function isExpiring(p) {
    const m = root.computeMonthsUntilExpiry(p.contract_expiry);
    return m !== null && m <= 12;
  }

  // severity: 'high' (red) | 'mid' (amber) | 'info'
  function findGaps(slot, needs) {
    const flags = [];
    if (!slot.starter) { flags.push({ type: 'nostarter', severity: 'high', text: 'No player for this role' }); return flags; }
    const expiring = isExpiring(slot.starter);
    const left = root.computeMonthsUntilExpiry(slot.starter.contract_expiry);
    const when = left < 0 ? `contract ran out in ${slot.starter.contract_expiry}` : `contract ends ${slot.starter.contract_expiry} (${left} month${left === 1 ? '' : 's'} left)`;
    if (expiring && !slot.backup && !slot.prospect) flags.push({ type: 'expiring-uncovered', severity: 'high', text: `Starter's ${when} and there is no replacement` });
    else if (expiring) flags.push({ type: 'expiring', severity: 'info', text: `Starter's ${when}; cover available` });
    if (!slot.backup) flags.push({ type: 'nobackup', severity: 'mid', text: 'No backup in the senior squad' });
    const need = needs && needs.get(slot.starter.player_id);
    if (need) {
      const pos = root.getPositionInfo(need.position_id).label;
      const target = Math.max(75, Number(need.overall || 75) - 2);
      flags.push({
        type: 'need', label: need.__reasons[0].toLowerCase(), severity: slot.backup ? 'info' : 'mid',
        text: `Watchlist: ${need.__reasons.join(', ')}. Suggested replacement: ${pos}, age 23-27, OVR ${target}+`
      });
    }
    return flags;
  }

  const gapKey = (slot, f) => slot.id + ':' + f.type;

  // Pro gating (js/license_ui.js). With licensing off, or no License object, everything is allowed.
  const proOk = f => !root.License || root.License.isPro(f);
  const allow = f => proOk(f) || (root.License.upsell(f), false);
  const lockMark = f => (root.License ? root.License.lock(f) : '');

  // ---- state --------------------------------------------------------------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { return root.localStorage.getItem('squadview:' + k) || d; } catch (e) { return d; } },
    set(k, v) { try { root.localStorage.setItem('squadview:' + k, v); } catch (e) { /* ignore */ } }
  };
  const $ = id => root.document.getElementById(id);
  const sameId = (a, b) => a != null && b != null && String(a) === String(b);

  let mode = 'list';
  let sellId = '';       // "what if I sell X"
  let lastSlots = [];
  let edit = null;       // { slot, idx } while the slot edit dialog is open
  let creating = false;  // the "new lineup" form is open

  // Lineups: Starting XI and Reserves (+ any the user creates), each with its own formation and manual arrangement.
  // `reserve` lineups auto-fill without the Starting XI's starters, so Reserves is naturally the next eleven.
  function freshLineups(formation) {
    return {
      active: 'xi',
      list: [
        { id: 'xi', name: 'Starting XI', core: true, formation: formation || DEFAULT_FORMATION, pins: {} },
        { id: 'rot', name: 'Reserves', core: true, reserve: true, formation: formation || DEFAULT_FORMATION, pins: {} }
      ]
    };
  }
  // The All-Time XI is a hidden lineup (reached from the small trophy button), fed by getAllTimeXI instead of the live squad.
  const ALLTIME = () => ({ id: 'alltime', name: 'All-Time XI', core: true, hidden: true, alltime: true, formation: DEFAULT_FORMATION, pins: {} });
  let lineups = freshLineups();
  const lineupById = id => lineups.list.find(l => l.id === id);
  const active = () => lineupById(lineups.active) || lineups.list[0];
  const pinsOf = l => l.pins;
  const saveLineups = () => store.set('lineups', JSON.stringify(lineups));

  function loadLineups() {
    try {
      const saved = JSON.parse(store.get('lineups', 'null'));
      if (saved && Array.isArray(saved.list) && saved.list.length) {
        lineups = saved;
        lineups.list = lineups.list.filter(l => l.id !== 'default'); // the auto-only Default lineup was dropped
        const rot = lineupById('rot'); if (rot && rot.name === 'Rotation / Reserves') rot.name = 'Reserves';
        ['xi', 'rot'].forEach(id => { if (!lineupById(id)) lineups = freshLineups(); });
        if (!lineupById('alltime')) lineups.list.push(ALLTIME());
        if (!lineupById(lineups.active)) lineups.active = 'xi';
        return;
      }
    } catch (e) { /* fall through to migration */ }
    // Migrate the pre-lineup storage (one formation + pins per formation, starter/backup keys).
    const f = store.get('formation', DEFAULT_FORMATION);
    lineups = freshLineups(FORMATIONS[f] ? f : DEFAULT_FORMATION);
    lineups.list.push(ALLTIME());
    try {
      const old = JSON.parse(store.get('pins', '{}')) || {};
      const forF = old[lineups.list[0].formation] || {};
      Object.keys(forF).forEach(slot => {
        const o = {}; if (forF[slot].starter != null) o[0] = forF[slot].starter; if (forF[slot].backup != null) o[1] = forF[slot].backup;
        if (Object.keys(o).length) lineups.list[0].pins[slot] = o;
      });
    } catch (e) { /* ignore */ }
  }

  const seniorsNow = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
  // All-Time XI data (loaded on demand): peak-season rows for everyone who ever appeared for the club.
  let allTimeRows = null, allTimeLoading = false;
  function prepAllTime(rows) {
    const played = (rows || []).filter(p => Number(p.appearances || 0) > 0);
    // if appearances were never recorded, don't end up with an empty XI: fall back to everyone
    return (played.length >= 11 ? played : (rows || [])).map(p => ({ ...p, __alltime: true, __clubStatus: 'normal' }));
  }
  async function loadAllTime() {
    if (allTimeRows || allTimeLoading) return;
    allTimeLoading = true;
    try {
      const sid = typeof currentSaveId !== 'undefined' ? currentSaveId : null;
      allTimeRows = root.api && root.api.getAllTimeXI ? prepAllTime(await root.api.getAllTimeXI(sid)) : [];
    } catch (e) { console.error('All-Time XI load failed', e); allTimeRows = []; }
    allTimeLoading = false;
    if (mode === 'depth') render();
  }
  const poolFor = l => l.alltime ? (allTimeRows || []) : seniorsNow();
  const academyFor = l => l.alltime ? [] : academyNow();
  const academyNow = () => typeof currentYouthAcademy !== 'undefined' ? currentYouthAcademy || [] : [];
  const needsMap = () => new Map((typeof computeTeamNeeds === 'function' ? computeTeamNeeds() : []).map(p => [p.player_id, p]));

  // Depth for a lineup (Reserves exclude the Starting XI's starters from the auto fill).
  function depthFor(l, seniors, academy, exclude, needs) {
    let autoExclude = (l.removed && l.removed.length) ? new Set(l.removed.map(String)) : null;
    if (autoExclude) autoExclude = new Set([...autoExclude].flatMap(id => [id, Number(id)]));
    if (l.reserve) {
      const xi = lineupById('xi');
      autoExclude = new Set([...(autoExclude || []), ...buildDepth(xi.formation, seniors, academy, exclude, null, pinsOf(xi)).map(s => s.starter && s.starter.player_id).filter(v => v != null)]);
    }
    const slots = buildDepth(l.formation, seniors, academy, exclude, l.alltime ? null : needs, pinsOf(l), autoExclude);
    if (l.alltime) slots.forEach(sl => { sl.flags = []; }); // gap flags are about the live squad
    return slots;
  }

  const uniqById = arr => arr.filter((p, i) => arr.findIndex(q => String(q.player_id) === String(p.player_id)) === i);

  // ---- rendering: pitch ---------------------------------------------------
  // Natural position badge + alternative positions ("alt CDM, RB"), shown wherever a player appears.
  function posBadge(p) {
    const info = root.getPositionInfo(p.position_id);
    return `<span class="pos-badge pos-${info.group} dc-pos">${info.label}</span>`;
  }
  // Alternative positions as small outlined chips next to the main badge; one that fits the slot's role is highlighted.
  function altText(p, role) {
    const nat = labelOf(p.position_id);
    const alts = altLabels(p).filter((l, i, a) => l !== nat && a.indexOf(l) === i);
    if (!alts.length) return '';
    const fam = role ? FAMILY[role] : [];
    // at most two chips (a fitting one first) so the name keeps its room; the tooltip lists them all
    const shown = alts.slice().sort((x, y) => fam.includes(y) - fam.includes(x)).slice(0, 2);
    const more = alts.length - shown.length;
    return `<span class="dc-alts" title="Can also play: ${esc(alts.join(', '))}">${shown.map(l => `<span class="dc-altchip${fam.includes(l) ? ' fits' : ''}">${esc(l)}</span>`).join('')}${more > 0 ? `<span class="dc-altchip">+${more}</span>` : ''}</span>`;
  }
  // Avatar ring = how well the player suits the slot: green natural position, yellow alternative, red neither.
  function fitRing(p, role) {
    if (!role || !FAMILY[role]) return '';
    const t = tierFor(p, role);
    return t === 0 ? 'ring-fit-0' : t === 1 ? 'ring-fit-1' : 'ring-fit-x';
  }

  // kind: string (draggable, drop target; idx = string index) | prospect | top (draggable only) | cand (edit dialog list)
  function personHtml(p, kind, slotId, idx, pinned, role) {
    const isString = kind === 'string';
    const dropAttrs = isString ? ` data-slot="${slotId}" data-idx="${idx}"` : '';
    const cls = isString ? (idx === 0 ? 'dc-starter' : 'dc-backup') : `dc-${kind}`;
    if (!p) return `<div class="dc-row dc-empty"${dropAttrs}>${idx === 0 ? 'Vacant' : idx === 1 ? 'No backup' : kind === 'prospect' ? 'No prospect' : '—'}</div>`;
    const age = p.__alltime ? null : root.computeAge(p.dob);
    const size = isString && idx === 0 ? 46 : 30;
    const ovr = kind === 'prospect'
      ? `${p.overall || '?'}<span class="dc-pot">→${esc(p.potential_high || p.potential || '?')}</span>`
      : `${p.overall || '?'}`;
    const tag = isString && idx > 0 ? `<span class="dc-tag">${idx + 1}</span>` : kind === 'prospect' ? '<span class="dc-tag">🎓</span>' : '';
    const drag = kind === 'prospect' ? '' : ' draggable="true"';
    const rm = isString ? `<button class="dc-rm" title="Remove from this lineup" onclick="event.stopPropagation(); SquadViews.removeFrom(${slotId}, ${idx})">✕</button>` : '';
    return `<div class="dc-row ${cls}${pinned ? ' dc-pinned' : ''}" data-pid="${esc(p.player_id)}"${dropAttrs}${drag} onclick="openPlayerProfile('${p.player_id ?? esc(p.name)}')">${rm}
      <span class="dc-ring ${fitRing(p, role)}">${root.buildPlayerAvatarHtml(p, size, '50%')}</span>
      ${isString && idx === 0
        ? `<span class="dc-col"><span class="dc-name">${esc(p.name)}</span><span class="dc-sub">${posBadge(p)}${altText(p, role)}</span></span>
            <span class="dc-rightcol"><span class="dc-ovr dc-ovr-big">${ovr}</span>${p.__alltime ? '<span class="dc-age">peak</span>' : ''}</span>`
        : isString
          ? `<span class="dc-col"><span class="dc-name"><span class="dc-tag">${idx + 1}</span> ${esc(p.name)}</span><span class="dc-sub">${posBadge(p)}${altText(p, role)}</span></span><span class="dc-ovr">${ovr}</span>`
          : `${tag}<span class="dc-name">${esc(p.name)}</span><span class="dc-ovr">${ovr}</span>`}
    </div>`;
  }

  function flagLabel(f) {
    return f.type === 'nobackup' ? 'no backup' : f.type === 'nostarter' ? 'vacant' : f.type === 'expiring-uncovered' ? 'expiring · no cover' : f.type === 'need' ? f.label : 'expiring';
  }

  // Formation y values are tactical positions; the big cards need a more even vertical spread so rows don't overlap
  // on a one-screen pitch (GK stays inside the bottom edge, ST inside the top).
  const Y_MAP = [[10, 9], [15, 12], [24, 21], [38, 33], [52, 46], [58, 52], [72, 67], [76, 70], [79, 72], [91, 90.5]];
  function mapY(y) {
    for (let i = 1; i < Y_MAP.length; i++) {
      const [x0, y0] = Y_MAP[i - 1], [x1, y1] = Y_MAP[i];
      if (y <= x1) return y0 + (y - x0) * (y1 - y0) / (x1 - x0);
    }
    return Y_MAP[Y_MAP.length - 1][1];
  }

  function slotHtml(s, newKeys) {
    const worst = s.flags.find(f => f.severity === 'high') || s.flags.find(f => f.severity === 'mid') || s.flags[0];
    const flagHtml = s.flags.map(f => `<span class="dc-flag sev-${f.severity}${newKeys && newKeys.has(gapKey(s, f)) ? ' dc-new' : ''}" title="${esc(f.text)}">${esc(flagLabel(f))}</span>`).join('');
    const shown = Math.min(Math.max(s.strings.length, 2), SHOWN_STRINGS);
    const rows = [];
    for (let i = 0; i < shown; i++) rows.push(personHtml(s.strings[i] || null, 'string', s.id, i, s.pinned.has(i), s.role));
    const more = s.strings.length > SHOWN_STRINGS ? `<div class="dc-more">+${s.strings.length - SHOWN_STRINGS} more · edit to see</div>` : '';
    const editBtn = `<button class="dc-edit" title="Edit ${s.role} depth: 1st, 2nd, 3rd string…" onclick="event.stopPropagation(); SquadViews.editSlot(${s.id})">✎</button>`;
    return `<div class="dc-slot${worst ? ' sev-' + worst.severity : ''}" style="left:${s.x}%;top:${mapY(s.y).toFixed(1)}%">
      <div class="dc-slot-head"><strong>${s.role}</strong>${flagHtml}${editBtn}</div>
      ${rows.join('')}${more}
    </div>`;
  }

  // Right-hand reserves list: every senior player not in the active lineup, two cards per row, no height limit.
  function reserveCardHtml(p, tag) {
    const age = p.__alltime ? null : root.computeAge(p.dob);
    return `<div class="dc-rcard" data-pid="${esc(p.player_id)}" draggable="true" onclick="openPlayerProfile('${p.player_id ?? esc(p.name)}')">
      <span class="dc-ring">${root.buildPlayerAvatarHtml(p, 44, '50%')}</span>
      <span class="dc-rinfo"><span class="dc-rname">${esc(p.name)}</span><span class="dc-rsub">${posBadge(p)}${altText(p)}</span>${p.__alltime || tag || p.injury ? `<span class="dc-rsub">${p.__alltime ? `${esc(p.peak_season || '')} · ${p.appearances} apps` : ''}${tag ? `<em>${tag}</em>` : ''}${p.injury ? `${tag ? ' · ' : ''}<em class="dc-inj">injured</em>` : ''}</span>` : ''}</span>
      <span class="dc-rovr">${p.overall || '?'}</span></div>`;
  }

  // ---- rendering: bottom section (squad + academy by position) -------------
  // Academy prospects, same two-wide card layout as the reserves (not draggable: they are not in the senior squad).
  function academyCardHtml(a) {
    const age = root.computeAge(a.dob);
    return `<div class="dc-rcard dc-rcard-academy" data-pid="${esc(a.player_id)}" onclick="openPlayerProfile('${a.player_id ?? esc(a.name)}')">
      <span class="dc-ring">${root.buildPlayerAvatarHtml(a, 44, '50%')}</span>
      <span class="dc-rinfo"><span class="dc-rname">${esc(a.name)}</span><span class="dc-rsub">${posBadge(a)}</span><span class="dc-rsub">age ${age ?? '—'}</span></span>
      <span class="dc-rovr">${a.overall || '?'}<span class="dc-pot"><small>POT</small> ${esc(a.potential_high || a.potential || '?')}</span></span></div>`;
  }

  function depthHtml() {
    const l = active();
    if (l.alltime && !allTimeRows) { loadAllTime(); return '<div class="empty-state" style="padding: 24px;">Digging through the club history…</div>'; }
    const seniors = uniqById(poolFor(l)), academy = uniqById(academyFor(l)), needs = l.alltime ? null : needsMap();
    const base = depthFor(l, seniors, academy, null, needs);
    let slots = base, banner = '', newKeys = null;
    if (sellId) {
      const sold = seniors.find(p => String(p.player_id) === String(sellId));
      slots = depthFor(l, seniors, academy, new Set([sold && sold.player_id]), needs);
      const before = new Set(); base.forEach(s => s.flags.forEach(f => before.add(gapKey(s, f))));
      newKeys = new Set(); const fresh = [];
      slots.forEach(s => s.flags.forEach(f => { const k = gapKey(s, f); if (!before.has(k)) { newKeys.add(k); fresh.push(`${s.role}: ${f.text}`); } }));
      banner = `<div class="dc-banner ${fresh.length ? 'bad' : 'ok'}">If you sell <strong>${esc(sold ? sold.name : '?')}</strong>: ${fresh.length ? `${fresh.length} new gap${fresh.length > 1 ? 's' : ''} — ${fresh.map(esc).join('; ')}` : 'no new gaps.'}</div>`;
    }
    lastSlots = slots;
    const gapCount = slots.reduce((n, s) => n + s.flags.filter(f => f.severity !== 'info').length, 0);
    const hint = l.alltime
      ? 'The best players ever to play for the club, ranked by their peak overall (ties: most appearances). Hover for peak-season details. Drag to change your mind.'
      : l.reserve
      ? 'Reserves fill with the players the Starting XI doesn’t use. Drag players in from the list, or use ✎. Saved automatically.'
      : 'Drag players from the list or between positions, or use ✎ for 1st / 2nd / 3rd string. Saved automatically.';
    const inLineup = new Set(); slots.forEach(sl => sl.strings.forEach(p => p && inLineup.add(p.player_id)));
    const xiStarters = new Set();
    if (l.reserve && !l.alltime) { const xi = lineupById('xi'); buildDepth(xi.formation, seniors, academy, null, null, pinsOf(xi)).forEach(sl => sl.starter && xiStarters.add(sl.starter.player_id)); }
    const rest = seniors.filter(p => !inLineup.has(p.player_id) && !sameId(p.player_id, sellId))
      .sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0));
    const listTitle = l.alltime ? 'All-time bench' : l.reserve ? 'Not in this eleven' : 'Reserves';
    const academySection = l.alltime ? '' : `
          <div class="dc-rhead dc-rhead-academy">Youth academy <span class="dc-dim">${academy.length} prospect${academy.length === 1 ? '' : 's'}</span></div>
          <div class="dc-rgrid">${academy.slice().sort((a, b) => prospectScore(b) - prospectScore(a)).map(academyCardHtml).join('') || '<span class="dc-none">No academy prospects loaded.</span>'}</div>`;
    return `<div class="dc-legend-bar"><span class="dc-ringkey"><i class="dc-dot d0"></i> main position <i class="dc-dot d1"></i> alt position <i class="dc-dot dx"></i> out of position · ${gapCount} gap${gapCount === 1 ? '' : 's'}</span><span>${hint}</span></div>
      ${banner}
      <div class="dc-layout">
        <div class="dc-pitch-wrap"><div class="dc-pitch">${slots.map(s => slotHtml(s, newKeys)).join('')}</div></div>
        <aside class="dc-reserves"><div class="dc-rhead">${listTitle} <span class="dc-dim">${rest.length} player${rest.length === 1 ? '' : 's'}</span></div>
          <div class="dc-rgrid">${rest.map(p => reserveCardHtml(p, xiStarters.has(p.player_id) ? 'XI' : (l.removed || []).some(r => sameId(r, p.player_id)) ? 'removed' : '')).join('') || '<span class="dc-none">Everyone is in the lineup.</span>'}</div>
${academySection}</aside>
      </div>
`;
  }

  // ---- toolbar (next to the List / Depth / Academy toggle) -----------------
  function controlsHtml() {
    const l = active();
    const seniors = poolFor(l);
    const chips = lineups.list.filter(x => !x.hidden).map(x => `<button class="home-toggle-btn${x.id === l.id ? ' active' : ''}" onclick="SquadViews.setLineup('${x.id}')">${esc(x.name)}${x.id === 'xi' ? '' : lockMark('depth-extras')}</button>`).join('')
      + (l.core ? '' : `<button class="dc-x" title="Delete this lineup" onclick="SquadViews.deleteLineup('${l.id}')">✕</button>`)
      + (creating
        ? `<span class="dc-new-form"><input id="dc-new-name" type="text" maxlength="30" placeholder="Lineup name" onkeydown="if(event.key==='Enter')SquadViews.createLineup(); if(event.key==='Escape')SquadViews.cancelCreate();">
           <label title="Auto-fill without the Starting XI's starters"><input id="dc-new-reserve" type="checkbox"> reserves</label>
           <button class="home-toggle-btn" onclick="SquadViews.createLineup()">Add</button><button class="home-toggle-btn" onclick="SquadViews.cancelCreate()">Cancel</button></span>`
        : `<button class="home-toggle-btn" title="Create another lineup (e.g. cup XI, youth team)" onclick="SquadViews.startCreate()">＋ New${lockMark('depth-extras')}</button>`);
    const sellOptions = seniors.slice().sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0))
      .map(p => `<option value="${esc(p.player_id)}"${sameId(p.player_id, sellId) ? ' selected' : ''}>${esc(p.name)} (${p.overall || '?'})</option>`).join('');
    const hasPins = Object.keys(l.pins).length > 0 || (l.removed || []).length > 0;
    const trophy = `<button class="dc-trophy${l.alltime ? ' on' : ''}" title="All-Time XI: the best players ever to play for the club" onclick="SquadViews.setLineup('alltime')">🏆 All-Time XI${lockMark('depth-extras')}</button>`;
    return `<div class="home-toggle dc-lineups">${chips}</div>${trophy}
      <label class="dc-ctl">Formation <select onchange="SquadViews.setFormation(this.value)">${Object.keys(FORMATIONS).map(f => `<option${f === l.formation ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      ${l.alltime ? '' : `<label class="dc-ctl">What if I sell${lockMark('depth-extras')} <select onchange="SquadViews.setSell(this.value)"><option value="">—</option>${sellOptions}</select></label>`}
      ${hasPins ? '<button class="home-toggle-btn" onclick="SquadViews.resetOrder()">Reset order</button>' : ''}`;
  }

  function renderControls() {
    const el = $('squad-view-controls'); if (!el) return;
    el.innerHTML = mode === 'depth' ? controlsHtml() : '';
    if (mode === 'depth' && creating) { const i = $('dc-new-name'); if (i) i.focus(); }
  }

  // ---- manual arrangement ----------------------------------------------------
  // Drop/assign `pid` onto slot/idx; if it came from another string (src) the two players swap places.
  function movePlayer(pid, src, target) {
    const l = active();
    const slot = lastSlots[target.slot]; if (!slot) return;
    const occupant = slot.strings[target.idx] || null;
    if (occupant && sameId(occupant.player_id, pid)) return;
    const P = l.pins;
    const unpin = id => Object.keys(P).forEach(k => {
      Object.keys(P[k]).forEach(i => { if (sameId(P[k][i], id)) delete P[k][i]; });
      if (!Object.keys(P[k]).length) delete P[k];
    });
    unpin(pid); if (occupant) unpin(occupant.player_id);
    l.removed = (l.removed || []).filter(r => !sameId(r, pid)); // putting a player back on the chart un-removes them
    (P[target.slot] = P[target.slot] || {})[target.idx] = pid;
    if (src && occupant) (P[src.slot] = P[src.slot] || {})[src.idx] = occupant.player_id;
    saveLineups(); renderAll();
  }

  // Take a player off the chart: their string stays vacant and they are kept out of the auto fill, so they sit in the list.
  function removeFrom(slotId, idx) {
    const l = active();
    const slot = lastSlots[slotId]; const p = slot && slot.strings[idx];
    if (!p) return;
    const P = l.pins;
    Object.keys(P).forEach(k => {
      Object.keys(P[k]).forEach(i => { if (sameId(P[k][i], p.player_id)) delete P[k][i]; });
      if (!Object.keys(P[k]).length) delete P[k];
    });
    if (idx < 2) (P[slotId] = P[slotId] || {})[idx] = EMPTY;
    l.removed = l.removed || [];
    if (!l.removed.some(r => sameId(r, p.player_id))) l.removed.push(p.player_id);
    saveLineups(); renderAll();
  }

  function clearString(slotId, idx) {
    const l = active();
    const P = l.pins;
    if (P[slotId]) delete P[slotId][idx]; // back to auto (or, for 3rd string and beyond, simply empty)
    if (P[slotId] && !Object.keys(P[slotId]).length) delete P[slotId];
    saveLineups(); renderAll();
  }

  // ---- slot edit dialog ----------------------------------------------------------
  function candidateRows(slot) {
    const role = slot.role;
    return poolFor(active()).map(p => ({ p, tier: tierFor(p, role) }))
      .sort((a, b) => (a.tier === null) - (b.tier === null) || (a.tier ?? 9) - (b.tier ?? 9) || Number(b.p.overall || 0) - Number(a.p.overall || 0));
  }

  function modalHtml() {
    const slot = lastSlots[edit.slot]; if (!slot) return '';
    const role = slot.role;
    const n = Math.max(slot.strings.length, 2);
    const strings = [];
    for (let i = 0; i < n; i++) {
      const p = slot.strings[i];
      strings.push(`<div class="dc-mstring${i === edit.idx ? ' on' : ''}" onclick="SquadViews.pickString(${i})">
        <span class="dc-mlabel">${stringName(i)} string</span>
        ${p ? `<span class="dc-row" data-pid="${esc(p.player_id)}"><span class="dc-name">${esc(p.name)}</span><span class="dc-ovr">${p.overall || '?'}</span></span>
          ${i < 2 && slot.pinned.has(i) ? `<button class="dc-x" title="Back to auto-fill" onclick="event.stopPropagation(); SquadViews.clearString(${slot.id}, ${i})">↺</button>` : ''}
          <button class="dc-x" title="Remove from the chart" onclick="event.stopPropagation(); SquadViews.removeFrom(${slot.id}, ${i})">✕</button>`
          : slot.pinned.has(i) && i < 2 ? `<span class="dc-none">vacant</span><button class="dc-x" title="Back to auto-fill" onclick="event.stopPropagation(); SquadViews.clearString(${slot.id}, ${i})">↺</button>`
          : '<span class="dc-none">empty</span>'}
      </div>`);
    }
    const cands = candidateRows(slot).map(({ p, tier }) => {
      const age = root.computeAge(p.dob);
      const here = slot.strings.findIndex(x => x && sameId(x.player_id, p.player_id));
      const fit = tier === 0 ? 'natural' : tier === 1 ? 'alt pos' : 'out of position';
      return `<div class="dc-row dc-cand${here >= 0 ? ' dc-pinned' : ''}" data-pid="${esc(p.player_id)}" onclick="SquadViews.assign('${esc(p.player_id)}')">
        <span class="dc-ring ${tier === 0 ? 'ring-fit-0' : tier === 1 ? 'ring-fit-1' : 'ring-fit-x'}">${root.buildPlayerAvatarHtml(p, 26, '50%')}</span>
        <span class="dc-name">${esc(p.name)}</span>${posBadge(p)}${altText(p, role)}
        <span class="dc-fit fit-${tier ?? 'x'}">${fit}</span>${here >= 0 ? `<span class="dc-tag">${stringName(here)}</span>` : ''}
        <span class="dc-ovr">${p.overall || '?'}</span><span class="dc-age">${age ?? ''}</span></div>`;
    }).join('');
    return `<div class="dc-modal-card" onclick="event.stopPropagation()">
      <div class="dc-modal-head"><strong>${slot.role} depth</strong><span class="dc-dim">${esc(active().name)} · ${esc(active().formation)}</span>
        <button class="back-btn" style="margin: 0 0 0 auto;" onclick="SquadViews.closeEdit()">✕</button></div>
      <div class="dc-modal-body">
        <div class="dc-mcol"><div class="dc-mtitle">Strings — pick one, then choose a player</div>${strings.join('')}
          <button class="home-toggle-btn" style="margin-top: 8px;" onclick="SquadViews.addString()">＋ Add string</button></div>
        <div class="dc-mcol"><div class="dc-mtitle">Players for <strong>${stringName(edit.idx)} string</strong> · hover for details</div><div class="dc-mlist">${cands}</div></div>
      </div></div>`;
  }

  let modal = null;
  function refreshModal() {
    if (!edit) { if (modal) modal.style.display = 'none'; return; }
    if (!modal) {
      modal = root.document.createElement('div'); modal.className = 'dc-modal';
      modal.addEventListener('click', () => api.closeEdit());
      root.document.body.appendChild(modal);
      bindTip(modal);
    }
    modal.innerHTML = modalHtml(); modal.style.display = 'flex';
  }

  // ---- hover summary ---------------------------------------------------------
  function findPlayer(pid) {
    return poolFor(active()).concat(academyNow()).concat(allTimeRows || []).find(p => sameId(p.player_id, pid));
  }
  function summaryHtml(p) {
    const attrs = p.attributes || {};
    const hasAttrs = Object.keys(attrs).length > 0;
    const ovr = Number(p.overall || 0);
    const gk = Number(p.position_id) === 0;
    const parts = !hasAttrs ? [] : gk
      ? [['DIV', attrs.diving], ['HAN', attrs.handling], ['KIC', attrs.kicking], ['REF', attrs.reflexes], ['SPD', root.calculatePace(attrs, ovr)], ['POS', attrs.gk_positioning]]
      : [['PAC', root.calculatePace(attrs, ovr)], ['SHO', root.calculateShooting(attrs, ovr)], ['PAS', root.calculatePassing(attrs, ovr)], ['DRI', root.calculateDribbling(attrs, ovr)], ['DEF', root.calculateDefending(attrs, ovr)], ['PHY', root.calculatePhysical(attrs, ovr)]];
    const age = p.__alltime ? null : root.computeAge(p.dob);
    const alt = root.getAltPositionsLabel(p.alt_positions);
    const row = (k, v) => `<div><span>${k}</span><strong>${v}</strong></div>`;
    const cats = parts.length ? `<div class="dc-tip-cats">${parts.map(([l, v]) => `<div><span>${l}</span><strong>${Number(v ?? ovr)}</strong></div>`).join('')}</div>` : '';
    return `<div class="dc-tip-title">${esc(p.name)} <em>${root.getPositionInfo(p.position_id).label}</em></div>
      ${p.__alltime ? '' : row('Age', age ?? '—')}${row('Overall', p.__alltime ? ovr + ' (peak)' : (ovr || '—'))}${p.potential_high || p.potential ? row('Potential', esc(p.potential_high || p.potential)) : ''}
      ${cats}
      ${row('Preferred foot', p.preferred_foot ? esc(p.preferred_foot) : '—')}${row('Height', p.height ? root.formatHeight(p.height) : '—')}
      ${row('Weak foot', p.weak_foot ? p.weak_foot + '★' : '—')}${row('Skill moves', p.skill_moves ? p.skill_moves + '★' : '—')}
      ${row('Alt positions', alt || 'none')}
      ${p.__alltime ? row('Peak season', esc(p.peak_season || '—')) + row('Club career', `${p.appearances} apps · ${p.goals} G · ${p.assists} A`) + row('Seasons', p.seasons) : ''}`;
  }
  let tip = null;
  function moveTip(e) {
    if (!tip) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 16, root.innerWidth - w - 8) + 'px';
    tip.style.top = Math.min(e.clientY + 16, root.innerHeight - h - 8) + 'px';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  function bindTip(el) {
    if (!tip) {
      tip = root.document.createElement('div'); tip.className = 'dc-tip'; tip.style.display = 'none';
      root.document.body.appendChild(tip);
    }
    el.addEventListener('mouseover', e => {
      const row = e.target.closest('[data-pid]'); if (!row) return;
      const p = findPlayer(row.dataset.pid); if (!p) return;
      tip.innerHTML = summaryHtml(p); tip.style.display = 'block'; moveTip(e);
    });
    el.addEventListener('mousemove', moveTip);
    el.addEventListener('mouseout', e => { if (e.target.closest('[data-pid]')) hideTip(); });
  }

  let wired = false;
  function wireHost() {
    const host = $('squad-alt-view'); if (!host || wired) return;
    wired = true;
    bindTip(host);
    host.addEventListener('dragstart', e => {
      const row = e.target.closest('[data-pid]'); if (!row) return;
      hideTip();
      e.dataTransfer.setData('text/plain', JSON.stringify({ pid: row.dataset.pid, slot: row.dataset.slot ?? null, idx: row.dataset.idx ?? null }));
      e.dataTransfer.effectAllowed = 'move';
    });
    host.addEventListener('dragover', e => { const r = e.target.closest('.dc-row[data-slot]'); if (r) { e.preventDefault(); r.classList.add('dc-over'); } });
    host.addEventListener('dragleave', e => { const r = e.target.closest('.dc-row'); if (r) r.classList.remove('dc-over'); });
    host.addEventListener('drop', e => {
      const row = e.target.closest('.dc-row[data-slot]'); if (!row) return;
      e.preventDefault();
      let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
      const src = d.slot !== null && d.slot !== undefined ? { slot: Number(d.slot), idx: Number(d.idx) } : null;
      movePlayer(d.pid, src, { slot: Number(row.dataset.slot), idx: Number(row.dataset.idx) });
    });
  }

  // ---- Home "Squad Gaps" card (always based on the Starting XI lineup) ---------------------------
  function renderGapsCard() {
    const el = $('home-squad-gaps-body'); if (!el) return;
    const seniors = seniorsNow();
    if (!seniors.length) { el.innerHTML = '<div class="empty-state" style="padding: 12px;">No squad data loaded.</div>'; return; }
    const needs = needsMap();
    const xi = lineupById('xi');
    const slots = buildDepth(xi.formation, seniors, academyNow(), null, needs, xi.pins);
    const rank = { high: 0, mid: 1, info: 2 };
    const rows = slots.map(s => ({ s, worst: s.flags.slice().sort((a, b) => rank[a.severity] - rank[b.severity])[0] }))
      .filter(r => r.worst && r.worst.severity !== 'info')
      .sort((a, b) => rank[a.worst.severity] - rank[b.worst.severity]);
    const starters = new Set(slots.map(s => s.starter && s.starter.player_id));
    const bench = [...needs.values()].filter(p => !starters.has(p.player_id)).slice(0, 5);
    const rowHtml = r => `<tr class="clickable-name" ${r.s.starter ? `onclick="openPlayerProfile('${r.s.starter.player_id}')"` : ''}>
      <td><span class="pos-badge">${r.s.role}</span></td><td>${r.s.starter ? esc(r.s.starter.name) : '<em>Vacant</em>'}</td>
      <td>${r.s.flags.map(f => `<span class="dc-flag sev-${f.severity}" title="${esc(f.text)}">${esc(flagLabel(f))}</span>`).join(' ')}</td></tr>`;
    el.innerHTML = `<div style="font-size: 12px; color: var(--text-dim); margin-bottom: 6px;">Starting XI · ${esc(xi.formation)} · hover a flag for detail</div>`
      + (rows.length ? `<table class="sub-table"><thead><tr><th>Slot</th><th>Starter</th><th>Flags</th></tr></thead><tbody>${rows.slice(0, 8).map(rowHtml).join('')}</tbody></table>`
        : '<div class="empty-state" style="padding: 12px;">No gaps in the starting shape.</div>')
      + (bench.length ? `<div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; margin: 12px 0 6px;">Watchlist (outside the starting shape)</div>
        <table class="sub-table"><tbody>${bench.map(p => `<tr class="clickable-name" onclick="openPlayerProfile('${p.player_id}')"><td>${esc(p.name)}</td><td>${root.getPositionInfo(p.position_id).label}</td><td>${p.overall || '?'}</td><td>${esc(p.__reasons.join(', '))}</td></tr>`).join('')}</tbody></table>` : '');
  }

  // ---- view switching ----------------------------------------------------------
  function render() {
    hideTip();
    const host = $('squad-alt-view');
    renderControls();
    if (!host || mode === 'list') return;
    if (mode === 'academy') { if (root.AcademyTracker) root.AcademyTracker.show(); return; }
    if (mode === 'finance') { if (root.SquadFinance) root.SquadFinance.show(); return; }
    if (mode === 'compare') { if (root.SquadCompare) root.SquadCompare.show(); return; }
    host.innerHTML = depthHtml();
    refreshModal();
  }
  function renderAll() { render(); renderGapsCard(); }

  function applyMode() {
    const list = mode === 'list';
    ['squad-season-bar', 'squad-filter-mount', 'squad-list-controls', 'squad-table-wrap'].forEach(id => { const el = $(id); if (el) el.style.display = list ? '' : 'none'; });
    const host = $('squad-alt-view'); if (host) host.style.display = list ? 'none' : '';
    ['list', 'depth', 'academy', 'finance', 'compare'].forEach(m => { const b = $('squad-view-' + m); if (b) b.classList.toggle('active', m === mode); });
    if (mode !== 'depth') { edit = null; refreshModal(); }
  }
  function setView(m) {
    if (m === 'academy' && !allow('academy-tracker')) return;
    mode = m; applyMode();
    if (m === 'list') { renderControls(); if (root.renderTableRows) root.renderTableRows(); } else render();
  }

  const api = {
    mode: () => mode,
    render, renderGapsCard,
    refresh() {
      renderGapsCard();
      if (root.AcademyTracker) { root.AcademyTracker.invalidate(); if (mode === 'academy') root.AcademyTracker.reload(); }
      if (mode === 'depth' || mode === 'finance' || mode === 'compare') render();
    },
    setView,
    setFormation(f) { if (!FORMATIONS[f]) return; active().formation = f; saveLineups(); renderAll(); },
    setSell(id) { if (id && !allow('depth-extras')) { render(); return; } sellId = id; render(); },
    resetOrder() { const l = active(); l.pins = {}; l.removed = []; saveLineups(); renderAll(); },
    setAllTimeData(rows) { allTimeRows = prepAllTime(rows); },
    setLineup(id) { if (!lineupById(id)) return; if (id !== 'xi' && !allow('depth-extras')) return; if (id === 'alltime') sellId = ''; lineups.active = id; edit = null; creating = false; saveLineups(); render(); },
    startCreate() { if (!allow('depth-extras')) return; creating = true; renderControls(); },
    cancelCreate() { creating = false; renderControls(); },
    createLineup() {
      const name = ($('dc-new-name') || {}).value;
      if (!name || !name.trim()) return;
      const reserve = !!($('dc-new-reserve') || {}).checked;
      const id = 'c' + Date.now().toString(36);
      lineups.list.push({ id, name: name.trim().slice(0, 30), formation: active().formation, pins: {}, reserve });
      lineups.active = id; creating = false; saveLineups(); render();
    },
    deleteLineup(id) {
      const l = lineupById(id); if (!l || l.core) return;
      lineups.list = lineups.list.filter(x => x.id !== id); lineups.active = 'xi'; saveLineups(); render();
    },
    editSlot(id) { edit = { slot: id, idx: 0 }; refreshModal(); },
    closeEdit() { edit = null; hideTip(); refreshModal(); },
    pickString(i) { if (edit) { edit.idx = i; refreshModal(); } },
    addString() {
      if (!edit) return;
      const slot = lastSlots[edit.slot]; edit.idx = Math.max(slot.strings.length, 2);
      slot.strings.push(null); // placeholder row until a player is chosen
      refreshModal();
    },
    assign(pid) { if (edit) { movePlayer(pid, null, { slot: edit.slot, idx: edit.idx }); } },
    clearString, removeFrom,
    // Called by License.refresh(): if the license lapsed while a Pro lineup / view is showing, fall back to the free one.
    applyLicense() {
      let changed = false;
      if (lineups.active !== 'xi' && !proOk('depth-extras')) { lineups.active = 'xi'; sellId = ''; edit = null; changed = true; }
      if (mode === 'academy' && !proOk('academy-tracker')) { mode = 'list'; applyMode(); changed = true; }
      if (changed) { if (mode === 'list') { if (root.renderTableRows) root.renderTableRows(); renderControls(); } else render(); }
      else if (mode === 'depth') renderControls();
    },
    init() {
      loadLineups();
      wireHost();
      mode = 'list'; // the Squad tab always opens on the List view
      applyMode(); render(); renderGapsCard();
    },
    buildDepth, findGaps, FORMATIONS, movePlayer, summaryHtml,
    _lineups: () => lineups
  };

  root.SquadViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) root.document.addEventListener('DOMContentLoaded', () => api.init());
})(typeof window !== 'undefined' ? window : globalThis);
