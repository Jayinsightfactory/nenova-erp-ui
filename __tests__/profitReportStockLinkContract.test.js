const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    REPORT_STOCK_ADJUSTMENT_POLICY,
    REPORT_STOCK_SELECTION,
    resolveProfitReportInventoryPeriods,
    selectLatestProductStockSnapshot,
  } = await import('../lib/profitReportStockPolicy.js');

  for (let major = 22; major <= 28; major += 1) {
    const periods = resolveProfitReportInventoryPeriods('2026', major);
    assert.deepEqual(periods.begin, { orderYear: '2026', major: String(major - 1).padStart(2, '0') });
    assert.deepEqual(periods.end, { orderYear: '2026', major: String(major).padStart(2, '0') });
  }

  const rows = [
    { orderYear: '2025', orderWeek: '27-04', isFix: 1, productStockCount: 500, stockKey: 900 },
    { orderYear: '2026', orderWeek: '27-1', isFix: 0, productStockCount: 100, stockKey: 101 },
    { orderYear: '2026', orderWeek: '27-02', isFix: 1, productStockCount: 90, stockKey: 102 },
    { orderYear: '2026', orderWeek: '27-02', isFix: 0, productStockCount: 110, stockKey: 103 },
    { orderYear: '2026', orderWeek: '27-03', isFix: 0, productStockCount: 200, stockKey: 104 },
    { orderYear: '2026', orderWeek: '27-04', isFix: 1, productStockCount: 0, stockKey: 105 },
  ];
  const selected = selectLatestProductStockSnapshot(rows, { orderYear: '2026', major: 27 });
  assert.equal(selected.stockKey, 104, 'isFix와 무관하게 현재연도의 마지막 ProductStock 세부차수를 사용해야 한다.');
  assert.equal(selectLatestProductStockSnapshot(rows, { orderYear: '2026', major: 28 }), null,
    'ProductStock 스냅샷이 없으면 전년도 행으로 fallback하면 안 된다.');

  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const selector = source.slice(source.indexOf('export async function latestStockSnapshotWeek'), source.indexOf('/** 재고단가표 편집용'));
  const snapshot = source.slice(source.indexOf('export async function stockSnapshotByCategory'), source.indexOf('/** 카테고리별 구매 통화'));
  const arrivalEvidence = source.slice(source.indexOf('export async function arrivalPriceEvidenceByProduct'), source.indexOf('// 입고 라인의 금액단위 수량'));
  assert.match(selector, /sm\.OrderYear=@yr/);
  assert.match(selector, /sm\.OrderWeek LIKE @pfx/);
  assert.doesNotMatch(selector, /sm\.isFix|smk\.isFix/);
  assert.match(selector, /TRY_CONVERT\(INT, SUBSTRING\(sm\.OrderWeek/);
  assert.match(selector, /EXISTS \(SELECT 1 FROM ProductStock ps WHERE ps\.StockKey=sm\.StockKey\)/);
  assert.doesNotMatch(snapshot, /StockHistory/, '재고조정 delta를 보고서에서 이중합산하면 안 된다.');
  assert.match(arrivalEvidence, /l\.OrderYear=@yr AND \$\{NORMALIZED_ORDER_WEEK_SQL\('l\.OrderWeek'\)\}=\$\{NORMALIZED_ORDER_WEEK_SQL\('@week'\)\}/);
  assert.match(arrivalEvidence, /l\.ProdKey/);
  assert.match(arrivalEvidence, /l\.IsCurrent=1 AND l\.MatchStatus=N'MATCHED'/);
  assert.match(arrivalEvidence, /h\.ActionType IN \(N'MATCH',N'BASIS_CHANGE'\)/);
  assert.match(arrivalEvidence, /SourceFileName/);
  assert.match(arrivalEvidence, /SheetName/);
  assert.match(arrivalEvidence, /SourceRow/);
  assert.match(arrivalEvidence, /l\.Unit.*p\.EstUnit/s);
  assert.doesNotMatch(arrivalEvidence, /Product\.Cost|p\.Cost|recent/i);
  assert.doesNotMatch(arrivalEvidence, /CREATE\s+TABLE|ALTER\s+TABLE/i);
  assert.match(snapshot, /arrivalPriceEvidenceByProduct\(orderYear, week\)/);
  const resolverSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportEvidence', 'sourceResolvers.mjs'), 'utf8');
  assert.match(resolverSource, /normalizeEvidenceOrderWeek/);
  assert.equal(REPORT_STOCK_SELECTION, 'latest_product_stock_subweek');
  assert.match(REPORT_STOCK_ADJUSTMENT_POLICY.included, /ProductStock 차수 스냅샷/);

  console.log('profit report stock link contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
