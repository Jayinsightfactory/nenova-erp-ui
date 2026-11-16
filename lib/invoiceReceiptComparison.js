export const RECEIPT_COMPARE_FIELDS = Object.freeze([
  ['boxQuantity', '박스'], ['bunchQuantity', '단'], ['stemQuantity', '송이'],
]);

export function receiptQuantityEvidence(sourceFields, evidence) {
  return Object.fromEntries(RECEIPT_COMPARE_FIELDS.flatMap(([field]) => {
    const source = sourceFields?.[field], value = source && evidence?.[source];
    return value && typeof value === 'object' && !Array.isArray(value) ? [[field, value]] : [];
  }));
}

export function uniqueReceiptSourceRow(rows, quote) {
  if (!quote?.trim()) return -1;
  const matches=(rows||[]).flatMap((row,index)=>row.some(value=>String(value).trim().toLowerCase()===quote.trim().toLowerCase())?[index]:[]);
  return matches.length===1?matches[0]:-1;
}

export function receiptComparisonFocus(line, field) {
  const source = line?.sourceEvidence || {};
  const exact = source.fieldEvidence?.[field] || source.quantityEvidence?.[field];
  const evidence = exact || source.descriptionEvidence || null;
  return { key: `${line?.lineId || ''}:${field}`, evidence, row: !exact,
    label: `${line?.lineNo ?? '—'}행 · ${RECEIPT_COMPARE_FIELDS.find(([key]) => key === field)?.[1] || '품목'} 대조`,
    quote: line?.originalName || '' };
}
