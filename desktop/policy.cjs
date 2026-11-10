'use strict';
const ORIGIN = 'https://nenovaweb.com';
function trustedUrl(input, { popup = true } = {}) {
  if (typeof input !== 'string' || input.length > 8192) return null;
  try {
    const u = new URL(input, ORIGIN);
    if (u.origin !== ORIGIN || u.username || u.password) return null;
    if (popup && !['/', '/login', '/dashboard'].includes(u.pathname)) u.searchParams.set('popup', '1');
    return u.href;
  } catch { return null; }
}
function externalUrl(input) {
  try {
    const u = new URL(input);
    return u.protocol === 'https:' && !u.username && !u.password && u.href.length < 8192 ? u.href : null;
  } catch { return null; }
}
const text = (v, max = 100) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, max) : '';
const number = (v, min, max, fallback) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
function safeTab(t) {
  let url = trustedUrl(t?.url);
  if (!url || new URL(url).pathname.startsWith('/api/') || new URL(url).pathname === '/login') return null;
  const u = new URL(url);
  const allowed = new Set(['popup','year','week','orderYear','orderWeek','OrderYear','OrderWeek','custKey','CustKey','prodKey','ProdKey','tab','hotel','hotelId','mode','preview','date','from','to']);
  for (const key of [...u.searchParams.keys()]) if (!allowed.has(key)) u.searchParams.delete(key);
  u.hash = '';
  url = u.href;
  return { url, title: text(t.title) || '업무 화면', zoom: number(t.zoom, .5, 1.5, 1) };
}
function safeFavorites(items) {
  const source = Array.isArray(items) ? items.slice(0, 100) : [];
  const used = new Set();
  const rows = [];
  for (const item of source) {
    const tab = safeTab(item);
    if (!tab) continue;
    const n = item.number;
    if (Number.isSafeInteger(n) && n > 0 && n <= 1000000000 && !used.has(n)) {
      used.add(n);
      tab.number = n;
    }
    const alias = text(item.alias, 60).trim();
    if (alias) tab.alias = alias;
    rows.push(tab);
  }
  let next = 1;
  for (const row of rows) {
    if (row.number) continue;
    while (used.has(next)) next++;
    row.number = next++;
  }
  return rows.sort((a, b) => a.number - b.number);
}
function safeSnapshot(s) {
  return {
    version: 1,
    ...(s?.favoritesMigrated === true ? {favoritesMigrated:true} : {}),
    actor: text(s?.actor, 120),
    favorites: safeFavorites(s?.favorites),
    windows: (Array.isArray(s?.windows) ? s.windows : []).slice(0, 12).map(w => ({
      bounds: { x: number(w?.bounds?.x, -30000, 30000, 0), y: number(w?.bounds?.y, -30000, 30000, 0), width: number(w?.bounds?.width, 800, 7680, 1500), height: number(w?.bounds?.height, 600, 4320, 950) },
      maximized: w?.maximized === true,
      active: number(w?.active, 0, 49, 0),
      tabs: (Array.isArray(w?.tabs) ? w.tabs : []).slice(0, 50).map(safeTab).filter(Boolean)
    }))
  };
}
module.exports = { ORIGIN, trustedUrl, externalUrl, safeSnapshot, safeFavorites, text };
