// Read-only historical purchase-cost comparison for the Raum/Choimun P&L detail view.
// This module deliberately does not create/ensure tables and has no write path.
const normSpace = value => String(value == null ? '' : value).replace(/[\s\u00a0]+/g, ' ').trim();
const normUnit = value => normSpace(value).toLowerCase();
const normName = value => normSpace(value);

function positiveProdKey(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function raumPnlCostIdentity(item) {
  const prodKey = positiveProdKey(item?.prodKey ?? item?.ProdKey);
  const unit = normUnit(item?.unit ?? item?.Unit);
  const custom = item?.isCustom ?? item?.IsCustom;
  const customPart = custom ? 'custom' : 'ordinary';
  if (prodKey != null) return `prod:${prodKey}|unit:${unit}|${customPart}`;
  const name = normName(item?.name ?? item?.Name ?? item?.itemName ?? item?.ItemName);
  return name ? `name:${name}|unit:${unit}|${customPart}` : null;
}

const identity = raumPnlCostIdentity;

export function raumPnlCostSnapshot(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      itemKey: Number(row?.itemKey ?? row?.ItemKey),
      costPrice: row?.costPrice ?? row?.CostPrice,
    }))
    .filter(row => Number.isInteger(row.itemKey) && row.itemKey > 0)
    .map(row => ({
      itemKey: row.itemKey,
      costPrice: row.costPrice == null || String(row.costPrice).trim() === '' ? null : Number(row.costPrice),
    }))
    .sort((a, b) => a.itemKey - b.itemKey);
}

export function sameRaumPnlCostSnapshot(left, right) {
  return JSON.stringify(raumPnlCostSnapshot(left)) === JSON.stringify(raumPnlCostSnapshot(right));
}

/** Build the editable product x settlement-week matrix from already scoped rows. */
export function buildRaumPnlPurchaseCostMatrix(rows = [], scope = {}) {
  const orderYear = String(scope.orderYear ?? '').trim();
  const partnerCode = String(scope.partnerCode ?? '').trim().toLowerCase();
  if (!/^\d{4}$/.test(orderYear) || !partnerCode) return { weeks: [], items: [] };

  const scoped = (Array.isArray(rows) ? rows : []).filter(row =>
    String(row.orderYear ?? row.OrderYear ?? '').trim() === orderYear &&
    String(row.partnerCode ?? row.PartnerCode ?? '').trim().toLowerCase() === partnerCode &&
    Number(row.pnlKey ?? row.PnlKey) > 0 && Number(row.itemKey ?? row.ItemKey) > 0
  );
  const weekMap = new Map();
  const itemMap = new Map();
  for (const row of scoped) {
    const pnlKey = Number(row.pnlKey ?? row.PnlKey);
    const major = Number(row.major ?? row.MajorWeek);
    if (!Number.isInteger(pnlKey) || pnlKey <= 0 || !Number.isInteger(major) || major <= 0) continue;
    if (!weekMap.has(pnlKey)) weekMap.set(pnlKey, {
      key: String(pnlKey), pnlKey, major, label: `${major}차`, title: String(row.title ?? row.Title ?? ''),
      updatedAt: row.pnlUpdatedAt ?? row.PnlUpdatedAt ?? null,
    });
    const itemIdentity = identity(row);
    if (!itemIdentity) continue;
    if (!itemMap.has(itemIdentity)) itemMap.set(itemIdentity, {
      identity: itemIdentity,
      name: String(row.name ?? row.Name ?? row.itemName ?? row.ItemName ?? ''),
      prodKey: positiveProdKey(row.prodKey ?? row.ProdKey),
      prodName: String(row.prodName ?? row.ProdName ?? ''),
      unit: normSpace(row.unit ?? row.Unit),
      isCustom: !!(row.isCustom ?? row.IsCustom),
      cells: new Map(),
    });
    const item = itemMap.get(itemIdentity);
    if (!item.cells.has(pnlKey)) item.cells.set(pnlKey, []);
    item.cells.get(pnlKey).push(row);
  }
  const weeks = [...weekMap.values()].sort((a, b) => b.major - a.major || b.pnlKey - a.pnlKey);
  const items = [...itemMap.values()].map(item => ({
    ...item,
    cells: weeks.map(week => {
      const cellRows = item.cells.get(week.pnlKey) || [];
      const values = [...new Set(cellRows
        .map(row => row.costPrice ?? row.CostPrice)
        .filter(value => value != null && String(value).trim() !== '')
        .map(Number)
        .filter(Number.isFinite))].sort((a, b) => a - b);
      const salePrices = [...new Set(cellRows
        .map(row => row.salePrice ?? row.SalePrice)
        .filter(value => value != null && String(value).trim() !== '')
        .map(Number)
        .filter(Number.isFinite))].sort((a, b) => a - b);
      const costRows = cellRows.filter(row => {
        const cost = row.costPrice ?? row.CostPrice;
        if (cost == null || String(cost).trim() === '') return false;
        const numericCost = Number(cost);
        return Number.isFinite(numericCost);
      });
      const purchaseAmount = costRows.length ? costRows.reduce((sum, row) =>
        sum + Number(row.costPrice ?? row.CostPrice) * Number(row.qty ?? row.Qty ?? 0), 0) : null;
      const saleAmountRows = cellRows.filter(row => {
        const amount = row.saleAmount ?? row.SaleAmount;
        return amount != null && String(amount).trim() !== '' && Number.isFinite(Number(amount));
      });
      const saleAmount = saleAmountRows.length
        ? saleAmountRows.reduce((sum, row) => sum + Number(row.saleAmount ?? row.SaleAmount), 0)
        : null;
      return cellRows.length ? {
        key: `${week.pnlKey}|${item.identity}`,
        pnlKey: week.pnlKey,
        major: week.major,
        identity: item.identity,
        values,
        salePrices,
        purchaseAmount,
        missingCostRows: cellRows.length - costRows.length,
        saleAmount,
        missingSaleAmountRows: cellRows.length - saleAmountRows.length,
        qty: cellRows.reduce((sum, row) => sum + Number(row.qty ?? row.Qty ?? 0), 0),
        snapshot: raumPnlCostSnapshot(cellRows),
        rowCount: cellRows.length,
      } : null;
    }),
  })).sort((a, b) => (a.prodName || a.name).localeCompare(b.prodName || b.name, 'ko'));
  return { weeks, items };
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
