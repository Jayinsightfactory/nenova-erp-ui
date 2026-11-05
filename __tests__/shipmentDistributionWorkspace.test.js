const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../lib/shipmentDistributionWorkspace.js')).href);

test('product ordering is ProdName A-Z regardless of stock, usage, or favorites', async () => {
  const { sortDistributionProducts } = await load();
  const rows = [
    { ProdKey: 90, ProdName: 'Zinnia', inQty: 100, favorite: true },
    { ProdKey: 2429, ProdName: 'Alstroemeria', inQty: 0 },
    { ProdKey: 53, ProdName: 'Carnation', inQty: 200 },
  ];
  assert.deepEqual(sortDistributionProducts(rows).map(row => row.ProdKey), [2429, 53, 90]);
  assert.deepEqual(sortDistributionProducts(rows, 'Alstro').map(row => row.ProdKey), [2429]);
  assert.deepEqual(rows.map(row => row.ProdKey), [90, 2429, 53], 'sort must not mutate server rows');
});

test('customer sorting and 2025/2026 week options retain selected year', async () => {
  const { sortDistributionCustomers, distributionWeekOptions } = await load();
  assert.deepEqual(sortDistributionCustomers([
    { CustKey: 2, CustName: 'Zulu' }, { CustKey: 1, CustName: 'Alpha' },
  ]).map(row => row.CustKey), [1, 2]);
  assert.ok(distributionWeekOptions('2025-41-02').includes('2025-41-02'));
  assert.ok(distributionWeekOptions('2026-41-02').includes('2026-41-02'));
  assert.ok(!distributionWeekOptions('2026-41-02').includes('2025-41-02'));
});

test('remarks distinguish persisted shipment text from unsaved OutUnit quantity', async () => {
  const { distributionQuantityRemark, hasDistributionDrafts } = await load();
  assert.equal(distributionQuantityRemark('기존 출고 비고', 48, 48, '단'), '기존 출고 비고');
  assert.match(distributionQuantityRemark('기존 출고 비고', 48, 50, '단'), /미저장 48 → 50단/);
  assert.equal(hasDistributionDrafts([{ CustKey: 478, 출고수량: 48 }], { 478: 50 }), true);
  assert.equal(hasDistributionDrafts([{ CustKey: 478, 출고수량: 48 }], { 478: 48 }), false);
});

test('exe-style week buttons: ±3 majors keep year/sub-week, sub-week buttons keep major, edges clamp', async () => {
  const { distributionWeekButtons, distributionSubWeekButtons } = await load();
  assert.deepEqual(distributionWeekButtons('2026-44-02'),
    ['2026-41-02', '2026-42-02', '2026-43-02', '2026-44-02', '2026-45-02', '2026-46-02', '2026-47-02']);
  assert.deepEqual(distributionWeekButtons('2025-01-01'), ['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01']);
  assert.deepEqual(distributionWeekButtons('41-02'), [], 'legacy WW-SS has no year → no buttons');
  assert.deepEqual(distributionSubWeekButtons('2026-44-03'), ['2026-44-01', '2026-44-02', '2026-44-03', '2026-44-04']);
});

test('save log lines and two-customer merge rows', async () => {
  const { distributionSaveLogLine, mergeDistributionCustomerItems } = await load();
  const at = new Date(2026, 10, 5, 9, 7, 3);
  assert.equal(distributionSaveLogLine({ mode: 'cust', name: 'Alpha + Zulu', week: '2026-41-02', savedCount: 2, totalQty: 1200 }, at),
    '09:07:03 2026-41-02 업체 Alpha + Zulu — 저장 완료 2건 · 총 1,200');
  assert.equal(distributionSaveLogLine({ mode: 'prod', name: 'Rose', week: '2026-41-02', skipped: true }, at),
    '09:07:03 2026-41-02 품목 Rose — 변경 없음, 저장 생략');
  assert.match(distributionSaveLogLine({ mode: 'prod', name: 'Rose', week: '2026-41-02', error: '검증 실패' }, at), /저장 실패: 검증 실패$/);
  const rows = mergeDistributionCustomerItems(
    [{ ProdKey: 90, ProdName: 'Zinnia', 출고수량: 5 }, { ProdKey: 2429, ProdName: 'Alstroemeria', 출고수량: 48 }],
    [{ ProdKey: 2429, ProdName: 'Alstroemeria', 출고수량: 0 }, { ProdKey: 53, ProdName: 'Carnation', 출고수량: 3 }]);
  assert.deepEqual(rows.map(row => [row.ProdKey, Boolean(row.a), Boolean(row.b)]),
    [[2429, true, true], [53, false, true], [90, true, false]], 'ProdName A-Z; a/b null when that customer has no order');
});

test('favorite parser accepts exact ProdKey only and rejects malformed rows', async () => {
  const { parseDistributionFavorite } = await load();
  assert.deepEqual(parseDistributionFavorite({ FavoriteKey: 10, FilterData: '{"prodKey":2429}' }),
    { favoriteKey: 10, prodKey: 2429 });
  assert.equal(parseDistributionFavorite({ FavoriteKey: 11, FilterData: '{"prodName":"Alstro"}' }), null);
  assert.equal(parseDistributionFavorite({ FavoriteKey: 12, FilterData: '{bad' }), null);
});
