'use strict';
const { ORIGIN, safeSnapshot } = require('./policy.cjs');

function accountHref(url) {
  const u = new URL(url, ORIGIN);
  u.searchParams.delete('popup');
  return u.pathname + u.search;
}

async function syncAccountFavorites({ owner, fetch, current, legacy, action }) {
  const page = 'dashboard-menu';
  async function request(method, body) {
    if (!current()) throw Error('계정이 변경되었습니다.');
    const response = await fetch(ORIGIN + '/api/favorites' + (method === 'GET' ? '?page=dashboard-menu' : ''), {
      method, credentials: 'include', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000),
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Favorite-Owner': owner },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok || !current()) throw Error('계정 즐겨찾기를 동기화하지 못했습니다.');
    const result = await response.json();
    if (!result.success || !current()) throw Error('계정 즐겨찾기를 다시 확인하세요.');
    return result;
  }
  async function list() {
    const { favorites } = await request('GET');
    if (!Array.isArray(favorites)) throw Error('즐겨찾기 목록을 확인하지 못했습니다.');
    return favorites.flatMap(row => {
      try {
        const data = JSON.parse(row.FilterData);
        if (typeof data.href !== 'string' || !data.href.startsWith('/')) return [];
        const entry = safeSnapshot({ favorites: [{ url: data.href, title: row.FavName, number: row.SortOrder, alias: data.alias }] }).favorites[0];
        return entry ? [{ entry, data, key: row.FavoriteKey }] : [];
      } catch { return []; }
    });
  }
  let rows = await list();
  const find = item => rows.find(row => accountHref(row.entry.url) === accountHref(item.url));
  const add = item => request('POST', { page, name: item.title, preferredNumber: item.number,
    filterData: JSON.stringify({ href: accountHref(item.url), desktopShortcut: true, alias: item.alias || '' }) });
  let changed = false;
  for (const item of legacy || []) {
    if (!find(item)) { await add(item); changed = true; }
    else if (item.alias && !find(item).data.alias) {
      await request('PATCH', { favoriteKey: find(item).key, alias: item.alias, onlyIfEmpty: true }); changed = true;
    }
  }
  if (action) {
    const row = find(action.item);
    if (action.kind === 'add' && !row) { await add(action.item); changed = true; }
    if (action.kind === 'remove' && row) { await request('DELETE', { favoriteKey: row.key }); changed = true; }
    if (action.kind === 'rename' && row) { await request('PATCH', { favoriteKey: row.key, alias: action.alias }); changed = true; }
    if (action.kind === 'rename' && !row) throw Error('이미 삭제된 즐겨찾기입니다.');
  }
  if (changed) rows = await list();
  return rows.map(row => row.entry);
}
module.exports = { syncAccountFavorites };
