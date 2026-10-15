import assert from 'node:assert/strict';
import test from 'node:test';
import { currentProductLabel, hydratePasteOrderNames, hydratePasteOrderNamesWithCompletion } from '../lib/pasteCurrentNames.js';
import pasteWorkspace from '../lib/pasteWorkspace.js';

const { buildPasteWorkspaceFingerprint } = pasteWorkspace;
const customers = [
  { CustKey: 538, CustName: '매일 새 이름', isDeleted: 0 },
  { CustKey: 456, CustName: '미우 새 이름', isDeleted: 0 },
  { CustKey: 999, CustName: '옛 이름', isDeleted: 0 },
  { CustKey: 777, CustName: '삭제 업체', isDeleted: 1 },
];
const products = [
  { ProdKey: 90, ProdName: '현재 품목', DisplayName: null, isDeleted: 0 },
  { ProdKey: 1306, ProdName: '동일한 옛 이름', DisplayName: '', isDeleted: 0 },
  { ProdKey: 2429, ProdName: '삭제 품목', DisplayName: '삭제', isDeleted: 1 },
];
const fixture = week => [{
  id: 1, custName: '입력 원문 업체', custMatch: { CustKey: 538, CustName: '옛 이름', CustCode: 'A' },
  distributionCompleted: true, orderOnlyRegistered: false, resultMsg: '과거 처리 결과',
  items: [
    { inputName: '원문 품목', matchName: '원문 매칭명', prodKey: 90, prodName: '옛 품목', displayName: '옛 화면명', qty: 10, cost: 700, unit: '단', action: 'ADD', week },
    { inputName: '원문2', prodKey: 1306, prodName: '옛 이름', displayName: '옛 표시', qty: 2, unit: '박스' },
    { inputName: '원문3', prodKey: 2429, prodName: '삭제 전 이름', displayName: '삭제 전 표시', qty: 3 },
  ],
}];

test('exact active keys update names only, including null/empty display names and cross-year rows', () => {
  for (const week of ['2025-41-02', '2026-41-02']) {
    const before = fixture(week);
    const after = hydratePasteOrderNames(before, customers, products);
    assert.equal(after[0].custMatch.CustName, '매일 새 이름');
    assert.equal(after[0].custName, '입력 원문 업체');
    assert.equal(after[0].custMatch.CustKey, 538);
    assert.equal(after[0].items[0].prodName, '현재 품목');
    assert.equal(after[0].items[0].displayName, null);
    assert.equal(after[0].items[1].displayName, '');
    assert.equal(after[0].items[2].prodName, '삭제 전 이름');
    for (const [index, item] of before[0].items.entries()) {
      for (const field of ['inputName', 'matchName', 'prodKey', 'qty', 'cost', 'unit', 'action', 'week'])
        assert.equal(after[0].items[index][field], item[field], `${week} ${field}`);
    }
    assert.equal(after[0].distributionCompleted, true);
    assert.equal(after[0].resultMsg, '과거 처리 결과');
    assert.equal(hydratePasteOrderNames(after, customers, products), after, 'second hydration is stable');
  }
});

test('same name at another key, missing or invalid keys never rematch', () => {
  const rows = [{ id: 2, custMatch: { CustKey: 777, CustName: '옛 이름' }, items: [
    { prodKey: 2429, prodName: '현재 품목', displayName: '옛 표시' },
    { prodKey: 99999, prodName: '현재 품목' },
    { prodKey: 0, prodName: '현재 품목' },
  ] }];
  assert.equal(hydratePasteOrderNames(rows, customers, products), rows);
});

test('completion fingerprint rebases only an exact existing completion, never creates one', () => {
  const week = '2026-41-02', pasteText = '입력 원문', evidenceMessages = [{ identity: 'message-1' }];
  const orders = fixture(week);
  const beforeFingerprint = buildPasteWorkspaceFingerprint({ week, pasteText, orders, evidenceMessages });
  const args = { orders, customers, products, week, pasteText, evidenceMessages, buildFingerprint: buildPasteWorkspaceFingerprint };
  const complete = hydratePasteOrderNamesWithCompletion({ ...args, completionFingerprint: beforeFingerprint });
  assert.equal(complete.completionRebased, true);
  assert.equal(complete.completionFingerprint,
    buildPasteWorkspaceFingerprint({ week, pasteText, orders: complete.orders, evidenceMessages }));
  assert.equal(complete.orders[0].distributionCompleted, true);
  assert.equal(hydratePasteOrderNamesWithCompletion({ ...args, completionFingerprint: '' }).completionFingerprint, '');
  assert.equal(hydratePasteOrderNamesWithCompletion({ ...args, completionFingerprint: 'other-intent' }).completionFingerprint, 'other-intent');
  assert.equal(hydratePasteOrderNamesWithCompletion({ ...args, completionFingerprint: beforeFingerprint, week: '2025-41-02' }).completionRebased, false);
});

test('late manual key change wins over a catalog snapshot', () => {
  const before = fixture('2026-41-02');
  const changed = [{ ...before[0], custMatch: { CustKey: 456, CustName: '옛 미우 이름' },
    items: [{ ...before[0].items[0], prodKey: 1306 }, ...before[0].items.slice(1)] }];
  const after = hydratePasteOrderNames(changed, customers, products);
  assert.equal(after[0].custMatch.CustKey, 456);
  assert.equal(after[0].custMatch.CustName, '미우 새 이름');
  assert.equal(after[0].items[0].prodKey, 1306);
  assert.equal(after[0].items[0].prodName, '동일한 옛 이름');
});

test('base-stock matched label projects only the current product name by exact key', () => {
  const row = { prodKey: 90, displayName: '저장된 화면명', prodName: '저장된 품목명', matchName: '원래 매칭명', qty: 10 };
  assert.equal(currentProductLabel(row, products), '현재 품목');
  assert.equal(currentProductLabel({ ...row, prodKey: 1306 }, products), '동일한 옛 이름');
  assert.equal(currentProductLabel({ ...row, prodKey: 2429 }, products), '저장된 화면명');
  assert.equal(currentProductLabel({ ...row, prodKey: 99999 }, products), '저장된 화면명');
  assert.equal(currentProductLabel(row, [{ ProdKey: 999, ProdName: '저장된 화면명', isDeleted: 0 }]), '저장된 화면명');
  assert.equal(row.displayName, '저장된 화면명');
  assert.equal(row.matchName, '원래 매칭명');
  assert.equal(row.qty, 10);
});
