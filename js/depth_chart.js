// Squad tab alternate views: List (the existing table) / Depth (pitch + pipeline) / Age (age-band grid).
//
// Depth view: pick a formation; every slot shows the best eligible starter, a backup and the best academy prospect
// for that role. Slots are filled scarcest-role-first so one flexible player is not burned on a deep position.
// The pure logic (buildDepth / findGaps) takes plain arrays so it can be unit-tested via module.exports.
//
// Reads app.js globals at render time only (let/const ones by bare name, they are not window properties): currentPlayers, currentYouthAcademy, getPositionInfo, computeAge,
// computeMonthsUntilExpiry, buildPlayerAvatarHtml, openPlayerProfile.
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
    '4-3-3 Holding': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['CM', 30, 56], ['CM', 70, 56], ['CAM', 50, 42], ['LW', 17, 22], ['ST', 50, 15], ['RW', 83, 22]],
    '4-4-2': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['LM', 14, 48], ['CM', 38, 53], ['CM', 62, 53], ['RM', 86, 48], ['ST', 36, 20], ['ST', 64, 20]],
    '4-2-3-1': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['CDM', 36, 56], ['CDM', 64, 56], ['LM', 16, 36], ['CAM', 50, 38], ['RM', 84, 36], ['ST', 50, 15]],
    '4-1-4-1': [['GK', 50, 91], ['LB', 14, 72], ['CB', 38, 76], ['CB', 62, 76], ['RB', 86, 72], ['CDM', 50, 60], ['LM', 14, 40], ['CM', 38, 43], ['CM', 62, 43], ['RM', 86, 40], ['ST', 50, 15]],
    '3-5-2': [['GK', 50, 91], ['CB', 26, 76], ['CB', 50, 78], ['CB', 74, 76], ['LWB', 10, 52], ['CM', 32, 52], ['CDM', 50, 58], ['CM', 68, 52], ['RWB', 90, 52], ['ST', 37, 20], ['ST', 63, 20]],
    '3-4-3': [['GK', 50, 91], ['CB', 26, 76], ['CB', 50, 78], ['CB', 74, 76], ['LM', 12, 52], ['CM', 38, 54], ['CM', 62, 54], ['RM', 88, 52], ['LW', 20, 24], ['ST', 50, 16], ['RW', 80, 24]],
    '5-3-2': [['GK', 50, 91], ['LWB', 9, 68], ['CB', 28, 77], ['CB', 50, 79], ['CB', 72, 77], ['RWB', 91, 68], ['CM', 28, 48], ['CM', 50, 52], ['CM', 72, 48], ['ST', 37, 20], ['ST', 63, 20]]
  };
  const DEFAULT_FORMATION = '4-3-3';

  const OVR_ALT_PENALTY = 6; // an off-position (alt_positions) player must be this much better to beat a natural one

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
  // pins: optional { slotId: { starter: player_id, backup: player_id } } manual arrangement, honoured before the auto fill.
  function buildDepth(formation, seniors, academy, exclude, needs, pins) {
    const slots = (FORMATIONS[formation] || FORMATIONS[DEFAULT_FORMATION]).map(([role, x, y], i) => ({
      id: i, role, x, y, starter: null, backup: null, backupShared: false, prospect: null
    }));
    const pool = seniors.filter(p => !(exclude && exclude.has(p.player_id)));
    const eligible = slots.map(s => pool
      .map(p => ({ p, tier: tierFor(p, s.role) }))
      .filter(e => e.tier !== null)
      .sort((a, b) => scoreOf(b.p, b.tier) - scoreOf(a.p, a.tier)));

    const order = slots.map((s, i) => i).sort((a, b) => eligible[a].length - eligible[b].length || a - b);
    const starters = new Set();
    const byId = id => pool.find(p => String(p.player_id) === String(id));
    const pinnedStart = new Set(), pinnedBack = new Set();
    slots.forEach(sl => {
      const pin = pins && pins[sl.id]; if (!pin) return;
      const st = pin.starter != null ? byId(pin.starter) : null;
      if (st && !starters.has(st)) { sl.starter = st; sl.pinnedStarter = true; starters.add(st); pinnedStart.add(sl.id); }
    });
    slots.forEach(sl => {
      const pin = pins && pins[sl.id]; if (!pin || pin.backup == null) return;
      const bk = byId(pin.backup);
      if (bk && !starters.has(bk)) { sl.backup = bk; sl.pinnedBackup = true; pinnedBack.add(sl.id); }
    });
    order.forEach(i => {
      if (pinnedStart.has(i)) return;
      const pick = eligible[i].find(e => !starters.has(e.p));
      if (pick) { slots[i].starter = pick.p; starters.add(pick.p); }
    });

    const backups = new Set(slots.filter(sl => sl.pinnedBackup).map(sl => sl.backup));
    order.forEach(i => {
      if (pinnedBack.has(i)) return;
      const open = eligible[i].filter(e => !starters.has(e.p));
      const fresh = open.find(e => !backups.has(e.p));
      const pick = fresh || open[0];
      if (pick) { slots[i].backup = pick.p; slots[i].backupShared = !fresh; backups.add(pick.p); }
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

  // ---- rendering ----------------------------------------------------------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { return root.localStorage.getItem('squadview:' + k) || d; } catch (e) { return d; } },
    set(k, v) { try { root.localStorage.setItem('squadview:' + k, v); } catch (e) { /* ignore */ } }
  };

  let mode = 'list';
  let formation = DEFAULT_FORMATION;
  let sellId = ''; // "what if I sell X"
  let pins = {};   // { formation: { slotId: { starter, backup } } } — manual arrangement, persisted
  let lastSlots = [];
  const pinsNow = () => pins[formation] || (pins[formation] = {});

  const seniorsNow = () => (typeof currentPlayers !== 'undefined' ? currentPlayers : []).filter(p => p.__clubStatus === 'normal');
  const academyNow = () => typeof currentYouthAcademy !== 'undefined' ? currentYouthAcademy || [] : [];

  function ringClass(age) { return age === null ? '' : age < 21 ? 'ring-young' : age >= 30 ? 'ring-old' : ''; }

  // kind: starter | backup (draggable, drop targets) | prospect | top (draggable only)
  function personHtml(p, kind, slotId, pinned) {
    const dropAttrs = (kind === 'starter' || kind === 'backup') ? ` data-slot="${slotId}" data-kind="${kind}"` : '';
    if (!p) return `<div class="dc-row dc-empty"${dropAttrs}>${kind === 'starter' ? 'Vacant' : kind === 'backup' ? 'No backup' : 'No prospect'}</div>`;
    const age = root.computeAge(p.dob);
    const size = kind === 'starter' ? 38 : 28;
    const ovr = kind === 'prospect'
      ? `${p.overall || '?'}<span class="dc-pot">→${esc(p.potential_high || p.potential || '?')}</span>`
      : `${p.overall || '?'}`;
    const tag = kind === 'backup' ? '<span class="dc-tag">B</span>' : kind === 'prospect' ? '<span class="dc-tag">🎓</span>' : '';
    const drag = kind === 'prospect' ? '' : ' draggable="true"';
    return `<div class="dc-row dc-${kind}${pinned ? ' dc-pinned' : ''}" data-pid="${esc(p.player_id)}"${dropAttrs}${drag} onclick="openPlayerProfile('${p.player_id ?? esc(p.name)}')">
      <span class="dc-ring ${ringClass(age)}">${root.buildPlayerAvatarHtml(p, size, '50%')}</span>
      ${tag}<span class="dc-name">${esc(p.name)}</span>${kind === 'top' ? `<span class="dc-tag">${root.getPositionInfo(p.position_id).label}</span>` : ''}<span class="dc-ovr">${ovr}</span><span class="dc-age">${age ?? ''}</span>
    </div>`;
  }

  function slotHtml(s, newKeys) {
    const worst = s.flags.find(f => f.severity === 'high') || s.flags.find(f => f.severity === 'mid') || s.flags[0];
    const flagHtml = s.flags.map(f => `<span class="dc-flag sev-${f.severity}${newKeys && newKeys.has(gapKey(s, f)) ? ' dc-new' : ''}" title="${esc(f.text)}">${f.type === 'nobackup' ? 'no backup' : f.type === 'nostarter' ? 'vacant' : f.type === 'expiring-uncovered' ? 'expiring · no cover' : f.type === 'need' ? f.label : 'expiring'}</span>`).join('');
    return `<div class="dc-slot${worst ? ' sev-' + worst.severity : ''}" style="left:${s.x}%;top:${s.y}%">
      <div class="dc-slot-head"><strong>${s.role}</strong>${flagHtml}</div>
      ${personHtml(s.starter, 'starter', s.id, s.pinnedStarter)}${personHtml(s.backup, 'backup', s.id, s.pinnedBackup)}${personHtml(s.prospect, 'prospect', s.id)}
    </div>`;
  }

  function pipelineHtml() {
    const groups = {};
    academyNow().forEach(a => {
      const info = root.getPositionInfo(a.position_id);
      (groups[info.label] = groups[info.label] || []).push(a);
    });
    const labels = Object.keys(groups).sort((a, b) => (POSITION_SORT_ORDER[a] || 99) - (POSITION_SORT_ORDER[b] || 99));
    if (!labels.length) return '<div class="empty-state">No academy prospects loaded.</div>';
    return labels.map(l => `<div class="dc-pipe-col"><div class="dc-pipe-head">${l} <span class="dc-pipe-n">${groups[l].length}</span></div>
      ${groups[l].sort((a, b) => prospectScore(b) - prospectScore(a)).map(a => personHtml(a, 'prospect')).join('')}</div>`).join('');
  }

  // Best senior players per natural position, draggable onto the pitch.
  function topByPositionHtml(seniors) {
    const groups = {};
    seniors.forEach(p => { const l = root.getPositionInfo(p.position_id).label; (groups[l] = groups[l] || []).push(p); });
    const labels = Object.keys(groups).sort((a, b) => (POSITION_SORT_ORDER[a] || 99) - (POSITION_SORT_ORDER[b] || 99));
    if (!labels.length) return '<div class="empty-state">No squad data loaded.</div>';
    return labels.map(l => `<div class="dc-pipe-col"><div class="dc-pipe-head">${l} <span class="dc-pipe-n">${groups[l].length}</span></div>
      ${groups[l].sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0)).slice(0, 3).map(p => personHtml(p, 'top')).join('')}</div>`).join('');
  }

  const needsMap = () => new Map((typeof computeTeamNeeds === 'function' ? computeTeamNeeds() : []).map(p => [p.player_id, p]));

  function depthHtml() {
    const seniors = seniorsNow(), academy = academyNow(), needs = needsMap();
    const base = buildDepth(formation, seniors, academy, null, needs, pinsNow());
    let slots = base, banner = '', newKeys = null;
    if (sellId) {
      const sold = seniors.find(p => String(p.player_id) === String(sellId));
      slots = buildDepth(formation, seniors, academy, new Set([sold && sold.player_id]), needs, pinsNow());
      const before = new Set(); base.forEach(s => s.flags.forEach(f => before.add(gapKey(s, f))));
      newKeys = new Set(); const fresh = [];
      slots.forEach(s => s.flags.forEach(f => { const k = gapKey(s, f); if (!before.has(k)) { newKeys.add(k); fresh.push(`${s.role}: ${f.text}`); } }));
      banner = `<div class="dc-banner ${fresh.length ? 'bad' : 'ok'}">If you sell <strong>${esc(sold ? sold.name : '?')}</strong>: ${fresh.length ? `${fresh.length} new gap${fresh.length > 1 ? 's' : ''} — ${fresh.map(esc).join('; ')}` : 'no new gaps.'}</div>`;
    }
    lastSlots = slots;
    const hasPins = Object.keys(pinsNow()).length > 0;
    const gapCount = slots.reduce((n, s) => n + s.flags.filter(f => f.severity !== 'info').length, 0);
    const sellOptions = seniors.slice().sort((a, b) => Number(b.overall || 0) - Number(a.overall || 0))
      .map(p => `<option value="${p.player_id}"${String(p.player_id) === String(sellId) ? ' selected' : ''}>${esc(p.name)} (${p.overall || '?'})</option>`).join('');
    return `<div class="dc-controls">
        <label>Formation <select onchange="SquadViews.setFormation(this.value)">${Object.keys(FORMATIONS).map(f => `<option${f === formation ? ' selected' : ''}>${f}</option>`).join('')}</select></label>
        <label>What if I sell <select onchange="SquadViews.setSell(this.value)"><option value="">—</option>${sellOptions}</select></label>
        <span class="dc-legend"><span class="dc-ring ring-young">&nbsp;</span> under 21 <span class="dc-ring ring-old">&nbsp;</span> 30+ · B backup · 🎓 academy · ${gapCount} gap${gapCount === 1 ? '' : 's'} · drag players to rearrange</span>
        ${hasPins ? '<button class="home-toggle-btn" onclick="SquadViews.resetOrder()">Reset order</button>' : ''}
      </div>${banner}
      <div class="dc-pitch-wrap"><div class="dc-pitch">${slots.map(s => slotHtml(s, newKeys)).join('')}</div></div>
      <h4 class="dc-section">Top players by position</h4><div class="dc-pipeline">${topByPositionHtml(seniors)}</div>
      <h4 class="dc-section">Academy pipeline by position</h4><div class="dc-pipeline">${pipelineHtml()}</div>`;
  }

  // Home "Squad Gaps" card: replaces the old Expiring Contracts + Team Needs cards. Same flags as the Depth view,
  // for the chosen formation, worst first; plus watchlist players who are not in the starting shape.
  function flagLabel(f) {
    return f.type === 'nobackup' ? 'no backup' : f.type === 'nostarter' ? 'vacant' : f.type === 'expiring-uncovered' ? 'expiring · no cover' : f.type === 'need' ? f.label : 'expiring';
  }
  function renderGapsCard() {
    const el = $('home-squad-gaps-body'); if (!el) return;
    const seniors = seniorsNow();
    if (!seniors.length) { el.innerHTML = '<div class="empty-state" style="padding: 12px;">No squad data loaded.</div>'; return; }
    const needs = needsMap();
    const slots = buildDepth(formation, seniors, academyNow(), null, needs, pinsNow());
    const rank = { high: 0, mid: 1, info: 2 };
    const rows = slots.map(s => ({ s, worst: s.flags.slice().sort((a, b) => rank[a.severity] - rank[b.severity])[0] }))
      .filter(r => r.worst && r.worst.severity !== 'info')
      .sort((a, b) => rank[a.worst.severity] - rank[b.worst.severity]);
    const starters = new Set(slots.map(s => s.starter && s.starter.player_id));
    const bench = [...needs.values()].filter(p => !starters.has(p.player_id)).slice(0, 5);
    const rowHtml = r => `<tr class="clickable-name" ${r.s.starter ? `onclick="openPlayerProfile('${r.s.starter.player_id}')"` : ''}>
      <td><span class="pos-badge">${r.s.role}</span></td><td>${r.s.starter ? esc(r.s.starter.name) : '<em>Vacant</em>'}</td>
      <td>${r.s.flags.map(f => `<span class="dc-flag sev-${f.severity}" title="${esc(f.text)}">${esc(flagLabel(f))}</span>`).join(' ')}</td></tr>`;
    el.innerHTML = `<div style="font-size: 12px; color: var(--text-dim); margin-bottom: 6px;">Formation ${formation} · hover a flag for detail</div>`
      + (rows.length ? `<table class="sub-table"><thead><tr><th>Slot</th><th>Starter</th><th>Flags</th></tr></thead><tbody>${rows.slice(0, 8).map(rowHtml).join('')}</tbody></table>`
        : '<div class="empty-state" style="padding: 12px;">No gaps in the starting shape.</div>')
      + (bench.length ? `<div style="font-size: 11px; color: var(--text-dim); text-transform: uppercase; margin: 12px 0 6px;">Watchlist (outside the starting shape)</div>
        <table class="sub-table"><tbody>${bench.map(p => `<tr class="clickable-name" onclick="openPlayerProfile('${p.player_id}')"><td>${esc(p.name)}</td><td>${root.getPositionInfo(p.position_id).label}</td><td>${p.overall || '?'}</td><td>${esc(p.__reasons.join(', '))}</td></tr>`).join('')}</tbody></table>` : '');
  }

  // ---- manual arrangement (drag & drop) -------------------------------------
  function savePins() { store.set('pins', JSON.stringify(pins)); }
  const sameId = (a, b) => a != null && b != null && String(a) === String(b);

  // Drop `pid` (optionally dragged from slot/kind) onto target slot/kind: the two players swap places.
  function movePlayer(pid, src, target) {
    const slot = lastSlots[target.slot]; if (!slot) return;
    const occupant = slot[target.kind];
    if (occupant && sameId(occupant.player_id, pid)) return;
    const P = pinsNow();
    const unpin = id => Object.keys(P).forEach(k => {
      ['starter', 'backup'].forEach(kind => { if (sameId(P[k][kind], id)) delete P[k][kind]; });
      if (!Object.keys(P[k]).length) delete P[k];
    });
    unpin(pid); if (occupant) unpin(occupant.player_id);
    (P[target.slot] = P[target.slot] || {})[target.kind] = pid;
    if (src && occupant) (P[src.slot] = P[src.slot] || {})[src.kind] = occupant.player_id;
    savePins(); render(); renderGapsCard();
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
    const vals = parts.map(([l, v]) => [l, Number(v ?? ovr)]);
    const total = vals.reduce((n, [, v]) => n + v, 0);
    const age = root.computeAge(p.dob);
    const alt = root.getAltPositionsLabel(p.alt_positions);
    const row = (k, v) => `<div><span>${k}</span><strong>${v}</strong></div>`;
    return `<div class="dc-tip-title">${esc(p.name)} <em>${root.getPositionInfo(p.position_id).label}</em></div>
      ${row('Age', age ?? '—')}${row('Overall', ovr || '—')}${p.potential_high || p.potential ? row('Potential', esc(p.potential_high || p.potential)) : ''}
      ${hasAttrs ? row('Base stats', `${total} <span class="dc-tip-sub">${vals.map(([l, v]) => l + ' ' + v).join(' · ')}</span>`) : row('Base stats', 'n/a')}
      ${row('Height', p.height ? root.formatHeight(p.height) : '—')}${row('Weak foot', p.weak_foot ? p.weak_foot + '★' : '—')}${row('Skill moves', p.skill_moves ? p.skill_moves + '★' : '—')}
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

  let wired = false;
  function wireHost() {
    const host = $('squad-alt-view'); if (!host || wired) return;
    wired = true;
    tip = root.document.createElement('div'); tip.className = 'dc-tip'; tip.style.display = 'none';
    root.document.body.appendChild(tip);
    host.addEventListener('mouseover', e => {
      const row = e.target.closest('.dc-row[data-pid]'); if (!row) return;
      const p = findPlayer(row.dataset.pid); if (!p) return;
      tip.innerHTML = summaryHtml(p); tip.style.display = 'block'; moveTip(e);
    });
    host.addEventListener('mousemove', moveTip);
    host.addEventListener('mouseout', e => { if (e.target.closest('.dc-row[data-pid]')) hideTip(); });
    host.addEventListener('dragstart', e => {
      const row = e.target.closest('.dc-row[data-pid]'); if (!row) return;
      hideTip();
      e.dataTransfer.setData('text/plain', JSON.stringify({ pid: row.dataset.pid, slot: row.dataset.slot ?? null, kind: row.dataset.kind ?? null }));
      e.dataTransfer.effectAllowed = 'move';
    });
    host.addEventListener('dragover', e => { const r = e.target.closest('.dc-row[data-slot]'); if (r) { e.preventDefault(); r.classList.add('dc-over'); } });
    host.addEventListener('dragleave', e => { const r = e.target.closest('.dc-row'); if (r) r.classList.remove('dc-over'); });
    host.addEventListener('drop', e => {
      const row = e.target.closest('.dc-row[data-slot]'); if (!row) return;
      e.preventDefault();
      let d; try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
      const src = d.slot !== null && d.slot !== undefined ? { slot: Number(d.slot), kind: d.kind } : null;
      movePlayer(d.pid, src, { slot: Number(row.dataset.slot), kind: row.dataset.kind });
    });
  }

  // ---- view switching -----------------------------------------------------
  const $ = id => root.document.getElementById(id);
  function render() {
    hideTip();
    const host = $('squad-alt-view');
    if (!host || mode === 'list') return;
    host.innerHTML = depthHtml();
  }
  function applyMode() {
    const list = mode === 'list';
    ['squad-search', 'squad-filter-mount', 'squad-list-controls', 'squad-table-wrap'].forEach(id => { const el = $(id); if (el) el.style.display = list ? '' : 'none'; });
    const host = $('squad-alt-view'); if (host) host.style.display = list ? 'none' : '';
    ['list', 'depth'].forEach(m => { const b = $('squad-view-' + m); if (b) b.classList.toggle('active', m === mode); });
  }
  function setView(m) {
    mode = m; store.set('mode', m); applyMode();
    if (m === 'list') { if (root.renderTableRows) root.renderTableRows(); } else render();
  }

  const api = {
    mode: () => mode,
    render, renderGapsCard,
    refresh() { renderGapsCard(); if (mode !== 'list') render(); },
    setView,
    setFormation(f) { formation = f; store.set('formation', f); render(); renderGapsCard(); },
    setSell(id) { sellId = id; render(); },
    resetOrder() { delete pins[formation]; savePins(); render(); renderGapsCard(); },
    init() {
      formation = FORMATIONS[store.get('formation', DEFAULT_FORMATION)] ? store.get('formation', DEFAULT_FORMATION) : DEFAULT_FORMATION;
      try { pins = JSON.parse(store.get('pins', '{}')) || {}; } catch (e) { pins = {}; }
      wireHost();
      const m = store.get('mode', 'list');
      mode = ['list', 'depth'].includes(m) ? m : 'list';
      applyMode(); if (mode !== 'list') render(); renderGapsCard();
    },
    buildDepth, findGaps, FORMATIONS, movePlayer
  };

  root.SquadViews = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) root.document.addEventListener('DOMContentLoaded', () => api.init());
})(typeof window !== 'undefined' ? window : globalThis);
