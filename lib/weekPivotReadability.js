export function normalizeWeekPivotProductSearch(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/\s+/g, '');
}

export function filterWeekPivotProductKeys(prodKeys = [], prodMap = {}, query = '') {
  const needle = normalizeWeekPivotProductSearch(query);
  if (!needle) return [...prodKeys];
  return prodKeys.filter((prodKey) => {
    const product = prodMap[prodKey] || {};
    const prodName = product.name ?? product.ProdName ?? '';
    const displayName = product.displayName ?? product.DisplayName ?? '';
    return normalizeWeekPivotProductSearch(prodName).includes(needle)
      || normalizeWeekPivotProductSearch(displayName).includes(needle);
  });
}

function scopedYear(value) {
  const match = String(value ?? '').match(/(?:^|\D)(\d{4})(?:\D|$)/);
  return match?.[1] || '';
}

function scopedWeek(value) {
  const match = String(value ?? '').match(/(?:^\d{4}-)?(\d{1,2})-(\d{1,2})(?:$|\D)/);
  if (!match) return { key: '', rank: null, explicitYear: scopedYear(value) };
  const major = Number(match[1]);
  const sub = Number(match[2]);
  return {
    key: `${String(major).padStart(2, '0')}-${String(sub).padStart(2, '0')}`,
    rank: major * 100 + sub,
    explicitYear: scopedYear(value),
  };
}

export function isWeekPivotRowInSelectedScope(row, { selectedYear, weekFrom, weekTo } = {}) {
  if (!row) return false;
  const requestedYear = scopedYear(selectedYear) || scopedYear(weekFrom) || scopedYear(weekTo);
  const rowWeek = scopedWeek(row.OrderWeek ?? row.orderWeek);
  const explicitFieldYear = scopedYear(row.OrderYear ?? row.orderYear);
  // Normal pivot rows omit OrderYear because the request itself is scoped. Only
  // an explicitly conflicting row year is excluded; missing years inherit the
  // selected request year.
  if (requestedYear && explicitFieldYear && explicitFieldYear !== requestedYear) return false;
  if (requestedYear && rowWeek.explicitYear && rowWeek.explicitYear !== requestedYear) return false;
  if (rowWeek.rank == null) return false;

  const from = scopedWeek(weekFrom);
  const to = scopedWeek(weekTo || weekFrom);
  if (from.rank != null && rowWeek.rank < from.rank) return false;
  if (to.rank != null && rowWeek.rank > to.rank) return false;
  return true;
}

export function getWeekPivotCustomerHighlightProdKeys(rows = [], {
  custKey,
  selectedYear,
  weekFrom,
  weekTo,
} = {}) {
  const selectedCustKey = Number(custKey);
  if (!Number.isFinite(selectedCustKey) || selectedCustKey <= 0) return new Set();
  const result = new Set();
  rows.forEach((row) => {
    if (Number(row?.CustKey ?? row?.custKey) !== selectedCustKey) return;
    if (!isWeekPivotRowInSelectedScope(row, { selectedYear, weekFrom, weekTo })) return;
    const orderQty = Number(row?.custOrderQty ?? row?.CustOrderQty ?? row?.OrderQuantity ?? 0);
    const shipmentQty = Number(row?.outQty ?? row?.OutQty ?? row?.ShipmentQuantity ?? 0);
    const hasPositiveOrder = Number.isFinite(orderQty) && orderQty > 0;
    const hasPositiveShipment = Number.isFinite(shipmentQty) && shipmentQty > 0;
    if (!hasPositiveOrder && !hasPositiveShipment) return;
    const prodKey = Number(row?.ProdKey ?? row?.prodKey);
    if (Number.isFinite(prodKey) && prodKey > 0) result.add(prodKey);
  });
  return result;
}
