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

// 화면에 남아 있는 모든 추가·취소 행이 한 트랜잭션의 저장 대상이어야 한다.
// 미확인 행을 조용히 제외하면 CANCEL만 먼저 반영되는 부분 처리가 발생한다.
export function validatePasteMixedBatchIntent(orders = []) {
  const rows = [];
  const issues = [];

  (orders || []).forEach((order) => {
    (order?.items || []).forEach((item, itemIndex) => {
      if (item?.skip) return;
      const row = {
        orderId: order?.id,
        itemIndex,
        customerName: order?.custMatch?.CustName || order?.custName || '업체 미확인',
        inputName: item?.inputName || item?.prodName || '품목 미확인',
        action: item?.action === '취소' ? '취소' : '추가',
      };
      rows.push(row);
      if (!Number(order?.custMatch?.CustKey)) issues.push({ ...row, reason: 'customer' });
      if (!Number(item?.prodKey)) issues.push({ ...row, reason: 'product' });
      if (!Number.isFinite(Number(item?.qty)) || Number(item?.qty) <= 0) issues.push({ ...row, reason: 'quantity' });
    });
  });

  return {
    intendedCount: rows.length,
    valid: rows.length > 0 && issues.length === 0,
    issues,
  };
}

// 실행 버튼의 표시 상태와 실제 클릭 가드는 반드시 같은 판정을 사용한다.
// native disabled로만 막으면 사용자는 원인을 알 수 없으므로, 실행 중을 제외한
// 차단 상태는 클릭 가능한 aria-disabled 버튼에서 이 메시지를 안내한다.
export function getPasteMixedBatchStartBlocker({
  week,
  bulkRunning = false,
  entries = [],
  presenceByCust = {},
} = {}) {
  if (bulkRunning) {
    return { code: 'RUNNING', message: '전체 업체 취소→추가 처리가 이미 진행 중입니다.' };
  }
  if (!String(week || '').trim()) {
    return { code: 'WEEK_REQUIRED', message: '등록 차수를 먼저 선택하세요.' };
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return { code: 'NO_ACTIONS', message: '처리할 추가·취소 품목이 없습니다. 붙여넣기 내용을 분석하고 업체·품목 매칭을 확인하세요.' };
  }

  for (const entry of entries) {
    const order = entry?.order || {};
    const custKey = Number(order?.custMatch?.CustKey || entry?.custKey || 0);
    if (!custKey) continue;
    const customerName = order?.custMatch?.CustName || order?.custName || entry?.custName || `업체 #${custKey}`;
    const presence = presenceByCust?.[String(custKey)] || {};
    if (presence.loading) {
      return { code: 'PRESENCE_LOADING', message: `${customerName} 작업 가능 상태를 확인 중입니다. 잠시 후 다시 눌러주세요.` };
    }
    if (presence.stale) {
      return { code: 'STALE', message: `${customerName}의 주문·분배 기준수량이 다른 화면에서 변경되었습니다. 새로고침한 뒤 다시 분석해 주세요.` };
    }
    if (presence.active && !presence.ownedByMe) {
      return {
        code: 'LOCKED',
        message: `${presence.ownerName || '다른 사용자'}님이 ${customerName}을(를) 작업 중입니다. 작업이 끝난 뒤 다시 실행하세요.`,
      };
    }
    if (presence.error) {
      return { code: 'PRESENCE_ERROR', message: `${customerName} 작업 상태를 확인하지 못했습니다: ${presence.error}. 새로고침 후 다시 시도하세요.` };
    }
  }
  return null;
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
    if (!cancelShipment) {
      return {
        orderBefore: beforeOrder,
        orderAfter: beforeOrder,
        shipmentBefore: beforeShipment,
        shipmentAfter: beforeShipment,
        policy: 'CANCEL_BLOCKED_NO_SHIPMENT',
        error: '취소할 현재 분배가 없어 일괄 처리 시 전체 롤백됩니다.',
      };
    }
    return {
      orderBefore: beforeOrder,
      orderAfter: beforeOrder,
      shipmentBefore: beforeShipment,
      shipmentAfter: converted.qtyAfter,
      policy: 'CANCEL_SHIPMENT_ONLY',
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
