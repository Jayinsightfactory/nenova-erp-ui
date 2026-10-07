'use strict';
const { ORIGIN, trustedUrl, text } = require('./policy.cjs');
function parseBootstrap(data, expectedActor) {
  if (!data || data.success !== true || data.schemaVersion !== 1 || typeof expectedActor !== 'string' || !expectedActor || data.user?.userId !== expectedActor) throw new Error('Invalid bootstrap identity');
  if (typeof data.webVersion !== 'string' || !data.webVersion || data.webVersion.length > 160 || !/^[a-f0-9]{64}$/i.test(data.menuVersion || '')) throw new Error('Invalid bootstrap version');
  if (!Array.isArray(data.menus) || !data.menus.length || data.menus.length > 50) throw new Error('Invalid menu groups');
  let count = 0;
  const seen = new Set();
  const menus = data.menus.map(group => {
    if (typeof group?.group !== 'string' || !group.group.trim() || group.group.length > 100 || !Array.isArray(group.items) || !group.items.length || group.items.length > 300) throw new Error('Invalid menu group');
    return { group: text(group.group, 100), items: group.items.map(item => {
      if (++count > 500 || typeof item?.href !== 'string' || !item.href.startsWith('/') || item.href.startsWith('//') || !trustedUrl(item.href, { popup: false }) || typeof item.labelKey !== 'string' || !item.labelKey.trim() || item.labelKey.length > 120 || typeof item.popup !== 'boolean') throw new Error('Invalid menu item');
      const u = new URL(item.href, ORIGIN);
      if (u.pathname.startsWith('/api/') || u.pathname === '/api' || seen.has(u.href)) throw new Error('Invalid menu route');
      seen.add(u.href);
      return { href: u.pathname + u.search + u.hash, labelKey: text(item.labelKey, 120), popup: item.popup };
    }) };
  });
  return { menus, menuVersion: data.menuVersion, webVersion: text(data.webVersion, 160) };
}
module.exports = { parseBootstrap };
