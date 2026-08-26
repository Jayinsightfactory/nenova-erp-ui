// Read-only historical purchase-cost comparison for the Raum/Choimun P&L detail view.
// This module deliberately does not create/ensure tables and has no write path.
const normSpace = value => String(value == null ? '' : value).replace(/[\s\u00a0]+/g, ' ').trim();
const normUnit = value => normSpace(value).toLowerCase();
const normName = value => normSpace(value);

function positiveProdKey(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function identity(item) {
  const prodKey = positiveProdKey(item?.prodKey ?? item?.ProdKey);
  const unit = normUnit(item?.unit ?? item?.Unit);
  const custom = item?.isCustom ?? item?.IsCustom;
  const customPart = custom ? 'custom' : 'ordinary';
  if (prodKey != null) return `prod:${prodKey}|unit:${unit}|${customPart}`;
  const name = normName(item?.name ?? item?.Name ?? item?.itemName ?? item?.ItemName);
  return name ? `name:${name}|unit:${unit}|${customPart}` : null;
}

/**
 * Build a stable week-by-item matrix. Each cell contains all distinct numeric
 * stored costs for that week (never an average); missing/null costs are empty.
 */
export function buildRaumPnlCostComparison(items = [], rows = [], scope = {}) {
  const orderYear = String(scope.orderYear ?? '').trim();
  const partnerCode = String(scope.partnerCode ?? '').trim().toLowerCase();
  if (!orderYear || !partnerCode) {
    return { weeks: [], rows: (Array.isArray(items) ? items : []).map(() => []) };
  }
  const scopedRows = (Array.isArray(rows) ? rows : []).filter(row =>
    (orderYear === '' || String(row.orderYear ?? row.OrderYear ?? '').trim() === orderYear) &&
    (partnerCode === '' || String(row.partnerCode ?? row.PartnerCode ?? '').trim().toLowerCase() === partnerCode)
  );
  const weekNumbers = [...new Set(scopedRows
    .map(row => Number(row.major ?? row.MajorWeek))
    .filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => b - a);
  const weeks = weekNumbers.map(major => ({ key: String(major), label: `${major}차` }));
  const byIdentityWeek = new Map();
  for (const row of scopedRows) {
    const major = Number(row.major ?? row.MajorWeek);
    const cost = row.costPrice ?? row.CostPrice;
    if (!Number.isInteger(major) || major <= 0 || typeof cost === 'boolean' || cost == null || String(cost).trim() === '') continue;
    const numeric = Number(cost);
    if (!Number.isFinite(numeric)) continue;
    const itemKey = identity(row);
    if (!itemKey) continue;
    const key = `${itemKey}|week:${major}`;
    if (!byIdentityWeek.has(key)) byIdentityWeek.set(key, new Set());
    byIdentityWeek.get(key).add(numeric);
  }
  return {
    weeks,
    rows: (Array.isArray(items) ? items : []).map(item =>
      weekNumbers.map(major => {
        const itemKey = identity(item);
        return itemKey ? [...(byIdentityWeek.get(`${itemKey}|week:${major}`) || [])].sort((a, b) => a - b) : [];
      })
    )
  };
}
