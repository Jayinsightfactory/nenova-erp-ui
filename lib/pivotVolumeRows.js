// Pivot 물량표/엑셀 — 행 포함 여부·수량 합산 (순수함수, DB 의존 없음)

function n(value) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

/** 객체 맵(custName→qty 등)의 숫자 합 */
export function sumMapQty(map) {
  if (!map || typeof map !== 'object') return 0;
  return Object.values(map).reduce((sum, v) => sum + n(v), 0);
}

/** 주문 수량 — totalOrder 와 orders 맵 중 큰 값(불일치 방어) */
export function sumOrderQty(row) {
  const fromTotal = n(row?.totalOrder ?? row?.summary?.totalOrder);
  const fromOrders = sumMapQty(row?.orders);
  return Math.max(fromTotal, fromOrders);
}

/** 입고 수량 — totalIncoming 과 incoming 맵 중 큰 값 */
export function sumIncomingQty(row) {
  const fromTotal = n(row?.totalIncoming ?? row?.summary?.totalIncoming);
  const fromIncoming = sumMapQty(row?.incoming);
  return Math.max(fromTotal, fromIncoming);
}

/**
 * 물량표·엑셀에 포함할 행인지.
 * 주문만 있고 입고가 없어도 포함 (입고만 있는 경우도 포함).
 */
export function includePivotVolumeRow(row) {
  if (!row) return false;
  if (sumOrderQty(row) > 0) return true;
  if (sumIncomingQty(row) > 0) return true;
  if (n(row.prevStock) > 0) return true;
  return false;
}
