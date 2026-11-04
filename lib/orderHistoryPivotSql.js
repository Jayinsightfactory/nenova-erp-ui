// nenova.exe FormOrderHistory.GetData (발주 관리 · 발주 목록) 원본 SQL.
// dnSpy 추출 (C:\Users\USER\nenova-decompiled\Nenova\FormOrderHistory.cs). 읽기 전용이며
// 조건은 파라미터 바인딩으로만 붙인다. 원장 쓰기·SP 호출 없음.

/** exe 와 동일한 SELECT. week/countryFlower 는 있을 때만 AND 조건으로 추가된다. */
export function sqlOrderHistoryPivotGetData({ week, countryFlower } = {}) {
  let text = `SELECT CONVERT(VARCHAR, oh.ChangeDtm, 23) ChangeDtm,
       o.OrderWeek,
       c.CustName,
       p.CounName,
       p.FlowerName,
       p.ProdName,
       o.OrderCode,
       oh.ChangeType,
       oh.ColumName,
       (oh.AfterValue - ISNULL(oh.BeforeValue,0)) AfterValue,
       u.UserName ChangeUser,
       p.OutUnit
  FROM ViewOrder o
  JOIN OrderHistory oh ON o.OrderDetailKey = oh.OrderDetailKey
  JOIN Customer c ON o.CustKey = c.CustKey
  JOIN Product p ON o.ProdKey = p.ProdKey
  JOIN UserInfo u ON oh.ChangeID = u.UserID
 WHERE 1 = 1 `;
  if (week) text += ' AND o.OrderWeek = @week ';
  if (countryFlower) text += ' AND p.CountryFlower = @countryFlower ';
  return text;
}

/** exe LogicManager.Common.GetOrderWeek: StockMaster 차수 목록, 최신순. */
export const SQL_ORDER_HISTORY_WEEKS = `SELECT OrderYear, OrderWeek, (OrderYear + OrderWeek) OrderYearWeek
  FROM StockMaster
 GROUP BY OrderYear, OrderWeek
 ORDER BY OrderYear DESC, OrderWeek DESC`;

/** exe LogicManager.Common.GetCountryFlower(true): 빈값 항목 + ViewCountry. */
export const SQL_ORDER_HISTORY_COUNTRY_FLOWERS = `SELECT 0 CounKey, '' CountryFlower, '' CounName
 UNION ALL
SELECT CounKey, CountryFlower, CounName
  FROM ViewCountry`;
