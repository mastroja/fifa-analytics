// Dynamic look manager: a page of its own (Settings > Player customization > Manage dynamic look) for everything that
// applies to the whole team: the monthly automatic look changes, which players are included, realistic heights and
// growth, the activity log and undo. Backend: dynamic_look.js (IPC). The per-player editor (player_editor_ui.js) is separate.
(function () {
  'use strict';

  const TABS = [
    ['overview', 'Overview'],
    ['changes', 'What changes'],
    ['players', 'Players'],
    ['heights', 'Heights & growth'],
    ['activity', 'Activity'],
    ['undo', 'Undo']
  ];
  const FEATURES = [
    ['hair', 'Haircuts and new styles', 'Younger players change style more often; styles stay within the ones that suit their skin tone, and long hair usually gets cut. Uncategorised styles are never picked, and players wearing one keep it (those are manual choices).'],
    ['beard', 'Beard growth and shaving', 'Adults can grow stubble into a full beard over months, trim it or shave it off. About a third never grow one.'],
    ['colour', 'Hair colour: dye and greying', 'Rare dye jobs for players up to 27 that grow out after a few months: dark hair is almost always bleached blonde, and a wild colour is very unlikely. Veterans from 35 slowly go silver.'],
    ['boots', 'Boots', 'Mostly new-season switches, usually staying with the same brand. Only boots linked to a game id are used.'],
    ['accessories', 'Accessories', 'Tape, wristbands and gloves come and go.'],
    ['growth', 'Height, weight and growth', 'Youth players keep growing toward their own adult height each month, and weight and body type follow. A height is only ever raised, and heights you set by hand are left alone.']
  ];

  let S = null; // { tab, data, q, msg, msgKind, busy, heightPreview, undoPreview, logQ }

  const api = () => window.api;
  const esc = v => String(v === undefined || v === null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtHeight = cm => (typeof formatHeight === 'function' ? formatHeight(String(cm)) : cm + ' cm');

  function injectStyles() {
    if (document.getElementById('dl-styles')) return;
    const style = document.createElement('style');
    style.id = 'dl-styles';
    style.textContent = `
      #dl-dialog { width: min(1180px, 97vw); height: min(820px, 94vh); padding: 0; border: 1px solid var(--border-color); border-radius: 14px; background: var(--card-bg); color: var(--text-main, #e6edf3); overflow: hidden; }
      #dl-dialog::backdrop { background: rgba(0,0,0,.7); }
      .dl-shell { display: grid; grid-template-rows: auto auto 1fr; height: 100%; }
      .dl-top { display: flex; align-items: center; gap: 16px; padding: 16px 24px; border-bottom: 1px solid var(--border-color); }
      .dl-top h2 { margin: 0; font-size: 22px; flex: 1; }
      .dl-pill { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
      .dl-pill.on { background: #3fb95030; color: #3fb950; } .dl-pill.off { background: #8b949e30; color: var(--text-dim); }
      .dl-x { background: none; border: 0; color: var(--text-dim); font-size: 22px; cursor: pointer; padding: 4px 8px; border-radius: 6px; }
      .dl-x:hover { background: var(--expand-bg); color: inherit; }
      .dl-msg { padding: 9px 24px; font-size: 13px; border-bottom: 1px solid var(--border-color); background: var(--expand-bg); }
      .dl-msg.ok { color: #3fb950; } .dl-msg.err { color: #f85149; } .dl-msg.empty { display: none; }
      .dl-main { display: grid; grid-template-columns: 190px 1fr; min-height: 0; }
      .dl-nav { border-right: 1px solid var(--border-color); padding: 14px 10px; background: var(--expand-bg); display: flex; flex-direction: column; gap: 4px; }
      .dl-tab { text-align: left; padding: 10px 14px; border-radius: 8px; border: 0; background: none; color: var(--text-dim); font-size: 14px; cursor: pointer; }
      .dl-tab:hover { background: var(--card-bg); color: inherit; }
      .dl-tab.on { background: var(--card-bg); color: inherit; font-weight: 600; box-shadow: inset 3px 0 0 var(--accent-color); }
      .dl-panel { overflow-y: auto; padding: 24px 32px 32px; }
      .dl-panel h3 { margin: 0 0 6px; font-size: 17px; }
      .dl-lead { margin: 0 0 18px; color: var(--text-dim); font-size: 13px; line-height: 1.5; max-width: 760px; }
      .dl-card { background: var(--expand-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px 18px; margin-bottom: 16px; }
      .dl-big { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
      .dl-big b { font-size: 16px; }
      .dl-big small { display: block; color: var(--text-dim); margin-top: 3px; font-size: 12px; }
      .dl-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
      .dl-stat { background: var(--expand-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 16px; }
      .dl-stat b { display: block; font-size: 22px; color: var(--accent-color); }
      .dl-stat span { font-size: 12px; color: var(--text-dim); }
      .dl-switch { position: relative; width: 46px; height: 26px; flex-shrink: 0; }
      .dl-switch input { opacity: 0; width: 100%; height: 100%; position: absolute; margin: 0; cursor: pointer; z-index: 1; }
      .dl-switch i { position: absolute; inset: 0; border-radius: 999px; background: #484f58; transition: background .15s; }
      .dl-switch i::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .15s; }
      .dl-switch input:checked + i { background: var(--accent-color); }
      .dl-switch input:checked + i::after { transform: translateX(20px); }
      .dl-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 0; border-top: 1px solid var(--border-color); }
      .dl-row:first-of-type { border-top: 0; }
      .dl-row b { font-size: 14px; } .dl-row small { display: block; color: var(--text-dim); margin-top: 3px; font-size: 12px; max-width: 640px; line-height: 1.45; }
      .dl-btn { padding: 9px 20px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--card-bg); color: inherit; cursor: pointer; font-size: 14px; }
      .dl-btn:hover:not(:disabled) { border-color: var(--text-dim); }
      .dl-btn.primary { background: var(--accent-color); color: #0d1117; border-color: var(--accent-color); font-weight: 700; }
      .dl-btn.danger { border-color: #f85149; color: #f85149; }
      .dl-btn:disabled { opacity: .45; cursor: not-allowed; }
      .dl-btns { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
      .dl-seg { display: inline-flex; border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; margin-bottom: 14px; }
      .dl-seg button { padding: 9px 18px; border: 0; background: var(--expand-bg); color: var(--text-dim); cursor: pointer; font-size: 14px; }
      .dl-seg button.on { background: var(--accent-color); color: #0d1117; font-weight: 700; }
      .dl-search { background: var(--expand-bg); color: inherit; border: 1px solid var(--border-color); border-radius: 8px; padding: 8px 12px; font-size: 14px; min-width: 240px; }
      .dl-search:focus { outline: none; border-color: var(--accent-color); }
      .dl-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .dl-table th, .dl-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-color); }
      .dl-table th { color: var(--text-dim); font-weight: 600; position: sticky; top: 0; background: var(--card-bg); }
      .dl-table tr.off td { opacity: .5; }
      .dl-scroll { max-height: 440px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 10px; }
      .dl-st { font-size: 11px; text-transform: uppercase; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
      .dl-st.queued { background: #d4a72c30; color: #d4a72c; } .dl-st.applied { background: #3fb95030; color: #3fb950; }
      .dl-st.failed { background: #f8514930; color: #f85149; } .dl-st.undone { background: #8b949e30; color: var(--text-dim); }
      .dl-hint { color: var(--text-dim); font-size: 12px; }
      .dl-warn { padding: 12px 14px; border-radius: 8px; background: #d4a72c20; border: 1px solid #d4a72c60; font-size: 13px; margin-bottom: 16px; }
    `;
    document.head.appendChild(style);
  }

  // ---------- data ----------
  async function load(keepMsg) {
    if (!api() || !api().getDynamicLook) {
      S.data = { error: 'This needs the latest app version. Close the app completely and start it again (npm start).' };
    } else {
      try {
        const r = await api().getDynamicLook();
        S.data = Object.assign({}, r);
        if (!r.settings) S.data.error = 'No active save yet. Press Refresh in the app once so it knows which career is open.';
        if (api().previewUndo) { try { S.undoPreview = await api().previewUndo(); } catch (e) { /* hint only */ } }
      } catch (e) {
        S.data = { error: 'Could not load the dynamic look settings: ' + ((e && e.message) || e) };
      }
    }
    if (!keepMsg) { S.msg = ''; S.msgKind = ''; }
    render();
    updateSettingsStatus();
  }

  async function save(patch) {
    try {
      const r = await api().setDynamicLook(patch);
      if (r && r.success) { S.data.settings = r.settings; }
      else { S.msg = 'Could not save: no active save yet. Press Refresh in the app once.'; S.msgKind = 'err'; }
    } catch (e) { S.msg = 'Could not save: ' + ((e && e.message) || e); S.msgKind = 'err'; }
    render();
    updateSettingsStatus();
  }

  function say(msg, kind) { S.msg = msg; S.msgKind = kind || ''; render(); }

  // ---------- views ----------
  function includedPlayers() {
    const d = S.data, players = d.players || [];
    return d.settings.scope === 'selected' ? players.filter(p => p.selected) : players;
  }
  const featureOn = k => S.data.settings.features[k] !== false && (k !== 'growth' || S.data.settings.features.growth === true);

  function viewOverview() {
    const d = S.data, s = d.settings, players = d.players || [], incl = includedPlayers();
    const on = FEATURES.filter(f => featureOn(f[0])).map(f => f[1]);
    const recent = (d.log || []).slice(0, 6);
    return `
      <h3>Automatic monthly updates</h3>
      <p class="dl-lead">Once per in-game month, the players you include may change a little: haircuts, beards, hair colour, boots, accessories, and growth for youngsters. The changes are written to the game for you through the F11 hotkey, so the game window comes forward briefly each month.</p>
      <div class="dl-card"><div class="dl-big"><div><b>${s.enabled ? 'Switched on' : 'Switched off'}</b>
        <small>${s.enabled ? (s.lastMonth ? `Last month played out: ${esc(s.lastMonth)}. The next update runs when a refresh sees a new in-game month.` : 'Starts counting from the next in-game month.') : 'Nothing changes on its own until you switch this on.'}</small></div>
        <label class="dl-switch"><input type="checkbox" data-enabled${s.enabled ? ' checked' : ''}><i></i></label></div></div>
      <div class="dl-stats">
        <div class="dl-stat"><b>${incl.length}</b><span>players included (of ${players.length})</span></div>
        <div class="dl-stat"><b>${on.length}</b><span>kinds of change on (of ${FEATURES.length})</span></div>
        <div class="dl-stat"><b>${(d.log || []).length}</b><span>changes made so far</span></div>
      </div>
      <div class="dl-card"><b>Try it now</b>
        <p class="dl-hint" style="margin:6px 0 12px">Plays the current in-game month straight away for the included players, with fresh randomness, and writes it to the game. Handy for seeing what it does.</p>
        <div class="dl-btns"><button class="dl-btn primary" data-run${S.busy ? ' disabled' : ''}>Run this month now</button></div></div>
      <h3 style="margin-top:22px">Recent activity</h3>
      ${recent.length ? `<div class="dl-card" style="padding:4px 18px">${recent.map(logRow).join('')}</div>` : '<p class="dl-hint">Nothing has changed yet.</p>'}`;
  }

  const logRow = l => `<div class="dl-row"><div><b>${esc(l.player_name)}</b><small>${esc(l.summary)} · ${esc(l.game_month)}</small></div><span class="dl-st ${esc(l.status || 'queued')}">${esc(l.status || 'queued')}</span></div>`;

  function viewChanges() {
    const rows = FEATURES.map(([k, label, hint]) => `<div class="dl-row"><div><b>${esc(label)}</b><small>${esc(hint)}</small></div>
      <label class="dl-switch"><input type="checkbox" data-feature="${k}"${featureOn(k) ? ' checked' : ''}><i></i></label></div>`).join('');
    return `<h3>What can change</h3>
      <p class="dl-lead">Choose which kinds of change are allowed. These apply to every included player, and only matter while the automatic monthly updates are switched on (or when you press Run this month now).</p>
      <div class="dl-card" style="padding:4px 18px">${rows}</div>`;
  }

  function viewPlayers() {
    const d = S.data, s = d.settings, players = d.players || [];
    const q = (S.q || '').toLowerCase();
    const shown = players.filter(p => !q || String(p.name).toLowerCase().includes(q));
    const picking = s.scope === 'selected';
    const rows = shown.map(p => `<tr class="${picking && !p.selected ? 'off' : ''}"><td style="width:34px"><input type="checkbox" data-player="${p.player_id}"${picking ? (p.selected ? ' checked' : '') : ' checked disabled'}></td>
      <td><b>${esc(p.name)}</b></td><td>${p.source === 'academy' ? 'Academy' : 'Squad'}</td><td>${p.age === null || p.age === undefined ? '—' : p.age}</td>
      <td>${p.height ? esc(fmtHeight(p.height)) : '—'}${p.heightLocked ? ' <span class="dl-hint" title="You set this height by hand, so the height model leaves it alone">(set by you)</span>' : ''}</td></tr>`).join('');
    return `<h3>Players</h3>
      <p class="dl-lead">Everyone the editor can change: your squad and academy players made by the game. Real, scanned players are never included.</p>
      <div class="dl-seg"><button data-scope="all" class="${picking ? '' : 'on'}">All players (${players.length})</button><button data-scope="selected" class="${picking ? 'on' : ''}">Only the ones I pick</button></div>
      <div class="dl-btns" style="margin-bottom:12px"><input class="dl-search" type="search" placeholder="Search players…" data-q value="${esc(S.q || '')}">
        ${picking ? `<button class="dl-btn" data-pick="all">Select shown</button><button class="dl-btn" data-pick="none">Clear shown</button>
        <span class="dl-hint">${players.filter(p => p.selected).length} of ${players.length} picked</span>` : '<span class="dl-hint">Everyone is included. Switch to "Only the ones I pick" to choose.</span>'}</div>
      <div class="dl-scroll"><table class="dl-table"><thead><tr><th></th><th>Player</th><th>Role</th><th>Age</th><th>Height</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="dl-hint">No players match.</td></tr>'}</tbody></table></div>`;
  }

  function viewHeights() {
    const pv = S.heightPreview;
    const pct = (a, n) => (n ? Math.round(100 * a / n) : 0);
    let preview = '';
    if (pv && pv.error) preview = `<div class="dl-warn">${esc(pv.error)}</div>`;
    else if (pv) {
      const row = (label, x) => `<tr><td>${label}</td><td>${x.n}</td><td>${esc(fmtHeight(Math.round(x.mean)))}</td><td>${Math.round(x.meanWeight || 0)} kg</td><td>${x.under} (${pct(x.under, x.n)}%)</td><td>${x.over}</td></tr>`;
      preview = `<div class="dl-card"><table class="dl-table"><thead><tr><th></th><th>Players</th><th>Average height</th><th>Average weight</th><th>Under 5'7"</th><th>Over 6'4"</th></tr></thead>
          <tbody>${row('Now', pv.before)}${row('After the model', pv.after)}</tbody></table>
        <p class="dl-hint" style="margin:12px 0 6px">${pv.changing === 0 ? `Nothing to change: all ${pv.total} players already match the model, so Apply would do nothing.` : `${pv.changing} of ${pv.total} players would change. Biggest changes first (the number in brackets is the player's expected adult height):`}</p>
        ${pv.sample.map(x => `<div class="dl-row" style="padding:8px 0"><div><b>${esc(x.name)}</b> <span class="dl-hint">age ${x.age}</span></div><span>${esc(fmtHeight(x.before))} to ${esc(fmtHeight(x.after))}, ${x.wBefore} to ${x.wAfter} kg <span class="dl-hint">(adult ${esc(fmtHeight(x.adult))})</span></span></div>`).join('')}</div>`;
    }
    return `<h3>Heights and growth</h3>
      <p class="dl-lead">Every player gets their own adult height, drawn once and fixed: about 5'10.5" on average, around 5% under 5'7", very few over 6'4", with taller keepers and centre-backs and shorter wingers. Players grow toward it with age (early and late bloomers), and weight and body type follow. A height is only ever raised, never lowered, and heights you set by hand are left alone.</p>
      <div class="dl-btns" style="margin-bottom:16px"><button class="dl-btn" data-height-preview${S.busy ? ' disabled' : ''}>Preview</button>
        <button class="dl-btn primary" data-height-apply${S.busy ? ' disabled' : ''}>Apply to included players now</button></div>
      ${preview}
      <p class="dl-hint">To keep youth players growing month by month, switch on "Height, weight and growth" under What changes.</p>`;
  }

  function viewActivity() {
    const q = (S.logQ || '').toLowerCase();
    const log = (S.data.log || []).filter(l => !q || String(l.player_name).toLowerCase().includes(q) || String(l.summary).toLowerCase().includes(q));
    return `<h3>Activity</h3>
      <p class="dl-lead">Every change the dynamic look has made, newest first. Each one is also an edit in that player's own History, where it can be undone.</p>
      <input class="dl-search" type="search" placeholder="Search player or change…" data-logq value="${esc(S.logQ || '')}" style="margin-bottom:12px">
      <div class="dl-scroll"><table class="dl-table"><thead><tr><th>Month</th><th>Player</th><th>Change</th><th>Status</th></tr></thead>
        <tbody>${log.map(l => `<tr><td>${esc(l.game_month)}</td><td><b>${esc(l.player_name)}</b></td><td>${esc(l.summary)}</td><td><span class="dl-st ${esc(l.status || 'queued')}">${esc(l.status || 'queued')}</span></td></tr>`).join('') || '<tr><td colspan="4" class="dl-hint">Nothing to show.</td></tr>'}</tbody></table></div>`;
  }

  function viewUndo() {
    const pv = S.undoPreview;
    const hint = pv && !pv.error
      ? `Right now: ${pv.shrunk.players} player${pv.shrunk.players === 1 ? ' is' : 's are'} shorter than they started; undoing everything would restore ${pv.all.columns} value${pv.all.columns === 1 ? '' : 's'} across ${pv.all.players} player${pv.all.players === 1 ? '' : 's'}.`
      : '';
    return `<h3>Undo</h3>
      <p class="dl-lead">Put players back the way they were before the app first changed them. Both options write through the game (F11), and you are asked to confirm with the numbers first.</p>
      <div class="dl-card"><div class="dl-row"><div><b>Restore players who got shorter</b><small>Puts back height, weight and body type only for players who ended up shorter than they started. Everything else stays.</small></div>
          <button class="dl-btn" data-undo="shrunk"${S.busy ? ' disabled' : ''}>Restore</button></div>
        <div class="dl-row"><div><b>Undo ALL customization</b><small>Restores every value the app ever changed (hair, kit, boots, height and the rest), switches the automatic monthly updates off and clears the growth records.</small></div>
          <button class="dl-btn danger" data-undo="all"${S.busy ? ' disabled' : ''}>Undo everything</button></div></div>
      <p class="dl-hint">${esc(hint)}</p>`;
  }

  function render() {
    const dlg = document.getElementById('dl-dialog');
    if (!dlg || !S) return;
    const panel = dlg.querySelector('.dl-panel');
    const prevScroll = panel && panel.dataset.panel === S.tab ? panel.scrollTop : 0;
    const d = S.data;
    let body;
    if (!d) body = '<p class="dl-hint">Loading…</p>';
    else if (d.error) body = `<div class="dl-warn">${esc(d.error)}</div>`;
    else body = { overview: viewOverview, changes: viewChanges, players: viewPlayers, heights: viewHeights, activity: viewActivity, undo: viewUndo }[S.tab]();
    const enabled = d && d.settings && d.settings.enabled;
    dlg.innerHTML = `<div class="dl-shell">
      <div class="dl-top"><h2>Dynamic look</h2><span class="dl-pill ${enabled ? 'on' : 'off'}">${enabled ? 'On' : 'Off'}</span><button class="dl-x" data-close title="Close">✕</button></div>
      <div class="dl-msg ${S.msg ? S.msgKind || '' : 'empty'}">${esc(S.msg || '')}</div>
      <div class="dl-main"><nav class="dl-nav">${TABS.map(([id, label]) => `<button class="dl-tab${S.tab === id ? ' on' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>
        <div class="dl-panel" data-panel="${S.tab}">${body}</div></div></div>`;
    const np = dlg.querySelector('.dl-panel');
    if (np) np.scrollTop = prevScroll;
    if (S.focus) {
      const el = dlg.querySelector(S.focus); S.focus = null;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    }
  }

  // ---------- events ----------
  async function run(label, fn) {
    S.busy = true; say(label, '');
    try { await fn(); } catch (e) { say('Something went wrong: ' + ((e && e.message) || e), 'err'); }
    S.busy = false;
    await load(true);
  }

  function bind(dlg) {
    dlg.addEventListener('click', async (e) => {
      if (!S) return;
      const t = e.target.closest('[data-close],[data-tab],[data-scope],[data-pick],[data-run],[data-height-preview],[data-height-apply],[data-undo]');
      if (!t) return;
      if (t.hasAttribute('data-close')) { dlg.close(); return; }
      if (t.dataset.tab) { S.tab = t.dataset.tab; render(); return; }
      if (t.dataset.scope) { await save({ scope: t.dataset.scope }); return; }
      if (t.dataset.pick) {
        const q = (S.q || '').toLowerCase();
        const ids = (S.data.players || []).filter(p => !q || String(p.name).toLowerCase().includes(q)).map(p => p.player_id);
        const r = await api().setDynamicLookPlayers(ids, t.dataset.pick === 'all');
        if (r && r.success) S.data.players = r.players;
        render(); return;
      }
      if (t.hasAttribute('data-run')) {
        await run('Running… the game window will come forward briefly.', async () => {
          const res = await api().runDynamicLookNow();
          say(res && res.success ? `Done: ${res.changed} player${res.changed === 1 ? '' : 's'} changed.` : ((res && res.error) || 'Failed.'), res && res.success ? 'ok' : 'err');
        });
        return;
      }
      if (t.hasAttribute('data-height-preview')) {
        S.heightPreview = await api().previewHeightModel(); render(); return;
      }
      if (t.hasAttribute('data-height-apply')) {
        const pv = S.heightPreview || await api().previewHeightModel();
        const n = pv && pv.after ? pv.after.n : 0;
        if (!confirm(`Set height, weight and body type for ${n} players in the game, using each player's own growth model?\n\nHeights are only ever raised. The game window comes forward briefly, and every change is saved as an edit you can undo.`)) return;
        await run('Applying heights in the game…', async () => {
          const res = await api().applyHeightModel();
          S.heightPreview = null;
          say(res && res.success ? `Done: ${res.changed} player${res.changed === 1 ? '' : 's'} updated.` : ((res && res.error) || 'Failed.'), res && res.success ? 'ok' : 'err');
        });
        return;
      }
      if (t.dataset.undo) {
        const mode = t.dataset.undo;
        const pv = await api().previewUndo();
        S.undoPreview = pv;
        if (!pv || pv.error) { render(); return; }
        const n = mode === 'shrunk' ? pv.shrunk.players : pv.all.players;
        if (n === 0) { say(mode === 'shrunk' ? 'No player is shorter than they started.' : 'Nothing to undo.', 'ok'); return; }
        const text = mode === 'shrunk'
          ? `Restore the original height, weight and body type of ${n} player${n === 1 ? '' : 's'} who ended up shorter than they started?`
          : `Undo ALL customization for ${n} player${n === 1 ? '' : 's'} (${pv.all.columns} values: hair, kit, boots, height and everything else the app changed)?\n\nThis also switches the automatic monthly updates off. The changes are written to the game through F11.`;
        if (!confirm(text)) return;
        await run('Restoring in the game…', async () => {
          const res = await api().undoCustomization(mode);
          say(res && res.success ? `Done: ${res.restored} player${res.restored === 1 ? '' : 's'} restored.` : ((res && res.error) || 'Failed.'), res && res.success ? 'ok' : 'err');
        });
      }
    });
    dlg.addEventListener('change', async (e) => {
      if (!S) return;
      const el = e.target;
      if (el.hasAttribute('data-enabled')) { await save({ enabled: el.checked }); return; }
      if (el.dataset.feature) { await save({ features: { [el.dataset.feature]: el.checked } }); return; }
      if (el.dataset.player) {
        const r = await api().setDynamicLookPlayers([Number(el.dataset.player)], el.checked);
        if (r && r.success) S.data.players = r.players;
        render();
      }
    });
    dlg.addEventListener('input', (e) => {
      if (!S) return;
      if (e.target.hasAttribute('data-q')) { S.q = e.target.value; S.focus = '[data-q]'; render(); }
      else if (e.target.hasAttribute('data-logq')) { S.logQ = e.target.value; S.focus = '[data-logq]'; render(); }
    });
  }

  // ---------- public ----------
  function ensureDialog() {
    let dlg = document.getElementById('dl-dialog');
    if (!dlg) {
      injectStyles();
      dlg = document.createElement('dialog');
      dlg.id = 'dl-dialog';
      document.body.appendChild(dlg);
      bind(dlg);
      dlg.addEventListener('close', () => { if (!dlg.open) S = null; });
    }
    return dlg;
  }

  async function open(tab) {
    const dlg = ensureDialog();
    S = { tab: tab || 'overview', data: null, q: '', logQ: '', msg: '', msgKind: '', busy: false, heightPreview: null, undoPreview: null };
    render();
    if (!dlg.open) dlg.showModal();
    await load();
  }

  // the one-line status next to the Settings entry
  async function updateSettingsStatus() {
    const el = document.getElementById('settings-dynamic-look-status');
    if (!el || !api() || !api().getDynamicLook) return;
    try {
      const r = await api().getDynamicLook();
      el.textContent = r && r.settings ? (r.settings.enabled ? 'On' : 'Off') : 'Not available yet';
      el.style.color = r && r.settings && r.settings.enabled ? '#3fb950' : 'var(--text-dim)';
    } catch (e) { el.textContent = ''; }
  }

  // Settings switch: reserve squad numbers (31+) for academy promotions (squad_numbers.js)
  async function loadReserveNumbers() {
    const el = document.getElementById('settings-reserve-numbers-toggle');
    if (!el || !api() || !api().getSquadNumberSettings) return;
    try { const r = await api().getSquadNumberSettings(); el.checked = !!(r && r.enabled); } catch (e) { /* leave as is */ }
  }
  async function setReserveNumbers(on) {
    if (!api() || !api().setSquadNumberSettings) return;
    const r = await api().setSquadNumberSettings(on);
    if (!r || !r.success) { const el = document.getElementById('settings-reserve-numbers-toggle'); if (el) el.checked = !on; }
  }

  if (window.api && window.api.onDynamicLookUpdated) {
    window.api.onDynamicLookUpdated(() => { if (S) load(true); updateSettingsStatus(); });
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => { updateSettingsStatus(); loadReserveNumbers(); }, 1500));

  window.DynamicLookUI = { open, updateSettingsStatus, setReserveNumbers };
})();
