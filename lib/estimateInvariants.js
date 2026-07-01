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

/** Estimate 전용 행(SdetailKey=null) 또는 EstimateType≠정상출고 — 불량·검역·단가차감 등 */
export function isEstimateDeductionRow(row) {
  if (row?.SdetailKey == null && row?.EstimateKey != null) return true;
  const t = String(row?.EstimateType || '').trim();
  return !!(t && t !== '정상출고');
}

export function hasPrintableEstimateQuantity(row) {
  const qty = Number(row?.Quantity) || 0;
  return qty !== 0;
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

/** nenova.exe FormPrintEstimate — 정상·차감 공통: 수량 0 행은 품목·단가·금액 모두 미출력 */
export function isPrintableEstimateRow(row) {
  return hasPrintableEstimateQuantity(row);
}

/** ShipmentDetail/Estimate Descr — 수량변동·단가변경 등 운영 로그(인쇄 제외) */
export function isOperationalEstimateDescr(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/수량\s*변동|분배\s*변동|붙여\s*넣기|단가\s*변경|차감\s*단가|차감\s*수량/i.test(s)) return true;
  if (/차감단가|차감수량/i.test(s)) return true;
  if (/\[\d{4}-\d{2}-\d{2}/.test(s)) return true;
  // 전산/웹 비고 요약: "임16>12" 또는 "임16>12,임12>14"
  if (/^[\u3131-\u318E\uAC00-\uD7A3a-zA-Z]{1,8}\d+(?:\.\d+)?>\d+(?:\.\d+)?(?:,[\u3131-\u318E\uAC00-\uD7A3a-zA-Z]{1,8}\d+(?:\.\d+)?>\d+(?:\.\d+)?)*$/.test(s)) {
    return true;
  }
  return false;
}

function splitDescrTokens(text) {
  return String(text || '').split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
}

/** ShipmentDetail.Descr + ShipmentDate.Descr 등 여러 소스 병합 (byDate 조회 시 출고일 비고가 분배 비고를 가리지 않게) */
export function mergeEstimateDescrRaw(...sources) {
  const parts = [];
  const seen = new Set();
  for (const src of sources) {
    for (const p of splitDescrTokens(src)) {
      if (!seen.has(p)) {
        seen.add(p);
        parts.push(p);
      }
    }
  }
  return parts.join(',');
}

/** DB SqlClient 감사 줄 등 인쇄·화면에서만 제외 */
function isSqlAuditDescrLine(text) {
  return /\[\d{4}-\d{2}-\d{2}.*(?:SqlClient|Data Provider)/i.test(String(text || ''));
}

/**
 * 차감(Estimate) 행 비고 — nenova.exe 견적서 관리·인쇄와 동일하게 Estimate.Descr 표시.
 * (단가차감·불량차감·검역차감 사용자 입력·차감내역 포함, SqlClient 감사줄만 제외)
 */
export function formatEstimateDeductionDescr(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const parts = splitDescrTokens(raw).filter((p) => !isSqlAuditDescrLine(p));
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0];
  return parts.join(', ');
}

/** 견적 행 1건 — 화면·API·인쇄 공통 비고 */
export function formatEstimateDescrForRow(row) {
  const raw = String(row?.DescrRaw ?? row?.Descr ?? '').trim();
  if (!raw) return '';
  if (isEstimateDeductionRow(row)) return formatEstimateDeductionDescr(raw);
  return sanitizeDescrTextForPrint(raw);
}

/** 여러 줄/콤마 혼합 비고에서 인쇄용 메모만 남김 (운영 로그 라인 제거) — 정상출고 전용 */
export function sanitizeDescrTextForPrint(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const parts = splitDescrTokens(raw);
  if (parts.length <= 1) {
    return isOperationalEstimateDescr(raw) ? '' : raw;
  }
  const kept = parts.filter((p) => !isOperationalEstimateDescr(p));
  return kept.join(', ');
}

/** 견적서 인쇄 적요 — 차감=Estimate.Descr(없으면 N일), 정상=사용자 비고(운영로그 제외) */
export function formatEstimatePrintDescr(row, { showDistribDesc = false } = {}) {
  if (isEstimateDeductionRow(row)) {
    const memo = formatEstimateDeductionDescr(row?.DescrRaw ?? row?.Descr);
    if (memo) return memo;
    const m = String(row?.outDate || row?.EstimateDtm || '').match(/^\d{4}-\d{2}-(\d{2})/);
    return m ? `${parseInt(m[1], 10)}일` : '';
  }
  if (showDistribDesc && row?._distribDesc) return row._distribDesc;
  return sanitizeDescrTextForPrint(row?.DescrRaw ?? row?.Descr);
}

/** 화면 비고 — 정상출고는 운영 로그 숨김, 차감은 EXE와 동일하게 Estimate.Descr */
export function sanitizeEstimateDescrForDisplay(row) {
  return formatEstimateDescrForRow(row);
}

/** API·화면·인쇄 공통 — 수량 0(정상·차감) 및 OutQuantity=0 유령행 제외 */
export function isActiveEstimateShipmentRow(row) {
  if (isEstimateDeductionRow(row)) {
    return hasPrintableEstimateQuantity(row);
  }
  if (row?.RawOutQuantity != null || row?.OutQuantity != null) {
    const outQty = Number(row?.RawOutQuantity ?? row?.OutQuantity) || 0;
    if (outQty === 0) return false;
  }
  return hasPrintableEstimateQuantity(row);
}

export function filterActiveEstimateShipmentRows(rows) {
  return (rows || []).filter(isActiveEstimateShipmentRow);
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
  const mapped = (rows || []).map((row) => {
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
  return filterActiveEstimateShipmentRows(mapped);
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
