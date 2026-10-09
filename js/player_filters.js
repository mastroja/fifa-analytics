// Shared player-table filter (Squad list + Squad All-Time use the same component, so the UI and behaviour never drift).
//
// PlayerFilters.create({ key, mount, fields, presets, onChange, getRows })
//   key      persistence key (localStorage "pf:<key>"; failures are ignored)
//   mount    id of the element the control renders into
//   fields   [{ id, label, type, get(row), ... }] where type is one of
//              'chips'  { options: [{value,label}] }  row matches if get(row) is any selected value
//              'range'  { step }                      min / max number inputs; rows with no value are excluded
//              'min'    { step }                      single "at least" number input
//              'text'                                 case-insensitive "contains"
//              'select' { options(rows) -> [value] }  one value, "Any" by default
//              'toggle'                               checkbox; row matches when get(row) is truthy
//   presets  [{ label, set: { fieldId: value } | () => {...} }]   one-click combinations (a function is evaluated on click)
//   getRows  () -> current rows, only used to build 'select' options
//
// matches(row) is pure (state in, boolean out), so it is also exported for tests via module.exports.
(function (root) {
  'use strict';

  const isBlank = v => v === '' || v === null || v === undefined;
  const num = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);

  function isActiveValue(field, v) {
    if (isBlank(v)) return false;
    switch (field.type) {
      case 'chips': return Array.isArray(v) && v.length > 0;
      case 'range': return num(v.min) !== null || num(v.max) !== null;
      case 'min': return num(v) !== null;
      case 'toggle': return v === true;
      default: return String(v).trim() !== '';
    }
  }

  function fieldMatches(field, v, row) {
    if (!isActiveValue(field, v)) return true;
    const got = field.get(row);
    switch (field.type) {
      case 'chips': return v.includes(got);
      case 'range': {
        const n = num(got); if (n === null) return false;
        const lo = num(v.min), hi = num(v.max);
        return (lo === null || n >= lo) && (hi === null || n <= hi);
      }
      case 'min': { const n = num(got); return n !== null && n >= num(v); }
      case 'toggle': return !!got;
      case 'text': return String(got ?? '').toLowerCase().includes(String(v).toLowerCase().trim());
      case 'select': return String(got ?? '') === String(v);
      default: return true;
    }
  }

  function matchesAll(fields, state, row) {
    return fields.every(f => fieldMatches(f, state[f.id], row));
  }
  function countActive(fields, state) {
    return fields.filter(f => isActiveValue(f, state[f.id])).length;
  }

  function create(cfg) {
    const { key, mount, fields, presets = [], onChange, getRows } = cfg;
    const storeKey = `pf:${key}`;
    let state = {};
    let open = false;
    try { state = JSON.parse(localStorage.getItem(storeKey) || '{}') || {}; } catch (e) { state = {}; }

    const el = () => document.getElementById(mount);
    const persist = () => { try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch (e) { /* no persistence */ } };
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const changed = () => { persist(); render(); if (onChange) onChange(); };

    function fieldHtml(f) {
      const v = state[f.id];
      const id = `pf-${key}-${f.id}`;
      let control = '';
      if (f.type === 'chips') {
        control = f.options.map(o => `<button type="button" class="pf-chip${Array.isArray(v) && v.includes(o.value) ? ' active' : ''}" data-pf-chip="${esc(f.id)}" data-v="${esc(o.value)}">${esc(o.label)}</button>`).join('');
      } else if (f.type === 'range') {
        const r = v || {};
        control = `<input type="number" step="${f.step || 1}" placeholder="min" data-pf-range="${esc(f.id)}" data-end="min" value="${esc(r.min ?? '')}" /><span class="pf-dash">–</span><input type="number" step="${f.step || 1}" placeholder="max" data-pf-range="${esc(f.id)}" data-end="max" value="${esc(r.max ?? '')}" />`;
      } else if (f.type === 'min') {
        control = `<input type="number" step="${f.step || 1}" placeholder="at least" data-pf-min="${esc(f.id)}" value="${esc(v ?? '')}" />`;
      } else if (f.type === 'text') {
        control = `<input type="text" placeholder="contains…" data-pf-text="${esc(f.id)}" value="${esc(v ?? '')}" />`;
      } else if (f.type === 'select') {
        const opts = (f.options ? f.options(getRows ? getRows() : []) : []);
        control = `<select data-pf-select="${esc(f.id)}"><option value="">Any</option>${opts.map(o => `<option value="${esc(o)}"${String(v) === String(o) ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      } else if (f.type === 'toggle') {
        control = `<label class="pf-toggle"><input type="checkbox" id="${id}" data-pf-toggle="${esc(f.id)}"${v === true ? ' checked' : ''} /> ${esc(f.toggleLabel || 'Yes')}</label>`;
      }
      return `<div class="pf-field${isActiveValue(f, v) ? ' active' : ''}"><div class="pf-label">${esc(f.label)}</div><div class="pf-control">${control}</div></div>`;
    }

    function render() {
      const host = el();
      if (!host) return;
      const n = countActive(fields, state);
      host.innerHTML = `
        <div class="pf-bar">
          <button type="button" class="home-toggle-btn${open ? ' active' : ''}" data-pf-toggle-panel="1">⚙ Filters${n ? ` <span class="pf-count">${n}</span>` : ''}</button>
          ${presets.map((p, i) => `<button type="button" class="pf-chip" data-pf-preset="${i}">${esc(p.label)}</button>`).join('')}
          ${n ? '<button type="button" class="pf-clear" data-pf-clear="1">Clear all</button>' : ''}
          <span class="pf-summary" data-pf-summary></span>
        </div>
        ${open ? `<div class="pf-panel">${fields.map(fieldHtml).join('')}</div>` : ''}`;
    }

    function setSummary(shown, total) {
      const s = el() && el().querySelector('[data-pf-summary]');
      if (s) s.textContent = countActive(fields, state) ? `Showing ${shown} of ${total}` : '';
    }

    function bind() {
      const host = el();
      if (!host || host.__pfBound) return;
      host.__pfBound = true;
      host.addEventListener('click', e => {
        const t = e.target.closest('button');
        if (!t) return;
        if (t.dataset.pfTogglePanel) { open = !open; render(); return; }
        if (t.dataset.pfClear) { state = {}; changed(); return; }
        if (t.dataset.pfPreset !== undefined) { const pr = presets[+t.dataset.pfPreset]; state = { ...(typeof pr.set === 'function' ? pr.set() : pr.set) }; open = true; changed(); return; }
        if (t.dataset.pfChip) {
          const cur = Array.isArray(state[t.dataset.pfChip]) ? state[t.dataset.pfChip].slice() : [];
          const i = cur.indexOf(t.dataset.v);
          if (i >= 0) cur.splice(i, 1); else cur.push(t.dataset.v);
          state[t.dataset.pfChip] = cur; changed();
        }
      });
      host.addEventListener('input', e => {
        const t = e.target;
        if (t.dataset.pfRange) { const r = { ...(state[t.dataset.pfRange] || {}) }; r[t.dataset.end] = t.value; state[t.dataset.pfRange] = r; persist(); if (onChange) onChange(); refreshBadges(); }
        else if (t.dataset.pfMin) { state[t.dataset.pfMin] = t.value; persist(); if (onChange) onChange(); refreshBadges(); }
        else if (t.dataset.pfText) { state[t.dataset.pfText] = t.value; persist(); if (onChange) onChange(); refreshBadges(); }
      });
      host.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.pfSelect) { state[t.dataset.pfSelect] = t.value; changed(); }
        else if (t.dataset.pfToggle) { state[t.dataset.pfToggle] = t.checked; changed(); }
      });
    }

    // Typing in a number box must not re-render the panel (it would steal focus), so only the count badge /
    // clear button / field highlights are refreshed in place.
    function refreshBadges() {
      const host = el(); if (!host) return;
      const n = countActive(fields, state);
      const btn = host.querySelector('[data-pf-toggle-panel]');
      if (btn) btn.innerHTML = `⚙ Filters${n ? ` <span class="pf-count">${n}</span>` : ''}`;
      let clear = host.querySelector('[data-pf-clear]');
      if (n && !clear) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pf-clear'; b.dataset.pfClear = '1'; b.textContent = 'Clear all'; host.querySelector('.pf-bar').insertBefore(b, host.querySelector('[data-pf-summary]')); }
      if (!n && clear) clear.remove();
      host.querySelectorAll('.pf-field').forEach((node, i) => node.classList.toggle('active', isActiveValue(fields[i], state[fields[i].id])));
    }

    render(); bind();
    return {
      matches: row => matchesAll(fields, state, row),
      activeCount: () => countActive(fields, state),
      reset: () => { state = {}; changed(); },
      refresh: render,       // re-render the control (e.g. after the rows behind a 'select' changed)
      setSummary
    };
  }

  const api = { create, fieldMatches, matchesAll, countActive };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlayerFilters = api;
})(typeof window !== 'undefined' ? window : globalThis);
