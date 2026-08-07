const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value) => Math.round((finite(value) + Number.EPSILON) * 1000) / 1000;

export function calculateStockPosition({ confirmedStock, pendingAllocation }) {
  const confirmed = round(confirmedStock);
  const pending = Math.max(0, round(pendingAllocation));
  return {
    confirmedStock: confirmed,
    pendingAllocation: pending,
    expectedStock: round(confirmed - pending),
  };
}

export function signedStockHistoryDelta({ source, quantity, beforeValue, afterValue }) {
  if (source === 'WAREHOUSE') return round(Math.abs(finite(quantity)));
  if (source === 'SHIPMENT_CONFIRMED' || source === 'SHIPMENT_PENDING') {
    return round(-Math.abs(finite(quantity)));
  }
  if (source === 'MANUAL_ADJUSTMENT') return round(finite(afterValue) - finite(beforeValue));
  throw new Error(`지원하지 않는 재고 이력 source: ${source}`);
}

export function normalizeStockHistoryRow(row) {
  const source = row.Source;
  const delta = signedStockHistoryDelta({
    source,
    quantity: row.Quantity,
    beforeValue: row.BeforeValue,
    afterValue: row.AfterValue,
  });
  return {
    source,
    date: row.EventDtm,
    type: row.ChangeType,
    delta,
    affectsConfirmedStock: source !== 'SHIPMENT_PENDING',
    affectsExpectedStock: true,
    descr: row.Descr || '',
  };
}

export function rankSubstituteCandidates(rows, target) {
  return rows
    .filter((row) => Number(row.ProdKey) !== Number(target.prodKey))
    .filter((row) => !target.countryFlower || row.CountryFlower === target.countryFlower)
    .filter((row) => !target.outUnit || row.OutUnit === target.outUnit)
    .map((row) => ({
      ...row,
      expectedStock: calculateStockPosition({
        confirmedStock: row.ConfirmedStock,
        pendingAllocation: row.PendingAllocation,
      }).expectedStock,
    }))
    .filter((row) => row.expectedStock > 0)
    .sort((a, b) => b.expectedStock - a.expectedStock || Number(a.ProdKey) - Number(b.ProdKey));
}

export const STOCK_HISTORY_SQL = `
SELECT 'WAREHOUSE' AS Source, wm.InputDate AS EventDtm, N'입고' AS ChangeType,
       wd.OutQuantity AS Quantity, NULL AS BeforeValue, NULL AS AfterValue, wm.FarmName AS Descr
  FROM WarehouseDetail wd
  JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
 WHERE wd.ProdKey=@pk AND wm.OrderYear=@year AND wm.OrderWeek=@week AND wm.isDeleted=0
UNION ALL
SELECT CASE WHEN ISNULL(sd.isFix,0)=1 THEN 'SHIPMENT_CONFIRMED' ELSE 'SHIPMENT_PENDING' END,
       sd.CreateDtm, CASE WHEN ISNULL(sd.isFix,0)=1 THEN N'확정출고' ELSE N'미확정분배' END,
       sd.OutQuantity, NULL, NULL, c.CustName
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Customer c ON sm.CustKey=c.CustKey
 WHERE sd.ProdKey=@pk AND sm.OrderYear=@year AND sm.OrderWeek=@week AND sm.isDeleted=0
UNION ALL
SELECT 'MANUAL_ADJUSTMENT', sh.ChangeDtm, sh.ChangeType, NULL, sh.BeforeValue, sh.AfterValue, sh.Descr
  FROM StockHistory sh
 WHERE sh.ProdKey=@pk AND sh.OrderYear=@year AND sh.OrderWeek=@week
   AND sh.ChangeType NOT IN (N'입고', N'출고')`;

export const STOCK_POSITION_SQL = `
SELECT p.ProdKey, p.ProdName, p.CountryFlower, p.OutUnit,
       ISNULL(ps.Stock,0) AS ConfirmedStock,
       ISNULL(pending.OutQuantity,0) AS PendingAllocation
  FROM Product p
  LEFT JOIN ProductStock ps ON ps.ProdKey=p.ProdKey AND ps.StockKey=@stockKey
  LEFT JOIN (
    SELECT sd.ProdKey, SUM(ISNULL(sd.OutQuantity,0)) AS OutQuantity
      FROM ShipmentDetail sd
      JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
     WHERE sm.OrderYear=@year AND sm.OrderWeek=@week AND sm.isDeleted=0
       AND ISNULL(sd.isFix,0)<>1
     GROUP BY sd.ProdKey
  ) pending ON pending.ProdKey=p.ProdKey
 WHERE p.isDeleted=0`;
