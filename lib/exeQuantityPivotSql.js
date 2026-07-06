/**
 * nenova.exe FormQuantityPivot.GetData
 */
export function sqlQuantityPivotGetData() {
  return `
WITH Stock AS (
  SELECT sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek, sm.StockKey,
         LAG(sm.StockKey) OVER (ORDER BY sm.OrderYearWeek) AS PrevStockKey
    FROM StockMaster sm
),
StockList AS (
  SELECT sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek, sm.StockKey, sm.PrevStockKey
    FROM Stock sm
   WHERE sm.OrderYearWeek BETWEEN @weekFrom AND @weekTo
)
SELECT N'01. 전재고' AS ListType,
       s.OrderYear, s.OrderWeek, s.OrderYearWeek,
       ps.ProdKey, p.ProdName, p.CounName, p.FlowerName, p.CountryFlower,
       NULL AS CustKey, NULL AS CustName, NULL AS CustArea,
       N'' AS CustDescr, 0 AS UPrice, 0 AS TPrice, N'' AS OrderNo,
       NULL AS ShipmentDtm, ps.Stock AS Quantity
  FROM StockList s
  JOIN ProductStock ps ON s.PrevStockKey = ps.StockKey
  JOIN Product p ON ps.ProdKey = p.ProdKey
 WHERE ps.Stock != 0
UNION ALL
SELECT N'02. 주문',
       vo.OrderYear, vo.OrderWeek, vo.OrderYearWeek2,
       vo.ProdKey, vo.ProdName, vo.CounName, vo.FlowerName, vo.CountryFlower,
       vo.CustKey, vo.CustName, vo.CustArea, vo.CustDescr,
       0, 0, N'', NULL, vo.OutQuantity
  FROM ViewOrder vo
  JOIN StockList sl ON vo.OrderYearWeek2 = sl.OrderYearWeek
 WHERE vo.OutQuantity > 0
UNION ALL
SELECT N'03. 미발주수량',
       vo.OrderYear, vo.OrderWeek, vo.OrderYearWeek2,
       vo.ProdKey, vo.ProdName, vo.CounName, vo.FlowerName, vo.CountryFlower,
       vo.CustKey, vo.CustName, vo.CustArea, N'',
       0, 0, N'', NULL, vo.OutQuantity
  FROM ViewOrder vo
  JOIN StockList sl ON vo.OrderYearWeek2 = sl.OrderYearWeek
 WHERE vo.NoneOutQuantity > 0
UNION ALL
SELECT N'04. 출고',
       vs.OrderYear, vs.OrderWeek, vs.OrderYearWeek2,
       vs.ProdKey, vs.ProdName, vs.CounName, vs.FlowerName, vs.CountryFlower,
       vs.CustKey, vs.CustName, vs.CustArea, N'',
       0, 0, N'',
       (pd.baseday + N'(' + ci.Descr2 + N')') AS ShipmentDtm,
       sd.ShipmentQuantity
  FROM ViewShipment vs
  JOIN ShipmentDate sd ON vs.SdetailKey = sd.SdetailKey
  JOIN StockList sl ON vs.OrderYearWeek2 = sl.OrderYearWeek
  JOIN PeriodDay pd ON sd.ShipmentDtm = pd.BaseYmd
  JOIN CodeInfo ci ON ci.Category = N'WeekDay' AND ci.DetailCode = pd.WeekDay
 WHERE sd.ShipmentQuantity > 0
UNION ALL
SELECT N'03. 입고',
       vw.OrderYear, vw.OrderWeek, vw.OrderYearWeek2,
       vw.ProdKey, vw.ProdName, vw.CounName, vw.FlowerName, vw.CountryFlower,
       NULL, vw.FarmName, c.CounName, N'',
       ROUND(vw.UPrice, 2), ROUND(vw.TPrice, 2), vw.OrderNo, NULL, vw.OutQuantity
  FROM ViewWarehouse vw
  JOIN StockList sl ON vw.OrderYearWeek2 = sl.OrderYearWeek
  LEFT JOIN Country c ON vw.CounKey = c.CounKey
UNION ALL
SELECT N'05. 현재고',
       s.OrderYear, s.OrderWeek, s.OrderYearWeek,
       ps.ProdKey, p.ProdName, p.CounName, p.FlowerName, p.CountryFlower,
       NULL, NULL, NULL, N'',
       0, 0, N'', NULL, ps.Stock
  FROM StockList s
  JOIN ProductStock ps ON s.StockKey = ps.StockKey
  JOIN Product p ON ps.ProdKey = p.ProdKey
 WHERE ps.Stock != 0
 ORDER BY ListType, OrderYearWeek, ProdName`;
}
