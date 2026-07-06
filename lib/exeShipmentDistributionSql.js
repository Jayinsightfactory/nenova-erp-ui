/**
 * nenova.exe FormShipmentDistribution — GetProductList
 */
export function sqlDistributeGetProductList() {
  return `
WITH stock AS (
  SELECT ps.ProdKey, ps.Stock, sm.OrderYearWeek
    FROM StockMaster sm
    JOIN ProductStock ps ON sm.StockKey = ps.StockKey
)
SELECT vo.ProdKey,
       p.ProdName,
       p.OutUnit,
       p.EstUnit,
       ISNULL(vw.wBoxQuantity, 0) AS wBoxQuantity,
       ISNULL(vw.wBunchQuantity, 0) AS wBunchQuantity,
       ISNULL(vw.wSteamQuantity, 0) AS wSteamQuantity,
       ISNULL(vw.wOutQuantity, 0) AS wOutQuantity,
       ISNULL(vs.sOutQuantity, 0) AS sOutQuantity,
       ISNULL(vs.sEstQuantity, 0) AS sEstQuantity,
       ISNULL(bs.Stock, 0) AS BeforeStock,
       ISNULL(ns.Stock, 0) AS Stock
  FROM (
    SELECT OrderYear, OrderWeek, OrderYearWeek2 AS OrderYearWeek, ProdKey
      FROM ViewOrder
     GROUP BY OrderYear, OrderWeek, OrderYearWeek2, ProdKey
  ) vo
  JOIN Product p ON vo.ProdKey = p.ProdKey
  JOIN stock ns ON vo.OrderYearWeek = ns.OrderYearWeek AND p.ProdKey = ns.ProdKey
  LEFT JOIN stock bs ON bs.OrderYearWeek = @beforeOrderYearWeek AND p.ProdKey = bs.ProdKey
  LEFT JOIN (
    SELECT OrderYear, OrderWeek, ProdKey,
           SUM(BoxQuantity) AS wBoxQuantity,
           SUM(BunchQuantity) AS wBunchQuantity,
           SUM(SteamQuantity) AS wSteamQuantity,
           SUM(OutQuantity) AS wOutQuantity
      FROM ViewWarehouse
     GROUP BY OrderYear, OrderWeek, ProdKey
  ) vw ON vo.OrderYear = vw.OrderYear AND vo.OrderWeek = vw.OrderWeek AND vo.ProdKey = vw.ProdKey
  LEFT JOIN (
    SELECT OrderYear, OrderWeek, ProdKey,
           SUM(OutQuantity) AS sOutQuantity,
           SUM(EstQuantity) AS sEstQuantity
      FROM ViewShipment
     GROUP BY OrderYear, OrderWeek, ProdKey
  ) vs ON vo.OrderYear = vs.OrderYear AND vo.OrderWeek = vs.OrderWeek AND vo.ProdKey = vs.ProdKey
 WHERE vo.OrderYear = @orderYear
   AND vo.OrderWeek = @orderWeek
   AND p.CountryFlower = @countryFlower
 ORDER BY p.CounName, p.FlowerName, p.ProdName`;
}

/** exe GetCustomerList — 업체 탭 좌측 그리드 */
export function sqlDistributeGetCustomerList() {
  return `
SELECT vo.CustKey,
       c.CustName,
       vo.oOutQuantity AS OutQuantity,
       vs.ShipmentDtm,
       vs.isTemp,
       vs.ShipmentDay
  FROM (
    SELECT CustKey, SUM(OutQuantity) AS oOutQuantity, OrderYear, OrderWeek
      FROM ViewOrder
     WHERE OrderYear = @orderYear
       AND OrderWeek = @orderWeek
       AND CountryFlower = @countryFlower
     GROUP BY OrderYear, OrderWeek, CustKey
  ) vo
  JOIN (
    SELECT vs.OrderYear, vs.OrderWeek, vs.CustKey,
           CASE WHEN COUNT(DISTINCT s.ShipmentDtm) > 1 THEN NULL ELSE MAX(vs.ShipmentDtm) END AS ShipmentDtm,
           CASE WHEN COUNT(DISTINCT s.ShipmentDtm) > 1 THEN 1 ELSE 0 END AS isTemp,
           CASE WHEN COUNT(DISTINCT s.ShipmentDtm) > 1 THEN NULL ELSE DATEPART(weekday, MAX(vs.ShipmentDtm)) END AS ShipmentDay
      FROM ViewShipment vs
      JOIN ShipmentDate s ON vs.SdetailKey = s.SdetailKey
     WHERE vs.OrderYear = @orderYear
       AND vs.OrderWeek = @orderWeek
       AND vs.CountryFlower = @countryFlower
     GROUP BY vs.OrderYear, vs.OrderWeek, vs.CustKey
  ) vs ON vo.OrderYear = vs.OrderYear AND vo.OrderWeek = vs.OrderWeek AND vo.CustKey = vs.CustKey
  JOIN Customer c ON vo.CustKey = c.CustKey
 ORDER BY c.CustArea, c.CustName`;
}

/** exe grdViewCust_FocusedRowChanged — 요일별 출고 그리드 */
export function sqlDistributeGetCustWeekGrid() {
  return `
WITH ShipList AS (
  SELECT vs.SdetailKey, vs.ProdKey, p.ProdName, p.OutUnit, p.EstUnit,
         vs.OutQuantity, p.BunchOf1Box, p.SteamOf1Bunch, p.SteamOf1Box
    FROM ViewShipment vs
    JOIN Product p ON vs.ProdKey = p.ProdKey
   WHERE vs.CustKey = @custKey
     AND vs.OrderYear = @orderYear
     AND vs.OrderWeek = @orderWeek
     AND vs.CountryFlower = @countryFlower
),
ProductWeekDays AS (
  SELECT ap.SdetailKey, ap.ProdKey, wd.WeekDay, wd.BaseYmd
    FROM (SELECT DISTINCT SdetailKey, ProdKey FROM ShipList) ap
    CROSS JOIN (
      SELECT WeekDay, BaseYmd FROM PeriodDay WHERE OrderYearWeek = @orderYearWeekPrefix
    ) wd
),
Shipments AS (
  SELECT pwd.SdetailKey,
         MAX(CASE WHEN pwd.WeekDay = 2 THEN pwd.BaseYmd END) AS ymd2,
         SUM(CASE WHEN pwd.WeekDay = 2 THEN ISNULL(sd.ShipmentQuantity, 0) END) AS day2,
         MAX(CASE WHEN pwd.WeekDay = 3 THEN pwd.BaseYmd END) AS ymd3,
         SUM(CASE WHEN pwd.WeekDay = 3 THEN ISNULL(sd.ShipmentQuantity, 0) END) AS day3,
         MAX(CASE WHEN pwd.WeekDay = 4 THEN pwd.BaseYmd END) AS ymd4,
         SUM(CASE WHEN pwd.WeekDay = 4 THEN ISNULL(sd.ShipmentQuantity, 0) END) AS day4,
         MAX(CASE WHEN pwd.WeekDay = 5 THEN pwd.BaseYmd END) AS ymd5,
         SUM(CASE WHEN pwd.WeekDay = 5 THEN ISNULL(sd.ShipmentQuantity, 0) END) AS day5,
         MAX(CASE WHEN pwd.WeekDay = 6 THEN pwd.BaseYmd END) AS ymd6,
         SUM(CASE WHEN pwd.WeekDay = 6 THEN ISNULL(sd.ShipmentQuantity, 0) END) AS day6,
         MAX(CASE WHEN pwd.WeekDay = 7 THEN pwd.BaseYmd END) AS ymd7,
         SUM(CASE WHEN pwd.WeekDay = 7 THEN ISNULL(sd.ShipmentQuantity, 0) END) AS day7,
         MAX(CASE WHEN pwd.WeekDay = 1 THEN pwd.BaseYmd END) AS ymd1,
         SUM(CASE WHEN pwd.WeekDay = 1 THEN ISNULL(sd.ShipmentQuantity, 0) END) AS day1
    FROM ProductWeekDays pwd
    LEFT JOIN (
      SELECT vs.ProdKey, pd.WeekDay, sd.ShipmentQuantity
        FROM ShipList vs
        JOIN ShipmentDate sd ON vs.SdetailKey = sd.SdetailKey
        JOIN PeriodDay pd ON sd.ShipmentDtm = pd.BaseYmd
    ) sd ON sd.ProdKey = pwd.ProdKey AND sd.WeekDay = pwd.WeekDay
   GROUP BY pwd.SdetailKey
)
SELECT sl.SdetailKey, sl.ProdKey, sl.ProdName, sl.OutQuantity, sl.OutUnit, sl.EstUnit,
       sl.BunchOf1Box, sl.SteamOf1Bunch, sl.SteamOf1Box,
       s.ymd1, s.ymd2, s.ymd3, s.ymd4, s.ymd5, s.ymd6, s.ymd7,
       s.day1, s.day2, s.day3, s.day4, s.day5, s.day6, s.day7
  FROM ShipList sl
  JOIN Shipments s ON sl.SdetailKey = s.SdetailKey
 ORDER BY sl.ProdName`;
}

/** exe grdViewProduct_FocusedRowChanged — 품목 선택 시 거래처별 출고 그리드 */
export function sqlDistributeGetProductShipmentGrid() {
  return `
SELECT vs.SdetailKey,
       vo.CustKey,
       vo.ProdKey,
       vo.CustName,
       vo.OrderCode,
       p.OutUnit,
       p.EstUnit,
       p.BunchOf1Box,
       p.SteamOf1Bunch,
       p.SteamOf1Box,
       ISNULL(vs.Cost, ISNULL(c.Cost, 0)) AS Cost,
       vo.OutQuantity AS oOutQuantity,
       vs.BoxQuantity AS sBoxQuantity,
       vs.BunchQuantity AS sBunchQuantity,
       vs.SteamQuantity AS sSteamQuantity,
       ISNULL(vs.OutQuantity, 0) AS sOutQuantity,
       vs.EstQuantity AS sEstQuantity,
       vs.Descr
  FROM ViewOrder vo
  JOIN Product p ON vo.ProdKey = p.ProdKey
  LEFT JOIN CustomerProdCost c ON vo.CustKey = c.CustKey AND vo.ProdKey = c.ProdKey
  LEFT JOIN ViewShipment vs
    ON vo.OrderYear = vs.OrderYear
   AND vo.OrderWeek = vs.OrderWeek
   AND vo.ProdKey = vs.ProdKey
   AND vo.CustKey = vs.CustKey
 WHERE vo.OrderYear = @orderYear
   AND vo.OrderWeek = @orderWeek
   AND vo.ProdKey = @prodKey
 ORDER BY vo.CustArea, vo.CustName`;
}

/** exe grdViewShipment_FocusedRowChanged — 농장별 입고/출고 잔량 */
export function sqlDistributeGetShipmentFarmGrid() {
  return `
WITH WarehouseSummary AS (
  SELECT vw.OrderYear,
         vw.OrderWeek,
         vw.FarmName,
         vw.OrderCode,
         vw.ProdKey,
         SUM(vw.OutQuantity) AS wOutQuantity
    FROM ViewWarehouse vw
   GROUP BY vw.OrderYear, vw.OrderWeek, vw.FarmName, vw.OrderCode, vw.ProdKey
)
SELECT ws.FarmName,
       ISNULL(f.FarmKey, 0) AS FarmKey,
       ISNULL(f.FarmCode, SUBSTRING(ws.FarmName, 1, 1)) AS FarmCode,
       ws.OrderCode,
       ws.wOutQuantity,
       COALESCE(s.tOutQuantity, 0) AS sOutQuantity,
       (ws.wOutQuantity - COALESCE(st.tOutQuantity, 0)) AS Remainuantity
  FROM WarehouseSummary ws
  LEFT JOIN Farm f ON ws.FarmName = f.FarmName
  LEFT JOIN (
    SELECT vs.OrderYear,
           vs.OrderWeek,
           vs.ProdKey,
           sf.SdetailKey,
           SUM(sf.ShipmentQuantity) AS tOutQuantity
      FROM ViewShipment vs
      JOIN ShipmentFarm sf ON vs.SdetailKey = sf.SdetailKey
     WHERE sf.SdetailKey = @sdetailKey
     GROUP BY vs.OrderYear, vs.OrderWeek, vs.ProdKey, sf.SdetailKey
  ) s ON ws.OrderYear = s.OrderYear
     AND ws.OrderWeek = s.OrderWeek
     AND ws.ProdKey = s.ProdKey
  LEFT JOIN (
    SELECT vs.OrderYear,
           vs.OrderWeek,
           vs.ProdKey,
           SUM(sf.ShipmentQuantity) AS tOutQuantity
      FROM ViewShipment vs
      JOIN ShipmentFarm sf ON vs.SdetailKey = sf.SdetailKey
     GROUP BY vs.OrderYear, vs.OrderWeek, vs.ProdKey
  ) st ON ws.OrderYear = st.OrderYear
      AND ws.OrderWeek = st.OrderWeek
      AND ws.ProdKey = st.ProdKey
 WHERE ws.ProdKey = @prodKey
 ORDER BY ws.FarmName, ws.OrderCode`;
}

/** exe GetPivotData — 출고 분배 집계 피벗 원본 */
export function sqlDistributeGetPivotData() {
  return `
SELECT vs.OrderYear,
       vs.OrderWeek,
       vs.CounName,
       vs.FlowerName,
       vs.CountryFlower,
       vs.ProdName,
       vs.CustName,
       vs.CustArea,
       vo.Manager,
       vo.OutQuantity AS oOutQuantity,
       vs.OutQuantity AS sOutQuantity
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderWeek = vo.OrderWeek
   AND vs.OrderYear = vo.OrderYear
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
 WHERE vs.OrderYear = @orderYear
   AND vs.OrderWeek = @orderWeek
   AND vs.CountryFlower = @countryFlower
   AND vs.OutQuantity > 0
 ORDER BY vs.CustArea, vs.CustName, vs.ProdName`;
}
