// Club presentation helpers: the Home ticker's CLUB group (in-game date, transfer window, contracts, injuries) and
// the Team-based theme (Settings > Display > Theme), which turns the club's in-game kit colours (team_colors in the
// calendar export) into the app's dark theme variables. Pure functions, used by app.js (renderHomeTicker,
// applyTheme) and tested by scripts/test_club_presentation.js.
(function (root) {
  'use strict';

  const DAY = 86400000;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // 'YYYYMMDD', 'YYYY-MM-DD' or a Date -> local-midnight Date, null if unreadable.
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    const m = String(v).match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  const longDate = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  // ---------------------------------------------------------------------------------------------------------
  // Transfer window (the English windows as Career Mode runs them: 1 Jul - 1 Sep and 1 - 31 Jan)
  // ---------------------------------------------------------------------------------------------------------

  // -> { open, daysLeft (to deadline day, when open), daysUntil (to opening, when shut), name } or null.
  function transferWindow(date) {
    const d = toDate(date);
    if (!d) return null;
    const y = d.getFullYear();
    const windows = [
      { name: 'January', open: new Date(y, 0, 1), close: new Date(y, 0, 31) },
      { name: 'summer', open: new Date(y, 6, 1), close: new Date(y, 8, 1) },
      { name: 'January', open: new Date(y + 1, 0, 1), close: new Date(y + 1, 0, 31) }
    ];
    const cur = windows.find(w => d >= w.open && d <= w.close);
    if (cur) return { open: true, name: cur.name, daysLeft: Math.round((cur.close - d) / DAY) };
    const next = windows.find(w => w.open > d);
    return { open: false, name: next.name, daysUntil: Math.round((next.open - d) / DAY) };
  }

  // ---------------------------------------------------------------------------------------------------------
  // Ticker CLUB group
  // ---------------------------------------------------------------------------------------------------------

  // ctx: { date (in-game), squad: own players at the club [{ name, injury, contract_expiry }], monthsUntil(expiry) }
  // -> [{ text, tone }] where tone is '' | 'good' | 'warn' | 'alert' (for colouring). The date always comes first;
  // everything else only appears when it says something.
  function clubTickerItems(ctx) {
    const items = [];
    const d = toDate(ctx && ctx.date);
    if (!d) return items;
    items.push({ text: `📅 ${longDate(d)}`, tone: '' });

    const w = transferWindow(d);
    if (w.open && w.daysLeft === 0) items.push({ text: '🚨 Deadline day! The transfer window shuts tonight', tone: 'alert' });
    else if (w.open) items.push({ text: `🔁 The ${w.name} window is open · ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'} to the deadline`, tone: w.daysLeft <= 7 ? 'warn' : 'good' });
    else items.push({ text: `🔁 The ${w.name} transfer window opens in ${w.daysUntil} day${w.daysUntil === 1 ? '' : 's'}`, tone: '' });

    const squad = (ctx.squad || []);
    if (ctx.monthsUntil) {
      const expiring = squad.filter(p => { const m = ctx.monthsUntil(p.contract_expiry); return m != null && m >= 0 && m <= 12; }).length;
      if (expiring) items.push({ text: `📋 ${expiring} contract${expiring === 1 ? '' : 's'} expire within 12 months`, tone: expiring >= 4 ? 'warn' : '' });
    }
    const injured = squad.filter(p => p.injury).map(p => p.name);
    if (injured.length) items.push({ text: `🚑 ${injured.length} injured: ${injured.slice(0, 3).join(', ')}${injured.length > 3 ? ` +${injured.length - 3}` : ''}`, tone: 'alert' });
    else if (squad.length) items.push({ text: '✅ Full squad fit', tone: 'good' });
    return items;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Team-based theme
  // ---------------------------------------------------------------------------------------------------------

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
  }
  function hexToRgb(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const hsl = (h, s, l) => `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  const isColour = c => c && Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b) && (c.r + c.g + c.b) > 0;

  // colours: [{r,g,b}] in kit order (primary first), or a '#rrggbb' override. Picks the club's most characterful
  // colour as the accent (the first properly coloured one, so red-and-white Arsenal goes red and black-and-white
  // Newcastle / Swansea go white), lifts it until it reads on a dark background, and tints the dark background with
  // its hue. -> { '--accent-color', '--bg-color', '--card-bg', '--border-color', '--hover-color' } or null.
  function teamThemeVars(colours) {
    const list = (typeof colours === 'string' ? [hexToRgb(colours)] : (colours || [])).filter(isColour);
    if (list.length === 0) return null;
    const hsls = list.map(rgbToHsl);
    const vivid = hsls.find(c => c.s >= 0.3 && c.l >= 0.12 && c.l <= 0.9);
    if (!vivid) {
      // a black-and-white (or grey) kit: white accent on the neutral dark theme
      return { '--accent-color': '#e6edf3', '--bg-color': '#0d1117', '--card-bg': '#161b22', '--border-color': '#30363d', '--hover-color': '#21262d' };
    }
    const h = vivid.h, s = vivid.s;
    const accentL = clamp(vivid.l, 0.5, 0.68); // dark navies get lifted, near-pastels toned down
    const tint = Math.min(s, 0.45);
    return {
      '--accent-color': hsl(h, Math.max(s, 0.55), accentL),
      '--bg-color': hsl(h, tint, 0.07),
      '--card-bg': hsl(h, tint, 0.11),
      '--border-color': hsl(h, Math.min(s, 0.4), 0.24),
      '--hover-color': hsl(h, tint, 0.15)
    };
  }

  // The team_colors export ({ primary, secondary, tertiary }) as a list in kit order.
  const kitColours = tc => (tc ? [tc.primary, tc.secondary, tc.tertiary] : []);

  const api = { toDate, longDate, transferWindow, clubTickerItems, rgbToHsl, hexToRgb, teamThemeVars, kitColours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ClubPresentation = api;
})(typeof window !== 'undefined' ? window : globalThis);
