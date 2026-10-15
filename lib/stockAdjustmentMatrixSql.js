import { stockAdjustmentHistorySql } from './stockAdjustmentReportNotes.js';
import { buildStockAdjustmentMatrix } from './stockAdjustmentMatrix.js';

export const STOCK_ADJUSTMENT_MATRIX_SQL = stockAdjustmentHistorySql({ annual: true });
export const STOCK_ADJUSTMENT_PERIODS_SQL = `SELECT DISTINCT sm.OrderWeek AS orderWeek
FROM StockMaster sm WHERE sm.OrderYear=@year
AND EXISTS(SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)`;

export function parseStockAdjustmentMatrixScope(input = {}) {
  const { year, major = '', search = '', format = '' } = input;
  if (typeof year !== 'string' || !/^\d{4}$/.test(year) || Number(year) === 0) return null;
  if (typeof major !== 'string' || major !== '' && (!/^\d{1,2}$/.test(major) || Number(major) < 1 || Number(major) > 53)) return null;
  if (typeof search !== 'string' || search.length > 100 || typeof format !== 'string' || !['', 'xlsx'].includes(format)) return null;
  return { orderYear: year, major: major === '' ? '' : String(Number(major)).padStart(2,'0'), search: search.trim(), format };
}

export async function loadStockAdjustmentMatrix({ query, sql }, scope) {
  const params = { year: { type: sql.NVarChar, value: scope.orderYear } };
  const [history, periods] = await Promise.all([
    query(STOCK_ADJUSTMENT_MATRIX_SQL, params), query(STOCK_ADJUSTMENT_PERIODS_SQL, params),
  ]);
  if (!Array.isArray(history.recordset) || !Array.isArray(periods.recordset)) throw Error('재고조정 조회 결과를 확인할 수 없습니다.');
  return buildStockAdjustmentMatrix(history.recordset, scope, periods.recordset.map(row => row.orderWeek));
}
