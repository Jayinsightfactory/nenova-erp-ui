const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });

const clean = (value) => String(value ?? '').trim();

export function incomingGroupKey(row = {}, mode = 'customer') {
  if (mode === 'product') {
    return clean(row.productName || row.matchedFlowerName) || '품종 미확인';
  }
  return clean(row.customerName || row.matchedCustomerName) || '거래처 미확인';
}

export function sortIncomingRows(rows = [], mode = 'customer') {
  const normalizedMode = mode === 'product' ? 'product' : 'customer';
  const secondaryMode = normalizedMode === 'customer' ? 'product' : 'customer';
  const sorted = rows.map((row, sourceIndex) => ({ row, sourceIndex }))
    .sort((left, right) => {
      const primary = collator.compare(
        incomingGroupKey(left.row, normalizedMode),
        incomingGroupKey(right.row, normalizedMode),
      );
      if (primary) return primary;
      const secondary = collator.compare(
        incomingGroupKey(left.row, secondaryMode),
        incomingGroupKey(right.row, secondaryMode),
      );
      if (secondary) return secondary;
      const leftKey = Number(left.row?.deductionKey || 0);
      const rightKey = Number(right.row?.deductionKey || 0);
      return leftKey - rightKey || left.sourceIndex - right.sourceIndex;
    });

  return sorted.map((entry, displayIndex) => {
    const groupLabel = incomingGroupKey(entry.row, normalizedMode);
    return {
      ...entry,
      displayIndex,
      groupLabel,
      isGroupStart: displayIndex === 0
        || incomingGroupKey(sorted[displayIndex - 1].row, normalizedMode) !== groupLabel,
    };
  });
}
