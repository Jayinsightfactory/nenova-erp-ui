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

export function resolveLaterSnapshotPreservation({ liveStock, delta, nextWeek }) {
  const live = Number(liveStock);
  const change = Number(delta);
  if (![live, change].every(Number.isFinite)) throw new Error('후속 재고 보존 계산값이 올바르지 않습니다.');
  if (!nextWeek || Math.abs(change) < 0.0001) return null;
  return {
    orderYear: String(nextWeek.orderYear),
    orderWeek: String(nextWeek.orderWeek),
    delta: -change,
    liveBefore: live + change,
    liveAfter: live,
  };
}
