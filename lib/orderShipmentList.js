export function detailNo(fullWeek) {
  const m = String(fullWeek || '').match(/(?:^|-)\d{2}-(\d{2})$/);
  return m ? Number(m[1]) : 1;
}

export function initializeShipDateAllocations(items, fullWeek, defaults) {
  const date = defaults?.[detailNo(fullWeek)] || '';
  return (items || []).filter(x => !x.skip && x.prodKey && Number(x.qty) > 0).map(x => ({
    ...x,
    totalQty: Number(x.qty),
    allocations: date ? { [date]: Number(x.qty) } : {},
  }));
}

export function moveShipmentQuantity(row, fromDate, toDate, quantity) {
  const qty = Number(quantity);
  if (!toDate || !Number.isFinite(qty) || qty <= 0) throw new Error('이동할 출고일과 양수 수량이 필요합니다.');
  const next = { ...(row.allocations || {}) };
  const sourceQty = Number(next[fromDate] || 0);
  if (!fromDate || sourceQty < qty) throw new Error('선택한 출고일의 수량을 초과할 수 없습니다.');
  next[fromDate] = sourceQty - qty;
  if (next[fromDate] <= 0) delete next[fromDate];
  next[toDate] = Number(next[toDate] || 0) + qty;
  return { ...row, allocations: next };
}

export function allocationTotal(row) {
  return Object.values(row.allocations || {}).reduce((sum, n) => sum + Number(n || 0), 0);
}

export function buildShipmentListRows(rows) {
  return (rows || []).flatMap(row => Object.entries(row.allocations || {})
    .filter(([, qty]) => Number(qty) > 0)
    .map(([shipDate, qty]) => ({ ...row, shipDate, shipQty: Number(qty) })));
}
