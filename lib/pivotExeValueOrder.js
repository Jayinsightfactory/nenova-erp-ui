// Map keys deliberately retain primitive types: '0', 0, false, null and '' differ.
export function createPivotValueOrderComparator(order = [], direction = null) {
  const ranks = new Map();
  for (const value of Array.isArray(order) ? order : []) {
    if (!ranks.has(value)) ranks.set(value, ranks.size);
  }
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  const sign = direction === 'asc' ? 1 : direction === 'desc' ? -1 : 0;
  return (left, right) => {
    const a = ranks.get(left); const b = ranks.get(right);
    if (a !== undefined || b !== undefined) {
      if (a === undefined) return 1;
      if (b === undefined) return -1;
      return a - b;
    }
    if (!sign) return 0;
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left ?? ''), String(right ?? ''));
    return sign * comparison;
  };
}

/** Move one value without changing the input; out-of-range destinations are clamped. */
export function movePivotValue(values, index, offset) {
  const next = [...values];
  if (!Number.isInteger(index) || index < 0 || index >= next.length || !Number.isFinite(offset)) return next;
  const destination = Math.max(0, Math.min(next.length - 1, index + Math.trunc(offset)));
  const [value] = next.splice(index, 1);
  next.splice(destination, 0, value);
  return next;
}
