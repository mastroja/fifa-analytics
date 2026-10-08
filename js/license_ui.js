// Renderer side of Pro licensing: feature checks, the 🔒 markers, the upgrade dialog and the Settings > Pro section.
// The real work (verifying keys, talking to the license server) happens in the main process (js/license.js); this
// file only asks it for the current status. With licensing off (no public key configured) every check passes.
//
//   License.isPro('academy-tracker')          -> boolean (synchronous, from the cached status)
//   License.upsell('academy-tracker')         -> opens the "available with Pro" dialog, returns false
//   License.requirePro('feature', () => ...)  -> runs the callback only when unlocked, else shows the dialog
//   <button data-pro="feature">               -> gets a 🔒 suffix while locked (see .pro-locked in index.html)
(function (root) {
  'use strict';
  let info = { enforced: false, pro: true, features: {} };
  let busy = false;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = () => root.api;
  const $ = id => root.document.getElementById(id);

  function isPro(feature) {
    if (!info.enforced) return true;
    if (!(feature in (info.features || {}))) return true;
    return !!info.pro;
  }

  function decorate() {
    root.document.querySelectorAll('[data-pro]').forEach(el => el.classList.toggle('pro-locked', !isPro(el.dataset.pro)));
  }

  function statusLine() {
    if (!info.enforced) return '';
    if (info.pro) {
      const bits = [info.source === 'patreon' ? 'Patreon member' : 'License key'];
      if (info.expires) bits.push(`renews ${new Date(info.expires).toLocaleDateString()}`);
      if (info.maxBuild) bits.push(`covers versions up to ${info.maxBuild}`);
      return `<b style="color:#3fb950">Pro active</b> <span class="pro-dim">· ${esc(bits.join(' · '))}</span>`;
    }
    return `<b>Free version</b>${info.reason ? ` <span class="pro-dim">· ${esc(info.reason)}</span>` : ''}`;
  }

  function renderSettings() {
    const section = $('settings-pro-section'), body = $('settings-pro-body');
    if (!section || !body) return;
    section.style.display = info.enforced ? '' : 'none';
    if (!info.enforced) return;
    const feats = Object.values(info.features || {}).map(f => `<li>${esc(f)}</li>`).join('');
    body.innerHTML = `
      <div class="settings-row" style="flex-wrap: wrap; gap: 6px;">${statusLine()}</div>
      ${info.pro ? '' : `<ul class="pro-list">${feats}</ul>`}
      <div class="settings-row" style="gap: 6px; flex-wrap: wrap;">
        ${info.patreonLogin && !info.pro ? `<button class="refresh-btn" id="pro-patreon-btn" onclick="License.signInWithPatreon()">Sign in with Patreon</button>` : ''}
        ${info.membershipUrl && !info.pro ? `<button class="refresh-btn" onclick="License.openMembership()">Become a member</button>` : ''}
        ${info.source !== 'none' ? `<button class="refresh-btn" onclick="License.signOut()">Remove key / sign out</button>` : ''}
      </div>
      ${info.pro ? '' : `<div class="settings-row" style="gap: 6px;"><input type="text" id="pro-key-input" placeholder="Paste a license key" class="pro-key" onkeydown="if(event.key==='Enter')License.activateKey()"><button class="refresh-btn" onclick="License.activateKey()">Activate</button></div>`}
      <div id="pro-message" class="pro-dim" style="min-height: 16px; font-size: 12px;"></div>`;
  }
  const say = (msg, bad) => { const el = $('pro-message'); if (el) { el.textContent = msg || ''; el.style.color = bad ? '#f85149' : ''; } };

  async function refresh() {
    if (api() && api().licenseInfo) {
      try { info = await api().licenseInfo(); } catch (e) { /* keep the last known status */ }
    }
    decorate(); renderSettings();
    if (root.SquadViews && root.SquadViews.applyLicense) root.SquadViews.applyLicense();
  }

  function upsell(feature) {
    let dlg = $('pro-dialog');
    if (!dlg) {
      dlg = root.document.createElement('dialog'); dlg.id = 'pro-dialog';
      root.document.body.appendChild(dlg);
      dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    }
    const name = (info.features || {})[feature] || 'This feature';
    const feats = Object.values(info.features || {}).map(f => `<li>${esc(f)}</li>`).join('');
    dlg.innerHTML = `<div class="pro-dlg">
      <h3>🔒 ${esc(name)} is part of Pro</h3>
      <p class="pro-dim">Pro includes:</p><ul class="pro-list">${feats}</ul>
      ${info.reason ? `<p class="pro-dim">${esc(info.reason)}</p>` : ''}
      <div style="display:flex; gap:8px; flex-wrap: wrap; margin-top: 12px;">
        ${info.patreonLogin ? `<button class="back-btn" style="margin:0" onclick="License.signInWithPatreon(true)">Sign in with Patreon</button>` : ''}
        ${info.membershipUrl ? `<button class="back-btn" style="margin:0" onclick="License.openMembership()">Become a member</button>` : ''}
        <button class="back-btn" style="margin:0" onclick="document.getElementById('pro-dialog').close(); toggleSettingsPanel(true)">I have a key</button>
        <button class="back-btn" style="margin:0 0 0 auto" onclick="document.getElementById('pro-dialog').close()">Not now</button>
      </div></div>`;
    if (!dlg.open) dlg.showModal();
    return false;
  }

  function requirePro(feature, fn) { if (isPro(feature)) return fn(); return upsell(feature); }

  async function signInWithPatreon(fromDialog) {
    if (busy || !api() || !api().licensePatreonLogin) return;
    busy = true; say('Waiting for you to finish signing in in your browser…');
    const btn = $('pro-patreon-btn'); if (btn) btn.disabled = true;
    try {
      const r = await api().licensePatreonLogin();
      if (r && r.error) say(r.error, true);
      else say('Signed in. Thank you!');
      await refresh();
      if (fromDialog === true && isPro(Object.keys(info.features || {})[0])) { const d = $('pro-dialog'); if (d && d.open) d.close(); }
    } finally { busy = false; if (btn) btn.disabled = false; }
  }
  async function activateKey() {
    const input = $('pro-key-input'); if (!input || !api()) return;
    const r = await api().licenseActivate(input.value);
    await refresh();
    say(r && r.ok ? 'Key activated. Thank you!' : (r && r.error) || 'That key did not work.', !(r && r.ok));
  }
  async function signOut() { if (api()) await api().licenseClear(); await refresh(); }
  function openMembership() { if (api() && api().licenseOpenMembership) api().licenseOpenMembership(); }

  root.License = { isPro, upsell, requirePro, refresh, decorate, signInWithPatreon, activateKey, signOut, openMembership, lock: f => (isPro(f) ? '' : ' 🔒') };
  root.document.addEventListener('DOMContentLoaded', () => { refresh(); });
  root.addEventListener('focus', () => { refresh(); });
})(window);
