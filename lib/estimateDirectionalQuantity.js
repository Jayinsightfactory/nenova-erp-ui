import { calculateShipmentAvailability, hasInsufficientShipmentStock, normalizeShipmentQty } from './shipmentAvailability.js';

// Shipment quantity is rounded to three decimal places.  0.001 is therefore a
// real physical quantity, not floating-point noise.
export const DIRECTIONAL_QTY_EPSILON = 0.0000001;

export function directionalQuantityError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function sameQuantity(left, right) {
  return Math.abs(normalizeShipmentQty(left) - normalizeShipmentQty(right)) <= DIRECTIONAL_QTY_EPSILON;
}

function knownFixFlag(value) {
  return value === true || value === false || value === 0 || value === 1;
}

/**
 * Converts server-locked date changes into per ShipmentDetail facts.  The
 * client never supplies the direction or confirmation state.
 */
export function buildDirectionalQuantityPlan({ changes = [], lockedBaselines = [] } = {}) {
  const baselineByDetail = new Map((lockedBaselines || []).map((baseline) => [
    Number(baseline.SdetailKey), baseline,
  ]));
  const groups = new Map();

  for (const change of changes || []) {
    const row = change?.row || {};
    const sdetailKey = Number(row.SdetailKey);
    if (!Number.isInteger(sdetailKey) || sdetailKey <= 0) {
      throw directionalQuantityError('DIRECTIONAL_BASELINE_INVALID', '잠긴 출고분배 기준 행이 올바르지 않습니다.');
    }
    if (!knownFixFlag(row.DetailIsFix) || !knownFixFlag(row.MasterIsFix)) {
      throw directionalQuantityError('FIX_STATUS_INVALID', `SdetailKey=${sdetailKey}의 확정 상태를 판정할 수 없습니다.`);
    }
    if (!groups.has(sdetailKey)) groups.set(sdetailKey, {
      row,
      changes: [],
      oldDetailOutQuantity: normalizeShipmentQty(row.DetailOutQuantity),
      newDetailOutQuantity: normalizeShipmentQty(row.DetailOutQuantity),
      fixed: row.DetailIsFix === true || row.DetailIsFix === 1,
    });
    const group = groups.get(sdetailKey);
    group.changes.push(change);
    group.newDetailOutQuantity = normalizeShipmentQty(
      group.newDetailOutQuantity
      + normalizeShipmentQty(change.newDateOutQuantity)
      - normalizeShipmentQty(row.DateShipmentQuantity),
    );
  }

  const plan = [];
  for (const group of groups.values()) {
    const baseline = baselineByDetail.get(Number(group.row.SdetailKey));
    if (!baseline) {
      throw directionalQuantityError('DIRECTIONAL_BASELINE_INVALID', `SdetailKey=${group.row.SdetailKey}의 날짜별 기준 합계를 잠그지 못했습니다.`);
    }
    const baselineOut = normalizeShipmentQty(baseline.DateOutTotal);
    const baselineCount = Number(baseline.DateCount || 0);
    if (group.fixed && (
      group.oldDetailOutQuantity <= DIRECTIONAL_QTY_EPSILON
      || baselineCount <= 0
      || !sameQuantity(baselineOut, group.oldDetailOutQuantity)
    )) {
      throw directionalQuantityError(
        'FIXED_BASELINE_INVALID',
        `SdetailKey=${group.row.SdetailKey}의 확정 출고 기준(총량/출고일)이 완전하지 않습니다. 저장하지 않았습니다.`,
      );
    }
    if (group.newDetailOutQuantity < -DIRECTIONAL_QTY_EPSILON) {
      throw directionalQuantityError('DIRECTIONAL_QUANTITY_INVALID', `SdetailKey=${group.row.SdetailKey}의 출고일 수량이 전체 출고수량을 초과합니다.`);
    }
    group.newDetailOutQuantity = group.newDetailOutQuantity <= DIRECTIONAL_QTY_EPSILON ? 0 : group.newDetailOutQuantity;
    group.confirmedDelta = normalizeShipmentQty(group.newDetailOutQuantity - group.oldDetailOutQuantity);
    group.actualIncrease = group.confirmedDelta > DIRECTIONAL_QTY_EPSILON;
    group.actualDecrease = group.confirmedDelta < -DIRECTIONAL_QTY_EPSILON;
    plan.push(group);
  }

  return plan;
}

/** Positive deltas stay separate so a decrease cannot conceal an increase. */
export function positiveIncreaseByProduct(plan = []) {
  const increases = new Map();
  for (const group of plan) {
    if (!group.actualIncrease) continue;
    const prodKey = Number(group.row?.ProdKey);
    const orderYear = String(group.row?.OrderYear || '');
    const orderWeek = String(group.row?.OrderWeek || '');
    if (!Number.isInteger(prodKey) || prodKey <= 0) {
      throw directionalQuantityError('DIRECTIONAL_PRODUCT_INVALID', '품목 기준키가 올바르지 않습니다.');
    }
    if (!/^\d{4}$/.test(orderYear) || !/^\d{2}-\d{2}$/.test(orderWeek)) {
      throw directionalQuantityError('DIRECTIONAL_SCOPE_INVALID', '증가분 재고검증 차수 범위가 올바르지 않습니다.');
    }
    const key = `${orderYear}|${orderWeek}|${prodKey}`;
    const previous = increases.get(key);
    const next = {
      orderYear,
      orderWeek,
      prodKey,
      increase: normalizeShipmentQty((previous?.increase || 0) + group.confirmedDelta),
    };
    const prodName = String(group.row?.ProdName || previous?.prodName || '').trim();
    const countryFlower = String(group.row?.CountryFlower || previous?.countryFlower || '').trim();
    if (prodName) next.prodName = prodName;
    if (countryFlower) next.countryFlower = countryFlower;
    increases.set(key, next);
  }
  return increases;
}

export function formatDirectionalProductLabel(scope = {}) {
  const prodKey = Number(scope.prodKey || 0);
  const prodName = String(scope.prodName || '').trim();
  const countryFlower = String(scope.countryFlower || '').trim();
  const readable = [countryFlower, prodName]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' · ');
  if (readable && prodKey > 0) return `${readable} (#${prodKey})`;
  if (readable) return readable;
  return prodKey > 0 ? `품목키 #${prodKey}` : '품목명 미확인';
}

export function fixedDirectionalChanges(plan = []) {
  return plan.filter((group) => group.fixed && Math.abs(Number(group.confirmedDelta || 0)) > DIRECTIONAL_QTY_EPSILON);
}

/**
 * Web quantity edits use a three-decimal shortage guard.  This intentionally
 * rejects a negative fractional box that native integer rounding can display as
 * zero.  `facts.totalOut` must be every active ViewShipment baseline quantity.
 */
export function evaluateDirectionalAvailability({ facts = {}, increase = 0, scope = {} } = {}) {
  const normalizedIncrease = normalizeShipmentQty(increase);
  const availability = calculateShipmentAvailability({
    ...facts,
    totalOut: normalizeShipmentQty(facts.totalOut) + normalizedIncrease,
  });
  const result = {
    ...scope,
    available: availability.available,
    increase: normalizedIncrease,
    remain: availability.remainAfter,
  };
  if (hasInsufficientShipmentStock(availability.remainAfter)) {
    const productLabel = formatDirectionalProductLabel(scope);
    const error = directionalQuantityError(
      'STOCK_SHORTAGE',
      `품목 ${productLabel} · 가용재고=${availability.available}, 증가=${normalizedIncrease}, 반영후 잔량=${availability.remainAfter}입니다.`,
    );
    error.stockValidation = { availability: [{ ...result, productLabel }], postNative: [] };
    throw error;
  }
  return result;
}

export function assertDirectionalPlanYears(plan = []) {
  for (const group of plan) {
    if (Math.abs(Number(group.confirmedDelta || 0)) <= DIRECTIONAL_QTY_EPSILON) continue;
    if (Number(group.row?.OrderYear) <= 2025) {
      throw directionalQuantityError('DIRECTIONAL_YEAR_INVALID', '2025년 이하 출고는 이 경로로 수정할 수 없습니다.');
    }
  }
}

/** Server-row comparison for the browser's optimistic snapshot. */
export function assertDirectionalDateSnapshot(row = {}, expected = {}) {
  if (expected.expectedOldQuantity != null
    && Math.round(Number(row.DateEstQuantity || 0)) !== Math.round(Number(expected.expectedOldQuantity))) {
    const error = directionalQuantityError('STALE_DATA', `출고일 견적수량이 조회 이후 변경되었습니다. SdateKey=${expected.sdateKey}`, 409);
    error.expected = expected.expectedOldQuantity;
    error.actual = row.DateEstQuantity;
    throw error;
  }
  if (expected.expectedOldDescr != null && String(row.DateDescr || '') !== String(expected.expectedOldDescr)) {
    const error = directionalQuantityError('STALE_DATA', `출고일 비고가 조회 이후 변경되었습니다. SdateKey=${expected.sdateKey}`, 409);
    error.expected = expected.expectedOldDescr;
    error.actual = String(row.DateDescr || '');
    throw error;
  }
  if (expected.expectedOldCost != null && Number(row.DateCost ?? 0) !== Number(expected.expectedOldCost)) {
    const error = directionalQuantityError('STALE_DATA', `출고일 단가가 조회 이후 변경되었습니다. SdateKey=${expected.sdateKey}`, 409);
    error.expected = expected.expectedOldCost;
    error.actual = row.DateCost;
    throw error;
  }
}

export async function assertDirectionalGateCapability(tQ) {
  let result;
  try {
    result = await tQ('EXEC dbo.usp_NenovaStockWeekGateCapability;');
  } catch (cause) {
    const error = directionalQuantityError(
      'STOCK_GATE_CAPABILITY_REQUIRED',
      '재고 게이트 소유권 V2가 준비되지 않아 수량 변경을 저장하지 않았습니다.',
      503,
    );
    error.cause = cause;
    throw error;
  }
  const row = result?.recordset?.[0] || {};
  if (Number(row.ProtocolVersion) !== 2 || Number(row.IsReady) !== 1) {
    throw directionalQuantityError(
      'STOCK_GATE_CAPABILITY_REQUIRED',
      '재고 게이트 소유권 V2가 준비되지 않아 수량 변경을 저장하지 않았습니다.',
      503,
    );
  }
  return row;
}

/** Hold the singleton in the caller transaction; never alter or clear its owner fields. */
export async function lockDirectionalGate(tQ) {
  let result;
  try {
    result = await tQ(
      `SELECT GateKey
         FROM dbo.NenovaStockWeekGate WITH (UPDLOCK, HOLDLOCK, NOWAIT)
        WHERE GateKey='1' AND ProtocolVersion=2 AND Mode IS NULL
          AND PendingCalc=0 AND OwnerSessionID IS NULL AND OwnerToken IS NULL`,
    );
  } catch (cause) {
    const error = directionalQuantityError('STOCK_GATE_BUSY', '재고 계산이 진행 중입니다. 잠시 후 다시 저장하세요.');
    error.cause = cause;
    throw error;
  }
  if (Number(result?.recordset?.length || 0) !== 1) {
    throw directionalQuantityError('STOCK_GATE_BUSY', '재고 계산 대기 작업이 있어 수량 변경을 저장하지 않았습니다.');
  }
}

export function assertNativeResult(result, label = '재고 계산') {
  const row = result?.recordset?.[0] || {};
  if (!Object.prototype.hasOwnProperty.call(row, 'returnCode') || row.returnCode == null || Number(row.returnCode) !== 0) {
    throw directionalQuantityError('STOCK_CALC_FAILED', `${label} 저장 프로시저 반환값이 실패입니다. ${row.message || ''}`.trim(), 500);
  }
  if (!Object.prototype.hasOwnProperty.call(row, 'result') || row.result == null || Number(row.result) !== 0) {
    throw directionalQuantityError('STOCK_CALC_FAILED', `${label}에 실패했습니다. ${row.message || ''}`.trim(), 500);
  }
  if (!Object.prototype.hasOwnProperty.call(row, 'TransactionState') || row.TransactionState == null || Number(row.TransactionState) !== 1) {
    throw directionalQuantityError('STOCK_CALC_TRANSACTION_ABORTED', `${label} 중 트랜잭션이 종료되어 전체 변경을 되돌렸습니다.`, 500);
  }
}
