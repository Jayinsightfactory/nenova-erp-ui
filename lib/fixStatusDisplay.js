const FIX_STATUS_LABELS = Object.freeze({
  FIXED: '전체확정',
  FIXED_PENDING_STOCK: '출고확정·재고미정합',
  PARTIAL: '부분확정',
  UNFIXED: '미확정',
  NO_SHIPMENT: '출고없음',
});

export function fixStatusLabel(status) {
  return FIX_STATUS_LABELS[status] || FIX_STATUS_LABELS.NO_SHIPMENT;
}

