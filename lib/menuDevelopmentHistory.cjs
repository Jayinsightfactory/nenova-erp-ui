'use strict';

const UNKNOWN_NOTE = 'Git 첫 부모 이력의 변경 파일명만 분석했습니다. 파일 내용·업무 의미를 판독하지 않으며, 추가(A) 기록이 없는 기능의 최초 도입일과 수정 횟수는 알 수 없습니다.';

function routeOf(href) { return String(href).split('?')[0].replace(/\/$/, '') || '/'; }
function normalizePath(value) { return String(value || '').replace(/\\/g, '/'); }

function extractMenuItems(source) {
  const start = source.indexOf('export const MENU_ITEMS = [');
  if (start < 0) throw new Error('MENU_ITEMS block missing');
  const end = source.indexOf('\n];', start);
  if (end < 0) throw new Error('MENU_ITEMS block unterminated');
  const block = source.slice(start, end);
  const groups = [...block.matchAll(/group:\s*['"]([^'"]+)['"]\s*,\s*items:\s*\[([\s\S]*?)(?=\n\s*\}\s*,?\s*\n\s*\{|$)/g)];
  if (!groups.length) throw new Error('MENU_ITEMS groups not parsed');
  const seen = new Set();
  const menus = [];
  for (const [, group, items] of groups) {
    for (const [, href, label] of items.matchAll(/\{\s*href:\s*['"]([^'"]+)['"]\s*,\s*labelKey:\s*['"]([^'"]+)['"]/g)) {
      if (seen.has(href)) continue;
      seen.add(href);
      menus.push({ href, route: routeOf(href), label, group });
    }
  }
  if (!menus.length) throw new Error('MENU_ITEMS entries not parsed');
  return menus;
}

function parseGitLog(raw) {
  if (!raw || !raw.includes('\x1e')) throw new Error('Git log record delimiter missing');
  return raw.split('\x1e').filter(Boolean).map(record => {
    const boundary = record.indexOf('\x1d');
    if (boundary < 0) throw new Error('Git log header boundary missing');
    const header = record.slice(0, boundary).replace(/^\r?\n/, '').split('\x1f');
    const lines = record.slice(boundary + 1).split(/\r?\n/);
    if (header.length !== 4 || !/^[a-f0-9]{40}$/i.test(header[0]) || !header[1]) throw new Error('Malformed Git log header');
    const changes = [];
    for (const line of lines) {
      if (!line) continue;
      const fields = line.split('\t');
      const status = fields[0];
      if (!/^[AMDRCTUXB][0-9]*$/.test(status)) throw new Error('Malformed Git name-status row');
      if (status[0] === 'R' || status[0] === 'C') {
        if (fields.length !== 3) throw new Error('Malformed Git rename/copy row');
        changes.push({ status, oldPath: normalizePath(fields[1]), path: normalizePath(fields[2]) });
      } else {
        if (fields.length !== 2) throw new Error('Malformed Git file row');
        changes.push({ status, path: normalizePath(fields[1]) });
      }
    }
    return { hash: header[0], date: header[1], subject: header[2], body: header[3], changes };
  });
}

function primaryPage(route) {
  const segment = route === '/' ? 'index' : route.slice(1);
  return new Set([`pages/${segment}.js`, `pages/${segment}.jsx`, `pages/${segment}.ts`, `pages/${segment}.tsx`, `pages/${segment}/index.js`, `pages/${segment}/index.jsx`, `pages/${segment}/index.ts`, `pages/${segment}/index.tsx`]);
}

function matchesPath(path, pattern) {
  return path.startsWith(pattern);
}

function displayTitle(commit) {
  if (!/^Merge (pull request|branch|remote-tracking)/i.test(commit.subject)) return commit.subject;
  const candidate = String(commit.body || '').split(/\r?\n/).map(line => line.trim()).find(line => line && !/^(#\d+|Merge pull request|Merge branch)/i.test(line));
  return candidate || commit.subject;
}

function buildSnapshot({ menus, commits, catalog = { features: [] }, headHash = null, isShallow = false, shallowBoundaryHashes = [] }) {
  if (!Array.isArray(menus) || !Array.isArray(commits) || !Array.isArray(catalog.features)) throw new Error('Invalid snapshot inputs');
  const outputMenus = menus.map(menu => {
    const route = routeOf(menu.route || menu.href);
    const specs = [{ id: 'page', title: '화면·기본 기능(경로 기반)', description: '메뉴 페이지 파일의 변경 이력', primary: true, paths: [] },
      ...catalog.features.filter(feature => feature.route === route)];
    return { ...menu, route, features: specs.map(spec => ({ id: spec.id, title: spec.title, description: spec.description, firstAddedAt: null, firstAddedKnown: false, changeCount: 0, modificationCount: null, lastChangedAt: null, timeline: [], _spec: spec })) };
  });
  const unclassified = new Set();
  const classified = new Set();
  const allRelevant = new Set();
  // Git --root fabricates A rows at shallow boundaries; these are not actual additions.
  const boundaries = new Set(shallowBoundaryHashes);
  const chronological = commits.filter(commit => !boundaries.has(commit.hash)).reverse();
  for (const commit of chronological) {
    const commitClassified = new Set();
    for (const change of commit.changes) {
      const paths = [normalizePath(change.path), ...(change.oldPath ? [normalizePath(change.oldPath)] : [])];
      let matched = false;
      for (const menu of outputMenus) {
        for (const feature of menu.features) {
          const spec = feature._spec;
          const hit = paths.some(path => spec.primary ? primaryPage(menu.route).has(path) : spec.paths.some(pattern => matchesPath(path, pattern)));
          if (!hit) continue;
          matched = true;
          const key = `${menu.href}\0${feature.id}`;
          if (!commitClassified.has(key)) {
            feature.timeline.push({ hash: commit.hash, subject: displayTitle(commit), date: commit.date, changedFiles: [], menuHref: menu.href, featureId: feature.id });
            commitClassified.add(key);
          }
          const event = feature.timeline[feature.timeline.length - 1];
          if (!event.changedFiles.includes(change.path)) event.changedFiles.push(change.path);
          const isAnchor = spec.primary ? primaryPage(menu.route).has(change.path) : (spec.anchorPaths || []).includes(change.path);
          if (change.status === 'A' && isAnchor && !feature.firstAddedKnown) {
            feature.firstAddedKnown = true;
            feature.firstAddedAt = commit.date;
            feature._introducedHash = commit.hash;
          }
        }
      }
      for (const path of paths) (matched ? classified : unclassified).add(path);
    }
    if (commitClassified.size) allRelevant.add(commit.hash);
  }
  for (const menu of outputMenus) {
    const hashes = new Set();
    for (const feature of menu.features) {
      feature.timeline.reverse();
      feature.changeCount = feature.timeline.length;
      feature.modificationCount = feature.firstAddedKnown ? feature.timeline.findIndex(event => event.hash === feature._introducedHash) : null;
      feature.lastChangedAt = feature.timeline[0]?.date || null;
      feature.timeline.forEach(event => hashes.add(event.hash));
      delete feature._spec;
      delete feature._introducedHash;
    }
    menu.changeCount = hashes.size;
    menu.featureCount = menu.features.length;
    menu.lastChangedAt = menu.features.map(f => f.lastChangedAt).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null;
  }
  return { schemaVersion: 1, sourceStatus: 'git', headHash, isShallow, generatedAt: new Date().toISOString(), coverageNote: UNKNOWN_NOTE + (isShallow ? ' 현재 저장소는 shallow clone이므로 과거 이력이 불완전합니다. 실제 변경으로 확인할 수 없는 shallow 경계 커밋은 집계에서 제외했습니다.' : ''), uniqueCommitCount: allRelevant.size, stats: { classifiedFileCount: classified.size, unclassifiedFileCount: unclassified.size }, menus: outputMenus };
}

function positiveInt(value, fallback, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

function querySnapshot(snapshot, query = {}) {
  const q = String(query.q || '').trim().toLocaleLowerCase();
  const sort = query.sort === 'changes' ? 'changes' : 'recent';
  const page = positiveInt(query.page, 1, 1000000);
  const limit = positiveInt(query.limit, 50, 100);
  const selectedMenu = snapshot.menus.find(menu => menu.href === query.menu) || null;
  const menuText = menu => `${menu.label} ${menu.group} ${menu.href}`.toLocaleLowerCase();
  const featureText = feature => `${feature.title} ${feature.description}`.toLocaleLowerCase();
  const eventText = event => `${event.subject} ${event.changedFiles.join(' ')}`.toLocaleLowerCase();
  const visibleMenus = snapshot.menus.filter(menu => !q || menuText(menu).includes(q) || menu.features.some(feature => featureText(feature).includes(q) || feature.timeline.some(event => eventText(event).includes(q))));
  const menuSorter = sort === 'changes' ? (a, b) => b.changeCount - a.changeCount || String(a.label || a.title).localeCompare(String(b.label || b.title), 'ko') : (a, b) => (Date.parse(b.lastChangedAt || '') || 0) - (Date.parse(a.lastChangedAt || '') || 0) || String(a.label || a.title).localeCompare(String(b.label || b.title), 'ko');
  const stripMenu = ({ features, ...menu }) => menu;
  const menus = visibleMenus.sort(menuSorter).map(stripMenu);
  const featureSource = selectedMenu ? selectedMenu.features : snapshot.menus.flatMap(menu => menu.features.map(f => ({ ...f, menuHref: menu.href })));
  const features = featureSource.filter(feature => !q || featureText(feature).includes(q) || feature.timeline.some(event => eventText(event).includes(q)) || (selectedMenu && menuText(selectedMenu).includes(q))).sort(menuSorter).map(({ timeline, ...feature }) => feature);
  const selectedFeatures = selectedMenu ? selectedMenu.features : snapshot.menus.flatMap(menu => menu.features);
  const rawEvents = selectedFeatures.filter(feature => !query.feature || feature.id === query.feature).flatMap(feature => feature.timeline).filter(event => !q || eventText(event).includes(q) || featureText(selectedFeatures.find(feature => feature.id === event.featureId && feature.timeline.includes(event)) || { title: '', description: '' }).includes(q) || menuText(snapshot.menus.find(menu => menu.href === event.menuHref)).includes(q));
  const byHash = new Map();
  for (const event of rawEvents) {
    if (!byHash.has(event.hash)) byHash.set(event.hash, { ...event, changedFiles: [], menuHrefs: [], featureIds: [] });
    const merged = byHash.get(event.hash);
    for (const file of event.changedFiles) if (!merged.changedFiles.includes(file)) merged.changedFiles.push(file);
    if (!merged.menuHrefs.includes(event.menuHref)) merged.menuHrefs.push(event.menuHref);
    if (!merged.featureIds.includes(event.featureId)) merged.featureIds.push(event.featureId);
  }
  const timeline = [...byHash.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.hash.localeCompare(b.hash));
  const totalEvents = timeline.length;
  return { success: true, sourceStatus: snapshot.sourceStatus, generatedAt: snapshot.generatedAt, headHash: snapshot.headHash, isShallow: snapshot.isShallow, coverageNote: snapshot.coverageNote, stats: snapshot.stats, uniqueCommitCount: snapshot.uniqueCommitCount, totalMenuCount: snapshot.menus.length, menus, selectedMenu: selectedMenu && stripMenu(selectedMenu), features, timeline: timeline.slice((page - 1) * limit, page * limit), page, limit, totalPages: Math.ceil(totalEvents / limit), totalEvents };
}

module.exports = { extractMenuItems, parseGitLog, buildSnapshot, querySnapshot, routeOf, primaryPage };
