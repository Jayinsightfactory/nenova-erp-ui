/**
 * nenova.exe FormOrderView.GetData
 */
export function sqlOrderViewGetData({ countryFlower } = {}) {
  const cf = countryFlower ? ' AND p.CountryFlower = @countryFlower' : '';
  return `
SELECT o.OrderMasterKey,
       o.OrderYear,
       o.OrderWeek,
       o.OrderYearWeek,
       o.OrderDtm,
       o.CustKey,
       o.CustName,
       o.CustName + N' (' + o.BusinessManager + N')' AS CustBusiness,
       o.CustArea,
       o.OrderCode,
       o.Descr,
       p.ProdName,
       p.OutUnit,
       o.BoxQuantity,
       o.BunchQuantity,
       o.SteamQuantity,
       o.CounName,
       o.FlowerName,
       o.ProdKey
  FROM ViewOrder o
  JOIN Product p ON o.ProdKey = p.ProdKey
  JOIN Customer c ON o.CustKey = c.CustKey
 WHERE o.OrderDtm BETWEEN @startDate AND @endDate
   ${cf}
 ORDER BY o.OrderMasterKey DESC, p.CounName, p.FlowerName, p.ProdKey`;
}
