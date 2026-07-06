/**
 * nenova.exe FormSalesManagerView.GetData
 */
export function sqlSalesManagerViewGetData({ managerFilter, areaFilter } = {}) {
  let managerClause = '';
  let areaClause = '';
  if (managerFilter) managerClause = ' AND vo.BusinessManager = @manager';
  if (areaFilter) areaClause = ` WHERE ISNULL(NULLIF(c.CustArea, N''), N'미지정') = @area`;

  return `
SELECT c.CustName,
       ISNULL(NULLIF(c.CustArea, N''), N'미지정') AS CustArea,
       v1.BusinessManager,
       v1.Amount AS Amount1,
       v2.Amount AS Amount2,
       CASE WHEN ISNULL(v2.Amount, 0) = 0 THEN 0
            ELSE ((v1.Amount - v2.Amount) / v2.Amount) * 100 END AS Rate
  FROM (
    SELECT vs.CustKey,
           vo.BusinessManager,
           SUM(vs.Amount) AS Amount
      FROM ViewShipment vs
      JOIN ViewOrder vo
        ON vs.OrderYearWeek2 = vo.OrderYearWeek2
       AND vs.ProdKey = vo.ProdKey
       AND vs.CustKey = vo.CustKey
     WHERE vs.OrderYearWeek = @week1
       AND vs.DetailFix = 1
       ${managerClause}
     GROUP BY vo.BusinessManager, vs.CustKey
  ) v1
  JOIN Customer c ON v1.CustKey = c.CustKey
  LEFT JOIN (
    SELECT vs.CustKey,
           vo.BusinessManager,
           SUM(vs.Amount) AS Amount
      FROM ViewShipment vs
      JOIN ViewOrder vo
        ON vs.OrderYearWeek2 = vo.OrderYearWeek2
       AND vs.ProdKey = vo.ProdKey
       AND vs.CustKey = vo.CustKey
     WHERE vs.OrderYearWeek = @week2
       AND vs.DetailFix = 1
       ${managerClause}
     GROUP BY vo.BusinessManager, vs.CustKey
  ) v2 ON v1.CustKey = v2.CustKey
 ${areaClause}
 ORDER BY c.CustArea, c.CustName`;
}
