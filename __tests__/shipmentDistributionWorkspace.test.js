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

test('partial move plan, pending-order rows and order count in save log', async () => {
  const { planDistributionMove, pendingDistributionOrderItems, pendingDistributionItem, distributionSaveLogLine } = await load();
  assert.deepEqual(planDistributionMove({ fromQty: 5, toQty: 2, requested: '' }), { moved: 5, fromAfter: 0, toAfter: 7 }, 'empty request moves all');
  assert.deepEqual(planDistributionMove({ fromQty: 5, toQty: 2, requested: '3' }), { moved: 3, fromAfter: 2, toAfter: 5 }, 'partial move');
  assert.deepEqual(planDistributionMove({ fromQty: 5, toQty: 0, requested: '9' }), { moved: 5, fromAfter: 0, toAfter: 5 }, 'capped at source qty');
  assert.deepEqual(planDistributionMove({ fromQty: 0, toQty: 1, requested: '2' }), { moved: 0, fromAfter: 0, toAfter: 1 }, 'nothing to move');
  const pending = pendingDistributionItem({ ProdKey: 90, ProdName: 'Zinnia', OutUnit: '박스', Cost: 12, 주문수량: 20, 출고수량: 7, ShipmentDescr: 'x' });
  assert.deepEqual([pending.주문수량, pending.출고수량, pending.pendingOrder, pending.ShipmentDescr, pending.Cost], [0, 0, true, '', 12]);
  const items = [pending, { ProdKey: 2429, ProdName: 'Alstroemeria', OutUnit: '단', 주문수량: 60, 출고수량: 51 }];
  assert.deepEqual(pendingDistributionOrderItems(items, { 90: { outQty: '3' }, 2429: { outQty: 0 } }), [{ prodKey: 90, qty: 3, unit: '박스' }]);
  assert.deepEqual(pendingDistributionOrderItems(items, { 90: { outQty: 0 } }), [], 'moved back to 0 → no order registration');
  assert.match(distributionSaveLogLine({ mode: 'cust', name: 'A + B', week: '2026-41-02', savedCount: 3, totalQty: 112, orderCount: 1 }, new Date(2026, 10, 5, 9, 7, 3)),
    /저장 완료 3건 · 총 112 · 주문등록 1건$/);
});

test('fix-cycle scope: only confirmed product groups, blocked when group is blank, save-log notes', async () => {
  const { distributionFixCycleScope, distributionSaveLogLine } = await load();
  assert.deepEqual(distributionFixCycleScope([{ prodKey: 1, countryFlower: 'A', fixed: false }]), { needed: false, countryFlowers: [], blocked: [] });
  assert.deepEqual(distributionFixCycleScope([
    { prodKey: 1, countryFlower: '콜롬비아 장미', fixed: true }, { prodKey: 2, countryFlower: '콜롬비아 장미', fixed: true },
    { prodKey: 3, countryFlower: '네덜란드 기타', fixed: false }, { prodKey: 4, countryFlower: ' ', fixed: true },
  ]), { needed: true, countryFlowers: ['콜롬비아 장미'], blocked: [4] });
  assert.equal(distributionSaveLogLine({ mode: 'cust', name: 'A + B', week: '2026-41-02', note: '2026-41-02 재확정 중' }, new Date(2026, 10, 5, 9, 7, 3)),
    '09:07:03 2026-41-02 업체 A + B — 2026-41-02 재확정 중');
});

test('group favorite parser keeps only groupKey rows (week independent)', async () => {
  const { parseDistributionGroupFavorite } = await load();
  assert.deepEqual(parseDistributionGroupFavorite({ FavoriteKey: 7, FilterData: '{"groupKey":"콜롬비아::장미"}' }), { groupKey: '콜롬비아::장미', favoriteKey: 7 });
  assert.equal(parseDistributionGroupFavorite({ FavoriteKey: 8, FilterData: '{"prodKey":90}' }), null, 'product favorite row is not a group');
  assert.equal(parseDistributionGroupFavorite({ FavoriteKey: 0, FilterData: '{"groupKey":"a"}' }), null);
  assert.equal(parseDistributionGroupFavorite({ FavoriteKey: 9, FilterData: 'not json' }), null);
});

test('pair view 품종 buttons and 박스/단 input unit keep OutUnit storage', async () => {
  const { distributionPairGroups, distributionPairGroupKey, distributionUnitFactor, toDisplayQty, toNativeQty } = await load();
  const rose = { CounName: '콜롬비아', FlowerName: '장미', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 200 };
  const hydrangea = { CounName: '콜롬비아', FlowerName: '수국', OutUnit: '박스', BunchOf1Box: 20, SteamOf1Box: 20 };
  assert.deepEqual(distributionPairGroups([rose, hydrangea, rose]), ['콜롬비아 수국', '콜롬비아 장미']);
  assert.equal(distributionPairGroupKey({}), '기타');
  // 단 품목을 박스로 입력: 1.6박스 = 16단 저장
  const f = distributionUnitFactor(rose, '박스');
  assert.equal(toDisplayQty(16, f), 1.6);
  assert.equal(toNativeQty('1.6', f), 16);
  // 박스 품목을 단으로 입력: 40단 = 2박스 저장
  assert.equal(toNativeQty('40', distributionUnitFactor(hydrangea, '단')), 2);
  assert.equal(distributionUnitFactor(rose, ''), 1);
  assert.equal(distributionUnitFactor({ OutUnit: '단', BunchOf1Box: 0 }, '박스'), null, 'missing factor → native input');
});

test('customer item search keeps ordered items first and appends unordered products as searchOnly', async () => {
  const { distributionCustomerSearchRows } = await load();
  const matches = (row, q) => `${row.ProdName}`.toLowerCase().includes(q.toLowerCase());
  const custItems = [{ ProdKey: 2, ProdName: 'Brassica Red', 주문수량: 10 }, { ProdKey: 9, ProdName: 'Rose', 주문수량: 5 }];
  const products = [{ ProdKey: 1, ProdName: 'Brassica White' }, { ProdKey: 2, ProdName: 'Brassica Red' }, { ProdKey: 3, ProdName: 'Bromelia' }, { ProdKey: 9, ProdName: 'Rose' }];
  const rows = distributionCustomerSearchRows(custItems, products, 'br', matches);
  assert.deepEqual(rows.map(r => r.ProdKey), [2, 1, 3], 'ordered item first, then unordered A-Z');
  assert.deepEqual(rows.map(r => !!r.searchOnly), [false, true, true]);
  assert.deepEqual(distributionCustomerSearchRows(custItems, products, '', matches).map(r => r.ProdKey), [2, 9], 'no search → only ordered items');
  assert.deepEqual(distributionCustomerSearchRows([], products, 'rose', matches).map(r => [r.ProdKey, !!r.searchOnly]), [[9, true]], 'no orders → unordered product still appears');
});
