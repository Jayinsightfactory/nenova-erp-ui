// Shared customer-selection policy. This module is safe to import in the browser:
// it contains no database dependency.

export const RECENT_CUSTOMER_SQL = `
WITH RecentTrade AS (
  SELECT om.CustKey, om.OrderDtm AS TradeDtm
    FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
   WHERE ISNULL(om.isDeleted, 0) = 0
     AND ISNULL(od.isDeleted, 0) = 0
     AND ISNULL(od.OutQuantity, 0) > 0
     AND om.OrderDtm >= DATEADD(day, -89, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
     AND om.OrderDtm < DATEADD(day, 1, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
  UNION ALL
  SELECT sm.CustKey, sd.ShipmentDtm AS TradeDtm
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
   WHERE ISNULL(sm.isDeleted, 0) = 0
     AND ISNULL(sd.OutQuantity, 0) > 0
     AND sd.ShipmentDtm >= DATEADD(day, -89, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
     AND sd.ShipmentDtm < DATEADD(day, 1, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
), RecentCustomer AS (
  SELECT CustKey, MAX(TradeDtm) AS LastTradeDtm
    FROM RecentTrade
   GROUP BY CustKey
)
SELECT c.CustKey, c.CustName, c.Manager, c.CustArea,
       CONVERT(bit, CASE WHEN rc.CustKey IS NULL THEN 0 ELSE 1 END) AS HasRecentTrade,
       rc.LastTradeDtm
  FROM Customer c
  LEFT JOIN RecentCustomer rc ON rc.CustKey = c.CustKey
 WHERE ISNULL(c.isDeleted, 0) = 0
   AND c.Manager IS NOT NULL AND LTRIM(RTRIM(c.Manager)) <> ''
  ORDER BY CASE WHEN rc.CustKey IS NULL THEN 1 ELSE 0 END,
          rc.LastTradeDtm DESC, c.CustName, c.CustKey ASC`;

// Product recency is global (all active customers) and is deliberately
// independent from the CustomerProdCost/EXE parity read.  The PK joins keep
// rolling dates from accidentally matching a same-week master in another year.
export const RECENT_PRODUCT_SQL = `
WITH RecentTrade AS (
  SELECT od.ProdKey, om.OrderDtm AS TradeDtm
    FROM OrderMaster om
    JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
   WHERE ISNULL(om.isDeleted, 0) = 0
     AND ISNULL(od.isDeleted, 0) = 0
     AND od.ProdKey IS NOT NULL
     AND ISNULL(od.OutQuantity, 0) > 0
     AND om.OrderDtm >= DATEADD(day, -89, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
     AND om.OrderDtm < DATEADD(day, 1, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
  UNION ALL
  SELECT sd.ProdKey, sd.ShipmentDtm AS TradeDtm
    FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
   WHERE ISNULL(sm.isDeleted, 0) = 0
     AND sd.ProdKey IS NOT NULL
     AND ISNULL(sd.OutQuantity, 0) > 0
     AND sd.ShipmentDtm >= DATEADD(day, -89, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
     AND sd.ShipmentDtm < DATEADD(day, 1, CONVERT(date, DATEADD(hour, 9, SYSUTCDATETIME())))
), RecentProduct AS (
  SELECT ProdKey, MAX(TradeDtm) AS LastTradeDtm
    FROM RecentTrade
   GROUP BY ProdKey
)
SELECT ProdKey, CONVERT(bit, 1) AS HasRecentTrade, LastTradeDtm
  FROM RecentProduct`;

function isRecentTradeValue(value) {
  return value === true || value === 1 || value === '1';
}

export function filterPricingCustomers(customers, search) {
  const rows = Array.isArray(customers) ? customers : [];
  const term = String(search || '').trim().toLocaleLowerCase();
  if (term) {
    return rows.filter((c) =>
      String(c.CustName || '').toLocaleLowerCase().includes(term) ||
      String(c.Manager || '').toLocaleLowerCase().includes(term)
    );
  }
  return rows.filter((c) => isRecentTradeValue(c.HasRecentTrade));
}

export function toggleVisiblePricingCustomers(selected, visible) {
  const next = new Set(selected || []);
  const keys = (Array.isArray(visible) ? visible : []).map((c) => c.CustKey);
  if (keys.length > 0 && keys.every((key) => next.has(key))) keys.forEach((key) => next.delete(key));
  else keys.forEach((key) => next.add(key));
  return next;
}

// Product selection is independent from customer recency selection. A new
// query starts with recent products selected; explicit search can select others. Filtering never
// removes hidden or manually deselected products.
export function filterPricingProducts(products, search, { recentOnly = false } = {}) {
  const rows = Array.isArray(products) ? products : [];
  const term = String(search || '').trim().toLocaleLowerCase();
  const scoped = recentOnly ? rows.filter((p) => isRecentTradeValue(p.HasRecentTrade)) : rows;
  if (!term) return scoped;
  return scoped.filter((p) => [p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.ProdCode]
    .some((value) => String(value || '').toLocaleLowerCase().includes(term)));
}

export function selectRecentPricingProducts(products) {
  return new Set((Array.isArray(products) ? products : [])
    .filter((p) => isRecentTradeValue(p.HasRecentTrade)).map((p) => p.ProdKey));
}

export function selectAllPricingProducts(products) {
  return new Set((Array.isArray(products) ? products : []).map((p) => p.ProdKey));
}

export function toggleVisiblePricingProducts(selected, visible) {
  const next = new Set(selected || []);
  const keys = (Array.isArray(visible) ? visible : []).map((p) => p.ProdKey);
  if (keys.length > 0 && keys.every((key) => next.has(key))) keys.forEach((key) => next.delete(key));
  else keys.forEach((key) => next.add(key));
  return next;
}

export function visiblePricingProducts(products, selected, { search = '', hideNoCost = false, hasCostMap = {} } = {}) {
  const selectedSet = new Set(selected || []);
  let rows = filterPricingProducts(products, search).filter((p) => selectedSet.has(p.ProdKey));
  if (hideNoCost) rows = rows.filter((p) => hasCostMap[p.ProdKey]);
  return rows;
}

// The caller supplies the already-visible product order, so filtered or
// deselected rows are skipped while the customer column remains unchanged.
export function nextPricingCustomerCellKey(currentKey, visibleProducts) {
  const match = String(currentKey || '').match(/^([^_]+)_(.+)$/);
  if (!match || !Array.isArray(visibleProducts)) return null;
  const customerKey = match[1];
  const productKey = match[2];
  const index = visibleProducts.findIndex((product) => String(product?.ProdKey) === productKey);
  if (index < 0 || index >= visibleProducts.length - 1) return null;
  return `${customerKey}_${visibleProducts[index + 1].ProdKey}`;
}
