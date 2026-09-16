// 내 업체 주문등록 POST 전용 순수 정책.
// FormOrderAdd: 변경된 행만 절대수량으로 저장하고, 출고가 있는 0 주문은 허용하지 않는다.

export const MY_CUSTOMER_ORDER_MODE = Object.freeze({
  ADD: 'ADD',
  REPLACE: 'REPLACE',
  FINAL_SNAPSHOT: 'FINAL_SNAPSHOT',
});

export function isMyCustomerOrderSource(source) {
  return ['my-customer', 'sales-paste', 'order-import-final'].includes(String(source || '').trim().toLowerCase());
}

export function isFinalSnapshotOrderSource(source) {
  return String(source || '').trim().toLowerCase() === 'order-import-final';
}

export function isAbsoluteOrderMode(orderMode) {
  const mode = String(orderMode || '').trim().toUpperCase();
  return mode === MY_CUSTOMER_ORDER_MODE.REPLACE || mode === MY_CUSTOMER_ORDER_MODE.FINAL_SNAPSHOT;
}

function policyError(message, code = 'MY_CUSTOMER_ORDER_INVALID') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function requiredFiniteNumber(value, label) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw policyError(`${label}은(는) 숫자 또는 숫자 문자열이어야 합니다.`);
  }
  if (value === '' || (typeof value === 'string' && !value.trim())) {
    throw policyError(`${label}은(는) 빈 값일 수 없습니다.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw policyError(`${label}은(는) 유한한 숫자여야 합니다.`);
  return number;
}

/** source/my-customer 입력을 DB 접근 전 완전히 검증한다. */
export function validateMyCustomerOrderWriteRequest({ source, orderMode, items } = {}) {
  const mine = isMyCustomerOrderSource(source);
  const finalSnapshot = isFinalSnapshotOrderSource(source);
  const requestedMode = orderMode == null ? '' : String(orderMode).trim().toUpperCase();

  if (!mine) {
    if (isAbsoluteOrderMode(requestedMode)) {
      throw policyError('절대수량 변경 모드는 지정된 주문등록 화면에서만 사용할 수 있습니다.', 'ORDER_MODE_FORBIDDEN');
    }
    return { isMyCustomerSource: false, orderMode: MY_CUSTOMER_ORDER_MODE.ADD, items };
  }

  const mode = requestedMode || (finalSnapshot ? MY_CUSTOMER_ORDER_MODE.FINAL_SNAPSHOT : MY_CUSTOMER_ORDER_MODE.ADD);
  if (mode !== MY_CUSTOMER_ORDER_MODE.ADD && mode !== MY_CUSTOMER_ORDER_MODE.REPLACE && mode !== MY_CUSTOMER_ORDER_MODE.FINAL_SNAPSHOT) {
    throw policyError('orderMode는 ADD, REPLACE 또는 FINAL_SNAPSHOT이어야 합니다.', 'ORDER_MODE_INVALID');
  }
  if (finalSnapshot !== (mode === MY_CUSTOMER_ORDER_MODE.FINAL_SNAPSHOT)) {
    throw policyError('FINAL_SNAPSHOT은 업로드 주문 최종본 전용 모드입니다.', 'ORDER_MODE_FORBIDDEN');
  }
  if (!Array.isArray(items) || items.length === 0) throw policyError('품목을 입력하세요.');

  const prodKeys = new Set();
  const normalizedItems = items.map((item, index) => {
    const prodKey = requiredFiniteNumber(item?.prodKey, `${index + 1}번째 품목코드`);
    if (!Number.isInteger(prodKey) || prodKey <= 0) {
      throw policyError(`${index + 1}번째 품목코드는 양의 정수여야 합니다.`);
    }
    if (prodKeys.has(prodKey)) throw policyError(`같은 품목(${prodKey})을 한 번만 입력하세요.`, 'DUPLICATE_PROD_KEY');
    prodKeys.add(prodKey);

    const qty = requiredFiniteNumber(item?.qty, `${index + 1}번째 입력 수량`);
    const expectedCurrentQty = finalSnapshot
      ? (item?.expectedCurrentQty == null ? undefined : requiredFiniteNumber(item.expectedCurrentQty, `${index + 1}번째 현재 수량`))
      : requiredFiniteNumber(item?.expectedCurrentQty, `${index + 1}번째 현재 수량`);
    if (expectedCurrentQty != null && expectedCurrentQty < 0) throw policyError(`${index + 1}번째 현재 수량은 0 이상이어야 합니다.`);
    if (mode === MY_CUSTOMER_ORDER_MODE.ADD && qty <= 0) {
      throw policyError('추가등록(ADD) 수량은 0보다 커야 합니다.', 'ADD_QUANTITY_INVALID');
    }
    if (isAbsoluteOrderMode(mode) && qty < 0) {
      throw policyError('최종 주문수량은 0 이상이어야 합니다.', 'REPLACE_QUANTITY_INVALID');
    }
    return { ...item, prodKey, qty, expectedCurrentQty };
  });

  return { isMyCustomerSource: true, orderMode: mode, items: normalizedItems };
}

/** 잠금된 현재 행과 입력 OutUnit 수량으로 한 품목의 쓰기 형태를 결정한다. */
export function planMyCustomerOrderWrite({ orderMode, inputOutQty, previousQty, hasActiveOrderDetail, hasShipmentDetail } = {}) {
  const mode = String(orderMode || '').toUpperCase();
  const input = requiredFiniteNumber(inputOutQty, 'OutUnit 입력 수량');
  const previous = requiredFiniteNumber(previousQty, '현재 주문수량');
  if (input < 0 || previous < 0) throw policyError('주문수량은 0 이상이어야 합니다.');

  const absolute = isAbsoluteOrderMode(mode);
  const finalQty = absolute ? input : previous + input;
  if (absolute && finalQty > 0 && hasActiveOrderDetail && Math.abs(finalQty - previous) <= 0.0001) {
    return { action: 'UNCHANGED', previousQty: previous, inputQty: input, deltaQty: 0, finalQty };
  }
  if (absolute && finalQty === 0 && hasShipmentDetail) {
    throw policyError('출고가 있는 품목은 주문수량을 0으로 변경할 수 없습니다.', 'REPLACE_ZERO_WITH_SHIPMENT');
  }
  if (absolute && finalQty === 0 && !hasActiveOrderDetail) {
    return { action: 'SKIP_ZERO', previousQty: previous, inputQty: input, deltaQty: 0, finalQty: 0 };
  }
  if (absolute && finalQty === 0) {
    return { action: 'DELETE_ZERO', previousQty: previous, inputQty: input, deltaQty: -previous, finalQty: 0 };
  }
  return {
    action: hasActiveOrderDetail ? 'UPDATE' : 'INSERT',
    previousQty: previous,
    inputQty: input,
    deltaQty: finalQty - previous,
    finalQty,
  };
}

/**
 * 업로드 파일을 업체·연도·차수의 최종 스냅샷으로 만든다.
 * 파일에 없는 활성 주문은 0으로 명시해 같은 트랜잭션에서 제거하고,
 * 파일에 있는 품목은 DB 잠금 뒤 읽은 현재수량을 optimistic 비교값으로 사용한다.
 */
export function expandFinalSnapshotItems({ uploadedItems = [], activeItems = [] } = {}) {
  const activeByProd = new Map();
  for (const row of activeItems) {
    const prodKey = Number(row?.prodKey ?? row?.ProdKey);
    if (!Number.isInteger(prodKey) || prodKey <= 0) continue;
    if (activeByProd.has(prodKey)) {
      throw policyError(`${row?.prodName || row?.ProdName || prodKey}: 같은 연도·차수의 활성 주문 상세가 여러 건이라 최종본을 적용할 수 없습니다.`, 'DUPLICATE_ACTIVE_ORDER_DETAIL');
    }
    activeByProd.set(prodKey, {
      prodKey,
      prodName: row?.prodName || row?.ProdName || '',
      unit: row?.unit || row?.OutUnit || '',
      qty: Number(row?.qty ?? row?.OutQuantity ?? 0),
    });
  }

  const uploadedKeys = new Set();
  const expanded = uploadedItems.map((item) => {
    const prodKey = Number(item.prodKey);
    uploadedKeys.add(prodKey);
    return { ...item, expectedCurrentQty: activeByProd.get(prodKey)?.qty || 0 };
  });
  for (const current of activeByProd.values()) {
    if (uploadedKeys.has(current.prodKey)) continue;
    expanded.push({
      prodKey: current.prodKey,
      prodName: current.prodName,
      qty: 0,
      unit: current.unit,
      expectedCurrentQty: current.qty,
      omittedFromSnapshot: true,
    });
  }
  return expanded;
}

/** optimistic-lock 수량 비교도 UI와 서버가 함께 쓸 수 있는 순수 규칙이다. */
export function assertMyCustomerExpectedCurrentQty(expectedCurrentQty, actualCurrentQty, epsilon = 0.0001) {
  const expected = requiredFiniteNumber(expectedCurrentQty, '현재 수량');
  const actual = requiredFiniteNumber(actualCurrentQty, '현재 주문수량');
  if (expected < 0 || actual < 0 || Math.abs(expected - actual) > epsilon) {
    const error = new Error('다른 작업에서 수량이 변경되었습니다. 새로고침 후 다시 등록하세요.');
    error.code = 'STALE_CURRENT_QTY';
    error.statusCode = 409;
    throw error;
  }
  return true;
}
