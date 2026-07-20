// 차수피벗 셀 편집의 주문/분배 부작용 계약 (DB 의존 없는 순수 함수).
//
// - ADD + 현재연도 주문 없음: 업체 추가와 동일하게 주문등록 + 분배
// - ADD + 현재연도 주문 있음: 분배만 변경, 주문등록수량 보존
// - CANCEL: 주문 존재 여부와 무관하게 분배만 변경, 주문등록수량 보존

export const PIVOT_DISTRIBUTION_MODE = 'PIVOT_DISTRIBUTION';

export function isPivotDistributionMode(mode) {
  return String(mode || '').trim().toUpperCase() === PIVOT_DISTRIBUTION_MODE;
}

export function resolvePivotAdjustmentPolicy({ mode, type, hasActiveOrder }) {
  const pivotDistribution = isPivotDistributionMode(mode);
  const normalizedType = String(type || '').trim().toUpperCase();

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
