/**
 * nenova.exe 공통 조회 헬퍼 (CommonLogic.cs parity)
 */
export function normalizeOrderYearWeek2(orderYearWeek) {
  return String(orderYearWeek || '').replace(/-/g, '');
}

/** PeriodDay.BaseYmd → OrderYearWeek (FormSalesDefectView 등) */
export async function resolveOrderYearWeekFromBaseYmd(dbQuery, sql, baseYmd) {
  const r = await dbQuery(
    `SELECT TOP 1 OrderYearWeek FROM PeriodDay WHERE BaseYmd = @d`,
    { d: { type: sql.Date, value: new Date(baseYmd) } }
  );
  return r.recordset[0]?.OrderYearWeek ? String(r.recordset[0].OrderYearWeek) : null;
}

/** LogicManager.Common.GetBeforeOrderYearWeek */
export async function resolveBeforeOrderYearWeek(dbQuery, sql, orderYearWeek) {
  const oyw = normalizeOrderYearWeek2(orderYearWeek);
  const r = await dbQuery(
    `SELECT TOP 1 OrderYearWeek
       FROM StockMaster
      WHERE OrderYearWeek < @oyw
      ORDER BY OrderYearWeek DESC, OrderWeek DESC`,
    { oyw: { type: sql.NVarChar, value: oyw } }
  );
  return r.recordset[0]?.OrderYearWeek ? String(r.recordset[0].OrderYearWeek) : null;
}

/** lueOrderWeek "2026" + "26-01" → OrderYear, OrderWeek parts */
export function splitOrderYearWeekEditValue(editValue) {
  const s = String(editValue || '');
  const orderYear = s.substring(0, 4);
  const orderWeek = s.replace(orderYear, '');
  return { orderYear, orderWeek };
}

export function useExeParityFlag(raw) {
  return raw !== '0' && raw !== 'false';
}
