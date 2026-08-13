export function resolveStockTargetAdjustment({ liveStock, selectedStock, targetStock }) {
  const live = Number(liveStock);
  const selected = Number(selectedStock);
  const target = Number(targetStock);
  if (![live, selected, target].every(Number.isFinite)) {
    throw new Error('재고 계산값이 올바르지 않습니다.');
  }
  const delta = target - selected;
  return {
    selectedBefore: selected,
    targetStock: target,
    delta,
    liveBefore: live,
    liveAfter: live + delta,
  };
}
