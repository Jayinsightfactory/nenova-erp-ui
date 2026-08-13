const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    REPORT_STOCK_ADJUSTMENT_POLICY,
    REPORT_STOCK_SELECTION,
    resolveProfitReportInventoryPeriods,
    selectLatestFixedStockSnapshot,
  } = await import('../lib/profitReportStockPolicy.js');

  for (let major = 22; major <= 28; major += 1) {
    const periods = resolveProfitReportInventoryPeriods('2026', major);
    assert.deepEqual(periods.begin, { orderYear: '2026', major: String(major - 1).padStart(2, '0') });
    assert.deepEqual(periods.end, { orderYear: '2026', major: String(major).padStart(2, '0') });
  }

  const rows = [
    { orderYear: '2025', orderWeek: '27-04', isFix: 1, productStockCount: 500, stockKey: 900 },
    { orderYear: '2026', orderWeek: '27-01', isFix: 1, productStockCount: 100, stockKey: 101 },
    { orderYear: '2026', orderWeek: '27-02', isFix: 1, productStockCount: 90, stockKey: 102 },
    { orderYear: '2026', orderWeek: '27-02', isFix: 1, productStockCount: 110, stockKey: 103 },
    { orderYear: '2026', orderWeek: '27-03', isFix: 0, productStockCount: 200, stockKey: 104 },
    { orderYear: '2026', orderWeek: '27-04', isFix: 2, productStockCount: 200, stockKey: 105 },
  ];
  const selected = selectLatestFixedStockSnapshot(rows, { orderYear: '2026', major: 27 });
  assert.equal(selected.stockKey, 103, '현재연도의 마지막 확정 세부차수와 중복 tie-break를 사용해야 한다.');
  assert.equal(selectLatestFixedStockSnapshot(rows, { orderYear: '2026', major: 28 }), null,
    '확정 스냅샷이 없으면 전년도/미확정 행으로 fallback하면 안 된다.');

  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const selector = source.slice(source.indexOf('export async function latestStockSnapshotWeek'), source.indexOf('/** 재고단가표 편집용'));
  const snapshot = source.slice(source.indexOf('export async function stockSnapshotByCategory'), source.indexOf('/** 카테고리별 구매 통화'));
  assert.match(selector, /sm\.OrderYear=@yr/);
  assert.match(selector, /sm\.OrderWeek LIKE @pfx/);
  assert.match(selector, /ISNULL\(sm\.isFix,0\)=1/);
  assert.match(selector, /EXISTS \(SELECT 1 FROM ProductStock ps WHERE ps\.StockKey=sm\.StockKey\)/);
  assert.doesNotMatch(snapshot, /StockHistory/, '재고조정 delta를 보고서에서 이중합산하면 안 된다.');
  assert.equal(REPORT_STOCK_SELECTION, 'latest_fixed_stock_subweek');
  assert.match(REPORT_STOCK_ADJUSTMENT_POLICY.included, /확정 스냅샷/);

  console.log('profit report stock link contract tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
