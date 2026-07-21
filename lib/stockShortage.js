// 확정 전산 재고 부족분 계산. OutQuantity와 ProductStock은 같은 저장 단위를
// 사용하므로 임의로 올림하지 않고 0.001 단위로만 정규화한다.

export function roundStockQuantity(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

export function calculateStockShortage(row) {
  const explicit = Number(row?.shortage);
  if (Number.isFinite(explicit) && explicit > 0) return roundStockQuantity(explicit);
  return roundStockQuantity(Math.max(0, -Number(row?.remain || 0)));
}
