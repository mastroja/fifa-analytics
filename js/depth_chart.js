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

  const OVR_ALT_PENALTY = 6; // an off-position (alt_positions) player must be this much better to beat a natural one
  const STRING_NAMES = ['1st', '2nd', '3rd'];
  const stringName = i => STRING_NAMES[i] || `${i + 1}th`;
  const SHOWN_STRINGS = 3;   // strings drawn on a pitch card; the rest are "+n more"

  function labelOf(posId) { return root.getPositionInfo(posId).label; }
  function altLabels(p) {
    return String(p.alt_positions || '').split(',').map(s => s.trim()).filter(Boolean).map(labelOf);
  }
  // 0 = natural position, 1 = listed alternative, null = cannot play the role
  function tierFor(p, role) {
    const fam = FAMILY[role];
    if (fam.includes(labelOf(p.position_id))) return 0;
    if (altLabels(p).some(l => fam.includes(l))) return 1;
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
    const pool = seniors.filter(p => !(exclude && exclude.has(p.player_id)));
    const eligible = slots.map(s => pool
      .map(p => ({ p, tier: tierFor(p, s.role) }))
      .filter(e => e.tier !== null)
      .sort((a, b) => scoreOf(b.p, b.tier) - scoreOf(a.p, a.tier)));
    const auto = eligible.map(list => autoExclude ? list.filter(e => !autoExclude.has(e.p.player_id)) : list);

    const order = slots.map((s, i) => i).sort((a, b) => auto[a].length - auto[b].length || a - b);
    const starters = new Set();
    const byId = id => pool.find(p => String(p.player_id) === String(id));
    const pinOf = (sl, idx) => (pins && pins[sl.id] && pins[sl.id][idx] != null) ? byId(pins[sl.id][idx]) : null;

    slots.forEach(sl => {
      const st = pinOf(sl, 0);
      if (st && !starters.has(st)) { sl.starter = st; sl.pinned.add(0); starters.add(st); }
    });
    slots.forEach(sl => {
      const bk = pinOf(sl, 1);
      if (bk && !starters.has(bk)) { sl.backup = bk; sl.pinned.add(1); }
    });
    order.forEach(i => {
      if (slots[i].pinned.has(0)) return;
      const pick = auto[i].find(e => !starters.has(e.p));
      if (pick) { slots[i].starter = pick.p; starters.add(pick.p); }
    });

    const backups = new Set(slots.filter(sl => sl.pinned.has(1)).map(sl => sl.backup));
    // a player pinned to the 3rd string (or lower) of a slot is not also that slot's auto backup
    const extraIn = slots.map(sl => new Set(Object.keys((pins && pins[sl.id]) || {}).map(Number).filter(i => i >= 2).map(i => byId(pins[sl.id][i])).filter(Boolean)));
    order.forEach(i => {
      if (slots[i].pinned.has(1)) return;
      const open = auto[i].filter(e => !starters.has(e.p) && !extraIn[i].has(e.p));
      const fresh = open.find(e => !backups.has(e.p));
      const pick = fresh || open[0];
      if (pick) { slots[i].backup = pick.p; slots[i].backupShared = !fresh; backups.add(pick.p); }
    });

    // 3rd string and beyond: manual only, never a starter elsewhere, never twice in the same slot
    slots.forEach(sl => {
      sl.strings[0] = sl.starter; sl.strings[1] = sl.backup;
      const pin = pins && pins[sl.id];
      if (!pin) return;
      Object.keys(pin).map(Number).filter(i => i >= 2).sort((a, b) => a - b).forEach(i => {
        const p = byId(pin[i]);
        if (p && !starters.has(p) && !sl.strings.includes(p)) {
          while (sl.strings.length <= i) sl.strings.push(null);
          sl.strings[i] = p; sl.pinned.add(i);
        }
      });
    });

    const usedAcademy = new Set();
    order.forEach(i => {
      const fam = FAMILY[slots[i].role];
      const open = (academy || [])
        .filter(a => fam.includes(labelOf(a.position_id)))
        .sort((a, b) => prospectScore(b) - prospectScore(a));
      const pick = open.find(a => !usedAcademy.has(a)) || null;
      if (pick) { slots[i].prospect = pick; usedAcademy.add(pick); }
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
        if (!lineupById(lineups.active)) lineups.active = 'xi';
        return;
      }
    } catch (e) { /* fall through to migration */ }
    // Migrate the pre-lineup storage (one formation + pins per formation, starter/backup keys).
    const f = store.get('formation', DEFAULT_FORMATION);
    lineups = freshLineups(FORMATIONS[f] ? f : DEFAULT_FORMATION);
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
  const academyNow = () => typeof currentYouthAcademy !== 'undefined' ? currentYouthAcademy || [] : [];
  const needsMap = () => new Map((typeof computeTeamNeeds === 'function' ? computeTeamNeeds() : []).map(p => [p.player_id, p]));

  // Depth for a lineup (Reserves exclude the Starting XI's starters from the auto fill).
  function depthFor(l, seniors, academy, exclude, needs) {
    let autoExclude = null;
    if (l.reserve) {
      const xi = lineupById('xi');
      autoExclude = new Set(buildDepth(xi.formation, seniors, academy, exclude, null, pinsOf(xi)).map(s => s.starter && s.starter.player_id).filter(v => v != null));
    }
    return buildDepth(l.formation, seniors, academy, exclude, needs, pinsOf(l), autoExclude);
  }

  // ---- rendering: pitch ---------------------------------------------------
  function ringClass(age) { return age === null ? '' : age < 21 ? 'ring-young' : age >= 30 ? 'ring-old' : ''; }

  // kind: string (draggable, drop target; idx = string index) | prospect | top (draggable only) | cand (edit dialog list)
  function personHtml(p, kind, slotId, idx, pinned) {
    const isString = kind === 'string';
    const dropAttrs = isString ? ` data-slot="${slotId}" data-idx="${idx}"` : '';
    const cls = isString ? (idx === 0 ? 'dc-starter' : 'dc-backup') : `dc-${kind}`;
    if (!p) return `<div class="dc-row dc-empty"${dropAttrs}>${idx === 0 ? 'Vacant' : idx === 1 ? 'No backup' : kind === 'prospect' ? 'No prospect' : '—'}</div>`;
    const age = root.computeAge(p.dob);
    const size = isString && idx === 0 ? 52 : 34;
    const ovr = kind === 'prospect'
      ? `${p.overall || '?'}<span class="dc-pot">→${esc(p.potential_high || p.potential || '?')}</span>`
      : `${p.overall || '?'}`;
    const tag = isString && idx > 0 ? `<span class="dc-tag">${idx + 1}</span>` : kind === 'prospect' ? '<span class="dc-tag">🎓</span>' : '';
    const drag = kind === 'prospect' ? '' : ' draggable="true"';
    return `<div class="dc-row ${cls}${pinned ? ' dc-pinned' : ''}" data-pid="${esc(p.player_id)}"${dropAttrs}${drag} onclick="openPlayerProfile('${p.player_id ?? esc(p.name)}')">
      <span class="dc-ring ${ringClass(age)}">${root.buildPlayerAvatarHtml(p, size, '50%')}</span>
      ${isString && idx === 0
        ? `<span class="dc-col"><span class="dc-name">${esc(p.name)}</span><span class="dc-sub"><span class="dc-ovr">${ovr}</span> OVR · age ${age ?? '—'}</span></span>`
        : `${tag}<span class="dc-name">${esc(p.name)}</span><span class="dc-ovr">${ovr}</span><span class="dc-age">${age ?? ''}</span>`}
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
    for (let i = 0; i < shown; i++) rows.push(personHtml(s.strings[i] || null, 'string', s.id, i, s.pinned.has(i)));
    const more = s.strings.length > SHOWN_STRINGS ? `<div class="dc-more">+${s.strings.length - SHOWN_STRINGS} more · edit to see</div>` : '';
    const editBtn = `<button class="dc-edit" title="Edit ${s.role} depth: 1st, 2nd, 3rd string…" onclick="event.stopPropagation(); SquadViews.editSlot(${s.id})">✎</button>`;
    return `<div class="dc-slot${worst ? ' sev-' + worst.severity : ''}" style="left:${s.x}%;top:${mapY(s.y).toFixed(1)}%">
      <div class="dc-slot-head"><strong>${s.role}</strong>${flagHtml}${editBtn}</div>
      ${rows.join('')}${more}
    </div>`;
  }

  // Right-hand reserves list: every senior player not in the active lineup, two cards per row, no height limit.
  function reserveCardHtml(p, tag) {
    const age = root.computeAge(p.dob);
    return `<div class="dc-rcard" data-pid="${esc(p.player_id)}" draggable="true" onclick="openPlayerProfile('${p.player_id ?? esc(p.name)}')">
      <span class="dc-ring ${ringClass(age)}">${root.buildPlayerAvatarHtml(p, 44, '50%')}</span>
      <span class="dc-rinfo"><span class="dc-rname">${esc(p.name)}</span><span class="dc-rsub">${labelOf(p.position_id)} · ${age ?? '—'}${tag ? ` · <em>${tag}</em>` : ''}${p.injury ? ' · <em class="dc-inj">injured</em>' : ''}</span></span>
      <span class="dc-rovr">${p.overall || '?'}</span></div>`;
  }

  // ---- rendering: bottom section (squad + academy by position) -------------
  // Academy prospects, same two-wide card layout as the reserves (not draggable: they are not in the senior squad).
  function academyCardHtml(a) {
    const age = root.computeAge(a.dob);
    return `<div class="dc-rcard dc-rcard-academy" data-pid="${esc(a.player_id)}" onclick="openPlayerProfile('${a.player_id ?? esc(a.name)}')">
      <span class="dc-ring ${ringClass(age)}">${root.buildPlayerAvatarHtml(a, 44, '50%')}</span>
      <span class="dc-rinfo"><span class="dc-rname">${esc(a.name)}</span><span class="dc-rsub">${labelOf(a.position_id)} · ${age ?? '—'} · <em>🎓 academy</em></span></span>
      <span class="dc-rovr">${a.overall || '?'}<span class="dc-pot">→${esc(a.potential_high || a.potential || '?')}</span></span></div>`;
  }

  function depthHtml() {
    const l = active();
    const seniors = seniorsNow(), academy = academyNow(), needs = needsMap();
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
    const hint = l.reserve
      ? 'Reserves fill with the players the Starting XI doesn’t use. Drag players in from the list, or use ✎. Saved automatically.'
      : 'Drag players from the list or between positions, or use ✎ for 1st / 2nd / 3rd string. Saved automatically.';
    const inLineup = new Set(); slots.forEach(sl => sl.strings.forEach(p => p && inLineup.add(p.player_id)));
    const xiStarters = new Set();
    if (l.reserve) { const xi = lineupById('xi'); buildDepth(xi.formation, seniors, academy, null, null, pinsOf(xi)).forEach(sl => sl.starter && xiStarters.add(sl.starter.player_id)); }
    const rest = seniors.filter(p => !inLineup.has(p.player_id) && !sameId(p.player_id, sellId))
      .sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0));
    const listTitle = l.reserve ? 'Not in this eleven' : 'Reserves';
    return `<div class="dc-legend-bar"><span><span class="dc-ring ring-young">&nbsp;</span> under 21 <span class="dc-ring ring-old">&nbsp;</span> 30+ · ${gapCount} gap${gapCount === 1 ? '' : 's'}</span><span>${hint}</span></div>
      ${banner}
      <div class="dc-layout">
        <div class="dc-pitch-wrap"><div class="dc-pitch">${slots.map(s => slotHtml(s, newKeys)).join('')}</div></div>
        <aside class="dc-reserves"><div class="dc-rhead">${listTitle} <span class="dc-dim">${rest.length} player${rest.length === 1 ? '' : 's'}</span></div>
          <div class="dc-rgrid">${rest.map(p => reserveCardHtml(p, xiStarters.has(p.player_id) ? 'XI' : '')).join('') || '<span class="dc-none">Everyone is in the lineup.</span>'}</div>
          <div class="dc-rhead dc-rhead-academy">Youth academy <span class="dc-dim">${academy.length} prospect${academy.length === 1 ? '' : 's'}</span></div>
          <div class="dc-rgrid">${academy.slice().sort((a, b) => prospectScore(b) - prospectScore(a)).map(academyCardHtml).join('') || '<span class="dc-none">No academy prospects loaded.</span>'}</div></aside>
      </div>
`;
  }

  // ---- toolbar (next to the List / Depth / Academy toggle) -----------------
  function controlsHtml() {
    const l = active();
    const seniors = seniorsNow();
    const chips = lineups.list.map(x => `<button class="home-toggle-btn${x.id === l.id ? ' active' : ''}" onclick="SquadViews.setLineup('${x.id}')">${esc(x.name)}</button>`).join('')
      + (l.core ? '' : `<button class="dc-x" title="Delete this lineup" onclick="SquadViews.deleteLineup('${l.id}')">✕</button>`)
      + (creating
        ? `<span class="dc-new-form"><input id="dc-new-name" type="text" maxlength="30" placeholder="Lineup name" onkeydown="if(event.key==='Enter')SquadViews.createLineup(); if(event.key==='Escape')SquadViews.cancelCreate();">
           <label title="Auto-fill without the Starting XI's starters"><input id="dc-new-reserve" type="checkbox"> reserves</label>
           <button class="home-toggle-btn" onclick="SquadViews.createLineup()">Add</button><button class="home-toggle-btn" onclick="SquadViews.cancelCreate()">Cancel</button></span>`
        : `<button class="home-toggle-btn" title="Create another lineup (e.g. cup XI, youth team)" onclick="SquadViews.startCreate()">＋ New</button>`);
    const sellOptions = seniors.slice().sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0))
      .map(p => `<option value="${esc(p.player_id)}"${sameId(p.player_id, sellId) ? ' selected' : ''}>${esc(p.name)} (${p.overall || '?'})</option>`).join('');
    const hasPins = Object.keys(l.pins).length > 0;
    return `<div class="home-toggle dc-lineups">${chips}</div>
      <label class="dc-ctl">Formation <select onchange="SquadViews.setFormation(this.value)">${Object.keys(FORMATIONS).map(f => `<option${f === l.formation ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
      <label class="dc-ctl">What if I sell <select onchange="SquadViews.setSell(this.value)"><option value="">—</option>${sellOptions}</select></label>
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
    (P[target.slot] = P[target.slot] || {})[target.idx] = pid;
    if (src && occupant) (P[src.slot] = P[src.slot] || {})[src.idx] = occupant.player_id;
    saveLineups(); renderAll();
  }

  function clearString(slotId, idx) {
    const l = active();
    const P = l.pins;
    if (idx < 2) {
      // an auto-filled string can't be left empty by clearing it; pin "nobody" isn't a thing, so just drop the pin
      if (P[slotId]) delete P[slotId][idx];
    } else if (P[slotId]) delete P[slotId][idx];
    if (P[slotId] && !Object.keys(P[slotId]).length) delete P[slotId];
    saveLineups(); renderAll();
  }

  // ---- slot edit dialog ----------------------------------------------------------
  function candidateRows(slot) {
    const role = slot.role;
    return seniorsNow().map(p => ({ p, tier: tierFor(p, role) }))
      .sort((a, b) => (a.tier === null) - (b.tier === null) || (a.tier ?? 9) - (b.tier ?? 9) || Number(b.p.overall || 0) - Number(a.p.overall || 0));
  }

  function modalHtml() {
    const slot = lastSlots[edit.slot]; if (!slot) return '';
    const n = Math.max(slot.strings.length, 2);
    const strings = [];
    for (let i = 0; i < n; i++) {
      const p = slot.strings[i];
      strings.push(`<div class="dc-mstring${i === edit.idx ? ' on' : ''}" onclick="SquadViews.pickString(${i})">
        <span class="dc-mlabel">${stringName(i)} string</span>
        ${p ? `<span class="dc-row" data-pid="${esc(p.player_id)}"><span class="dc-name">${esc(p.name)}</span><span class="dc-ovr">${p.overall || '?'}</span></span>
          <button class="dc-x" title="${i < 2 ? 'Back to auto' : 'Remove'}" onclick="event.stopPropagation(); SquadViews.clearString(${slot.id}, ${i})">✕</button>`
          : '<span class="dc-none">empty</span>'}
      </div>`);
    }
    const cands = candidateRows(slot).map(({ p, tier }) => {
      const age = root.computeAge(p.dob);
      const here = slot.strings.findIndex(x => x && sameId(x.player_id, p.player_id));
      const fit = tier === 0 ? 'natural' : tier === 1 ? 'alt pos' : 'out of position';
      return `<div class="dc-row dc-cand${here >= 0 ? ' dc-pinned' : ''}" data-pid="${esc(p.player_id)}" onclick="SquadViews.assign('${esc(p.player_id)}')">
        <span class="dc-ring ${ringClass(age)}">${root.buildPlayerAvatarHtml(p, 26, '50%')}</span>
        <span class="dc-name">${esc(p.name)}</span><span class="dc-tag">${labelOf(p.position_id)}</span>
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
    return seniorsNow().concat(academyNow()).find(p => sameId(p.player_id, pid));
  }
  function summaryHtml(p) {
    const attrs = p.attributes || {};
    const hasAttrs = Object.keys(attrs).length > 0;
    const ovr = Number(p.overall || 0);
    const gk = Number(p.position_id) === 0;
    const parts = !hasAttrs ? [] : gk
      ? [['DIV', attrs.diving], ['HAN', attrs.handling], ['KIC', attrs.kicking], ['REF', attrs.reflexes], ['SPD', root.calculatePace(attrs, ovr)], ['POS', attrs.gk_positioning]]
      : [['PAC', root.calculatePace(attrs, ovr)], ['SHO', root.calculateShooting(attrs, ovr)], ['PAS', root.calculatePassing(attrs, ovr)], ['DRI', root.calculateDribbling(attrs, ovr)], ['DEF', root.calculateDefending(attrs, ovr)], ['PHY', root.calculatePhysical(attrs, ovr)]];
    const age = root.computeAge(p.dob);
    const alt = root.getAltPositionsLabel(p.alt_positions);
    const row = (k, v) => `<div><span>${k}</span><strong>${v}</strong></div>`;
    const cats = parts.length ? `<div class="dc-tip-cats">${parts.map(([l, v]) => `<div><span>${l}</span><strong>${Number(v ?? ovr)}</strong></div>`).join('')}</div>` : '';
    return `<div class="dc-tip-title">${esc(p.name)} <em>${root.getPositionInfo(p.position_id).label}</em></div>
      ${row('Age', age ?? '—')}${row('Overall', ovr || '—')}${p.potential_high || p.potential ? row('Potential', esc(p.potential_high || p.potential)) : ''}
      ${cats}
      ${row('Preferred foot', p.preferred_foot ? esc(p.preferred_foot) : '—')}${row('Height', p.height ? root.formatHeight(p.height) : '—')}
      ${row('Weak foot', p.weak_foot ? p.weak_foot + '★' : '—')}${row('Skill moves', p.skill_moves ? p.skill_moves + '★' : '—')}
      ${row('Alt positions', alt || 'none')}`;
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
    host.innerHTML = depthHtml();
    refreshModal();
  }
  function renderAll() { render(); renderGapsCard(); }

  function applyMode() {
    const list = mode === 'list';
    ['squad-search', 'squad-filter-mount', 'squad-list-controls', 'squad-table-wrap'].forEach(id => { const el = $(id); if (el) el.style.display = list ? '' : 'none'; });
    const host = $('squad-alt-view'); if (host) host.style.display = list ? 'none' : '';
    ['list', 'depth', 'academy'].forEach(m => { const b = $('squad-view-' + m); if (b) b.classList.toggle('active', m === mode); });
    if (mode !== 'depth') { edit = null; refreshModal(); }
  }
  function setView(m) {
    mode = m; store.set('mode', m); applyMode();
    if (m === 'list') { renderControls(); if (root.renderTableRows) root.renderTableRows(); } else render();
  }

  const api = {
    mode: () => mode,
    render, renderGapsCard,
    refresh() {
      renderGapsCard();
      if (root.AcademyTracker) { root.AcademyTracker.invalidate(); if (mode === 'academy') root.AcademyTracker.reload(); }
      if (mode === 'depth') render();
    },
    setView,
    setFormation(f) { if (!FORMATIONS[f]) return; active().formation = f; saveLineups(); renderAll(); },
    setSell(id) { sellId = id; render(); },
    resetOrder() { const l = active(); l.pins = {}; saveLineups(); renderAll(); },
    setLineup(id) { if (!lineupById(id)) return; lineups.active = id; edit = null; creating = false; saveLineups(); render(); },
    startCreate() { creating = true; renderControls(); },
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
    clearString,
    init() {
      loadLineups();
      wireHost();
      const m = store.get('mode', 'list');
      mode = ['list', 'depth', 'academy'].includes(m) ? m : 'list';
      applyMode(); render(); renderGapsCard();
    },
    buildDepth, findGaps, FORMATIONS, movePlayer, summaryHtml,
    _lineups: () => lineups
  };

  root.SquadViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) root.document.addEventListener('DOMContentLoaded', () => api.init());
})(typeof window !== 'undefined' ? window : globalThis);
