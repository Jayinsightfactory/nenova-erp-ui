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

test('favorite parser accepts exact ProdKey only and rejects malformed rows', async () => {
  const { parseDistributionFavorite } = await load();
  assert.deepEqual(parseDistributionFavorite({ FavoriteKey: 10, FilterData: '{"prodKey":2429}' }),
    { favoriteKey: 10, prodKey: 2429 });
  assert.equal(parseDistributionFavorite({ FavoriteKey: 11, FilterData: '{"prodName":"Alstro"}' }), null);
  assert.equal(parseDistributionFavorite({ FavoriteKey: 12, FilterData: '{bad' }), null);
});
