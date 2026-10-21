'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildModel, renderMarkdown, loadPrs, loadEvidence, CLASSES, TOTAL_PROGRAMS, TOTAL_PACKETS } = require('../scripts/ecount-progress-report.cjs');

const root = path.join(__dirname, '..');
const report = require('../data/ecount-workbench/button-matches.json');
const packets = require('../data/ecount-workbench/parity-packets.json').packets;
const observedButtons = report.pages.reduce((n, p) => n + (p.buttons || []).length, 0);
const pagesWithButtons = report.pages.filter(p => p.buttons?.length).length;

const ghOk = n => ({ title: `PR ${n} title`, mergedAt: '2026-10-21T00:00:00Z', mergeCommit: { oid: 'abcdef0123456789' }, url: `https://github.com/Jayinsightfactory/nenova-erp-ui/pull/${n}` });
const ghFail = () => { throw new Error('gh unavailable'); };
const decisionRows = [{ item: 'DECISION_SENTINEL_ITEM', reason: 'sentinel reason', needed: 'sentinel needed' }];

// 마크다운 표 블록마다 셀 수가 헤더와 같아야 한다 (표 깨짐 방지).
function assertTablesIntact(md) {
  const lines = md.split('\n');
  let header = null;
  for (const line of lines) {
    if (!line.startsWith('|')) { header = null; continue; }
    const cells = line.split('|').length;
    if (header === null) header = cells; else assert.equal(cells, header, `table row cell count mismatch: ${line}`);
  }
}

test('packet rows cover all 59 packets and sums equal observed buttons', () => {
  const m = buildModel({ date: '2026-10-21', prs: [1164, 1165], ghRunner: ghOk, decisionRows });
  assert.equal(m.rows.length, TOTAL_PACKETS);
  assert.deepEqual(m.rows.map(r => r.id), packets.map(p => p.id));
  assert.equal(m.totals.buttons, observedButtons, 'button total must equal button-matches observed buttons');
  assert.equal(CLASSES.reduce((n, k) => n + m.totals[k], 0), observedButtons, 'class tally must partition observed buttons');
  for (const r of m.rows) {
    assert.equal(CLASSES.reduce((n, k) => n + r[k], 0), r.buttons, `class tally per packet ${r.id}`);
    assert(r.programsWithButtons <= r.programs);
    assert(r.verified <= r.buttons);
    assert.equal(r.programs, packets.find(p => p.id === r.id).screenIds.length);
  }
  assert.equal(m.totals.programs, TOTAL_PROGRAMS);
  assert.equal(m.totals.programsWithButtons, pagesWithButtons);
  assert.equal(m.totals.verified, 0, 'no button has function+window+queryValues all 일치 yet');
});

test('uninventoried screens = 373 - pages with buttons, each with a label', () => {
  const m = buildModel({ date: '2026-10-21', ghRunner: ghFail, decisionRows });
  const count = m.uninventoried.reduce((n, pk) => n + pk.screens.length, 0);
  assert.equal(count, TOTAL_PROGRAMS - pagesWithButtons);
  assert.equal(m.pages - m.pagesWithButtons, count);
  const ids = new Set(m.uninventoried.flatMap(pk => pk.screens.map(s => s.program)));
  assert.equal(ids.size, count, 'no duplicate program across packets');
  for (const pk of m.uninventoried) for (const s of pk.screens) { assert.match(s.program, /^[A-Z]\d{6}$/); assert(s.label && s.label !== '-', `label missing for ${s.program}`); }
  for (const r of m.rows) if (r.programsWithButtons === 0) assert.equal(r.status, '원본 미조사'); else assert.match(r.status, /원본 목록/);
});

test('PR section: gh result rendered as table, gh failure falls back to number only', () => {
  const ok = loadPrs([1164], ghOk);
  assert.equal(ok[0].source, 'gh'); assert.equal(ok[0].mergeCommit, 'abcdef01'); assert.equal(ok[0].title, 'PR 1164 title');
  const bad = loadPrs([1164], ghFail);
  assert.equal(bad[0].source, 'number-only'); assert.equal(bad[0].number, 1164); assert.match(bad[0].url, /pull\/1164$/);
  const md = renderMarkdown(buildModel({ date: '2026-10-21', prs: [1164, 1173], ghRunner: ghFail, decisionRows }));
  assert.match(md, /\| #1164 \| \(gh 조회 실패\) \|/); assert.match(md, /\| #1173 \|/);
});

test('evidence section reads smoke/regression files and drops privacy-flagged ones', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecount-evidence-'));
  fs.writeFileSync(path.join(dir, 'x-smoke.json'), JSON.stringify({ id: 'S1', checks: [{ kind: 'production', what: '/api/ping', result: '200' }], privacy: { rawBusinessValues: false } }));
  fs.writeFileSync(path.join(dir, 'y-regression.json'), JSON.stringify({ id: 'R1', checks: [{ kind: 'api', criteria: 'profile', result: 'PASS' }], privacy: { personalData: true } }));
  fs.writeFileSync(path.join(dir, 'z-other.json'), JSON.stringify({ id: 'O1', checks: [{ kind: 'x', what: 'ignored', result: 'x' }] }));
  const rows = loadEvidence(dir);
  assert.deepEqual(rows.map(r => [r.id, r.kind, r.what, r.result]), [['S1', 'production', '/api/ping', '200'], ['R1', 'excluded', '(privacy 플래그 true — 미게재)', '-']]);
  const real = loadEvidence(path.join(root, 'data/ecount-workbench/evidence'));
  assert(real.length > 0, 'repo evidence smoke/regression rows expected');
  assert(real.some(r => /smoke/.test(r.file)) && real.some(r => /regression/.test(r.file)));
});

test('decisions table renders, markdown has intact tables, no percent completion, no private values', () => {
  const m = buildModel({ date: '2026-10-21', prs: [1164], ghRunner: ghOk, decisionRows });
  const md = renderMarkdown(m);
  assertTablesIntact(md);
  assert.match(md, /## 5\. 결정 대기/); assert.match(md, /\| DECISION_SENTINEL_ITEM \| sentinel reason \| sentinel needed \|/);
  assert.match(md, new RegExp(`완료\\(전체 동등성 승인\\) 0/${TOTAL_PROGRAMS} 프로그램, 0/${TOTAL_PACKETS} 묶음`));
  assert.match(md, /\| 합계 \|/);
  assert(!/\d+(\.\d+)?\s?%/.test(md), 'no percent completion figures');
  assert(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(md), 'no e-mail addresses');
  assert(!/\b\d{3}-\d{2,6}-\d{4,}\b/.test(md), 'no account-number-like strings');
  assert(!/(password|passwd|token=|Bearer )/i.test(md), 'no credentials');
  // 주입된 원본 값(rawData/금액)은 보고서에 나오면 안 된다.
  const poisoned = structuredClone(report);
  const b = poisoned.pages.find(p => p.buttons.length).buttons[0];
  b.rawData = { amount: 'PRIVATE_SENTINEL_AMOUNT', customer: 'PRIVATE_SENTINEL_NAME' };
  b.source.label = 'PRIVATE_SENTINEL_LABEL';
  const pm = renderMarkdown(buildModel({ date: '2026-10-21', data: { report: poisoned }, ghRunner: ghFail, decisionRows }));
  assert(!pm.includes('PRIVATE_SENTINEL'), 'button-level raw data and labels must not reach the packet report');
  // 결정 파일 경로 입력도 동작
  const file = path.join(os.tmpdir(), `decisions-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(decisionRows));
  assert.equal(buildModel({ date: '2026-10-21', ghRunner: ghFail, decisions: file }).decisions[0].item, 'DECISION_SENTINEL_ITEM');
  fs.unlinkSync(file);
});
