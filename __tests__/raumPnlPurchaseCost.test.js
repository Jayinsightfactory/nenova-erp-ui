const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function main() {
  const comparison = await import('../lib/raumPnlCostComparison.js');
  const purchase = await import('../lib/raumPnlPurchaseCost.js');
  const {
    buildRaumPnlPurchaseCostMatrix,
    raumPnlCostIdentity,
    raumPnlCostSnapshot,
    sameRaumPnlCostSnapshot,
  } = comparison;

  const rows = [
    { pnlKey: 100, itemKey: 1, orderYear: 2026, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 2, costPrice: 100, salePrice: 3000, saleAmount: 6000, isCustom: false },
    { pnlKey: 100, itemKey: 2, orderYear: 2026, major: 34, partnerCode: 'raum', name: '다른 판매행', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 3, costPrice: 120, salePrice: 3500, saleAmount: 10500, isCustom: false },
    { pnlKey: 101, itemKey: 3, orderYear: 2026, major: 33, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 4, costPrice: 0, salePrice: 3200, saleAmount: 12800, isCustom: false },
    { pnlKey: 100, itemKey: 4, orderYear: 2026, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 11, prodName: 'ROSE B', unit: '단', qty: 1, costPrice: null, salePrice: null, saleAmount: null, isCustom: false },
    { pnlKey: 100, itemKey: 5, orderYear: 2026, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '박스', qty: 1, costPrice: 500, salePrice: 8000, saleAmount: 8000, isCustom: false },
    { pnlKey: 100, itemKey: 6, orderYear: 2026, major: 34, partnerCode: 'raum', name: '수동', prodKey: null, unit: '단', qty: 1, costPrice: 600, salePrice: 1000, saleAmount: 1000, isCustom: true },
    { pnlKey: 100, itemKey: 7, orderYear: 2026, major: 34, partnerCode: 'raum', name: '수동', prodKey: null, unit: '단', qty: 1, costPrice: 700, salePrice: 1100, saleAmount: 1100, isCustom: false },
    { pnlKey: 200, itemKey: 8, orderYear: 2025, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', qty: 9, costPrice: 999, salePrice: 9999, saleAmount: 89991, isCustom: false },
    { pnlKey: 300, itemKey: 9, orderYear: 2026, major: 34, partnerCode: 'choimun', name: '장미 A', prodKey: 10, unit: '단', qty: 9, costPrice: 998, salePrice: 9998, saleAmount: 89982, isCustom: false },
  ];
  const matrix = buildRaumPnlPurchaseCostMatrix(rows, { orderYear: 2026, partnerCode: 'raum' });
  assert.deepEqual(matrix.weeks.map(week => week.major), [34, 33], 'selected year/partner weeks must be isolated and descending');
  const roseA = matrix.items.find(item => item.prodKey === 10 && item.unit === '단');
  assert.deepEqual(roseA.cells[0].values, [100, 120], 'multiple stored costs remain visible and are not averaged');
  assert.equal(roseA.cells[0].qty, 5, 'same product/unit rows in one settlement are one editable cell');
  assert.deepEqual(roseA.cells[1].values, [0], 'explicit zero remains a value');
  assert.ok(matrix.items.find(item => item.prodKey === 11).cells[0].values.length === 0, 'missing cost remains editable and missing');
  assert.equal(matrix.items.filter(item => item.name === '수동').length, 2, 'custom and ordinary unmatched rows stay separate');
  assert.notEqual(raumPnlCostIdentity(rows[0]), raumPnlCostIdentity(rows[4]), 'unit is part of product identity');

  assert.deepEqual(roseA.cells[0].salePrices, [3000, 3500], 'distinct stored sale prices are shown, never averaged');
  assert.equal(roseA.cells[0].purchaseAmount, 100 * 2 + 120 * 3, 'purchase amount sums stored cost x qty across matching rows');
  assert.equal(roseA.cells[0].saleAmount, 6000 + 10500, 'sale amount sums stored SaleAmount across matching rows');
  assert.equal(roseA.cells[0].qty, 5, 'qty stays the shared quantity total');
  const roseB = matrix.items.find(item => item.prodKey === 11);
  assert.equal(roseB.cells[0].purchaseAmount, null, 'fully missing cost is shown as unknown, not a false zero');
  assert.equal(roseB.cells[0].missingCostRows, 1);
  assert.equal(roseB.cells[0].saleAmount, null, 'fully missing sale amount is shown as unknown, not a false zero');
  assert.equal(roseB.cells[0].missingSaleAmountRows, 1);

  assert.deepEqual(raumPnlCostSnapshot([rows[1], rows[0]]), [
    { itemKey: 1, costPrice: 100 }, { itemKey: 2, costPrice: 120 },
  ], 'snapshot is stable by ItemKey');
  assert.equal(sameRaumPnlCostSnapshot(rows.slice(0, 2), [{ itemKey: 2, costPrice: 120 }, { itemKey: 1, costPrice: 100 }]), true);
  assert.equal(sameRaumPnlCostSnapshot(rows.slice(0, 2), [{ itemKey: 1, costPrice: 101 }, { itemKey: 2, costPrice: 120 }]), false, 'stale cost must fail');

  assert.equal(purchase.parseRaumPurchaseCost('0'), 0);
  assert.equal(purchase.parseRaumPurchaseCost(''), null);
  assert.equal(purchase.parseRaumPurchaseCost('1,234.5'), 1234.5);
  assert.throws(() => purchase.parseRaumPurchaseCost('-1'), /0 이상의 숫자/);
  assert.throws(() => purchase.parseRaumPurchaseCost('abc'), /0 이상의 숫자/);
  const normalized = purchase.normalizeRaumPurchaseCostUpdates([{ pnlKey: 100, major: 34, identity: roseA.identity, expected: roseA.cells[0].snapshot, costPrice: 0 }]);
  assert.equal(normalized[0].costPrice, 0);
  assert.throws(() => purchase.normalizeRaumPurchaseCostUpdates([
    { pnlKey: 100, major: 34, identity: roseA.identity, expected: roseA.cells[0].snapshot, costPrice: 100 },
    { pnlKey: 100, major: 34, identity: roseA.identity, expected: roseA.cells[0].snapshot, costPrice: 200 },
  ]), /중복 요청/);

  const server = read('lib/raumPnlPurchaseCost.js');
  assert.match(server, /m\.OrderYear=@yr/);
  assert.match(server, /m\.MajorWeek=@major/);
  assert.match(server, /m\.PartnerCode=@pc/);
  assert.match(server, /m\.PnlKey=@pnlKey/);
  assert.match(server, /ISNULL\(m\.isDeleted, 0\)=0/);
  assert.match(server, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(server, /sameRaumPnlCostSnapshot/);
  const writeSql = Object.values(purchase.RAUM_PNL_PURCHASE_COST_WRITE_SQL).join('\n');
  for (const match of writeSql.matchAll(/\b(?:UPDATE|MERGE|INSERT\s+INTO|DELETE\s+FROM)\s+([\w.]+)/gi)) {
    assert.match(match[1].replace(/^dbo\./i, ''), /^WebRaumPnl(?:Item)?$/, `unexpected write target: ${match[1]}`);
  }
  for (const forbidden of ['WebRaumCostPrice', 'OrderDetail', 'ShipmentDetail', 'ProductStock', 'StockHistory', 'Estimate', 'WebProfitReport']) {
    assert.doesNotMatch(writeSql, new RegExp(`(?:UPDATE|MERGE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+(?:dbo\\.)?${forbidden}`, 'i'));
  }
  assert.doesNotMatch(writeSql, /SET[^;]*\b(SalePrice|SaleAmount)\b/i, 'purchase cost save must never write SalePrice/SaleAmount');

  const serverComparison = read('lib/raumPnlCostComparisonServer.js');
  assert.match(serverComparison, /i\.SalePrice/, 'sale price must be read for display');
  assert.match(serverComparison, /i\.SaleAmount/, 'sale amount must be read for display');
  const comparisonLib = read('lib/raumPnlCostComparison.js');
  assert.match(comparisonLib, /salePrices/);
  assert.match(comparisonLib, /purchaseAmount/);
  assert.match(comparisonLib, /saleAmount/);

  const api = read('pages/api/raum/purchase-costs.js');
  const page = read('pages/raum/purchase-costs.js');
  const pnlPage = read('pages/raum/pnl.js');
  const layout = read('components/Layout.js');
  assert.match(api, /explicitYear/);
  assert.match(api, /explicitPartner/);
  assert.match(api, /loadRaumPnlCostComparisonRows/);
  assert.match(api, /saveRaumPnlPurchaseCosts/);
  assert.match(page, /차수별 매입단가/);
  assert.match(page, /변경 단가 저장/);
  assert.match(page, /미입력만/);
  assert.match(page, /해당 차수의 매입액·이익도 새 단가로 계산/);
  assert.match(page, /판매가/);
  assert.match(page, /매입액/);
  assert.match(page, /견적액/);
  assert.match(page, /displayPurchaseAmount/, 'draft cost must recompute displayed purchase amount live as draft \\* qty');
  assert.match(page, /draftInvalid/);
  assert.match(page, /매입금액/);
  assert.match(page, /견적서 금액/);
  assert.doesNotMatch(page, /salePrice\s*:/i, 'page save payload must not send SalePrice');
  assert.doesNotMatch(page, /saleAmount\s*:/i, 'page save payload must not send SaleAmount');
  assert.match(pnlPage, /차수별 매입단가 관리/);
  assert.equal((layout.match(/href: '\/raum\/purchase-costs'/g) || []).length, 1, 'menu entry must be centralized and unique');

  const contract = JSON.parse(read('docs/contracts/raum-pnl-settlement.json'));
  const action = contract.actions.find(item => item.name === 'RAUM_PNL_PURCHASE_COST_EDIT');
  assert.ok(action);
  assert.deepEqual(action.writeAllowlist, ['WebRaumPnlItem.CostPrice', 'WebRaumPnlItem.CostSource', 'WebRaumPnl.UpdatedBy', 'WebRaumPnl.UpdatedAt']);
  assert.ok(contract.requiredTestFiles.includes('__tests__/raumPnlPurchaseCost.test.js'));
  console.log('Raum/Choimun purchase cost management tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
