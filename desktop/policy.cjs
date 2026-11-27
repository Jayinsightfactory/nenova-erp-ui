'use strict';
const ORIGIN = 'https://nenovaweb.com';
const MAX_WINDOWS = 12;
const WINDOW_CASCADE_OFFSET = 32;

function clampBoundsToDisplays(bounds, displays = [], primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1080 }) {
  const primary = primaryWorkArea || { x: 0, y: 0, width: 1920, height: 1080 };
  const b = bounds || { ...primary, width: 1600, height: 1000 };
  const list = Array.isArray(displays) ? displays : [];
  const hit = list.find(({ workArea: a }) =>
    a && b.x + 100 > a.x && b.x < a.x + a.width - 100 && b.y + 50 > a.y && b.y < a.y + a.height - 50
  );
  const a = hit?.workArea || primary;
  const width = Math.min(a.width, Math.max(800, Number.isFinite(b.width) ? b.width : 1600));
  const height = Math.min(a.height, Math.max(600, Number.isFinite(b.height) ? b.height : 1000));
  const rawX = Number.isFinite(b.x) ? b.x : a.x;
  const rawY = Number.isFinite(b.y) ? b.y : a.y;
  return {
    width,
    height,
    x: Math.max(a.x, Math.min(rawX, a.x + a.width - width)),
    y: Math.max(a.y, Math.min(rawY, a.y + a.height - height)),
  };
}

function cascadeWindowBounds(anchorBounds, displays = [], primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1080 }, offset = WINDOW_CASCADE_OFFSET) {
  if (!anchorBounds) return clampBoundsToDisplays(null, displays, primaryWorkArea);
  return clampBoundsToDisplays({
    ...anchorBounds,
    x: (Number.isFinite(anchorBounds.x) ? anchorBounds.x : 0) + offset,
    y: (Number.isFinite(anchorBounds.y) ? anchorBounds.y : 0) + offset,
  }, displays, primaryWorkArea);
}

function secondInstanceAction({ argv = [], locked = true, windowCount = 0, maxWindows = MAX_WINDOWS } = {}) {
  const args = Array.isArray(argv) ? argv.map(arg => String(arg || '').trim()) : [];
  if (!locked && args.some(arg => /^nenova-notes:\/\/open\/?$/i.test(arg))) return 'open-notes';
  if (args.some(arg => arg === '--focus-only')) return 'focus-existing';
  if (!locked && windowCount < maxWindows) return 'new-window';
  return 'focus-existing';
}

function tabContextMenuItems({ tabCount = 1, windowCount = 1, locked = false, maxWindows = MAX_WINDOWS } = {}) {
  return [
    { id: 'detach', label: '새 창으로 분리', enabled: !locked && windowCount < maxWindows },
    { id: 'close', label: '탭 닫기', enabled: true },
    { id: 'closeOthers', label: '다른 탭 닫기', enabled: tabCount > 1 },
  ];
}

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
  const allowed = new Set(['popup','year','week','orderYear','orderWeek','OrderYear','OrderWeek','custKey','CustKey','prodKey','ProdKey','tab','tool','country','source','days','hotel','hotelId','mode','preview','date','from','to']);
  const warehouseKeys = u.searchParams.getAll('warehouseKey');
  if ((u.pathname === '/incoming' || (u.pathname === '/import/tools' && u.searchParams.get('tab') === 'cost'))
    && warehouseKeys.length === 1 && /^[1-9]\d*$/.test(warehouseKeys[0]) && Number.isSafeInteger(Number(warehouseKeys[0]))) allowed.add('warehouseKey');
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
module.exports = {
  ORIGIN,
  MAX_WINDOWS,
  WINDOW_CASCADE_OFFSET,
  clampBoundsToDisplays,
  cascadeWindowBounds,
  secondInstanceAction,
  tabContextMenuItems,
  trustedUrl,
  externalUrl,
  safeSnapshot,
  safeFavorites,
  text,
};
