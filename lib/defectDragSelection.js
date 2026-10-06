// Recompute from the initial selection so dragging back retracts only this gesture.
export function selectDefectRange({ baseline, items, anchor, current, selected }) {
  const result = new Set(baseline);
  const low = Math.min(anchor, current), high = Math.max(anchor, current);
  for (let i = low; i <= high; i++) {
    const item = items[i];
    if (!item?.eligible) continue;
    if (selected) result.add(item.key); else result.delete(item.key);
  }
  return result;
}
