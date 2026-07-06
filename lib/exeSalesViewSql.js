/**
 * nenova.exe FormSalesView.GetData — 월별 판매 (ViewShipment+ShipmentDate+PeriodDay)
 */
function monthSalesSubquery(alias, yearMonthParam) {
  return `
SELECT ${alias}.CountryFlower,
       SUM(${alias}.OutQuantity) AS OutQuantity,
       SUM(ISNULL(${alias}.Amount, 0)) AS Amount
  FROM ViewShipment ${alias}
  JOIN ViewOrder vo
    ON ${alias}.OrderYearWeek = vo.OrderYearWeek
   AND ${alias}.CustKey = vo.CustKey
   AND ${alias}.ProdKey = vo.ProdKey
  JOIN ShipmentDate sd ON sd.SdetailKey = ${alias}.SdetailKey
  JOIN PeriodDay pd ON pd.BaseYmd = sd.ShipmentDtm
 WHERE pd.YearMonth = ${yearMonthParam}
   AND ${alias}.DetailFix = 1
 GROUP BY ${alias}.CountryFlower`;
}

export function sqlSalesViewByProduct() {
  return `
SELECT v1.CountryFlower,
       v1.OutQuantity,
       v1.Amount AS Amount1,
       v2.Amount AS Amount2,
       CASE WHEN ISNULL(v2.Amount, 0) = 0 THEN 0
            ELSE ((v1.Amount - v2.Amount) / v2.Amount) * 100 END AS Rate
  FROM (${monthSalesSubquery('vs', '@curMonth')}) v1
  LEFT JOIN (${monthSalesSubquery('vs', '@prevMonth')}) v2
    ON v1.CountryFlower = v2.CountryFlower`;
}

function custMonthSubquery(yearMonthParam) {
  return `
SELECT ROW_NUMBER() OVER (ORDER BY SUM(vs.Amount) DESC) AS rownum,
       vs.CustKey,
       SUM(ISNULL(vs.Amount, 0)) AS Amount
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek = vo.OrderYearWeek
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
  JOIN ShipmentDate sd ON sd.SdetailKey = vs.SdetailKey
  JOIN PeriodDay pd ON pd.BaseYmd = sd.ShipmentDtm
 WHERE pd.YearMonth = ${yearMonthParam}
   AND vs.DetailFix = 1
 GROUP BY vs.CustKey`;
}

export function sqlSalesViewByCustomer() {
  return `
SELECT v1.rownum,
       c.CustArea,
       c.CustName,
       v1.Amount AS Amount1,
       v2.Amount AS Amount2,
       CASE WHEN ISNULL(v2.Amount, 0) = 0 THEN 0
            ELSE ((v1.Amount - v2.Amount) / v2.Amount) * 100 END AS Rate
  FROM (${custMonthSubquery('@curMonth')}) v1
  JOIN Customer c ON v1.CustKey = c.CustKey
  LEFT JOIN (${custMonthSubquery('@prevMonth')}) v2 ON v1.CustKey = v2.CustKey
 ORDER BY v1.rownum`;
}

function mgrMonthSubquery(yearMonthParam) {
  return `
SELECT vo.BusinessManager AS Manager,
       SUM(ISNULL(vs.Amount, 0)) AS Amount
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek = vo.OrderYearWeek
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
  JOIN ShipmentDate sd ON sd.SdetailKey = vs.SdetailKey
  JOIN PeriodDay pd ON pd.BaseYmd = sd.ShipmentDtm
 WHERE pd.YearMonth = ${yearMonthParam}
   AND vs.DetailFix = 1
 GROUP BY vo.BusinessManager`;
}

export function sqlSalesViewByManager() {
  return `
SELECT v1.Manager,
       v1.Amount AS Amount1,
       v2.Amount AS Amount2,
       CASE WHEN ISNULL(v2.Amount, 0) = 0 THEN 0
            ELSE ((v1.Amount - v2.Amount) / v2.Amount) * 100 END AS Rate
  FROM (${mgrMonthSubquery('@curMonth')}) v1
  LEFT JOIN (${mgrMonthSubquery('@prevMonth')}) v2 ON v1.Manager = v2.Manager`;
}

function areaMonthSubquery(yearMonthParam) {
  return `
SELECT c.CustArea,
       SUM(ISNULL(vs.Amount, 0)) AS Amount
  FROM ViewShipment vs
  JOIN ViewOrder vo
    ON vs.OrderYearWeek = vo.OrderYearWeek
   AND vs.CustKey = vo.CustKey
   AND vs.ProdKey = vo.ProdKey
  JOIN Customer c ON vs.CustKey = c.CustKey
  JOIN ShipmentDate sd ON sd.SdetailKey = vs.SdetailKey
  JOIN PeriodDay pd ON pd.BaseYmd = sd.ShipmentDtm
 WHERE pd.YearMonth = ${yearMonthParam}
   AND vs.DetailFix = 1
 GROUP BY c.CustArea`;
}

export function sqlSalesViewByArea() {
  return `
SELECT v1.CustArea,
       v1.Amount AS Amount1,
       v2.Amount AS Amount2,
       CASE WHEN ISNULL(v2.Amount, 0) = 0 THEN 0
            ELSE ((v1.Amount - v2.Amount) / v2.Amount) * 100 END AS Rate
  FROM (${areaMonthSubquery('@curMonth')}) v1
  LEFT JOIN (${areaMonthSubquery('@prevMonth')}) v2 ON v1.CustArea = v2.CustArea`;
}
