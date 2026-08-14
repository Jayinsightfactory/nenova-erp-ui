export const REPORT_STOCK_SELECTION = 'latest_product_stock_subweek';

export const REPORT_STOCK_ADJUSTMENT_POLICY = Object.freeze({
  source: 'ProductStock.Stock',
  included: 'usp_StockCalculation이 ProductStock 차수 스냅샷에 반영한 StockHistory 재고조정만 포함',
  forbidden: '보고서에서 StockHistory delta를 별도로 더하거나 입고-출고로 재추정하지 않음',
});

export function resolveProfitReportInventoryPeriods(orderYear, major) {
  const currentMajor = Number(major);
  if (!Number.isInteger(currentMajor) || currentMajor < 1 || currentMajor > 99) {
    throw new Error(`유효하지 않은 대차수: ${major}`);
  }
  const year = String(orderYear);
  return {
    begin: currentMajor === 1
      ? { orderYear: String(Number(year) - 1), major: '52' }
      : { orderYear: year, major: String(currentMajor - 1).padStart(2, '0') },
    end: { orderYear: year, major: String(currentMajor).padStart(2, '0') },
  };
}

export function selectLatestProductStockSnapshot(rows, { orderYear, major }) {
  const targetYear = String(orderYear);
  const targetMajor = Number(major);
  return (rows || [])
    .filter((row) => {
      const match = String(row.orderWeek || '').match(/^(\d{1,2})-(\d{1,2})$/);
      return String(row.orderYear) === targetYear
        && Number(match?.[1]) === targetMajor
        && Number(row.productStockCount) > 0;
    })
    .sort((a, b) => {
      const subweek = Number(String(b.orderWeek).split('-')[1]) - Number(String(a.orderWeek).split('-')[1]);
      if (subweek) return subweek;
      const rowCount = Number(b.productStockCount) - Number(a.productStockCount);
      if (rowCount) return rowCount;
      return Number(b.stockKey) - Number(a.stockKey);
    })[0] || null;
}

// 기존 테스트/호출부 호환용 별칭. StockMaster.isFix는 EXE 재고 마감 기준이 아니다.
export const selectLatestFixedStockSnapshot = selectLatestProductStockSnapshot;
