'use strict';

const MAX_SEARCH_ROWS = 50000;
const SEARCH_STRING_KEYS = ['scope', 'who', 'dept', 'ext', 'dir', 'period', 'sensitive', 'versions', 'origin', 'stage', 'subcategory'];
const SORT_KEYS = ['uploadedAt', 'filename', 'uploaderName', 'cycle', 'stage', 'size'];

function cycleKey(cycle) {
  const match = String(cycle || '').match(/^(\d+)(?:-(\d+))?$/);
  return match ? parseInt(match[1], 10) * 10 + parseInt(match[2] || '0', 10) : -1;
}

// Match the employee browser's calendar even when the server uses another TZ.
// A filename year wins; an early-January edit of a late cycle belongs to last year.
function yearOf(file, offset = new Date().getTimezoneOffset()) {
  const filename = String(file.filename || '');
  const match = filename.match(/(?:^|[^\d])(20(2\d))(?:년|-\d{2}차|\s*\d{2}차)/) || filename.match(/(?:^|[^\d])(2\d)년/);
  if (match) return match[1].length === 4 ? parseInt(match[1], 10) : 2000 + parseInt(match[1], 10);
  const localDate = value => new Date(new Date(value).getTime() - offset * 60000);
  const date = localDate(file.mtime || file.uploadedAt);
  let year = date.getUTCFullYear();
  if (!(year > 2000)) return localDate(file.uploadedAt).getUTCFullYear();
  const week = Math.ceil(((date - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7);
  const major = parseInt(String(file.cycle || '').split('-')[0], 10);
  if (major > week + 2) year--;
  return year;
}

function extKind(file) {
  if (/xls|csv/.test(file.ext)) return 'xls';
  if (file.ext === 'pdf') return 'pdf';
  if (/doc|hwp|txt|ppt/.test(file.ext)) return 'doc';
  if (/png|jpg|jpeg/.test(file.ext)) return 'img';
  return 'etc';
}

function normalizeSearchCriteria(input = {}) {
  const criteria = {};
  for (const key of SEARCH_STRING_KEYS) criteria[key] = typeof input[key] === 'string' ? input[key].slice(0, 500) : '';
  criteria.scope = ['all', 'mine', 'dept'].includes(criteria.scope) ? criteria.scope : 'all';
  criteria.sortKey = SORT_KEYS.includes(input.sortKey) ? input.sortKey : 'uploadedAt';
  criteria.sortDirection = input.sortDirection === 1 ? 1 : -1;
  criteria.limit = Number.isInteger(input.limit) ? Math.min(MAX_SEARCH_ROWS, Math.max(1, input.limit)) : 200;
  criteria.offset = Number.isFinite(input.offset) ? Math.min(840, Math.max(-840, input.offset)) : new Date().getTimezoneOffset();
  return criteria;
}

const versionKey = file => file.uploaderName + '|' + file.filename;
function inScope(file, scope, viewer) {
  if (scope === 'all') return true;
  if (scope === 'mine') return file.uploaderName === viewer.me;
  return file.dept === viewer.dept || file.uploaderName === viewer.me;
}

function matchesQuery(file, query) {
  return String(file.filename || '').toLowerCase().includes(query.toLowerCase())
    || String(file.uploaderName || '').includes(query)
    || (file.cycle || '') === query;
}

function matchesCriteria(file, criteria, viewer, versions, since) {
  const personMatches = criteria.who ? file.uploaderName === criteria.who : inScope(file, criteria.scope, viewer);
  if (!personMatches) return false;
  if (criteria.dept && file.dept !== criteria.dept) return false;
  if (criteria.ext && extKind(file) !== criteria.ext) return false;
  if (criteria.dir && file.sourceDir !== criteria.dir) return false;
  if (since && !(new Date(file.uploadedAt).getTime() >= since)) return false;
  if (criteria.sensitive && !(criteria.sensitive === 'sens' ? file.sensitive : !file.sensitive)) return false;
  if (criteria.versions && !(versions.get(versionKey(file)) > 1)) return false;
  const fromWeb = file.eventType === 'web-upload' || file.hostname === 'web';
  if (criteria.origin && (criteria.origin === 'web') !== fromWeb) return false;
  return true;
}

// Facet/PC totals use every authorized file, independently of the search page.
function collectFacets(visible, criteria, viewer, now) {
  const versions = new Map(), dirs = new Map(), people = new Map(), hosts = new Map(), depts = new Set();
  const today = new Date(now).toISOString().slice(0, 10);
  for (const file of visible) {
    const key = versionKey(file);
    versions.set(key, (versions.get(key) || 0) + 1);
    if (file.sourceDir) dirs.set(file.sourceDir, (dirs.get(file.sourceDir) || 0) + 1);
    if (file.dept) depts.add(file.dept);
    if (inScope(file, criteria.scope, viewer) && file.uploaderName) {
      const person = people.get(file.uploaderName) || {name: file.uploaderName, dept: file.dept, n: 0, last: ''};
      person.n++;
      if (file.uploadedAt > person.last) person.last = file.uploadedAt;
      people.set(file.uploaderName, person);
    }
    const hostKey = (file.uploaderName || '?') + '@' + (file.hostname || '?');
    const host = hosts.get(hostKey) || {name: file.uploaderName || '?', host: file.hostname || '?', n: 0, today: 0, last: ''};
    host.n++;
    if (String(file.uploadedAt || '').slice(0, 10) === today) host.today++;
    if (file.uploadedAt > host.last) host.last = file.uploadedAt;
    hosts.set(hostKey, host);
  }
  return {
    versions,
    facets: {
      people: [...people.values()].sort((a, b) => b.n - a.n),
      dirs: [...dirs].filter(([, count]) => count >= 5).sort((a, b) => b[1] - a[1]).slice(0, 30),
      depts: [...depts],
      hosts: [...hosts.values()].sort((a, b) => b.last > a.last ? 1 : -1),
    },
  };
}

function collectCategorySummary(scoped, criteria, category) {
  const stageCounts = {}, yearMap = new Map();
  let noCycleCount = 0;
  for (const file of scoped) {
    stageCounts[file.stage] = (stageCounts[file.stage] || 0) + 1;
    if (!file.cycle) { noCycleCount++; continue; }
    const year = yearOf(file, criteria.offset), cycles = yearMap.get(year) || new Map();
    cycles.set(file.cycle, (cycles.get(file.cycle) || 0) + 1);
    yearMap.set(year, cycles);
  }
  const years = [...yearMap].sort((a, b) => b[0] - a[0]).map(([year, cycles]) => ({
    year,
    cycles: [...cycles].sort((a, b) => cycleKey(b[0]) - cycleKey(a[0])).map(([cycle, n]) => ({c: cycle, n, ck: year + ':' + cycle})),
  }));
  return {stageCounts, years, noCycleCount, subcategoryCounts: category.subcategoryCounts(scoped, criteria.stage)};
}

function sortSearchRows(rows, criteria, category) {
  const value = file => {
    if (criteria.sortKey === 'cycle') return cycleKey(file.cycle);
    if (criteria.sortKey === 'size') return file.size;
    if (criteria.sortKey === 'stage') return category.fileSubcategory(file);
    return String(file[criteria.sortKey] || '');
  };
  return rows.sort((a, b) => value(a) > value(b) ? criteria.sortDirection : value(a) < value(b) ? -criteria.sortDirection : 0);
}

function buildSearchWindow(visible, query, input, viewer, category, {now = Date.now()} = {}) {
  const criteria = normalizeSearchCriteria(input);
  const {versions, facets} = collectFacets(visible, criteria, viewer, now);
  const matched = visible.filter(file => matchesQuery(file, String(query)));
  const since = criteria.period ? now - Number(criteria.period) * 86400e3 : 0;
  const scoped = matched.filter(file => matchesCriteria(file, criteria, viewer, versions, since));
  const summary = collectCategorySummary(scoped, criteria, category);
  const filtered = category.filterCategories(scoped, criteria.stage, criteria.subcategory);
  sortSearchRows(filtered, criteria, category);
  const files = filtered.slice(0, criteria.limit).map(file => ({...file, searchVersionCount: versions.get(versionKey(file))}));
  return {
    files,
    totalFiles: matched.length,
    visibleTotal: visible.length,
    scopedCount: scoped.length,
    categoryCount: filtered.length,
    ...summary,
    facets,
  };
}

module.exports = {MAX_SEARCH_ROWS, cycleKey, yearOf, normalizeSearchCriteria, buildSearchWindow};
