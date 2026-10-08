'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { sanitizeText, isSafePath, parseGitLog, buildSnapshot, querySnapshot, validateSourceGraph } = require('../lib/fullDevelopmentHistory.cjs');

const h = n => String(n).padStart(40, '0');
const rec = (n, paths = [], parents = [h(n - 1)], extra = {}) => ({
  hash: h(n), date: `2026-0${Math.ceil(n / 30)}-${String((n - 1) % 28 + 1).padStart(2, '0')}T12:00:00+09:00`,
  committedAt: `2026-0${Math.ceil(n / 30)}-${String((n - 1) % 28 + 1).padStart(2, '0')}T12:00:00+09:00`,
  subject: `change ${n}`, parents, paths, ...extra,
});
const menus = [{ href: '/alpha', label: 'Alpha' }, { href: '/beta', label: 'Beta' }];

test('source별 non-merge/merge/work-summary 분리, hash union과 source provenance', () => {
  const duplicate = rec(2, ['pages/alpha.js']);
  const snapshot = buildSnapshot({
    current: [rec(1, ['README.md'], []), duplicate, rec(3, ['pages/unmapped.js'], [h(1), h(2)])],
    external: { sources: [
      { id: 'mindmap-viewer', label: 'MindMap Viewer', repo: 'mindmap-viewer', ref: 'main', headHash: h(3), collectedAt: '2026-10-08T00:00:00Z', records: [duplicate, rec(4, ['src/viewer.js'])], summaries: [{ id: 'day', date: '2026-02-27', title: '초기 작업', path: 'WORK_MEMORY.md' }] },
    ] }, menus, headHash: h(3), generatedAt: '2026-10-08T00:00:00Z',
  });
  assert.deepEqual(snapshot.sources.map(s => [s.id, s.totalCommits, s.nonMergeCount, s.mergeCount, s.summaryCount]), [
    ['erp', 3, 2, 1, 0], ['mindmap-viewer', 2, 2, 0, 1],
  ]);
  assert.deepEqual(snapshot.counts, { uniqueCommits: 4, nonMerge: 3, merge: 1, summaries: 1, knownSummaryTitles: 1, unknownSummaryTitles: 0 });
  const shared = snapshot.records.find(x => x.hash === h(2));
  assert.deepEqual(shared.sourceIds, ['erp', 'mindmap-viewer']);
  assert.equal(snapshot.records.filter(x => x.hash === h(2)).length, 1);
  assert.equal(snapshot.records.find(x => x.hash === h(3)).menuHrefs.length, 0, 'unmapped commit remains in global history');
  assert.equal(querySnapshot(snapshot, { source: 'mindmap-viewer' }).totalEvents, 3);
  assert.equal(querySnapshot(snapshot, { type: 'summary' }).totalEvents, 1);
});

test('root is a genuine parentless commit and roots are not inferred from oldest observation', () => {
  const snapshot = buildSnapshot({ current: [rec(10, ['pages/alpha.js'], []), rec(11, ['pages/alpha.js'])], menus });
  assert.deepEqual(snapshot.records.find(x => x.hash === h(10)).parents, []);
  assert.equal(snapshot.records.find(x => x.hash === h(11)).parents.length, 1);
  assert.equal(snapshot.records.find(x => x.hash === h(10)).workType, 'initial');
  assert.notEqual(snapshot.records.find(x => x.hash === h(11)).workType, 'initial');
  assert.throws(() => buildSnapshot({ current: [rec(12, ['pages/alpha.js'], ['not-a-hash'])], menus }), /Invalid history record/,
    'malformed parent metadata cannot be normalized into a false root');
});

test('timeline search/filter/date bounds and pagination keep full reachable history', () => {
  const current = Array.from({ length: 121 }, (_, i) => rec(i + 1, [`pages/area${i % 2 ? 'alpha' : 'beta'}.js`], i === 0 ? [] : [h(i)]));
  const snapshot = buildSnapshot({ current, menus });
  assert.equal(snapshot.records.length, 121, 'no first-parent or arbitrary history cap');
  const first = querySnapshot(snapshot, { limit: 100, page: 1 });
  const second = querySnapshot(snapshot, { limit: 100, page: 2 });
  assert.equal(first.totalEvents, 121);
  assert.equal(first.timeline.length + second.timeline.length, 121);
  assert.equal(new Set([...first.timeline, ...second.timeline].map(x => x.id)).size, 121);
  assert.equal(querySnapshot(snapshot, { q: 'pages/areaalpha.js' }).totalEvents, 60);
  assert.equal(querySnapshot(snapshot, { source: 'erp', type: 'merge' }).totalEvents, 0);
  assert.ok(first.timeline[0].date >= first.timeline.at(-1).date);
});

test('date filtering spans calendar years and UI exposes metadata, disclosure, keyboard, and responsive behavior', () => {
  const snapshot = buildSnapshot({ current: [
    { ...rec(1, ['pages/alpha.js'], []), date: '2025-12-31T14:30:00Z', committedAt: '2025-12-31T14:30:00Z' },
    { ...rec(2, ['pages/alpha.js']), date: '2025-12-31T15:30:00Z', committedAt: '2025-12-31T15:30:00Z' },
    { ...rec(3, ['pages/alpha.js']), date: '2026-01-01T00:15:00+09:00', committedAt: '2026-01-01T00:15:00+09:00' },
  ], menus });
  assert.equal(querySnapshot(snapshot, { from: '2025-12-31', to: '2025-12-31' }).totalEvents, 1);
  assert.equal(querySnapshot(snapshot, { from: '2026-01-01', to: '2026-01-01' }).totalEvents, 2, 'UTC late night is included on the next Seoul calendar day');
  assert.equal(querySnapshot(snapshot, { from: '2025-12-30', to: '2026-01-02' }).timeline[0].hash, h(2), 'timeline keeps chronological order across the KST year boundary');

  const ui = fs.readFileSync('components/dev/FullDevelopmentHistory.js', 'utf8');
  const css = fs.readFileSync('components/dev/FullDevelopmentHistory.module.css', 'utf8');
  for (const marker of ['headHash', 'collectedAt', 'sourceStatus', 'counts?.summaries', 'filteredCounts?.summaries', '코드 변경 기록 수에 미포함', '비공개 대화 원문 제외']) assert.ok(ui.includes(marker), `UI disclosure marker missing: ${marker}`);
  for (const label of ['전체 개발 변경 기록', '개별 코드 변경 기록', '코드 통합 기록', '작업 메모', '개발 프로젝트', '기록 종류', '작업 종류', '원본 기록 제목', '확인번호', '현재 원본과 같은지는 확인되지 않았습니다']) assert.ok(ui.includes(label), `Plain-language label missing: ${label}`);
  for (const jargon of ['고유 커밋', '비병합 커밋', '병합 커밋', '원본 저장소', '레코드 종류', '변경 성격', 'main manifest', '빌드 HEAD', '기준 ref']) assert.equal(ui.includes(jargon), false, `Raw jargon should not be visible: ${jargon}`);
  assert.match(ui, /코드 통합 기록은 개발 내용을 합친 기록이며 배포 횟수가 아닙니다/);
  assert.match(ui, /코드 변경 기록은 기능 수, 사용자 요청 수, 작업 횟수가 아닙니다/);
  assert.doesNotMatch(ui, /\{item\.typeEvidence\}|projectIds\.join\(/, 'internal classification codes and project ids must not render raw');
  assert.match(ui, /evidenceLabels\[item\.typeEvidence\]/);
  assert.match(ui, /item\.projectIds\.map\(id => projectLabels\[id\]/);
  assert.match(ui, /AbortController/);
  assert.match(ui, /aria-expanded/);
  assert.match(ui, /onKeyDown/);
  assert.match(ui, /Escape/);
  assert.match(ui, /if \(!value\)/, 'missing dates must not render as epoch dates');
  assert.match(css, /@media/);
  assert.match(css, /min-width:0/);
});

test('menu/event count union is not the sum of menu matches', () => {
  const snapshot = buildSnapshot({ current: [rec(1, ['pages/alpha.js', 'pages/beta.js'])], menus });
  assert.equal(snapshot.records[0].menuHrefs.length, 2);
  assert.equal(snapshot.counts.uniqueCommits, 1);
});

test('safe metadata sanitizes secrets, author/body are never accepted, and paths are allowlisted', () => {
  const secret = 'Bearer abcdefghijklmnop email me@example.com C:\\Users\\Alice\\secret.txt';
  const clean = sanitizeText(secret);
  for (const forbidden of ['abcdefghijklmnop', 'me@example.com', 'C:\\Users\\Alice']) assert.equal(clean.includes(forbidden), false);
  assert.equal(isSafePath('.env'), false);
  assert.equal(isSafePath('data/private-dump.json'), false);
  assert.equal(isSafePath('pages/alpha.js'), true);
  const snapshot = buildSnapshot({ current: [rec(1, ['pages/alpha.js', 'C:\\Users\\Alice\\.env'], [], { author: 'person@example.com', body: secret })], menus });
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ['person@example.com', 'abcdefghijklmnop', 'me@example.com', 'C:\\\\Users']) assert.equal(serialized.includes(forbidden), false);
  assert.equal(snapshot.records[0].paths.includes('pages/alpha.js'), true);
  assert.equal(snapshot.records[0].paths.some(p => p.includes('Users')), false);
  assert.equal('author' in snapshot.records[0], false);
  assert.equal('body' in snapshot.records[0], false);
});

test('privacy fixtures redact environment credentials, quoted values, JWT/API tokens, and Windows data paths', () => {
  const raw = [
    'JWT_SECRET=visible-jwt-secret',
    'DB_PASSWORD=visible-db-password',
    'JWT_SECRET="private words here"',
    "DB_PASSWORD='another private value'",
    'access_token="visible quoted access credential"',
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signatureValue123',
    'AIzaSyD-ThisIsARealisticGoogleApiKeyThatMustDisappear',
    'C:/secret/customer.xlsx',
  ].join(' | ');
  const clean = sanitizeText(raw);
  for (const forbidden of ['visible-jwt-secret', 'visible-db-password', 'private words here', 'another private value', 'private', 'words', 'visible quoted access credential', 'eyJhbGci', 'signatureValue123', 'AIzaSyD-', 'C:/secret/customer.xlsx', 'customer.xlsx']) {
    assert.equal(clean.includes(forbidden), false, `secret survived sanitizer: ${forbidden}`);
  }
  assert.equal(isSafePath('C:/secret/customer.xlsx'), false);
});

test('MindMap source commit may belong to Nenova ERP project without duplicating global object count', () => {
  const mindmapCommit = rec(41, ['nenova-erp-ui/pages/estimate.js'], []);
  const snapshot = buildSnapshot({ current: [], external: { sources: [
    { id: 'mindmap-viewer', label: 'MindMap Viewer', repo: 'mindmap-viewer', ref: 'main', headHash: h(41), collectedAt: '2026-10-08T00:00:00Z', records: [mindmapCommit], summaries: [] },
  ] }, menus: [{ href: '/estimate', route: '/estimate' }] });
  assert.equal(snapshot.counts.uniqueCommits, 1);
  assert.deepEqual(snapshot.records[0].sourceIds, ['mindmap-viewer']);
  assert.deepEqual(snapshot.records[0].projectIds, ['mindmap-orbit', 'nenova-erp']);
  assert.deepEqual(snapshot.records[0].menuHrefs, ['/estimate']);
  assert.equal(querySnapshot(snapshot, { project: 'mindmap-orbit' }).totalEvents, 1);
  assert.equal(querySnapshot(snapshot, { project: 'nenova-erp' }).totalEvents, 1);
});

test('imported App Router menu paths link route pages only, not shared layouts', () => {
  const snapshot = buildSnapshot({ current: [], external: { sources: [{
    id: 'mindmap-viewer', label: 'MindMap Viewer', repo: 'mindmap-viewer', ref: 'main', headHash: h(43), collectedAt: '2026-10-08T00:00:00Z', records: [
      rec(43, ['nenova-erp-ui/src/app/(app)/orders/page.tsx'], []),
      rec(44, ['nenova-erp-ui/src/app/(app)/layout.tsx'], []),
      rec(45, ['nenova-erp-ui/app/(group)/reports/page.js'], []),
    ], summaries: [],
  }] }, menus: [{ href: '/orders', route: '/orders' }, { href: '/reports', route: '/reports' }] });
  assert.deepEqual(snapshot.records.find(x => x.hash === h(43)).menuHrefs, ['/orders']);
  assert.deepEqual(snapshot.records.find(x => x.hash === h(44)).menuHrefs, [], 'shared layout must not be linked to every nested menu');
  assert.deepEqual(snapshot.records.find(x => x.hash === h(45)).menuHrefs, ['/reports']);
  assert.equal(snapshot.counts.uniqueCommits, 3);
});

test('external source graph must be fully reachable from head with intact parent links', () => {
  const source = records => ({ headHash: h(3), reachableCount: records.length, records });
  const valid = source([rec(1, [], []), rec(2, [], [h(1)]), rec(3, [], [h(2)])]);
  assert.equal(validateSourceGraph(valid), true);
  assert.throws(() => validateSourceGraph(source([rec(1, [], []), rec(3, [], [h(2)])])), /parent missing/);
  assert.throws(() => validateSourceGraph(source([rec(1, [], []), rec(2, [], [h(1)]), rec(3, [], [h(2)]), rec(4, [], [])])), /unreachable/);
  assert.throws(() => validateSourceGraph({ headHash: h(3), reachableCount: 2, records: [rec(3, [], [h(2)]), rec(3, [], [h(1)])] }), /count\/head mismatch/);
});

test('dated summaries are separate records and their source/date/head coverage is visible', () => {
  const snapshot = buildSnapshot({ current: [rec(1)], external: { sources: [{ id: 'mindmap-viewer', label: 'MindMap', repo: 'mindmap-viewer', ref: 'main', headHash: h(2), collectedAt: '2026-10-07T00:00:00Z', records: [], summaries: [{ id: 'first', date: '2026-02-27', title: '초기 개발', path: 'WORK_MEMORY.md' }] }] }, headHash: h(1), generatedAt: '2026-10-08T00:00:00Z' });
  assert.equal(snapshot.summaries.length, 1);
  assert.equal(snapshot.counts.uniqueCommits, 1);
  assert.equal(snapshot.counts.summaries, 1);
  assert.equal(snapshot.sources[1].headHash, h(2));
  assert.equal(snapshot.sources[1].collectedAt, '2026-10-07T00:00:00.000Z');
  assert.equal(snapshot.summaries[0].titleKnown, true);
  assert.match(snapshot.coverageNote, /요약/);
});

test('ERP dated summary contains only sanitized title and path class, never source body', () => {
  const snapshot = buildSnapshot({ current: [], currentSummaries: [
    { id: 'session-1', date: '2026-03-14T12:00:00+09:00', title: 'Nenova ERP 작업 세션 · 2026-03-14', path: 'docs/work-sessions', body: 'PRIVATE_SESSION_BODY customer account database secret' },
    { id: 'session-2', date: '2026-03-15T12:00:00+09:00', title: '제목 미확인 · ERP 작업 문서 · 날짜', titleKnown: false, path: 'docs/work-sessions' },
  ] });
  const summary = snapshot.summaries.find(item => item.id.endsWith('session-1'));
  assert.equal(summary.path, 'docs/work-sessions');
  assert.equal(summary.title, 'Nenova ERP 작업 세션 · 2026-03-14');
  assert.equal(summary.titleKnown, true);
  assert.deepEqual(Object.keys(summary).sort(), ['date', 'id', 'kind', 'path', 'projectIds', 'sourceId', 'title', 'titleKnown'].sort());
  const unknownSummary = snapshot.summaries.find(item => item.id.endsWith('session-2'));
  assert.equal(unknownSummary.titleKnown, false);
  assert.match(unknownSummary.title, /제목 미확인/);
  assert.deepEqual(snapshot.counts, { uniqueCommits: 0, nonMerge: 0, merge: 0, summaries: 2, knownSummaryTitles: 1, unknownSummaryTitles: 1 });
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ['PRIVATE_SESSION_BODY', 'customer account', 'database secret']) assert.equal(serialized.includes(forbidden), false);
});

test('tracked snapshot title-known counters match the prepared verified manifest', () => {
  const snapshot = JSON.parse(fs.readFileSync('data/generated/full-development-history.json', 'utf8'));
  assert.equal(snapshot.counts.summaries, snapshot.summaries.length);
  assert.equal(snapshot.counts.knownSummaryTitles, snapshot.summaries.filter(summary => summary.titleKnown).length);
  assert.equal(snapshot.counts.unknownSummaryTitles, snapshot.summaries.filter(summary => !summary.titleKnown).length);
  assert.equal(snapshot.counts.knownSummaryTitles + snapshot.counts.unknownSummaryTitles, snapshot.counts.summaries);
  for (const summary of snapshot.summaries) assert.equal(typeof summary.titleKnown, 'boolean');
});

test('Git parser retains all parents and rejects malformed headers', () => {
  const raw = `\x1e${h(3)}\x1f2026-01-02T00:00:00Z\x1f2026-01-02T00:01:00Z\x1fMerge title\x1f${h(1)} ${h(2)}\x1d\npages/alpha.js\x00`;
  const parsed = parseGitLog(raw);
  assert.equal(parsed[0].parents.length, 2);
  assert.throws(() => parseGitLog('bad'));
});

test('runtime API is authenticated read-only snapshot GET and never runs Git/SQL/shell', () => {
  const apiPath = 'pages/api/dev/full-history.js';
  if (!fs.existsSync(apiPath)) return assert.fail('full-history API not added yet');
  const api = fs.readFileSync(apiPath, 'utf8');
  assert.match(api, /withAuth/);
  assert.match(api, /GET/);
  assert.match(api, /private, no-store/);
  assert.doesNotMatch(api, /child_process|execSync|execFileSync|query\s*\(|INSERT|UPDATE|DELETE FROM|lib\/db/);
  for (const key of ['q', 'source', 'project', 'type', 'workType', 'from', 'to', 'menu', 'page', 'limit']) assert.match(api, new RegExp(`['\"]${key}['\"]`), `API should forward ${key} filter`);
  const page = fs.readFileSync('pages/dev/history.js', 'utf8');
  assert.match(page, /FullDevelopmentHistory/);
  assert.match(page, /useState\('full'\)/);
  assert.match(page, /\['full', '전체 개발 이력'\]/);
  assert.match(page, /\['menu', '메뉴별 기능'\]/);
  for (const legacy of ['commits', 'pending', 'plans', 'memory']) assert.ok(page.includes(legacy));
  assert.doesNotMatch(page, /import Layout|<Layout/);
});

test('exporter uses reachable graph, not first-parent-only history', () => {
  const exporterPath = 'scripts/generate-full-development-history.cjs';
  if (!fs.existsSync(exporterPath)) return assert.fail('full-history generator not added yet');
  const source = fs.readFileSync(exporterPath, 'utf8');
  assert.match(source, /rev-list/);
  assert.match(source, /reachableCount/);
  assert.match(source, /rootHashes/);
  assert.doesNotMatch(source, /--first-parent/);
});
