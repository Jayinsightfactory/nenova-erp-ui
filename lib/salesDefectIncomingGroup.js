const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' });

const clean = (value) => String(value ?? '').trim();

export function incomingCountryKey(row = {}) {
  return clean(row.countryName) || '국가 미확인';
}

export function incomingProductKey(row = {}) {
  return clean(row.productName || row.matchedFlowerName) || '품종 미확인';
}

export function incomingGroupKey(row = {}, mode = 'customer') {
  if (mode === 'product') {
    return `${incomingCountryKey(row)} · ${incomingProductKey(row)}`;
  }
  return clean(row.customerName || row.matchedCustomerName) || '거래처 미확인';
}

function compareKey(left, right, missingLabel) {
  if (left === right) return 0;
  if (left === missingLabel) return 1;
  if (right === missingLabel) return -1;
  return collator.compare(left, right);
}

export function sortIncomingRows(rows = [], mode = 'customer') {
  const normalizedMode = mode === 'product' ? 'product' : 'customer';
  const sorted = rows.map((row, sourceIndex) => ({ row, sourceIndex }))
    .sort((left, right) => {
      const customer = () => compareKey(
        incomingGroupKey(left.row, 'customer'),
        incomingGroupKey(right.row, 'customer'),
        '거래처 미확인',
      );
      const country = () => compareKey(
        incomingCountryKey(left.row),
        incomingCountryKey(right.row),
        '국가 미확인',
      );
      const product = () => compareKey(
        incomingProductKey(left.row),
        incomingProductKey(right.row),
        '품종 미확인',
      );
      const orderedComparisons = normalizedMode === 'product'
        ? [country, product, customer]
        : [customer, product, country];
      for (const compare of orderedComparisons) {
        const compared = compare();
        if (compared) return compared;
      }
      const leftKey = Number(left.row?.deductionKey || 0);
      const rightKey = Number(right.row?.deductionKey || 0);
      return leftKey - rightKey || left.sourceIndex - right.sourceIndex;
    });

  return sorted.map((entry, displayIndex) => {
    const groupLabel = incomingGroupKey(entry.row, normalizedMode);
    const countryLabel = incomingCountryKey(entry.row);
    const previous = sorted[displayIndex - 1]?.row;
    return {
      ...entry,
      displayIndex,
      groupLabel,
      countryLabel,
      isGroupStart: displayIndex === 0
        || incomingGroupKey(previous, normalizedMode) !== groupLabel,
      isCountryStart: normalizedMode === 'product'
        && (displayIndex === 0 || incomingCountryKey(previous) !== countryLabel),
    };
  });
}
