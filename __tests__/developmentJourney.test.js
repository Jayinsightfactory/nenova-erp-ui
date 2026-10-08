'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSnapshot, querySnapshot } = require('../lib/fullDevelopmentHistory.cjs');
const { queryJourney } = require('../lib/developmentJourney.cjs');

const hash = n => String(n).padStart(40, '0');
const commit = (n, date, paths = ['pages/alpha.js'], extra = {}) => ({
  hash: hash(n), date, committedAt: date, subject: `feat: event ${n}`,
  parents: n === 1 ? [] : [hash(n - 1)], paths, ...extra,
});

function fixtureSnapshot() {
  const current = [
    // 2025-12-31T15:30Z is 2026-01-01 00:30 KST.
    commit(1, '2025-12-31T15:30:00Z', ['pages/alpha.js']),
    commit(2, '2026-01-01T00:15:00Z', ['pages/beta.js'], { subject: 'refactor: boundary' }),
    commit(3, '2026-01-01T03:00:00Z', ['pages/unknown.js'], { subject: 'a completely unclassified note' }),
    commit(4, '2026-02-01T00:00:00Z', ['lib/shared.js'], { parents: [hash(2), hash(3)], subject: 'Merge branch release' }),
  ];
  const sameRecord = commit(3, '2026-01-01T03:00:00Z', ['pages/unknown.js']);
  return buildSnapshot({
    current,
    currentSummaries: [{ id: 'erp-note', date: '2026-01-01T12:00:00+09:00', title: 'ERP 작업 요약', path: 'docs/work-sessions' }],
    external: { sources: [{
      id: 'mindmap-viewer', label: 'MindMap Viewer', repo: 'mindmap-viewer', ref: 'main', headHash: hash(3), collectedAt: '2026-10-08T00:00:00Z',
      records: [sameRecord, commit(5, '2026-03-02T00:00:00Z', ['src/viewer.js'], { parents: [] })],
      summaries: [{ id: 'map-note', date: '2026-03-02T10:00:00+09:00', title: 'MindMap 기록', path: 'WORK_MEMORY.md' }],
    }] },
    menus: [{ href: '/alpha', route: '/alpha' }, { href: '/beta', route: '/beta' }],
    generatedAt: '2026-10-08T00:00:00Z',
  });
}

test('journey reconciles all events and nested month/day totals', () => {
  const snapshot = fixtureSnapshot();
  const result = queryJourney(snapshot);
  assert.equal(result.success, true);
  assert.equal(result.totalEvents, snapshot.records.length + snapshot.summaries.length);
  assert.deepEqual(result.counts, snapshot.counts);
  assert.equal(result.months.reduce((sum, month) => sum + month.totalEvents, 0), result.totalEvents);
  for (const month of result.months) {
    assert.equal(month.days.reduce((sum, day) => sum + day.totalEvents, 0), month.totalEvents);
    for (const day of month.days) {
      assert.equal(day.summaries + day.commits, day.totalEvents);
      assert.equal(day.nonMerge + day.merge, day.commits);
    }
  }
  const dates = result.months.flatMap(month => month.days.map(day => day.date));
  assert.deepEqual(dates, [...dates].sort());
});

test('more than 100 events on one day are retained without page loss', () => {
  const current = Array.from({ length: 105 }, (_, i) => commit(i + 20, `2026-04-15T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`));
  const snapshot = buildSnapshot({ current, generatedAt: '2026-10-08T00:00:00Z' });
  const result = queryJourney(snapshot, { from: '2026-04-15', to: '2026-04-15' });
  assert.equal(result.totalEvents, 105);
  assert.equal(result.months[0].days.find(day => day.date === '2026-04-15').totalEvents, 105);
  assert.equal(result.months[0].days[0].commits, 105);
});

test('KST day grouping includes UTC boundary and cross-year filters', () => {
  const result = queryJourney(fixtureSnapshot(), { from: '2025-12-31', to: '2026-01-01' });
  const dates = result.months.flatMap(month => month.days.map(day => day.date));
  assert.deepEqual(dates, ['2026-01-01']);
  assert.equal(result.totalEvents, 4, 'two UTC-boundary commits, one unclassified commit, and one ERP summary');
  assert.ok(result.months.every(month => month.month === month.days[0].date.slice(0, 7)));
});

test('filters preserve unclassified records and multi-source provenance', () => {
  const snapshot = fixtureSnapshot();
  const unclassified = queryJourney(snapshot, { workType: 'other' });
  assert.ok(unclassified.totalEvents >= 1);
  assert.ok(unclassified.filteredCounts.commits >= 1);
  assert.ok(unclassified.filteredCounts.nonMerge >= 1);
  const source = queryJourney(snapshot, { source: 'mindmap-viewer' });
  assert.equal(source.totalEvents, 3, 'shared commit, external commit, and external summary remain visible');
  const project = queryJourney(snapshot, { project: 'nenova-erp' });
  assert.ok(project.totalEvents >= 4);
});

test('daily detail uses the exact same filters and unions every 50-record page', () => {
  const snapshot = buildSnapshot({
    current: Array.from({ length: 105 }, (_, i) => commit(i + 20, `2026-04-15T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`)),
    menus: [{ href: '/alpha', route: '/alpha' }],
  });
  const filters = { from: '2026-04-15', to: '2026-04-15', menu: '/alpha', q: 'event' };
  const journey = queryJourney(snapshot, filters);
  const expected = querySnapshot(snapshot, { ...filters, order: 'oldest', limit: 50 });
  assert.equal(journey.totalEvents, expected.totalEvents);
  const pages = [];
  for (let page = 1; page <= expected.totalPages; page += 1) pages.push(querySnapshot(snapshot, { ...filters, order: 'oldest', page, limit: 50 }));
  const ids = pages.flatMap(page => page.timeline.map(item => item.id));
  assert.equal(ids.length, expected.totalEvents);
  assert.equal(new Set(ids).size, expected.totalEvents);
  assert.deepEqual(ids, expected.timeline.concat(querySnapshot(snapshot, { ...filters, order: 'oldest', page: 2, limit: 50 }).timeline, querySnapshot(snapshot, { ...filters, order: 'oldest', page: 3, limit: 50 }).timeline).slice(0, expected.totalEvents).map(item => item.id));
});

test('journey filter totals stay parity with the full-history selector', () => {
  const snapshot = fixtureSnapshot();
  for (const filters of [
    {}, { q: 'boundary' }, { source: 'mindmap-viewer' }, { project: 'nenova-erp' },
    { type: 'merge' }, { workType: 'other' }, { menu: '/alpha' },
    { from: '2026-01-01', to: '2026-01-01' },
  ]) {
    assert.equal(queryJourney(snapshot, filters).totalEvents, querySnapshot(snapshot, filters).totalEvents, JSON.stringify(filters));
  }
});

test('tracked snapshot has complete month/day parity with the original selector', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/generated/full-development-history.json'), 'utf8'));
  const journey = queryJourney(snapshot);
  const expectedTotal = snapshot.records.length + snapshot.summaries.length;
  assert.equal(journey.totalEvents, expectedTotal);
  assert.equal(journey.months.reduce((sum, month) => sum + month.totalEvents, 0), expectedTotal);
  assert.equal(journey.months.flatMap(month => month.days).reduce((sum, day) => sum + day.totalEvents, 0), expectedTotal);
  for (const month of journey.months) {
    assert.equal(month.days.reduce((sum, day) => sum + day.totalEvents, 0), month.totalEvents);
    for (const day of month.days) {
      const selected = querySnapshot(snapshot, { from: day.date, to: day.date });
      assert.equal(selected.totalEvents, day.totalEvents, `day mismatch: ${day.date}`);
    }
  }
  assert.equal(journey.counts.uniqueCommits, snapshot.records.length);
  assert.equal(journey.counts.summaries, snapshot.summaries.length);
});

test('search and repeated queries are deterministic, with no sensitive fields', () => {
  const snapshot = fixtureSnapshot();
  const first = queryJourney(snapshot, { q: 'boundary', order: 'oldest' });
  const second = queryJourney(snapshot, { q: 'boundary', order: 'oldest' });
  assert.deepEqual(first, second);
  assert.ok(first.totalEvents >= 1);
  const serialized = JSON.stringify(first);
  for (const forbidden of ['person@example.com', 'DB_PASSWORD=secret', 'C:\\\\Users\\\\Alice']) assert.equal(serialized.includes(forbidden), false);
});

test('authenticated read-only API whitelists journey filters and disables caching', () => {
  const api = fs.readFileSync(path.join(__dirname, '../pages/api/dev/development-journey.js'), 'utf8');
  assert.match(api, /withAuth/);
  assert.match(api, /GET/);
  assert.match(api, /private, no-store/);
  for (const key of ['q', 'source', 'project', 'type', 'workType', 'from', 'to', 'menu']) assert.match(api, new RegExp(`['"]${key}['"]`));
  assert.doesNotMatch(api, /child_process|execSync|execFileSync|INSERT|UPDATE|DELETE FROM|sql\.query/);
});

test('journey UI exposes native accessibility, mascot, and overflow markers', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../components/dev/DevelopmentJourney.js'), 'utf8');
  const cssPath = path.join(__dirname, '../components/dev/DevelopmentJourney.module.css');
  assert.ok(fs.existsSync(cssPath), 'journey CSS module is required for responsive overflow handling');
  const css = fs.readFileSync(cssPath, 'utf8');
  for (const marker of ['aria-label', 'aria-expanded', '<button', 'onKeyDown', 'Escape', 'mascot']) assert.ok(ui.includes(marker), `missing native UI marker: ${marker}`);
  for (const marker of ['PAGE_SIZE = 50', '/api/dev/full-history', 'AbortController', 'detailCache', 'from', 'to']) assert.ok(ui.includes(marker), `missing detail marker: ${marker}`);
  assert.doesNotMatch(ui, /full-development-history\.json/);
  assert.match(css, /overflow-x|overflow-wrap|word-break/);
  assert.match(ui, /month\.days|day\.summaries/);
  for (const handler of ['chooseMonth', 'chooseDay', 'resetFilters']) {
    const body = ui.match(new RegExp(`function ${handler}\\([^}]+\\}`))?.[0] || '';
    assert.ok(body, `${handler} handler should remain explicit`);
    assert.doesNotMatch(body, /setDetail\(null\)/, `${handler} must preserve cached detail while the effect reloads it`);
  }
});

test('history page defaults safely and exposes the journey URL view', () => {
  const page = fs.readFileSync(path.join(__dirname, '../pages/dev/history.js'), 'utf8');
  assert.match(page, /useState\('full'\)/);
  assert.match(page, /DevelopmentJourney/);
  assert.match(page, /view=journey|query\.view/);
  assert.match(page, /\['journey', '개발 여정'\]/);
  assert.match(page, /\['journey', 'menu', 'legacy'\]\.includes/);
  assert.match(page, /view === 'journey'/);
});
