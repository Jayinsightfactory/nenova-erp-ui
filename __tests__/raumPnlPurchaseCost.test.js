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
    buildRaumPnlSharedPurchaseCostMatrix,
    raumPnlCostIdentity,
    raumPnlCostSnapshot,
    sameRaumPnlCostSnapshot,
    raumPnlSharedCostSnapshot,
    sameRaumPnlSharedCostSnapshot,
    isRaumPnlSharedDraftUnchanged,
  } = comparison;

  // ---------------------------------------------------------------------
  // Legacy partner-scoped read path stays intact (loadRaumPnlCostComparisonRows
  // and buildRaumPnlPurchaseCostMatrix are preserved for pnl detail cost-history compat).
  // ---------------------------------------------------------------------
  const legacyRows = [
    { pnlKey: 100, itemKey: 1, orderYear: 2026, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 2, costPrice: 100, salePrice: 3000, saleAmount: 6000, isCustom: false },
    { pnlKey: 100, itemKey: 2, orderYear: 2026, major: 34, partnerCode: 'raum', name: '다른 판매행', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 3, costPrice: 120, salePrice: 3500, saleAmount: 10500, isCustom: false },
  ];
  const legacyMatrix = buildRaumPnlPurchaseCostMatrix(legacyRows, { orderYear: 2026, partnerCode: 'raum' });
  assert.equal(legacyMatrix.items.length, 1, 'legacy per-partner matrix builder keeps working unchanged');
  assert.deepEqual(legacyMatrix.items[0].cells[0].values, [100, 120]);

  const serverComparisonSource = read('lib/raumPnlCostComparisonServer.js');
  assert.match(serverComparisonSource, /export const RAUM_PNL_COST_COMPARISON_SQL/, 'legacy single-partner comparison SQL must remain exported');
  assert.match(serverComparisonSource, /m\.PartnerCode = @pc/, 'legacy comparison query keeps partner scoping for pnl detail cost history');
  assert.match(serverComparisonSource, /export async function loadRaumPnlCostComparisonRows/, 'legacy loader preserved');
  assert.match(serverComparisonSource, /export async function loadRaumPnlPurchaseCostRows/, 'new shared loader added');
  assert.match(serverComparisonSource, /export const RAUM_PNL_PURCHASE_COST_COMPARISON_SQL/);
  assert.match(serverComparisonSource, /m\.PartnerCode IN \('raum', 'choimun'\)/, 'shared loader reads both partners, not one');

  // ---------------------------------------------------------------------
  // Shared Raum+Choimun matrix — the fixture this task is really about.
  // ---------------------------------------------------------------------
  const rows = [
    // week 34: raum + choimun same cost -> single shared value, per-partner metrics differ
    { pnlKey: 100, itemKey: 1, orderYear: 2026, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 2, costPrice: 100, salePrice: 3000, saleAmount: 6000, isCustom: false },
    { pnlKey: 900, itemKey: 101, orderYear: 2026, major: 34, partnerCode: 'choimun', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 4, costPrice: 100, salePrice: 2900, saleAmount: 11600, isCustom: false },
    // week 33: raum + choimun disagree -> mismatch
    { pnlKey: 101, itemKey: 2, orderYear: 2026, major: 33, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 1, costPrice: 120, salePrice: 3100, saleAmount: 3100, isCustom: false },
    { pnlKey: 901, itemKey: 902, orderYear: 2026, major: 33, partnerCode: 'choimun', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 1, costPrice: 150, salePrice: 3200, saleAmount: 3200, isCustom: false },
    // week 32: only raum has the item -> choimun partner block is absent, not created
    { pnlKey: 102, itemKey: 3, orderYear: 2026, major: 32, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 1, costPrice: 80, salePrice: 2900, saleAmount: 2900, isCustom: false },
    // week 31: raum cost is null, choimun has 90 -> partial (needs "맞추기 필요")
    { pnlKey: 103, itemKey: 4, orderYear: 2026, major: 31, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 1, costPrice: null, salePrice: 2800, saleAmount: 2800, isCustom: false },
    { pnlKey: 903, itemKey: 904, orderYear: 2026, major: 31, partnerCode: 'choimun', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '단', qty: 2, costPrice: 90, salePrice: 2850, saleAmount: 5700, isCustom: false },
    // unit isolation: same ProdKey, different unit must not merge with '단'
    { pnlKey: 100, itemKey: 5, orderYear: 2026, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 10, prodName: 'ROSE A', unit: '박스', qty: 1, costPrice: 500, salePrice: 8000, saleAmount: 8000, isCustom: false },
    // custom vs ordinary unmatched rows stay separate identities
    { pnlKey: 100, itemKey: 6, orderYear: 2026, major: 34, partnerCode: 'raum', name: '수동품목', prodKey: null, unit: '단', qty: 1, costPrice: 600, salePrice: 1000, saleAmount: 1000, isCustom: true },
    { pnlKey: 100, itemKey: 7, orderYear: 2026, major: 34, partnerCode: 'raum', name: '수동품목', prodKey: null, unit: '단', qty: 1, costPrice: 700, salePrice: 1100, saleAmount: 1100, isCustom: false },
    // prior-year row with the same MajorWeek must not leak into 2026
    { pnlKey: 200, itemKey: 8, orderYear: 2025, major: 34, partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', qty: 9, costPrice: 999, salePrice: 9999, saleAmount: 89991, isCustom: false },
  ];

  const shared = buildRaumPnlSharedPurchaseCostMatrix(rows, { orderYear: 2026 });
  assert.deepEqual(shared.weeks.map(w => w.major), [34, 33, 32, 31], 'weeks are unique MajorWeek across both partners, descending, prior-year excluded');

  const roseA = shared.items.find(item => item.prodKey === 10 && item.unit === '단');
  assert.ok(roseA, 'shared identity ignores PartnerCode');
  const [cell34, cell33, cell32, cell31] = roseA.cells;

  // same week shared cell (both partners same cost)
  assert.equal(cell34.state, 'match');
  assert.deepEqual(cell34.values, [100]);
  assert.equal(cell34.singleValue, 100);
  assert.ok(cell34.partners.raum && cell34.partners.choimun, 'both partner blocks present when both rows exist');
  assert.equal(cell34.partners.raum.qty, 2, 'raum qty is partner-specific');
  assert.equal(cell34.partners.choimun.qty, 4, 'choimun qty is partner-specific');
  assert.equal(cell34.partners.raum.purchaseAmount, 100 * 2);
  assert.equal(cell34.partners.choimun.purchaseAmount, 100 * 4);
  assert.deepEqual(cell34.partners.raum.salePrices, [3000]);
  assert.deepEqual(cell34.partners.choimun.salePrices, [2900]);
  assert.equal(cell34.partners.raum.saleAmount, 6000);
  assert.equal(cell34.partners.choimun.saleAmount, 11600);

  // mismatch
  assert.equal(cell33.state, 'mismatch');
  assert.deepEqual(cell33.values, [120, 150], 'distinct combined costs are shown, never averaged');
  assert.deepEqual(cell33.partners.raum.costPrices, [120], 'Raum stored costs stay visible per partner');
  assert.deepEqual(cell33.partners.choimun.costPrices, [150], 'Choimun stored costs stay visible per partner');

  // one partner missing the product entirely -> no row created, block is null
  assert.equal(cell32.state, 'match');
  assert.equal(cell32.values[0], 80);
  assert.ok(cell32.partners.raum);
  assert.equal(cell32.partners.choimun, null, 'missing partner is shown as absent, not a fabricated zero row');

  // partial null -> shown with the one known value + "맞추기 필요"
  assert.equal(cell31.state, 'partial');
  assert.deepEqual(cell31.values, [90]);
  assert.equal(cell31.singleValue, 90);
  assert.equal(cell31.partners.raum.purchaseAmount, null, 'raum row has no cost yet, so its own purchase amount is unknown');
  assert.equal(cell31.partners.raum.missingCostRows, 1);
  assert.equal(cell31.partners.choimun.purchaseAmount, 90 * 2);
  assert.equal(isRaumPnlSharedDraftUnchanged('100', cell34), true, 'matching shared value is unchanged');
  assert.equal(isRaumPnlSharedDraftUnchanged('90', cell31), false, 'partial same value must stay dirty so NULL partner rows are filled');
  assert.equal(isRaumPnlSharedDraftUnchanged('', cell33), true, 'blank mismatch input restores its original unchanged state');
  assert.equal(isRaumPnlSharedDraftUnchanged('120', cell33), false, 'choosing one mismatched value is an explicit shared change');
  assert.equal(isRaumPnlSharedDraftUnchanged('', cell34), false, 'clearing a matched value is an explicit NULL change');

  // unit isolation
  const roseABox = shared.items.find(item => item.prodKey === 10 && item.unit === '박스');
  assert.notEqual(raumPnlCostIdentity({ prodKey: 10, unit: '단' }), raumPnlCostIdentity({ prodKey: 10, unit: '박스' }));
  assert.ok(roseABox && roseABox.cells[0].values[0] === 500);

  // custom vs ordinary isolation
  assert.equal(shared.items.filter(item => item.name === '수동품목').length, 2, 'custom and ordinary unmatched rows stay separate identities');

  // shared snapshot is stable and sorted (partnerCode, pnlKey, itemKey)
  const week34Rows = rows.filter(r => r.orderYear === 2026 && r.major === 34 && r.prodKey === 10 && r.unit === '단');
  assert.deepEqual(cell34.snapshot, raumPnlSharedCostSnapshot(week34Rows));
  assert.deepEqual(cell34.snapshot, [
    { partnerCode: 'choimun', pnlKey: 900, itemKey: 101, costPrice: 100 },
    { partnerCode: 'raum', pnlKey: 100, itemKey: 1, costPrice: 100 },
  ]);
  assert.deepEqual(
    raumPnlSharedCostSnapshot([week34Rows[1], week34Rows[0]]),
    raumPnlSharedCostSnapshot(week34Rows),
    'snapshot order does not depend on input order',
  );

  // either partner going stale must fail the comparison
  assert.equal(sameRaumPnlSharedCostSnapshot(week34Rows, cell34.snapshot), true);
  const raumStale = week34Rows.map(r => (r.partnerCode === 'raum' ? { ...r, costPrice: 999 } : r));
  assert.equal(sameRaumPnlSharedCostSnapshot(raumStale, cell34.snapshot), false, 'raum-side change must be detected');
  const choimunStale = week34Rows.map(r => (r.partnerCode === 'choimun' ? { ...r, costPrice: 999 } : r));
  assert.equal(sameRaumPnlSharedCostSnapshot(choimunStale, cell34.snapshot), false, 'choimun-side change must be detected');

  // row added after preview -> target set changed -> must not match
  const withExtraRow = [...week34Rows, { pnlKey: 900, itemKey: 999, partnerCode: 'choimun', prodKey: 10, unit: '단', costPrice: 100 }];
  assert.equal(sameRaumPnlSharedCostSnapshot(withExtraRow, cell34.snapshot), false, 'a row added after preview must invalidate the snapshot');
  // row moved to a different pnlKey (e.g. settlement re-created) -> must not match
  const movedRow = week34Rows.map(r => (r.partnerCode === 'choimun' ? { ...r, pnlKey: 777 } : r));
  assert.equal(sameRaumPnlSharedCostSnapshot(movedRow, cell34.snapshot), false, 'a pnlKey move must invalidate the snapshot');

  // ---------------------------------------------------------------------
  // Zero / null / negative cost values
  // ---------------------------------------------------------------------
  assert.equal(purchase.parseRaumPurchaseCost('0'), 0, 'explicit zero is preserved as a valid cost');
  assert.equal(purchase.parseRaumPurchaseCost(''), null, 'empty clears to NULL');
  assert.equal(purchase.parseRaumPurchaseCost('1,234.5'), 1234.5);
  assert.throws(() => purchase.parseRaumPurchaseCost('-1'), /0 이상의 숫자/, 'negative is rejected');
  assert.throws(() => purchase.parseRaumPurchaseCost('abc'), /0 이상의 숫자/, 'non-number is rejected');

  // ---------------------------------------------------------------------
  // Shared save-request normalization — payload has no pnlKey/partnerCode, only major+identity.
  // ---------------------------------------------------------------------
  const normalized = purchase.normalizeSharedRaumPurchaseCostUpdates([
    { major: 34, identity: roseA.identity, expected: cell34.snapshot, costPrice: 150 },
  ]);
  assert.equal(normalized[0].costPrice, 150);
  assert.equal(normalized[0].pnlKey, undefined, 'shared update carries no single pnlKey — server re-derives both partner scopes');
  assert.throws(() => purchase.normalizeSharedRaumPurchaseCostUpdates([
    { major: 34, identity: roseA.identity, expected: cell34.snapshot, costPrice: 100 },
    { major: 34, identity: roseA.identity, expected: cell34.snapshot, costPrice: 200 },
  ]), /중복 요청/, 'duplicate major+identity in one request is rejected');
  assert.throws(() => purchase.normalizeSharedRaumPurchaseCostUpdates([
    { major: 34, identity: roseA.identity, expected: [], costPrice: 100 },
  ]), /화면 기준값이 없어/, 'empty expected snapshot is rejected');
  assert.throws(() => purchase.normalizeSharedRaumPurchaseCostUpdates([]), /저장할 단가 변경이 없습니다/);

  // ---------------------------------------------------------------------
  // Write-target SQL allowlist — must stay WebRaumPnl/WebRaumPnlItem only, and never touch
  // SalePrice/SaleAmount or any ERP ledger table.
  // ---------------------------------------------------------------------
  const purchaseSource = read('lib/raumPnlPurchaseCost.js');
  assert.match(purchaseSource, /m\.OrderYear=@yr/);
  assert.match(purchaseSource, /m\.MajorWeek=@major/);
  assert.match(purchaseSource, /m\.PartnerCode IN \('raum', 'choimun'\)/, 'shared save locks both partner scopes for the major/year');
  assert.match(purchaseSource, /ISNULL\(m\.isDeleted, 0\)=0/);
  assert.match(purchaseSource, /WITH \(UPDLOCK, HOLDLOCK\)/);
  assert.match(purchaseSource, /sameRaumPnlSharedCostSnapshot/);
  assert.match(purchaseSource, /export async function saveRaumSharedPurchaseCosts/);

  const writeSqlAll = [
    ...Object.values(purchase.RAUM_PNL_PURCHASE_COST_WRITE_SQL),
    ...Object.values(purchase.RAUM_PNL_SHARED_PURCHASE_COST_WRITE_SQL),
  ].join('\n');
  for (const match of writeSqlAll.matchAll(/\b(?:UPDATE|MERGE|INSERT\s+INTO|DELETE\s+FROM)\s+([\w.]+)/gi)) {
    assert.match(match[1].replace(/^dbo\./i, ''), /^WebRaumPnl(?:Item)?$/, `unexpected write target: ${match[1]}`);
  }
  for (const forbidden of ['WebRaumCostPrice', 'OrderDetail', 'ShipmentDetail', 'ProductStock', 'StockHistory', 'Estimate', 'WebProfitReport', 'Product']) {
    assert.doesNotMatch(writeSqlAll, new RegExp(`(?:UPDATE|MERGE|INSERT\\s+INTO|DELETE\\s+FROM)\\s+(?:dbo\\.)?${forbidden}`, 'i'));
  }
  assert.doesNotMatch(writeSqlAll, /SET[^;]*\b(SalePrice|SaleAmount)\b/i, 'purchase cost save must never write SalePrice/SaleAmount');

  const serverComparison = read('lib/raumPnlCostComparisonServer.js');
  assert.match(serverComparison, /i\.SalePrice/, 'sale price must be read for display');
  assert.match(serverComparison, /i\.SaleAmount/, 'sale amount must be read for display');
  const comparisonLib = read('lib/raumPnlCostComparison.js');
  assert.match(comparisonLib, /salePrices/);
  assert.match(comparisonLib, /purchaseAmount/);
  assert.match(comparisonLib, /saleAmount/);
  assert.match(comparisonLib, /buildRaumPnlSharedPurchaseCostMatrix/);
  assert.match(comparisonLib, /raumPnlSharedCostSnapshot/);

  // ---------------------------------------------------------------------
  // API: year-only scope, no partner required for read or write.
  // ---------------------------------------------------------------------
  const api = read('pages/api/raum/purchase-costs.js');
  assert.match(api, /explicitYear/);
  assert.doesNotMatch(api, /explicitPartner/, 'partner selection was removed — the screen always covers both partners');
  assert.doesNotMatch(api, /resolvePnlPartner/, 'API must not resolve/require a partner to scope reads or writes');
  assert.match(api, /loadRaumPnlPurchaseCostRows/);
  assert.match(api, /saveRaumSharedPurchaseCosts/);
  assert.match(api, /req\.query\.year/);
  assert.doesNotMatch(api, /req\.query\.partner/, 'stray partner query must not be used for scoping');
  assert.doesNotMatch(api, /req\.body\?\.partnerCode/, 'stray partner body field must not be used for scoping');

  // ---------------------------------------------------------------------
  // Page: single combined screen, no partner toggle, both partner sections per cell.
  // ---------------------------------------------------------------------
  const page = read('pages/raum/purchase-costs.js');
  const pnlPage = read('pages/raum/pnl.js');
  const layout = read('components/Layout.js');
  assert.match(page, /라움·초이문 공통 매입단가/, 'title/summary must state the shared-cost screen explicitly');
  assert.match(page, /변경 단가 저장/);
  assert.match(page, /buildRaumPnlSharedPurchaseCostMatrix/);
  assert.doesNotMatch(page, /changeScope|setPartnerCode|PNL_PARTNERS\)\.map/, 'partner toggle buttons/state must be removed');
  assert.match(page, /라움 손익계산서/);
  assert.match(page, /초이문 손익계산서/);
  assert.match(page, /PartnerCellBlock/, 'each cell must render separate Raum/Choimun sections');
  assert.match(page, /단가 다름/);
  assert.match(page, /StoredCostDifference/, 'mismatch cells visibly compare each partner stored cost');
  assert.match(page, /저장 단가 비교/);
  assert.match(page, /맞추기 필요/);
  assert.match(page, /동일 적용/);
  assert.match(page, /판매가|판 /);
  assert.match(page, /매입액|매 /);
  assert.match(page, /견적액|견 /);
  assert.doesNotMatch(page, /partnerCode\s*:/i, 'shared save payload must never send partnerCode');
  assert.doesNotMatch(page, /salePrice\s*:/i, 'page save payload must not send SalePrice');
  assert.doesNotMatch(page, /saleAmount\s*:/i, 'page save payload must not send SaleAmount');
  assert.match(pnlPage, /차수별 매입단가 관리/);
  assert.equal((layout.match(/href: '\/raum\/purchase-costs'/g) || []).length, 1, 'menu entry must be centralized and unique');

  const contract = JSON.parse(read('docs/contracts/raum-pnl-settlement.json'));
  const action = contract.actions.find(item => item.name === 'RAUM_PNL_PURCHASE_COST_EDIT');
  assert.ok(action);
  assert.deepEqual(action.writeAllowlist, ['WebRaumPnlItem.CostPrice', 'WebRaumPnlItem.CostSource', 'WebRaumPnl.UpdatedBy', 'WebRaumPnl.UpdatedAt']);
  assert.ok(contract.requiredTestFiles.includes('__tests__/raumPnlPurchaseCost.test.js'));
  assert.ok(contract.purchaseCostManagement, 'contract must document the shared purchase-cost identity/write scope');
  assert.match(contract.purchaseCostManagement.identity, /PartnerCode is deliberately excluded/i);

  console.log('Raum/Choimun shared purchase cost management tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
