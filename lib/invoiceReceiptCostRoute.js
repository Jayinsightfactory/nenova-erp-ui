export function invoiceReceiptCostScope({ orderYear, orderWeek, warehouseKey } = {}) {
  const year = String(orderYear ?? '');
  const week = String(orderWeek ?? '');
  const key = String(warehouseKey ?? '');
  if (![orderYear, orderWeek, warehouseKey].every(value => typeof value === 'string' || typeof value === 'number')
    || !/^20\d{2}$/.test(year) || !/^(?:0[1-9]|[1-4]\d|5[0-3])-\d{2}$/.test(week)
    || !/^[1-9]\d*$/.test(key) || !Number.isSafeInteger(Number(key))) return null;
  return { orderYear: year, orderWeek: week, warehouseKey: Number(key) };
}

export function invoiceReceiptCostHref(input) {
  const scope = invoiceReceiptCostScope(input);
  return scope ? `/import/tools?${new URLSearchParams({ tab: 'cost', ...scope })}` : null;
}
