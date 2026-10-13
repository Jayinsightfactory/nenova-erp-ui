const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pages/orders/paste.js'), 'utf8');
const load = () => import(pathToFileURL(path.join(root, 'lib/pasteBatchFailure.js')).href);
const message = '품목 콜롬비아알스트로 · ALSTROMERIA Mlla (#90) · 입고/재고조정 반영 후 가용수량이 0 이하인 차수입니다.';
const targets = [
  { action: '취소', custKey: 436, custName: '취소 업체', prodKey: 2429, inputName: '취소 입력명', prodName: '취소 매칭명', qty: 1, unit: '박스' },
  { action: '취소', custKey: 436, custName: '취소 업체', prodKey: 53, inputName: '다른 취소', prodName: '다른 품목', qty: 1, unit: '박스' },
  { action: '추가', custKey: 478, custName: '추가 업체', prodKey: 90, inputName: '콜롬비아알스트로', prodName: 'ALSTROMERIA Mlla', qty: 1, unit: '박스' },
];

test('actual ADD #90 failure identifies the addition, not earlier CANCEL #2429', async () => {
  const { formatPasteBatchFailure } = await load();
  const text = formatPasteBatchFailure({
    message,
    failedEntry: { inputIndex: 2, executionIndex: 2, type: 'ADD', custKey: 478, prodKey: 90, qty: 1 },
    targets, year: '2026', week: '2026-41-02',
  });
  assert.match(text, /^분배 추가 실패: 추가 업체 \(#478\)/);
  assert.match(text, /입력 콜롬비아알스트로 → 매칭 ALSTROMERIA Mlla \(#90\)/);
  assert.match(text, /1박스 · 2026-41-02/);
  assert.match(text, /원인: 품목 콜롬비아알스트로/);
  assert.doesNotMatch(text, /취소 업체|#2429/);
});

test('CANCEL failure retains its action and matched item', async () => {
  const { formatPasteBatchFailure } = await load();
  const text = formatPasteBatchFailure({
    message: '취소량이 현재 출고보다 큽니다.',
    failedEntry: { inputIndex: 0, type: 'CANCEL', custKey: 436, prodKey: 2429, qty: 1, unit: '박스' },
    targets, year: '2026', week: '41-02',
  });
  assert.match(text, /^분배 취소 실패: 취소 업체 \(#436\)/);
  assert.match(text, /취소 입력명 → 매칭 취소 매칭명 \(#2429\)/);
  assert.match(text, /2026-41-02/);
  assert.match(text, /원인: 취소량이 현재 출고보다 큽니다/);
});

test('missing or inconsistent metadata leaves the original server error generic', async () => {
  const { formatPasteBatchFailure } = await load();
  const base = { message, targets, year: '2026', week: '2026-41-02' };
  assert.equal(formatPasteBatchFailure({ ...base }), message);
  assert.equal(formatPasteBatchFailure({ ...base, failedEntry: { executionIndex: 0 } }), message);
  assert.equal(formatPasteBatchFailure({ ...base, failedEntry: {
    inputIndex: 2, type: 'ADD', custKey: 436, prodKey: 2429, qty: 1,
  } }), message, 'a mismatched inputIndex must not supply names or unit from another row');
});

test('only verified inputIndex supplies missing names, never executionIndex', async () => {
  const { formatPasteBatchFailure } = await load();
  const text = formatPasteBatchFailure({
    message, failedEntry: {
      inputIndex: 2, executionIndex: 0, type: 'ADD', custKey: 478, prodKey: 90, qty: 1,
    }, targets, year: '2026', week: '2026-41-02',
  });
  assert.match(text, /추가 업체 \(#478\)/);
  assert.match(text, /ALSTROMERIA Mlla \(#90\)/);
  assert.doesNotMatch(text, /취소 업체|#2429/);
  const unknown = formatPasteBatchFailure({
    message, failedEntry: {
      executionIndex: 2, type: 'ADD', custKey: 478, prodKey: 90, qty: 1,
    }, targets, year: '2026', week: '2026-41-02',
  });
  assert.equal(unknown, message);
});

test('selected batch year is preserved across repeated week names', async () => {
  const { formatPasteBatchFailure } = await load();
  const failedEntry = { inputIndex: 2, type: 'ADD', custKey: 478, prodKey: 90, qty: 1 };
  const prior = formatPasteBatchFailure({ message, failedEntry, targets, year: '2025', week: '2025-41-02' });
  const current = formatPasteBatchFailure({ message, failedEntry, targets, year: '2026', week: '2026-41-02' });
  assert.match(prior, / · 2025-41-02\n/);
  assert.match(current, / · 2026-41-02\n/);
  assert.equal(formatPasteBatchFailure({ message, failedEntry, targets,
    year: '2025', week: '2026-41-02' }), message);
});

test('preflight and save failures append context to pasteWriteError message while preserving metadata', () => {
  assert.match(source, /const preflightError = pasteWriteError\([\s\S]*?preflightError\.message = formatPasteBatchFailure/);
  assert.match(source, /const rollbackError = pasteWriteError\([\s\S]*?rollbackError\.message = formatPasteBatchFailure/);
  assert.match(source, /error\.code = data\?\.code/);
  assert.match(source, /error\.data = data \|\| \{\}/);
  assert.doesNotMatch(source, /failed\.executionIndex|failedEntry\?\.executionIndex/);
});
