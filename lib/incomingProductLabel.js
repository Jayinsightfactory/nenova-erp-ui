export function incomingProductLabel(row) {
  if (!row) return '';
  const name = [row.matchedProductDbName, row.matchedProductName, row.colorName, row.productName]
    .find(value => typeof value === 'string' && value.trim());
  return [row.countryName?.trim(), name?.trim() || '품명 미확인'].filter(Boolean).join(' · ');
}
