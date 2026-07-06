/**
 * nenova.exe FormSalesDefectView.GetData — dnSpy parity
 */
export function sqlSalesDefectOrderYearWeekFromDate() {
  return `SELECT TOP 1 OrderYearWeek FROM PeriodDay WHERE BaseYmd = @baseYmd`;
}

export function sqlSalesDefectProfitSummary() {
  return `
SELECT N'매출액' AS Type,
       SUM(CASE WHEN vs.OrderYearWeek = @week1 THEN vs.Amount ELSE 0 END) AS Amount1,
       SUM(CASE WHEN vs.OrderYearWeek = @week2 THEN vs.Amount ELSE 0 END) AS Amount2
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek2 = vo.OrderYearWeek2
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
 WHERE vs.OrderYearWeek IN (@week1, @week2)
   AND vs.DetailFix = 1`;
}

export function sqlSalesDefectProfitPivot() {
  return `
SELECT N'매출액' AS Type,
       (ISNULL(c.OrderNo, 99) * 100) + ISNULL(f.OrderNo, 0) AS fOrderNo,
       CASE WHEN vs.CounName IN (N'콜롬비아') THEN vs.FlowerName ELSE vs.CounName END AS FlowerName,
       vs.Amount AS Amount
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek2 = vo.OrderYearWeek2
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
  JOIN Country c ON vo.CounName = c.CounName
  JOIN Flower f ON vo.FlowerName = f.FlowerName
 WHERE vs.OrderYearWeek = @week1
   AND vs.DetailFix = 1`;
}

export function sqlSalesDefectDefectSummary() {
  return `
SELECT N'매출액' AS Type,
       0 AS OrderNo,
       SUM(CASE WHEN vs.OrderYearWeek = @week1 THEN vs.Amount ELSE 0 END) AS Amount1,
       SUM(CASE WHEN vs.OrderYearWeek = @week2 THEN vs.Amount ELSE 0 END) AS Amount2
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek2 = vo.OrderYearWeek2
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
 WHERE vs.OrderYearWeek IN (@week1, @week2)
   AND vs.DetailFix = 1
UNION ALL
SELECT CASE WHEN ci.Descr2 IN (N'불량차감', N'검역차감') THEN ci.Descr2 ELSE N'기타' END AS Descr,
       CASE WHEN ci.Descr2 = N'불량차감' THEN 1
            WHEN ci.Descr2 = N'검역차감' THEN 2
            ELSE 3 END AS OrderNo,
       SUM(CASE WHEN sm.OrderYearWeek = @week1 THEN e.Amount ELSE 0 END) AS Amount1,
       SUM(CASE WHEN sm.OrderYearWeek = @week2 THEN e.Amount ELSE 0 END) AS Amount2
  FROM ShipmentMaster sm
  JOIN Estimate e ON sm.ShipmentKey = e.ShipmentKey
  JOIN CodeInfo ci ON e.EstimateType = ci.DetailCode AND ci.Category = N'EstimateType' AND ci.DetailCode <> N'1'
 WHERE sm.OrderYearWeek IN (@week1, @week2)
 GROUP BY CASE WHEN ci.Descr2 IN (N'불량차감', N'검역차감') THEN ci.Descr2 ELSE N'기타' END,
          CASE WHEN ci.Descr2 = N'불량차감' THEN 1 WHEN ci.Descr2 = N'검역차감' THEN 2 ELSE 3 END
 ORDER BY OrderNo`;
}

export function sqlSalesDefectDefectPivot() {
  return `
SELECT N'매출액' AS Type,
       0 AS OrderNo,
       (ISNULL(c.OrderNo, 99) * 100) + ISNULL(f.OrderNo, 0) AS fOrderNo,
       CASE WHEN vs.CounName IN (N'콜롬비아') THEN vs.FlowerName ELSE vs.CounName END AS FlowerName,
       vs.Amount AS Amount
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek2 = vo.OrderYearWeek2
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
  JOIN Country c ON vo.CounName = c.CounName
  JOIN Flower f ON vo.FlowerName = f.FlowerName
 WHERE vs.OrderYearWeek = @week1
   AND vs.DetailFix = 1
UNION ALL
SELECT CASE WHEN ci.Descr2 NOT IN (N'불량차감', N'검역차감') THEN N'기타' ELSE ci.Descr2 END AS Type,
       CASE WHEN ci.Descr2 = N'불량차감' THEN 1 WHEN ci.Descr2 = N'검역차감' THEN 2 ELSE 3 END AS OrderNo,
       (ISNULL(c.OrderNo, 99) * 100) + ISNULL(f.OrderNo, 0) AS fOrderNo,
       CASE WHEN p.CounName IN (N'콜롬비아') THEN p.FlowerName ELSE p.CounName END AS FlowerName,
       e.Amount AS Amount
  FROM ShipmentMaster sm
  JOIN Estimate e ON sm.ShipmentKey = e.ShipmentKey
  JOIN Product p ON e.ProdKey = p.ProdKey
  JOIN Country c ON p.CounName = c.CounName
  JOIN Flower f ON p.FlowerName = f.FlowerName
  JOIN CodeInfo ci ON e.EstimateType = ci.DetailCode AND ci.Category = N'EstimateType' AND ci.DetailCode <> N'1'
 WHERE sm.OrderYearWeek = @week1`;
}

export function sqlSalesDefectWeeklyTrend(year) {
  const y = String(year || new Date().getFullYear());
  return `
SELECT N'매출액' AS Type,
       0 AS OrderNo,
       vs.OrderWeek2 AS OrderWeek,
       vs.Amount AS Amount
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek2 = vo.OrderYearWeek2
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
 WHERE vs.OrderYear = N'${y}'
   AND vs.DetailFix = 1
UNION ALL
SELECT CASE WHEN ci.Descr2 NOT IN (N'불량차감', N'검역차감') THEN N'기타' ELSE ci.Descr2 END AS Type,
       CASE WHEN ci.Descr2 = N'불량차감' THEN 1 WHEN ci.Descr2 = N'검역차감' THEN 2 ELSE 3 END AS OrderNo,
       sm.OrderWeek,
       e.Amount AS Amount
  FROM ShipmentMaster sm
  JOIN Estimate e ON sm.ShipmentKey = e.ShipmentKey
  JOIN CodeInfo ci ON e.EstimateType = ci.DetailCode AND ci.Category = N'EstimateType' AND ci.DetailCode <> N'1'
 WHERE sm.OrderYear = N'${y}'`;
}
