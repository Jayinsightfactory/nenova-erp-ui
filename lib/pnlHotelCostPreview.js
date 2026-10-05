import { buildRaumPnlCostComparison, raumPnlCostIdentity } from './raumPnlCostComparison.js';

// Cross-hotel display joins only exact ERP product + unit identities.
// Unmapped names stay within the selected hotel.
export function buildPnlHotelCostPreview(item, rows = [], scope = {}) {
  const key = raumPnlCostIdentity(item);
  if (!key) return [];
  const mapped = Number(item?.prodKey ?? item?.ProdKey) > 0;
  const groups = new Map();
  for (const row of rows) {
    if (String(row.orderYear) !== String(scope.orderYear) || raumPnlCostIdentity(row) !== key) continue;
    if (!mapped && row.partnerCode !== scope.partnerCode) continue;
    if (!groups.has(row.partnerCode)) groups.set(row.partnerCode, []);
    groups.get(row.partnerCode).push(row);
  }
  return [...groups].map(([partnerCode, history]) => {
    const comparison = buildRaumPnlCostComparison([item], history, { ...scope, partnerCode });
    return { partnerCode, label: history[0].partnerLabel || partnerCode, weeks: comparison.weeks, values: comparison.rows[0] };
  }).sort((a, b) => a.partnerCode === scope.partnerCode ? -1 : b.partnerCode === scope.partnerCode ? 1 : a.label.localeCompare(b.label, 'ko'));
}
