import { query, sql } from './db';
import { STOCK_ADJUSTMENT_NOTES_SQL, buildStockAdjustmentNotes } from './stockAdjustmentReportNotes';
import { colombiaImpactNotes, inventoryContinuityNotes, stockAdjustmentInlineNotes, valueStockAdjustmentRows } from './profitImpactNotes';
import { profitDisplayCalculation } from './profitReportStoredCalculation';
import { computeCustomsAndForwarding } from './customsForwarding';

export function adjacentProfitScopes(year, major, calendar) {
  const ordered = (calendar || []).filter(row => /^\d{4}(0[1-9]|[1-4]\d|5[0-3])$/.test(String(row.scope)))
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const index = ordered.findIndex(row => row.scope === `${year}${String(major).padStart(2, '0')}`);
  if (index < 0) return [null, null];
  return [ordered[index - 1], ordered[index + 1]].map((row, side) => {
    if (!row) return null;
    const a = side === 0 ? row.endDate : ordered[index].endDate;
    const b = side === 0 ? ordered[index].startDate : row.startDate;
    if (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`) !== 86400000) return null;
    return { year: row.scope.slice(0, 4), major: row.scope.slice(4) };
  });
}

// All reads. Adjacent periods must be saved/confirmed, never refreshed for notes.
export async function loadProfitImpactNotes(payload, loadStoredPeriod) {
  const year = String(payload.orderYear), major = String(payload.major).padStart(2, '0');
  const history = await query(STOCK_ADJUSTMENT_NOTES_SQL, {
    year: { type: sql.NVarChar, value: year }, major: { type: sql.NVarChar, value: major }, prefix: { type: sql.NVarChar, value: `${major}-%` },
  });
  const display = profitDisplayCalculation(payload);
  const notes = buildStockAdjustmentNotes(valueStockAdjustmentRows(history.recordset, payload, display.rows), { orderYear: year, major });
  let allocationPayload = payload;
  if (!payload.colombiaAllocationEvidence?.length && payload.rows?.some(row => String(row.category).startsWith('콜롬비아') && (row.calc?.S || row.auto?.S || row.calc?.Q || row.auto?.Q))) {
    const customs = await computeCustomsAndForwarding(major, year, { profile: 'profit-report' });
    allocationPayload = { ...payload, colombiaAllocationEvidence: customs.components?.colombiaWeeks || [], allocationEvidenceCurrent: true };
  }
  const calendar = await query(`SELECT CONVERT(nvarchar(6),OrderYearWeek) AS scope,
      CONVERT(char(10),MIN(TRY_CONVERT(date,BaseYmd)),23) AS startDate,
      CONVERT(char(10),MAX(TRY_CONVERT(date,BaseYmd)),23) AS endDate
    FROM PeriodDay WHERE LEFT(CONVERT(nvarchar(20),OrderYearWeek),4) IN (@previousYear,@year,@nextYear)
    GROUP BY CONVERT(nvarchar(6),OrderYearWeek)`, {
    previousYear: { type: sql.NVarChar, value: String(Number(year) - 1) }, year: { type: sql.NVarChar, value: year }, nextYear: { type: sql.NVarChar, value: String(Number(year) + 1) },
  });
  const adjacent = await Promise.all(adjacentProfitScopes(year, major, calendar.recordset).map(async scope => {
    if (!scope) return null;
    try { return await loadStoredPeriod(scope); } catch { return null; }
  }));
  return { ...notes, text: [colombiaImpactNotes(allocationPayload, display.rows),
    '[실제 재고조정 · 현재 원장 조회, 보고서 금액 미반영]',
    notes.count ? stockAdjustmentInlineNotes(notes.items) : '해당 차수 실제 조정 이력 없음',
    inventoryContinuityNotes({ ...payload, rows: display.rows }, ...adjacent),
  ].filter(Boolean).join('\n') };
}
