/**
 * FormSalesDefectView.GetData — exe parity 데이터 로더
 */
import {
  sqlSalesDefectDefectPivot,
  sqlSalesDefectDefectSummary,
  sqlSalesDefectOrderYearWeekFromDate,
  sqlSalesDefectProfitPivot,
  sqlSalesDefectProfitSummary,
  sqlSalesDefectWeeklyTrend,
} from '../exeSalesDefectViewSql.js';
import { resolveOrderYearWeekFromBaseYmd } from './common.js';

export async function loadSalesDefectViewData(dbQuery, sql, searchDate) {
  const base = searchDate ? new Date(searchDate) : new Date();
  const week1 = await resolveOrderYearWeekFromBaseYmd(dbQuery, sql, base);
  const prev = new Date(base);
  prev.setDate(prev.getDate() - 7);
  const week2 = await resolveOrderYearWeekFromBaseYmd(dbQuery, sql, prev);

  if (!week1) {
    return { week1: null, week2: null, profit: [], profitPivot: [], defect: [], defectPivot: [], trend: [] };
  }

  const wk = {
    week1: { type: sql.NVarChar, value: week1 },
    week2: { type: sql.NVarChar, value: week2 || week1 },
  };

  const [profit, profitPivot, defect, defectPivot, trend] = await Promise.all([
    dbQuery(sqlSalesDefectProfitSummary(), wk),
    dbQuery(sqlSalesDefectProfitPivot(), { week1: wk.week1 }),
    dbQuery(sqlSalesDefectDefectSummary(), wk),
    dbQuery(sqlSalesDefectDefectPivot(), { week1: wk.week1 }),
    dbQuery(sqlSalesDefectWeeklyTrend(String(base.getFullYear())), {}),
  ]);

  return {
    week1,
    week2: week2 || week1,
    profit: profit.recordset,
    profitPivot: profitPivot.recordset,
    defect: defect.recordset,
    defectPivot: defectPivot.recordset,
    trend: trend.recordset,
  };
}

export { sqlSalesDefectOrderYearWeekFromDate };
