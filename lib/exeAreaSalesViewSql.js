/**
 * nenova.exe FormAreaSalesView.GetData
 */
export function sqlAreaSalesByArea() {
  return `
SELECT ISNULL(NULLIF(v1.CustArea, N''), N'미지정') AS CustArea,
       v1.Amount AS Amount1,
       v2.Amount AS Amount2,
       CASE WHEN ISNULL(v2.Amount, 0) = 0 THEN 0
            ELSE ((v1.Amount - v2.Amount) / v2.Amount) * 100 END AS Rate
  FROM (
    SELECT c.CustArea, SUM(vs.Amount) AS Amount
      FROM ViewShipment vs
      JOIN ViewOrder vo
        ON vs.OrderYearWeek2 = vo.OrderYearWeek2
       AND vs.CustKey = vo.CustKey
       AND vs.ProdKey = vo.ProdKey
      JOIN Customer c ON vs.CustKey = c.CustKey
     WHERE vs.OrderYearWeek = @week1
       AND vs.DetailFix = 1
     GROUP BY c.CustArea
  ) v1
  LEFT JOIN (
    SELECT c.CustArea, SUM(vs.Amount) AS Amount
      FROM ViewShipment vs
      JOIN ViewOrder vo
        ON vs.OrderYearWeek2 = vo.OrderYearWeek2
       AND vs.CustKey = vo.CustKey
       AND vs.ProdKey = vo.ProdKey
      JOIN Customer c ON vs.CustKey = c.CustKey
     WHERE vs.OrderYearWeek = @week2
       AND vs.DetailFix = 1
     GROUP BY c.CustArea
  ) v2 ON v1.CustArea = v2.CustArea
 ORDER BY v1.CustArea`;
}

export function sqlAreaSalesCountries() {
  return `
SELECT vs.CountryFlower
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek2 = vo.OrderYearWeek2
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
 WHERE vs.OrderYearWeek = @week1
   AND vs.DetailFix = 1
 GROUP BY vs.CountryFlower`;
}

export function sqlAreaSalesPivot(year) {
  return `
SELECT ISNULL(NULLIF(c.CustArea, N''), N'미지정') AS CustArea,
       vs.OrderWeek2,
       vs.Amount
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek2 = vo.OrderYearWeek2
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
  JOIN Customer c ON vs.CustKey = c.CustKey
 WHERE vs.OrderYear = N'${String(year)}'
   AND vs.DetailFix = 1`;
}
