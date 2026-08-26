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

export function filterPricingCustomers(customers, search) {
  const rows = Array.isArray(customers) ? customers : [];
  const term = String(search || '').trim().toLocaleLowerCase();
  if (term) {
    return rows.filter((c) =>
      String(c.CustName || '').toLocaleLowerCase().includes(term) ||
      String(c.Manager || '').toLocaleLowerCase().includes(term)
    );
  }
  return rows.filter((c) => c.HasRecentTrade === true || c.HasRecentTrade === 1 || c.HasRecentTrade === '1');
}

export function toggleVisiblePricingCustomers(selected, visible) {
  const next = new Set(selected || []);
  const keys = (Array.isArray(visible) ? visible : []).map((c) => c.CustKey);
  if (keys.length > 0 && keys.every((key) => next.has(key))) keys.forEach((key) => next.delete(key));
  else keys.forEach((key) => next.add(key));
  return next;
}
