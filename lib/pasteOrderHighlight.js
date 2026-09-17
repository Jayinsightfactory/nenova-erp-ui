/**
 * 붙여넣기 주문 카드의 작업 완료 강조 상태.
 * 주문 원장만 저장한 경우와 분배까지 끝난 경우를 시각적으로 구분한다.
 */
export function pasteOrderHighlightState(order = {}) {
  if (order.orderOnlyRegistered === true) {
    return {
      key: 'ORDER_ONLY',
      label: '주문만 등록됨 · 분배 대기',
      color: '#1565c0',
      background: '#e3f2fd',
      border: '#64b5f6',
    };
  }
  return {
    key: 'PENDING',
    label: '',
    color: '#c62828',
    background: '#fff5f5',
    border: '#ef9a9a',
  };
}
