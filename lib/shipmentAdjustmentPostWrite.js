import { normalizeShipmentQty } from './shipmentAvailability.js';

const TOLERANCE = 0.001;

function sameQty(left, right) {
  return Math.abs(normalizeShipmentQty(left) - normalizeShipmentQty(right)) <= TOLERANCE;
}

function addCheck(checks, key, ok, message, expected, actual) {
  checks.push({ key, ok: Boolean(ok), message, expected, actual });
}

/** 저장 직후 원장과 nenova.exe 뷰가 같은 값을 보이는지 판정하는 순수 정책. */
export function evaluateShipmentAdjustmentPostWrite({ expectedOrderOut, expectedShipmentOut, facts = {} } = {}) {
  const orderExpected = normalizeShipmentQty(expectedOrderOut);
  const shipmentExpected = normalizeShipmentQty(expectedShipmentOut);
  const orderActive = orderExpected > TOLERANCE;
  const shipmentActive = shipmentExpected > TOLERANCE;
  const checks = [];

  addCheck(checks, 'raw-order-count', Number(facts.rawOrderCount || 0) === (orderActive ? 1 : 0),
    orderActive ? '활성 주문 상세는 한 행이어야 합니다.' : '0이 된 주문 상세는 활성 상태로 남으면 안 됩니다.',
    orderActive ? 1 : 0, Number(facts.rawOrderCount || 0));
  addCheck(checks, 'raw-order-qty', sameQty(facts.rawOrderQty, orderExpected),
    '주문 원장의 실제 수량이 처리 예정값과 다릅니다.', orderExpected, normalizeShipmentQty(facts.rawOrderQty));
  addCheck(checks, 'view-order-count', Number(facts.viewOrderCount || 0) === (orderActive ? 1 : 0),
    orderActive ? '주문은 저장됐지만 nenova.exe 주문 화면에서 보이지 않거나 중복 표시됩니다.' : '취소된 주문이 nenova.exe 주문 화면에 남아 있습니다.',
    orderActive ? 1 : 0, Number(facts.viewOrderCount || 0));
  addCheck(checks, 'view-order-qty', sameQty(facts.viewOrderQty, orderExpected),
    'nenova.exe 주문 수량이 처리 예정값과 다릅니다.', orderExpected, normalizeShipmentQty(facts.viewOrderQty));

  addCheck(checks, 'raw-shipment-count', Number(facts.rawShipmentCount || 0) === (shipmentActive ? 1 : 0),
    shipmentActive ? '활성 분배 상세는 한 행이어야 합니다.' : '0이 된 분배 상세가 원장에 남아 있습니다.',
    shipmentActive ? 1 : 0, Number(facts.rawShipmentCount || 0));
  addCheck(checks, 'raw-shipment-qty', sameQty(facts.rawShipmentQty, shipmentExpected),
    '분배 원장의 실제 수량이 처리 예정값과 다릅니다.', shipmentExpected, normalizeShipmentQty(facts.rawShipmentQty));
  addCheck(checks, 'shipment-customer', Number(facts.shipmentCustomerMismatch || 0) === 0,
    '분배 상세의 업체가 분배 마스터 업체와 다릅니다.', 0, Number(facts.shipmentCustomerMismatch || 0));
  addCheck(checks, 'view-shipment-count', Number(facts.viewShipmentCount || 0) === (shipmentActive ? 1 : 0),
    shipmentActive ? '분배는 저장됐지만 nenova.exe 분배 화면에서 보이지 않거나 중복 표시됩니다.' : '취소된 분배가 nenova.exe 분배 화면에 남아 있습니다.',
    shipmentActive ? 1 : 0, Number(facts.viewShipmentCount || 0));
  addCheck(checks, 'view-shipment-qty', sameQty(facts.viewShipmentQty, shipmentExpected),
    'nenova.exe 분배 수량이 처리 예정값과 다릅니다.', shipmentExpected, normalizeShipmentQty(facts.viewShipmentQty));
  addCheck(checks, 'shipment-date-count', shipmentActive ? Number(facts.shipmentDateCount || 0) > 0 : Number(facts.shipmentDateCount || 0) === 0,
    shipmentActive ? '분배 수량에 연결된 출고일 행이 없습니다.' : '취소된 분배의 출고일 행이 남아 있습니다.',
    shipmentActive ? '1개 이상' : 0, Number(facts.shipmentDateCount || 0));
  addCheck(checks, 'shipment-date-qty', sameQty(facts.shipmentDateQty, shipmentExpected),
    '출고일별 수량 합계가 분배 수량과 다릅니다.', shipmentExpected, normalizeShipmentQty(facts.shipmentDateQty));

  const mismatches = checks.filter((check) => !check.ok);
  return { verified: mismatches.length === 0, expectedOrderOut: orderExpected, expectedShipmentOut: shipmentExpected, checks, mismatches };
}

export function shipmentPostWriteMismatchError(verification) {
  const first = verification?.mismatches?.[0];
  const error = new Error(`저장 직후 전산 대조가 일치하지 않아 전체 변경을 되돌렸습니다. ${first?.message || '주문·분배 수량을 다시 확인하세요.'}`);
  error.statusCode = 409;
  error.code = 'SHIPMENT_POST_WRITE_MISMATCH';
  error.verification = verification;
  return error;
}

/** 주문만 등록하는 붙여넣기 경로의 raw Order와 nenova.exe ViewOrder 대조. */
export function evaluateOrderRegistrationPostWrite({ expectedOrderOut, facts = {} } = {}) {
  const expected = normalizeShipmentQty(expectedOrderOut);
  const active = expected > TOLERANCE;
  const checks = [];
  addCheck(checks, 'raw-order-count', Number(facts.rawOrderCount || 0) === (active ? 1 : 0),
    active ? '활성 주문 상세는 한 행이어야 합니다.' : '0이 된 주문 상세는 활성 상태로 남으면 안 됩니다.',
    active ? 1 : 0, Number(facts.rawOrderCount || 0));
  addCheck(checks, 'raw-order-qty', sameQty(facts.rawOrderQty, expected),
    '주문 원장의 실제 수량이 처리 예정값과 다릅니다.', expected, normalizeShipmentQty(facts.rawOrderQty));
  addCheck(checks, 'view-order-count', Number(facts.viewOrderCount || 0) === (active ? 1 : 0),
    active ? '주문은 저장됐지만 nenova.exe 주문 화면에서 보이지 않거나 중복 표시됩니다.' : '취소된 주문이 nenova.exe 주문 화면에 남아 있습니다.',
    active ? 1 : 0, Number(facts.viewOrderCount || 0));
  addCheck(checks, 'view-order-qty', sameQty(facts.viewOrderQty, expected),
    'nenova.exe 주문 수량이 처리 예정값과 다릅니다.', expected, normalizeShipmentQty(facts.viewOrderQty));
  const mismatches = checks.filter((check) => !check.ok);
  return { verified: mismatches.length === 0, expectedOrderOut: expected, checks, mismatches };
}

export function orderRegistrationPostWriteMismatchError(verification) {
  const first = verification?.mismatches?.[0];
  const error = new Error(`주문 저장 직후 전산 대조가 일치하지 않아 전체 등록을 되돌렸습니다. ${first?.message || '주문 수량을 다시 확인하세요.'}`);
  error.statusCode = 409;
  error.code = 'ORDER_POST_WRITE_MISMATCH';
  error.verification = verification;
  return error;
}
