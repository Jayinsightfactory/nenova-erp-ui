// 견적서/출고일 분배 불변조건 — 단위테스트·런타임 검증 공용
import { distributeUnits, amountVatFromCostEst } from './distributeUnits.js';

export const DAY_KR = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEKDAY_MAP = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6, 일: 0 };

/** YYYY-MM-DD → 로컬 요일(0=일). UTC 파싱 버그 방지 */
export function weekdayFromYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return -1;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}

export function weekdayKrFromYmd(ymd) {
  const d = weekdayFromYmd(ymd);
  return d >= 0 ? DAY_KR[d] : '';
}

export function isEstimateDeductionRow(row) {
  const t = row?.EstimateType;
  return !!(t && t !== '정상출고');
}

/** nenova 견적 요일필터 — 정상출고만 요일 적용, 차감/불량차감은 항상 포함 */
export function filterItemsByWeekday(items, activeWdSet) {
  const active = activeWdSet instanceof Set ? activeWdSet : new Set(activeWdSet || []);
  if (active.size === 7) return [...(items || [])];
  if (active.size === 0) return [];
  return (items || []).filter((item) => {
    if (isEstimateDeductionRow(item)) return true;
    if (!item?.outDate) return false;
    const dow = weekdayFromYmd(item.outDate);
    return dow >= 0 && [...active].some((wd) => WEEKDAY_MAP[wd] === dow);
  });
}

export function isPrintableEstimateRow(row) {
  if (isEstimateDeductionRow(row)) return true;
  const qty = Number(row?.Quantity) || 0;
  const money = (Number(row?.Amount) || 0) + (Number(row?.Vat) || 0);
  return qty !== 0 || money !== 0;
}

/** 인쇄/미리보기 대상 — 요일필터 + 종합/선출고 구분 */
export function filterPrintTargetItems(items, activeWdSet, outType = 'total') {
  let rows = filterItemsByWeekday(items, activeWdSet);
  rows = rows.filter(isPrintableEstimateRow);
  if (outType === 'select') {
    rows = rows.filter((row) => !isEstimateDeductionRow(row));
  }
  return rows;
}

/** 인쇄 HTML 합산 키 — 출고일이 다르면 병합 금지 */
export function estimateAggregateKey(row) {
  const costKey = Number(row?.Cost || 0).toFixed(4);
  return `${row?.EstimateType || '정상출고'}|${row?.ProdKey || row?.ProdName}|${row?.Unit || ''}|${costKey}|${row?.outDate || ''}`;
}

/** 단가×수량 = 공급가+부가세 (nenova Cost=부가세포함단가) */
export function checkCostQtyInvariant(row, tol = 2) {
  const qty = Number(row?.Quantity) || 0;
  const cost = Number(row?.Cost) || 0;
  const amt = Number(row?.Amount) || 0;
  const vat = Number(row?.Vat) || 0;
  if (qty === 0) return { ok: true, skip: true };
  const expected = cost * qty;
  const actual = amt + vat;
  const diff = Math.abs(expected - actual);
  return { ok: diff <= tol, diff, expected, actual, qty, cost };
}

/**
 * byDate 분할 행들이 Detail 총 EstQuantity·Amount·Vat 와 일치하는지 검증.
 * rows: 동일 SdetailKey 의 byDate 행 배열, detail: ShipmentDetail 원본 합계
 */
export function checkSplitSumInvariant(rows, detail, tol = 2) {
  const sumQty = rows.reduce((s, r) => s + (Number(r.Quantity) || 0), 0);
  const sumAmt = rows.reduce((s, r) => s + (Number(r.Amount) || 0), 0);
  const sumVat = rows.reduce((s, r) => s + (Number(r.Vat) || 0), 0);
  const expQty = Number(detail?.EstQuantity ?? detail?.Quantity) || 0;
  const expAmt = Number(detail?.Amount) || 0;
  const expVat = Number(detail?.Vat) || 0;
  const qtyOk = Math.abs(sumQty - expQty) <= 1; // ROUND 분할 1 단위 오차 허용
  const amtOk = Math.abs(sumAmt - expAmt) <= tol;
  const vatOk = Math.abs(sumVat - expVat) <= tol;
  return {
    ok: qtyOk && amtOk && vatOk,
    sumQty, expQty, sumAmt, expAmt, sumVat, expVat,
    qtyOk, amtOk, vatOk,
  };
}

/**
 * nenova FormEstimateView.GetDetail 과 동일: 출고일별 ShipmentQuantity(OutUnit) → EstQuantity.
 * Detail 총 Est × 비율 배분은 박스 품목(수국 화이트 등)에서 190박스 전량 표시 버그 유발.
 */
/** byDate=1 API: 정상출고만 ShipmentDate.ShipmentQuantity → EstQuantity 재산출. 차감 행은 DB 수량 유지 */
export function applyByDateRowQuantities(rows) {
  return (rows || []).map((row) => {
    if (isEstimateDeductionRow(row)) return row;
    if (row?.DateShipQty == null) return row;
    const dateQty = Number(row.DateShipQty);
    if (!Number.isFinite(dateQty)) return row;
    const units = distributeUnits(dateQty, {
      OutUnit: row.OutUnit,
      EstUnit: row.EstUnit,
      BunchOf1Box: row.BunchOf1Box,
      SteamOf1Bunch: row.SteamOf1Bunch,
      SteamOf1Box: row.SteamOf1Box,
    });
    const cost = Number(row.Cost) || 0;
    const { amount, vat } = amountVatFromCostEst(cost, units.estQty);
    const estUnit = row.EstUnit || row.Unit;
    return {
      ...row,
      Unit: estUnit,
      Quantity: units.estQty,
      BoxQty: units.box,
      Amount: amount,
      Vat: vat,
      RawBunchQuantity: units.bunch,
      RawSteamQuantity: units.steam,
      RawBoxQuantity: units.box,
    };
  });
}

export function splitEstByDistributeUnits(dateRows, product, cost = 0) {
  return (dateRows || []).map((r) => {
    const shipQty = Number(r.ShipmentQuantity ?? r.DateShipQty) || 0;
    const units = distributeUnits(shipQty, product);
    const { amount, vat } = amountVatFromCostEst(cost, units.estQty);
    return {
      ...r,
      expQty: units.estQty,
      expBox: units.box,
      expAmount: amount,
      expVat: vat,
    };
  });
}

/** @deprecated 박스 품목에서 오류 — splitEstByDistributeUnits 사용 */
export function splitEstByShipQty(totalEst, dateRows) {
  const sumShip = dateRows.reduce((s, r) => s + (Number(r.ShipmentQuantity) || 0), 0);
  if (sumShip <= 0) {
    const n = dateRows.length || 1;
    return dateRows.map((r) => ({
      ...r,
      expQty: Math.round((Number(totalEst) || 0) / n),
    }));
  }
  return dateRows.map((r) => ({
    ...r,
    expQty: Math.round((Number(totalEst) || 0) * (Number(r.ShipmentQuantity) || 0) / sumShip),
  }));
}
