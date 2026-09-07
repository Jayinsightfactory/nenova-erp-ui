const assert = require('node:assert/strict');

const row = (overrides = {}) => ({
  pnlKey: 1, itemKey: 1, orderYear: '2026', major: 35, partnerCode: 'raum',
  name: '장미 · 쉬머', prodKey: 3170, prodName: 'ROSE SHIMMER', unit: '단',
  qty: 2, costPrice: 100, salePrice: 200, saleAmount: 400, isCustom: false,
  ...overrides,
});

async function main() {
  const { buildRaumPnlCombinedPurchaseCostMatrix } = await import('../lib/raumPnlCostComparison.js');
  const sharedRows = [
    row(),
    row({ pnlKey: 2, itemKey: 2, partnerCode: 'choimun', qty: 3, costPrice: 100, salePrice: 210, saleAmount: 630 }),
    row({ pnlKey: 3, itemKey: 3, major: 34, unit: '단-5스팀', qty: 170, costPrice: 21500 }),
    row({ pnlKey: 99, itemKey: 99, orderYear: '2025', major: 35, costPrice: 999 }),
    row({ pnlKey: 4, itemKey: 4, prodKey: null, name: '호접 · 화이트', unit: '8스팀' }),
  ];
  const shillaRows = [
    row({ pnlKey: 10, itemKey: 10, partnerCode: 'shilla', qty: 16, costPrice: 10800, salePrice: 300, saleAmount: 4800 }),
    row({ pnlKey: 11, itemKey: 11, partnerCode: 'shilla', major: 34, unit: '단-5스팀', qty: 170, costPrice: 21500 }),
    row({ pnlKey: 10, itemKey: 12, partnerCode: 'shilla', prodKey: null, name: '호접 · 화이트', unit: '8스팀', qty: 324, costPrice: 11233 }),
    row({ pnlKey: 10, itemKey: 13, partnerCode: 'shilla', prodKey: 3170, unit: '8스팀', qty: 324, costPrice: 11233 }),
    row({ pnlKey: 14, itemKey: 14, partnerCode: 'shilla', orderYear: '2025', costPrice: 999 }),
  ];
  const before = JSON.parse(JSON.stringify({ sharedRows, shillaRows }));
  const matrix = buildRaumPnlCombinedPurchaseCostMatrix(sharedRows, shillaRows, { orderYear: '2026' });

  assert.deepEqual(matrix.conflicts, []);
  assert.deepEqual(matrix.weeks.map(week => week.major), [35, 34], 'union weeks are exact-year, descending');
  const sameProduct = matrix.items.find(item => item.prodKey === 3170 && item.unit === '단');
  assert.ok(sameProduct, 'same positive ProdKey + Unit has a shared product item');
  assert.deepEqual(Object.keys(sameProduct.cells[0]).sort(), ['key', 'major', 'shared', 'shilla']);
  assert.equal(sameProduct.cells[0].shared.partners.raum.qty, 2);
  assert.equal(sameProduct.cells[0].shilla.qty, 16);
  assert.equal(sameProduct.shillaName, '장미 · 쉬머', 'co-located rows retain the Shilla source name separately for display');
  assert.notDeepEqual(sameProduct.cells[0].shared.snapshot, sameProduct.cells[0].shilla.snapshot, 'save snapshots remain separate');
  assert.equal(sameProduct.cells[1], null, 'missing on both sides is represented as null');

  const differentUnit = matrix.items.find(item => item.prodKey === 3170 && item.unit === '8스팀');
  assert.ok(differentUnit, '8스팀 never converts or merges into 단');
  assert.equal(differentUnit.cells[0].shared, null);
  assert.equal(differentUnit.cells[0].shilla.qty, 324);
  const steamFive = matrix.items.find(item => item.unit === '단-5스팀');
  assert.ok(steamFive && steamFive.cells[1].shared && steamFive.cells[1].shilla, '단-5스팀 remains its own co-located unit group');
  assert.equal(steamFive.cells[0], null);

  const unmatched = matrix.items.filter(item => item.name === '호접 · 화이트' && item.prodKey === null);
  assert.equal(unmatched.length, 2, 'unmapped Shilla names never join the Raum/Choimun fallback identity');
  assert.ok(unmatched.some(item => item.identity.startsWith('shilla:')));
  const shillaOnlyUnmatched = unmatched.find(item => item.identity.startsWith('shilla:'));
  assert.equal(shillaOnlyUnmatched.cells[0].shared, null, 'Shilla-only rows never leak into the shared saver cell');
  assert.equal(shillaOnlyUnmatched.shillaName, '호접 · 화이트');
  assert.equal(shillaOnlyUnmatched.cells[0].shilla.snapshot[0].itemKey, 12, 'the independent Shilla snapshot stays on the Shilla cell');
  assert.equal(matrix.items[0].identity, 'prod:3170|unit:단|ordinary', 'existing shared ordering stays first');
  assert.deepEqual({ sharedRows, shillaRows }, before, 'pure display helper never mutates rows');
  const duplicateShillaSettlement = buildRaumPnlCombinedPurchaseCostMatrix(sharedRows, [
    ...shillaRows,
    row({ pnlKey: 15, itemKey: 15, partnerCode: 'shilla', major: 35, prodKey: 4000, name: '중복 결산', unit: '단' }),
  ], { orderYear: '2026' });
  assert.deepEqual(duplicateShillaSettlement.conflicts, ['35차 신라 결산이 여러 건입니다. 신라 단가를 표시하거나 저장할 수 없습니다.']);
  const sharedAfterShillaConflict = duplicateShillaSettlement.items.find(item => item.prodKey === 3170 && item.unit === '단');
  assert.ok(sharedAfterShillaConflict.cells[0].shared, 'ambiguous Shilla input preserves the existing shared cell');
  assert.equal(sharedAfterShillaConflict.cells[0].shilla, null, 'ambiguous-major Shilla rows are all omitted rather than silently selecting one');
  assert.deepEqual(buildRaumPnlCombinedPurchaseCostMatrix(sharedRows, shillaRows, { orderYear: 'bad' }), { weeks: [], items: [], conflicts: [] });
  console.log('Shilla combined purchase-cost matrix tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
