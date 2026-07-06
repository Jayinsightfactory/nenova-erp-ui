/**
 * nenova.exe FormStockView — GetData / StockHistory focus
 */
export function sqlStockViewGetData({ countryFlower } = {}) {
  const countryFilter = countryFlower ? ' AND p.CountryFlower = @countryFlower' : '';
  return `
WITH stock AS (
  SELECT ps.ProdKey, ps.Stock, sm.OrderYearWeek
    FROM StockMaster sm
    JOIN ProductStock ps ON sm.StockKey = ps.StockKey
)
SELECT p.CounName,
       p.FlowerName,
       p.ProdName,
       p.ProdKey,
       p.OutUnit,
       p.EstUnit,
       ISNULL(bs.Stock, 0) AS BeforeStock,
       ISNULL(ns.Stock, 0) AS Stock,
       ISNULL(w.OutQuantity, 0) AS WareQuantity,
       ISNULL(s.OutQuantity, 0) AS ShipQuantity,
       ISNULL(sh.OutQuantity, 0) AS StockQuantity
  FROM Product p
  JOIN stock ns ON ns.OrderYearWeek = @orderYearWeek AND p.ProdKey = ns.ProdKey
  LEFT JOIN stock bs ON bs.OrderYearWeek = @beforeOrderYearWeek AND p.ProdKey = bs.ProdKey
  LEFT JOIN (
    SELECT ProdKey, SUM(vw.OutQuantity) AS OutQuantity
      FROM ViewWarehouse vw
     WHERE OrderYearWeek2 = @orderYearWeek
     GROUP BY ProdKey
  ) w ON p.ProdKey = w.ProdKey
  LEFT JOIN (
    SELECT ProdKey, SUM(vs.OutQuantity) AS OutQuantity
      FROM ViewShipment vs
     WHERE OrderYearWeek2 = @orderYearWeek
     GROUP BY ProdKey
  ) s ON p.ProdKey = s.ProdKey
  LEFT JOIN (
    SELECT sh.ProdKey, ROUND(SUM(sh.AfterValue - sh.BeforeValue), 2) AS OutQuantity
      FROM StockHistory sh
      JOIN CodeInfo ci ON ci.Category = N'StockType' AND sh.ChangeType = ci.Descr
     WHERE sh.OrderYear + REPLACE(sh.OrderWeek, '-', '') = @orderYearWeek
     GROUP BY sh.ProdKey
  ) sh ON p.ProdKey = sh.ProdKey
 WHERE p.isDeleted = 0
   ${countryFilter}
 ORDER BY p.CounName, p.FlowerName, p.ProdName`;
}

export function sqlStockViewHistory() {
  return `
SELECT StockHistoryKey,
       ChangeDtm,
       ChangeID,
       ChangeType,
       ColumName,
       BeforeValue,
       AfterValue,
       (AfterValue - BeforeValue) AS ChangeValue,
       Descr,
       ProdKey
  FROM StockHistory sh
 WHERE ProdKey = @prodKey
   AND ChangeDtm >= DATEADD(week, -2, GETDATE())
 ORDER BY ChangeDtm DESC`;
}
