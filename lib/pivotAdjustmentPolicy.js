// 차수피벗 셀 편집의 주문/분배 부작용 계약 (DB 의존 없는 순수 함수).
//
// - ADD + 현재연도 주문 없음: 업체 추가와 동일하게 주문등록 + 분배
// - ADD + 현재연도 주문 있음: 분배만 변경, 주문등록수량 보존
// - CANCEL: 주문 존재 여부와 무관하게 분배만 변경, 주문등록수량 보존
// - AUTO_CANCEL: 주문은 항상 보존하고 분배만 취소. 활성 분배가 없으면 저장 단계에서 실패한다.

export const PIVOT_DISTRIBUTION_MODE = 'PIVOT_DISTRIBUTION';
export const AUTO_CANCEL_MODE = 'AUTO_CANCEL';
export const PASTE_UNDO_SHIPMENT_ONLY_MODE = 'PASTE_UNDO_SHIPMENT_ONLY';
export const PASTE_UNDO_BOTH_MODE = 'PASTE_UNDO_BOTH';

export function isPivotDistributionMode(mode) {
  return String(mode || '').trim().toUpperCase() === PIVOT_DISTRIBUTION_MODE;
}

export function isAutoCancelMode(mode) {
  return String(mode || '').trim().toUpperCase() === AUTO_CANCEL_MODE;
}

export function isPasteUndoShipmentOnlyMode(mode) {
  return String(mode || '').trim().toUpperCase() === PASTE_UNDO_SHIPMENT_ONLY_MODE;
}

export function isPasteUndoBothMode(mode) {
  return String(mode || '').trim().toUpperCase() === PASTE_UNDO_BOTH_MODE;
}

export function resolvePivotAdjustmentPolicy({ mode, type, hasActiveOrder, hasActiveShipment = false }) {
  const pivotDistribution = isPivotDistributionMode(mode);
  const autoCancel = isAutoCancelMode(mode);
  const undoShipmentOnly = isPasteUndoShipmentOnlyMode(mode);
  const undoBoth = isPasteUndoBothMode(mode);
  const normalizedType = String(type || '').trim().toUpperCase();

  if (autoCancel) {
    if (normalizedType !== 'CANCEL') {
      throw new Error('AUTO_CANCEL 모드는 CANCEL만 허용합니다.');
    }
    return {
      mode: AUTO_CANCEL_MODE,
      mutateOrder: false,
      mutateShipment: true,
      reason: 'auto_cancel_distribution_only',
    };
  }

  if (undoShipmentOnly) {
    if (normalizedType !== 'ADD') throw new Error('PASTE_UNDO_SHIPMENT_ONLY 모드는 ADD만 허용합니다.');
    return { mode: PASTE_UNDO_SHIPMENT_ONLY_MODE, mutateOrder: false, mutateShipment: true, reason: 'paste_undo_shipment_only' };
  }
  if (undoBoth) {
    if (normalizedType !== 'CANCEL') throw new Error('PASTE_UNDO_BOTH 모드는 CANCEL만 허용합니다.');
    return { mode: PASTE_UNDO_BOTH_MODE, mutateOrder: true, mutateShipment: true, reason: 'paste_undo_both' };
  }

  if (!pivotDistribution) {
    return {
      mode: 'ORDER_AND_SHIPMENT',
      mutateOrder: true,
      mutateShipment: true,
      reason: 'combined_adjustment',
    };
  }

  const createMissingOrder = normalizedType === 'ADD' && !hasActiveOrder;
  return {
    mode: PIVOT_DISTRIBUTION_MODE,
    mutateOrder: createMissingOrder,
    mutateShipment: true,
    reason: createMissingOrder
      ? 'pivot_add_without_order'
      : normalizedType === 'ADD'
        ? 'pivot_add_existing_order'
        : 'pivot_cancel_distribution_only',
  };
}
