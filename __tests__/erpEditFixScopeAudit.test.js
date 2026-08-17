const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');

async function main() {
  const { requireErpWriteScope, assertErpWriteScope } = await import('../lib/erpWriteScope.js');
  const { resolveFixStatusOrderYear, findFixStatusWeek } = await import('../lib/fixStatusYearScope.js');

  const scope2025 = requireErpWriteScope({ orderYear: '2025', custKey: 11 });
  const scope2026 = requireErpWriteScope({ orderYear: '2026', custKey: 11 });
  assert.notEqual(scope2025.orderYear, scope2026.orderYear);
  assert.throws(() => requireErpWriteScope({ orderYear: '', custKey: 11 }), /선택 연도/);
  assert.throws(() => assertErpWriteScope({ OrderYear: '2025', CustKey: 11 }, scope2026), /실제 연도/);

  const sameWeekRows = [
    { OrderYear: '2025', OrderWeek: '32-02', status: 'UNFIXED' },
    { OrderYear: '2026', OrderWeek: '32-02', status: 'FIXED' },
  ];
  assert.equal(resolveFixStatusOrderYear('2025', '32-02'), '2025');
  assert.equal(resolveFixStatusOrderYear('2026', '32-02'), '2026');
  assert.equal(findFixStatusWeek(sameWeekRows, { orderYear: '2025', orderWeek: '32-02' }).status, 'UNFIXED');
  assert.equal(findFixStatusWeek(sameWeekRows, { orderYear: '2026', orderWeek: '32-02' }).status, 'FIXED');

  const estimatePage = read('pages/estimate.js');
  const estimateApi = read('pages/api/estimate/index.js');
  const fixClient = read('lib/fixCycleClient.js');
  const modal = read('components/estimate/OrderRegisterDistributeModal.js');
  const stockPage = read('pages/stock.js');
  const stockApi = read('pages/api/stock/adjust-batch.js');
  const raum = read('pages/raum/pnl.js');
  const paste = read('pages/orders/paste.js');
  const pivot = read('pages/shipment/week-pivot.js');
  const adjustApi = read('pages/api/shipment/adjust.js');
  const adjustBatchPolicy = read('lib/shipmentAdjustmentBatch.js');
  const costApi = read('pages/api/estimate/update-cost.js');
  const distributePage = read('pages/shipment/distribute.js');
  const distributeApi = read('pages/api/shipment/distribute.js');
  const ordersApi = read('pages/api/orders/index.js');
  const warehouseApi = read('pages/api/warehouse/index.js');
  const remitApi = read('pages/api/incoming-price/remit.js');
  const ecountSalesApi = read('pages/api/ecount/sales-push.js');
  const ecountDashboard = read('pages/ecount/dashboard.js');
  const salesStatus = read('pages/sales/status.js');
  const costSyncApi = read('pages/api/dev/estimate-cost-date-sync.js');
  const descrCleanupApi = read('pages/api/dev/estimate-print-descr-cleanup.js');
  const mobileEstimate = read('pages/m/estimate/index.js');
  const bizContext = read('lib/chat/bizContext.js');

  assert.match(estimatePage, /apiGet\('\/api\/estimate', \{[\s\S]{0,100}?week: weekNum,[\s\S]{0,80}?year: yearStr/);
  assert.match(estimateApi, /resolveOrderYearWeek\(parentWeek, explicitYear\)/);
  assert.match(estimateApi, /om\.OrderYear=@yr/);
  assert.match(estimateApi, /sm\.OrderYear=@yr/);
  assert.doesNotMatch(estimateApi, /ensureWeekProdCostTable|WEEK_PROD_COST_SCHEMA_SQL/);
  assert.doesNotMatch(costApi, /WEEK_PROD_COST_SCHEMA_SQL|CREATE TABLE WeekProdCost|ALTER TABLE WeekProdCost/);
  assert.match(costApi, /WEEK_PROD_COST_YEAR_PROBE_SQL/);

  assert.match(fixClient, /action, force: false/);
  assert.match(modal, /runEditWithFixCycle/);
  assert.doesNotMatch(modal, /force:\s*true/);
  assert.doesNotMatch(stockPage, /postAdjustBatch\([^)]*force:\s*true/);
  assert.doesNotMatch(stockApi, /if \(!force/);
  assert.doesNotMatch(raum, /force:\s*true/);
  assert.doesNotMatch(pivot, /call\(true\)/);
  assert.match(paste, /force:\s*false/);
  assert.match(paste, /return handleAdjust\(true\)/, '붙여넣기 단건 조정은 서버 경고 뒤 사용자 확인 시에만 재고부족 override를 허용한다.');

  assert.doesNotMatch(adjustApi, /function normWeek/);
  assert.match(adjustApi, /requireOrderYear\(week, year \|\| body\.orderYear \|\| ''\)/);
  assert.match(adjustApi, /export async function executeShipmentAdjustmentInTransaction\(tQ,/);
  assert.match(adjustBatchPolicy, /entryScope\.orderYear !== batchScope\.orderYear/);
  assert.match(adjustBatchPolicy, /entryScope\.orderWeek !== batchScope\.orderWeek/);
  assert.match(raum, /week: a\.week, year: orderYear/);
  assert.match(raum, /week: s\.plusWeek, orderYear/);
  assert.match(distributePage, /selectedOrderYear/);
  assert.doesNotMatch(distributePage, /year:\s*new Date\(\)\.getFullYear/);
  assert.match(distributeApi, /requireOrderYear\(rawWeek, year \|\| ''\)/);
  assert.doesNotMatch(distributeApi, /row\.OrderYear \|\| new Date\(\)\.getFullYear/);
  assert.match(ordersApi, /requireOrderYear\(week \|\| '', year \|\| ''\)/);
  assert.doesNotMatch(ordersApi, /orderYear = v\.year \|\| year \|\| new Date/);
  assert.match(warehouseApi, /ORDER_YEAR_WEEK_REQUIRED/);
  assert.doesNotMatch(warehouseApi, /orderYear \|\| new Date\(\)\.getFullYear/);
  assert.match(remitApi, /송금 저장에는 화면의 선택 연도/);
  assert.doesNotMatch(remitApi, /year \|\| new Date\(\)\.getFullYear/);
  assert.match(ecountSalesApi, /전체 판매 전송에는 화면의 선택 연도/);
  assert.match(ecountSalesApi, /sm\.OrderYear=@orderYear/);
  assert.match(ecountDashboard, /orderYear: saleOrderYear/);
  assert.match(salesStatus, /orderYear: scopeYears\[0\]/);
  assert.match(costSyncApi, /ORDER_YEAR_REQUIRED/);
  assert.match(costSyncApi, /sm\.OrderYear = @orderYear/);
  assert.match(descrCleanupApi, /ORDER_YEAR_REQUIRED/);
  assert.match(descrCleanupApi, /sm\.OrderYear=@orderYear/);
  assert.match(mobileEstimate, /year=\$\{encodeURIComponent\(orderYear\)\}/);
  assert.match(bizContext, /recentOrderYear/);
  assert.match(bizContext, /yearScope\('om'\)/);

  for (const file of [
    'pages/api/estimate/update-quantity.js',
    'pages/api/estimate/update-date-quantity.js',
    'pages/api/estimate/update-entry.js',
  ]) {
    const source = read(file);
    assert.match(source, /requireErpWriteScope/);
    assert.match(source, /assertErpWriteScope/);
  }

  assert.match(estimatePage, /＋ 불량\/검역등록/);
  assert.match(estimatePage, /＋ 불량차감등록/);
  assert.match(estimatePage, /＋ 판매요청/);
  assert.match(estimatePage, /＋ 추가 품목등록/);
  assert.match(estimatePage, /openEstimateEntry\('legacy'\)/);
  assert.match(estimatePage, /options=\{estimateTypeOptions\}/);

  console.log('ERP edit/fix/cost full call-graph audit tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
