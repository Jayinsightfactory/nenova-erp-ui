// 붙여넣기 주문등록의 혼합 추가/취소 일괄 처리 순서 계약.
//
// 기존 단건 API 정책은 그대로 두고, 한 번의 실행 안에서 취소를 모두 처리한 뒤
// 추가를 처리하도록 안정적으로 순서만 나눈다. 같은 단계 안에서는 입력 순서를 보존한다.

import { computeShipmentAdjustUnits } from './adjustUnits.js';

export function pasteBatchActionType(item) {
  return item?.action === '취소' ? 'CANCEL' : 'ADD';
}

export function pasteBatchRetryKey(item) {
  return `${Number(item?.prodKey)}:${pasteBatchActionType(item)}`;
}

export function orderPasteMixedBatchTargets(items = []) {
  const cancelTargets = [];
  const addTargets = [];

  items.forEach((item) => {
    if (pasteBatchActionType(item) === 'CANCEL') cancelTargets.push(item);
    else addTargets.push(item);
  });

  return [...cancelTargets, ...addTargets];
}

export function buildPasteMixedActionPreview({ type, qty, unit, orderQty, shipmentQty, product = {} } = {}) {
  const actionType = String(type || '').toUpperCase() === 'CANCEL' ? 'CANCEL' : 'ADD';
  const converted = computeShipmentAdjustUnits({
    curOut: Number(shipmentQty || 0), delta: Number(qty || 0), type: actionType, unit,
    outUnit: product.OutUnit, bunchOf1Box: product.BunchOf1Box,
    steamOf1Box: product.SteamOf1Box, steamOf1Bunch: product.SteamOf1Bunch,
    estUnit: product.EstUnit,
  });
  const beforeOrder = Number(orderQty || 0);
  const beforeShipment = Number(shipmentQty || 0);
  if (actionType === 'CANCEL') {
    const cancelShipment = beforeShipment > 0.0001;
    return {
      orderBefore: beforeOrder,
      orderAfter: cancelShipment ? beforeOrder : beforeOrder - converted.deltaOut,
      shipmentBefore: beforeShipment,
      shipmentAfter: cancelShipment ? converted.qtyAfter : beforeShipment,
      policy: cancelShipment ? 'CANCEL_SHIPMENT_ONLY' : 'CANCEL_ORDER_ONLY',
    };
  }
  return {
    orderBefore: beforeOrder,
    orderAfter: beforeOrder + converted.deltaOut,
    shipmentBefore: beforeShipment,
    shipmentAfter: converted.qtyAfter,
    policy: 'ADD_ORDER_AND_SHIPMENT',
  };
}
