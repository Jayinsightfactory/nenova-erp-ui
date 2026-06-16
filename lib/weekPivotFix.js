// 차수피벗 확정 표시 — nenova.exe 와 동일: ShipmentDetail.isFix (출고라인 단위)

/** @param {object} row stock-status customers 행 */
export function isWeekPivotLineFixed(row) {
  return Number(row?.isFix || 0) === 1 && Number(row?.outQty || 0) > 0;
}

/** 품목×업체×차수 셀 확정 여부 */
export function isWeekPivotCellFixed(rows, prodKey, custKey, orderWeek) {
  const row = (rows || []).find(
    (r) => r.ProdKey === prodKey && r.CustKey === custKey && r.OrderWeek === orderWeek,
  );
  return isWeekPivotLineFixed(row);
}

/**
 * 차수 헤더 확정 상태 — 출고수량>0 인 ShipmentDetail 라인 기준
 * @returns {'empty'|'unfixed'|'fixed'|'partial'}
 */
export function weekPivotFixState(rows, orderWeek) {
  const wkRows = (rows || []).filter(
    (r) => r.OrderWeek === orderWeek && Number(r.outQty || 0) > 0,
  );
  if (wkRows.length === 0) return 'empty';
  const fixedCount = wkRows.filter(isWeekPivotLineFixed).length;
  if (fixedCount === 0) return 'unfixed';
  if (fixedCount === wkRows.length) return 'fixed';
  return 'partial';
}
