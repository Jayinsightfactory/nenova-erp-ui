'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSnapshot } = require('../lib/fullDevelopmentHistory.cjs');
const { buildPurposeIndex, queryPurposeStories, recordKey } = require('../lib/developmentPurposeStories.cjs');
const hash = n => String(n).padStart(40, '0');
const story = (id, rules = {}, changes = [{ title: '수량 확인', description: '확인 후 작업합니다.', evidenceRefs: ['docs/contracts/full-development-history.json'] }]) => ({ id, title: '업무를 쉽게 처리하기', purpose: '수량과 입력 결과를 직접 확인하기 위해 만들었습니다.', userValue: '확인 후 안전하게 작업할 수 있습니다.', scopeNote: '근거에서 확인한 범위만 설명합니다.', confidence: 'supported', purposeEvidence: [{ kind: 'document', ref: 'docs/contracts/full-development-history.json', summary: '읽기 전용 기능 계약을 확인했습니다.' }], changes, rules });
const catalog = stories => ({ schemaVersion: 1, catalogVersion: '2026-10-08.1', stories });
const record = (n, subject = '물량표 작업', paths = ['pages/volume.js']) => ({ hash: hash(n), date: '2025-12-31T15:30:00Z', committedAt: '2025-12-31T15:30:00Z', subject, parents: n === 1 ? [] : [hash(n - 1)], paths });
const snap = current => buildSnapshot({ current, generatedAt: '2026-10-08T00:00:00Z' });

test('review explanations are validated and appear only on pending evidence', () => {
  const snapshot = snap([record(1), record(2)]);
  const authored = catalog([story('known', {}, [{ title: '확인된 작업', description: '실제 변경을 확인했다.', evidenceHashes: [hash(1)] }])]);
  authored.reviewNotes = snapshot.records.map(item => ({ canonicalId: recordKey(item), reason: '변경 내용을 더 확인해야 합니다.' }));
  const index = buildPurposeIndex(snapshot, authored);
  assert.equal(index.assignments[recordKey(snapshot.records[0])].reviewReason, undefined);
  assert.equal(index.assignments[recordKey(snapshot.records[1])].reviewReason, authored.reviewNotes[1].reason);
  assert.throws(() => buildPurposeIndex(snapshot, { ...authored, reviewNotes: [...authored.reviewNotes, authored.reviewNotes[0]] }), /Invalid development review note/);
  assert.throws(() => buildPurposeIndex(snapshot, { ...authored, reviewNotes: [{ canonicalId: 'unknown', reason: '근거 없음' }] }), /Invalid development review note/);
  assert.throws(() => buildPurposeIndex(snapshot, { ...authored, reviewNotes: [{ canonicalId: recordKey(snapshot.records[1]), reason: [] }] }), /Invalid development review note/);
  const withNote = buildSnapshot({ current: [record(1)], currentSummaries: [{ id: 'shifting-index', date: '2026-10-08T00:00:00Z', title: '작업 메모', path: 'docs/work-sessions' }] });
  assert.throws(() => buildPurposeIndex(withNote, { ...authored, reviewNotes: [{ canonicalId: recordKey(withNote.summaries[0]), reason: '확인 필요' }] }), /Invalid development review note/);
  const safe = buildPurposeIndex(snapshot, { ...authored, reviewNotes: [{ canonicalId: recordKey(snapshot.records[1]), reason: 'private.person@example.com API_KEY=abcdefghijklmnop 확인 필요' }] });
  const pending = queryPurposeStories(safe, { mode: 'records', storyId: 'review-pending' });
  assert.equal(JSON.stringify(pending).includes('private.person@example.com'), false);
  assert.equal(JSON.stringify(pending).includes('abcdefghijklmnop'), false);
  assert.equal(JSON.stringify(queryPurposeStories(safe, { mode: 'overview' })).includes('확인 필요'), false);
});

test('reviewed summaries require unique exact source/date/title and survive unstable list ids', () => {
  const make = (id, titleKnown = true) => buildSnapshot({ current: [], currentSummaries: [{ id, date: '2026-10-08T12:00:00+09:00', title: '원문 검토한 메모', titleKnown, path: 'docs/work-sessions' }] });
  const evidence = { sourceId: 'erp', date: '2026-10-08T03:00:00.000Z', title: '원문 검토한 메모' };
  const authored = catalog([story('reviewed-note', {}, [{ title: '메모에 남은 개선', description: '원문에서 확인한 변경을 요약한다.', evidenceSummaries: [evidence] }])]);
  for (const id of ['old-index', 'shifted-index']) {
    const index = buildPurposeIndex(make(id), authored);
    assert.equal(index.coverage.assignedRecords, 1);
    assert.equal(index.stories[0].changes[0].firstDate, '2026-10-08');
    assert.deepEqual(index.stories[0].changes[0].evidenceKinds, ['summary']);
    const safe = JSON.stringify(queryPurposeStories(index, { mode: 'overview' }));
    assert.equal(safe.includes('evidenceSummaries'), false);
    assert.equal(safe.includes('summaryEvidence'), false);
  }
  assert.throws(() => buildPurposeIndex(make('x', false), authored), /Summary evidence missing/);
  const duplicate = make('one'); duplicate.summaries.push({ ...duplicate.summaries[0], id: 'two' });
  assert.throws(() => buildPurposeIndex(duplicate, authored), /Summary evidence missing or ambiguous/);
  const other = { ...story('conflicting-note'), summaryEvidence: [evidence] };
  assert.throws(() => buildPurposeIndex(make('one'), catalog([...authored.stories, other])), /summary evidence conflict/);
  const wrong = structuredClone(authored); wrong.stories[0].changes[0].evidenceSummaries[0].title = '다른 메모';
  assert.throws(() => buildPurposeIndex(make('one'), wrong), /Summary evidence missing/);
});

test('stories on the same day begin with the actual earliest work, not alphabetic ids', () => {
  const initial = { ...record(1), committedAt: '2026-02-27T00:54:31Z' };
  const later = { ...record(2), committedAt: '2026-02-27T05:10:00Z' };
  const authored = catalog([
    story('a-later', {}, [{ title: '후속 개선', description: '나중에 개선했다.', evidenceHashes: [hash(2)] }]),
    story('z-origin', {}, [{ title: '최초 개발', description: '처음 만들었다.', evidenceHashes: [hash(1)] }]),
  ]);
  assert.deepEqual(buildPurposeIndex(snap([later, initial]), authored).stories.map(item => item.id), ['z-origin', 'a-later']);
});

test('mixed timezone commit and summary evidence follows the real instant', () => {
  const snapshot = buildSnapshot({ current: [{ ...record(1), committedAt: '2026-10-08T12:00:00+09:00' }], currentSummaries: [{ id: 'note', date: '2026-10-08T02:30:00Z', title: '검토한 작업 메모', titleKnown: true, path: 'docs/work-sessions' }] });
  const note = { sourceId: 'erp', date: snapshot.summaries[0].date, title: snapshot.summaries[0].title };
  const authored = catalog([
    story('a-commit', {}, [{ title: '나중 기록', description: '이후 작업이다.', evidenceHashes: [hash(1)] }]),
    story('z-note', {}, [{ title: '먼저 기록', description: '앞선 작업이다.', evidenceSummaries: [note] }]),
  ]);
  assert.deepEqual(buildPurposeIndex(snapshot, authored).stories.map(item => item.id), ['z-note', 'a-commit']);
});

test('authored problem and outcome remain safe searchable narrative, not inferred from titles', () => {
  const change = { title: '검색 대기 줄이기', description: '검색 작업을 화면 표시와 나누었다.', problem: '품목을 찾는 동안 입력이 멈췄다.', result: '품목을 찾으면서 입력을 이어갈 수 있다.', evidenceHashes: [hash(1)] };
  const index = buildPurposeIndex(snap([record(1)]), catalog([story('responsive-search', {}, [change])]));
  const result = queryPurposeStories(index, { mode: 'overview' });
  assert.equal(result.stories[0].changes[0].problem, change.problem);
  assert.equal(result.stories[0].changes[0].result, change.result);
  const legacy = buildPurposeIndex(snap([record(1)]), catalog([story('legacy', { subjectTerms: ['물량표'] })]));
  assert.equal(Object.hasOwn(legacy.stories[0].changes[0], 'problem'), false);
  assert.throws(() => buildPurposeIndex(snap([record(1)]), catalog([story('invalid', {}, [{ ...change, problem: {} }])])), /Invalid story/);
  assert.throws(() => buildPurposeIndex(snap([record(1)]), catalog([story('invalid-result', {}, [{ ...change, result: [] }])])), /Invalid story/);
  const privateChange = { ...change, problem: '연결 문의 private.person@example.com', result: 'API_KEY=abcdefghijklmnop 연결값은 공개하지 않는다.' };
  const safeIndex = buildPurposeIndex(snap([record(1)]), catalog([story('private-fields', {}, [privateChange])]));
  const publicText = JSON.stringify(queryPurposeStories(safeIndex, { mode: 'overview' }));
  assert.equal(publicText.includes('private.person@example.com'), false);
  assert.equal(publicText.includes('abcdefghijklmnop'), false);
  const ui = fs.readFileSync(path.join(__dirname, '../components/dev/DevelopmentPurposeStories.js'), 'utf8');
  assert.match(ui, /change\.problem \|\| ''/);
  assert.match(ui, /change\.result \|\| ''/);
  assert.match(ui, /해결하려던 문제/);
  assert.match(ui, /만든 것·바꾼 것/);
});

test('all story and review pages reconcile the entire tracked snapshot without duplication', () => {
  const snapshot = require('../data/generated/full-development-history.json');
  const authored = require('../config/development-purpose-stories.json');
  const index = buildPurposeIndex(snapshot, authored);
  const total = snapshot.records.length + snapshot.summaries.length;
  assert.equal(index.coverage.totalRecords, total);
  assert.equal(index.coverage.assignedRecords + index.coverage.reviewPending, total);
  assert.equal(index.coverage.ambiguous + index.coverage.unmatched, index.coverage.reviewPending);
  const found = [];
  const publicRows = [];
  for (const id of [...authored.stories.map(item => item.id), 'review-pending']) {
    const first = queryPurposeStories(index, { mode: 'records', storyId: id });
    assert.equal(first.success, true);
    for (let page = 1; page <= first.totalPages; page += 1) {
      const result = queryPurposeStories(index, { mode: 'records', storyId: id, page });
      assert.ok(result.timeline.length <= 50);
      publicRows.push(...result.timeline);
      found.push(...result.timeline.map(item => item.canonicalId));
    }
  }
  assert.equal(found.length, total);
  assert.equal(new Set(found).size, total);
  assert.deepEqual([...found].sort(), [...snapshot.records, ...snapshot.summaries].map(recordKey).sort());
  const rawByCanonical = new Map([...snapshot.records, ...snapshot.summaries].map(item => [recordKey(item), item]));
  for (const row of publicRows) {
    const raw = rawByCanonical.get(row.canonicalId);
    assert.ok(raw, row.canonicalId);
    assert.equal(row.id, raw.id, 'public id remains the snapshot id while canonicalId is the audit key');
    assert.notEqual(row.canonicalId, row.id, 'canonicalId is distinct from the raw snapshot id');
  }
});

test('specific purpose evidence overrides generic rules and preserves cross-year KST dates', () => {
  const snapshot = snap([record(1), record(2, '다른 작업', ['pages/other.js'])]);
  const index = buildPurposeIndex(snapshot, catalog([story('volume', { subjectTerms: ['물량표'] }, [{ title: '수량 확인 버튼', description: '입력 전에 확인합니다.', evidenceHashes: [hash(2)], evidenceRefs: [] }])]));
  assert.equal(index.stories[0].recordCount, 2);
  assert.equal(index.stories[0].firstDate, '2026-01-01');
  assert.equal(index.stories[0].lastDate, '2026-01-01');
  assert.equal(index.stories[0].changes[0].firstDate, '2026-01-01');
});

test('equal purpose rules remain ambiguous, unrelated records remain unmatched', () => {
  const index = buildPurposeIndex(snap([record(1), record(2, '전혀 다른 업무')]), catalog([story('one', { subjectTerms: ['물량표'] }), story('two', { subjectTerms: ['물량표'] })]));
  assert.equal(index.coverage.ambiguous, 1);
  assert.equal(index.coverage.unmatched, 1);
  assert.equal(index.coverage.assignedRecords, 0);
});

test('more than 100 evidence records remain reachable with clamped pagination', () => {
  const index = buildPurposeIndex(snap(Array.from({ length: 121 }, (_, i) => record(i + 1))), catalog([story('volume', { subjectTerms: ['물량표'] })]));
  const result = queryPurposeStories(index, { mode: 'records', storyId: 'volume', page: 9999, limit: 9999 });
  assert.equal(result.totalPages, 3);
  assert.equal(result.page, 3);
  assert.equal(result.limit, 50);
  assert.equal(result.timeline.length, 21);
  const all = [];
  for (let page = 1; page <= result.totalPages; page += 1) all.push(...queryPurposeStories(index, { mode: 'records', storyId: 'volume', page }).timeline.map(item => item.canonicalId));
  assert.equal(all.length, 121);
  assert.equal(new Set(all).size, 121);
  assert.equal(queryPurposeStories(index, { mode: 'records', storyId: 'missing' }).success, false);
  assert.equal(queryPurposeStories(index, { mode: 'invalid' }).success, false);
});

test('review-pending pagination also exposes every unmatched record exactly once', () => {
  const records = Array.from({ length: 101 }, (_, i) => record(i + 1, '무관한 기록', ['pages/unrelated.js']));
  const index = buildPurposeIndex(snap(records), catalog([story('volume', { subjectTerms: ['물량표'] })]));
  const first = queryPurposeStories(index, { mode: 'records', storyId: 'review-pending' });
  assert.equal(first.totalPages, 3);
  const all = [];
  for (let page = 1; page <= first.totalPages; page += 1) all.push(...queryPurposeStories(index, { mode: 'records', storyId: 'review-pending', page }).timeline.map(item => item.canonicalId));
  assert.equal(all.length, 101);
  assert.equal(new Set(all).size, 101);
  assert.equal(index.coverage.unmatched, 101);
});

test('public projection omits internal paths, matching rules and private bodies', () => {
  const snapshot = snap([record(1)]);
  const index = buildPurposeIndex(snapshot, catalog([story('volume', { subjectTerms: ['물량표'] }, [{ title: '수량 확인', description: '확인 후 작업합니다.', evidenceHashes: [hash(1)], evidenceRefs: ['docs/contracts/full-development-history.json'] }])]));
  const output = JSON.stringify([queryPurposeStories(index), queryPurposeStories(index, { mode: 'records', storyId: 'volume' })]);
  for (const key of ['evidenceRefs', 'pathPrefixes', 'subjectTerms', 'paths', 'author', 'body', 'diff']) assert.ok(!output.includes(`"${key}"`), key);
});

test('public overview and record projections expose only the documented safe fields', () => {
  const snapshot = buildSnapshot({
    current: [record(1, '안전한 제목', ['pages/volume.js'])],
    currentSummaries: [{ id: 'private-note', date: '2026-01-01T00:00:00Z', title: '안전한 요약', path: 'docs/work-sessions' }],
    generatedAt: '2026-01-01T00:00:00Z',
  });
  const index = buildPurposeIndex(snapshot, catalog([story('volume', { pathPrefixes: ['pages/volume.js'] })]));
  const overview = queryPurposeStories(index);
  const records = queryPurposeStories(index, { mode: 'records', storyId: 'volume' });
  const forbidden = new Set(['evidenceRefs', 'pathPrefixes', 'subjectTerms', 'excludeTerms', 'paths', 'path', 'author', 'body', 'diff', 'parents']);
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbidden.has(key), false, `private field leaked: ${key}`);
      walk(child);
    }
  };
  walk(overview);
  walk(records);
  assert.deepEqual(Object.keys(records.timeline[0]).sort(), ['assignment', 'canonicalId', 'date', 'id', 'isMerge', 'kind', 'shortHash', 'sourceIds', 'subject', 'typeEvidence', 'workType'].sort());
  assert.deepEqual(Object.keys(overview.stories[0].purposeEvidence[0]).sort(), ['kind', 'summary']);
  assert.equal(records.timeline.some(row => row.id === 'private-note'), false);
});

test('generic catch-all rules cannot masquerade as purpose evidence', () => {
  for (const rules of [
    { subjectTerms: ['fix'] },
    { subjectTerms: ['test'] },
    { pathPrefixes: ['pages/'] },
    { pathPrefixes: ['pages'] },
    { pathPrefixes: ['components'] },
    { pathPrefixes: ['docs'] },
    { pathPrefixes: ['lib/'] },
    { pathPrefixes: ['components/'] },
  ]) {
    assert.throws(() => buildPurposeIndex(snap([record(1)]), catalog([story('unsafe', rules)])), /generic|broad/);
  }
  assert.throws(() => buildPurposeIndex(snap([record(1)]), catalog([story('unsafe', { sourceIds: ['erp'] })])), /source-only/);
});

test('path and subject rules require both dimensions, exclusion wins and exact evidence conflicts fail', () => {
  const rules = { pathPrefixes: ['pages/volume.js'], subjectTerms: ['물량표'], excludeTerms: ['제외'] };
  const index = buildPurposeIndex(snap([record(1), record(2, '다른 업무'), record(3, '물량표', ['pages/other.js']), record(4, '물량표 제외')]), catalog([story('volume', rules)]));
  assert.equal(index.coverage.assignedRecords, 1);
  const evidence = [{ title: '확인 버튼', description: '확인합니다.', evidenceHashes: [hash(1)] }];
  assert.throws(() => buildPurposeIndex(snap([record(1)]), catalog([story('one', {}, evidence), story('two', {}, evidence)])), /conflict/);
});

test('source ids are scope gates while exact evidence remains authoritative across sources', () => {
  const snapshot = buildSnapshot({
    current: [record(1, '물량표 작업', ['pages/volume.js'])],
    external: { sources: [{ id: 'mindmap-viewer', label: 'MindMap', repo: 'mindmap-viewer', records: [record(2, '물량표 작업', ['pages/volume.js'])] }] },
    generatedAt: '2026-01-01T00:00:00Z',
  });
  const index = buildPurposeIndex(snapshot, catalog([
    story('erp-only', { sourceIds: ['erp'], pathPrefixes: ['pages/volume.js'] }),
    story('exact-cross-source', { sourceIds: ['erp'], pathPrefixes: ['pages/other.js'] }, [{ title: '정확한 근거', description: '정확한 기록을 연결합니다.', evidenceHashes: [hash(2)], evidenceRefs: [] }]),
  ]));
  assert.equal(index.assignments[recordKey(snapshot.records.find(item => item.hash === hash(1)))].primaryStoryId, 'erp-only');
  assert.equal(index.assignments[recordKey(snapshot.records.find(item => item.hash === hash(2)))].primaryStoryId, 'exact-cross-source');
  assert.equal(index.coverage.unmatched, 0);
});

test('priority selects a valid candidate, but equal specificity and priority stays ambiguous', () => {
  const priorityIndex = buildPurposeIndex(snap([record(1)]), catalog([
    story('high-priority', { pathPrefixes: ['pages/volume.js'], priority: 20 }),
    story('low-priority', { pathPrefixes: ['pages/volume.js'], priority: 10 }),
  ]));
  assert.equal(priorityIndex.assignments[recordKey(priorityIndex.snapshot.records[0])].primaryStoryId, 'high-priority');

  const tieIndex = buildPurposeIndex(snap([record(1)]), catalog([
    story('tie-a', { pathPrefixes: ['pages/volume.js'], priority: 20 }),
    story('tie-b', { pathPrefixes: ['pages/volume.js'], priority: 20 }),
  ]));
  assert.equal(tieIndex.coverage.ambiguous, 1);
  assert.equal(tieIndex.assignments[recordKey(tieIndex.snapshot.records[0])].primaryStoryId, 'review-pending');
  assert.deepEqual(tieIndex.reviewQueue[0].candidateStoryIds.sort(), ['tie-a', 'tie-b']);
});

test('input order does not change story assignment or evidence chronology', () => {
  const snapshot = snap([record(1), record(2), record(3, '다른 업무')]);
  const authored = catalog([story('volume', { subjectTerms: ['물량표'] })]);
  const normal = buildPurposeIndex(snapshot, authored);
  const reversed = buildPurposeIndex({ ...snapshot, records: [...snapshot.records].reverse() }, authored);
  assert.deepEqual(normal.assignments, reversed.assignments);
  assert.deepEqual(queryPurposeStories(normal), queryPurposeStories(reversed));
});

test('catalog evidence references exist and every narrative describes purpose and actual change', () => {
  const authored = require('../config/development-purpose-stories.json');
  const snapshot = require('../data/generated/full-development-history.json');
  const hashes = new Set(snapshot.records.map(item => item.hash));
  assert.ok(authored.stories.length >= 20);
  for (const item of authored.stories) {
    for (const key of ['title', 'purpose', 'userValue', 'scopeNote']) assert.match(item[key], /[가-힣]/, `${item.id}:${key}`);
    assert.ok(item.changes.length > 0, item.id);
    const refs = [...item.purposeEvidence.filter(evidence => evidence.kind === 'document').map(evidence => evidence.ref), ...item.changes.flatMap(change => change.evidenceRefs || [])];
    for (const ref of refs) {
      assert.ok(!path.isAbsolute(ref) && !ref.includes('..'), ref);
      assert.ok(fs.existsSync(path.join(__dirname, '..', ref)), ref);
    }
    for (const evidence of [...item.changes.flatMap(change => change.evidenceHashes || []), ...item.purposeEvidence.filter(value => value.kind === 'commit').map(value => value.ref)]) assert.ok(hashes.has(evidence), `${item.id}:${evidence}`);
  }
});

test('purpose UI is the default, raw history stays alternate and API remains authenticated GET-only', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const wrapper = read('components/dev/DevelopmentJourney.js');
  const ui = read('components/dev/DevelopmentPurposeStories.js');
  const api = read('pages/api/dev/development-stories.js');
  assert.match(wrapper, /useState\('stories'\)/);
  assert.match(wrapper, /원본 날짜별 기록/);
  for (const text of ['왜 만들었나', '만들고 다듬은 흐름', 'review-pending', 'AbortController', 'aria-expanded', 'Escape']) assert.ok(ui.includes(text), text);
  assert.match(api, /withAuth/);
  assert.match(api, /private, no-store/);
  assert.match(api, /req.method !== 'GET'/);
  assert.doesNotMatch(api, /mssql|child_process|execSync|INSERT INTO|UPDATE \[/i);
  assert.doesNotMatch(ui, /dangerouslySetInnerHTML/);
});
