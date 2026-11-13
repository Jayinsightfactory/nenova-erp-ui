export function normalizeLedgerAlertScope(year, week) {
  const y=String(year ?? '').trim(), w=String(week ?? '').trim();
  if(!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(w) || Number(w)<1 || Number(w)>53) {
    const error=new Error('조회할 연도와 차수를 선택하세요.'); error.statusCode=400; throw error;
  }
  return {year:y,week:Number(w)};
}

const major = alias => `TRY_CONVERT(int,LEFT(${alias}.OrderWeek,CHARINDEX(N'-',${alias}.OrderWeek+N'-')-1))`;
const deletedProduct = `(p.ProdKey IS NULL OR p.isDeleted=1)`;
export const DELETED_PRODUCT_SHIPMENT_ALERT_SQL=`
SELECT TOP (200) COUNT(*) OVER() TotalCount, N'deleted-product-shipment' Kind,
 sm.OrderYear,sm.OrderWeek,sm.CustKey,c.CustName,sd.ProdKey,p.ProdName,
 sd.OutQuantity Quantity,p.OutUnit Unit,sd.Amount Amount,sd.SdetailKey ReferenceKey
FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
LEFT JOIN Product p ON p.ProdKey=sd.ProdKey LEFT JOIN Customer c ON c.CustKey=sm.CustKey
WHERE sm.OrderYear=@year AND ${major('sm')}=@week AND ISNULL(sm.isDeleted,0)=0
 AND ${deletedProduct}
 AND (ISNULL(sd.OutQuantity,0)<>0 OR ISNULL(sd.EstQuantity,0)<>0 OR ISNULL(sd.Amount,0)<>0 OR ISNULL(sd.Vat,0)<>0
 OR EXISTS(SELECT 1 FROM ShipmentDate dt WHERE dt.SdetailKey=sd.SdetailKey AND
 (ISNULL(dt.ShipmentQuantity,0)<>0 OR ISNULL(dt.EstQuantity,0)<>0 OR ISNULL(dt.Amount,0)<>0 OR ISNULL(dt.Vat,0)<>0)))
ORDER BY sm.OrderWeek,sm.CustKey,sd.ProdKey,sd.SdetailKey`;
export const DELETED_PRODUCT_ESTIMATE_ALERT_SQL=`
SELECT TOP (200) COUNT(*) OVER() TotalCount,N'deleted-product-estimate' Kind,
 sm.OrderYear,sm.OrderWeek,sm.CustKey,c.CustName,e.ProdKey,p.ProdName,
 e.Quantity,e.Unit,e.Amount,e.EstimateKey ReferenceKey
FROM ShipmentMaster sm JOIN Estimate e ON e.ShipmentKey=sm.ShipmentKey
LEFT JOIN Product p ON p.ProdKey=e.ProdKey LEFT JOIN Customer c ON c.CustKey=sm.CustKey
WHERE sm.OrderYear=@year AND ${major('sm')}=@week AND ISNULL(sm.isDeleted,0)=0 AND ${deletedProduct}
 AND (ISNULL(e.Quantity,0)<>0 OR ISNULL(e.Amount,0)<>0 OR ISNULL(e.Vat,0)<>0)
ORDER BY sm.OrderWeek,sm.CustKey,e.ProdKey,e.EstimateKey`;
const linkedColumns=['DeductionKey','OrderYear','OrderWeek','AppliedOrderYear','AppliedOrderWeek','CustKey','CustName','ProdKey','ProdName','Quantity','SourceUnit','EstimateKey','IsDeleted'];
export const LINKED_DEDUCTION_SCHEMA_SQL=`SELECT CASE WHEN ${linkedColumns.map(c=>`COL_LENGTH(N'dbo.WebSalesDefectDeduction',N'${c}') IS NOT NULL`).join(' AND ')} THEN 1 ELSE 0 END Ready`;
export const MISSING_LINKED_DEDUCTION_ALERT_SQL=`
SELECT TOP (200) COUNT(*) OVER() TotalCount,N'missing-linked-deduction' Kind,
 COALESCE(d.AppliedOrderYear,d.OrderYear) OrderYear,COALESCE(d.AppliedOrderWeek,d.OrderWeek) OrderWeek,
 d.CustKey,d.CustName,d.ProdKey,d.ProdName,d.Quantity,d.SourceUnit Unit,
 CAST(NULL AS decimal(18,4)) Amount,d.EstimateKey ReferenceKey,d.DeductionKey
FROM dbo.WebSalesDefectDeduction d
WHERE COALESCE(d.AppliedOrderYear,d.OrderYear)=@year
 AND TRY_CONVERT(int,LEFT(COALESCE(d.AppliedOrderWeek,d.OrderWeek),CHARINDEX(N'-',COALESCE(d.AppliedOrderWeek,d.OrderWeek)+N'-')-1))=@week
 AND ISNULL(d.IsDeleted,0)=0 AND d.EstimateKey>0
 AND NOT EXISTS(SELECT 1 FROM Estimate e WHERE e.EstimateKey=d.EstimateKey)
ORDER BY d.DeductionKey`;

export async function readEstimateLedgerAlerts(query,sql,input) {
  const scope=normalizeLedgerAlertScope(input.year,input.week);
  const params={year:{type:sql.NVarChar,value:scope.year},week:{type:sql.Int,value:scope.week}};
  const results=[];
  for(const text of [DELETED_PRODUCT_SHIPMENT_ALERT_SQL,DELETED_PRODUCT_ESTIMATE_ALERT_SQL])results.push((await query(text,params)).recordset || []);
  const ready=Number((await query(LINKED_DEDUCTION_SCHEMA_SQL,{})).recordset?.[0]?.Ready)===1;
  if(ready)results.push((await query(MISSING_LINKED_DEDUCTION_ALERT_SQL,params)).recordset || []);
  return {scope,rows:results.flat(),total:results.reduce((n,rows)=>n+Number(rows[0]?.TotalCount || 0),0),
    linkedDeductionCheck:ready?'checked':'unavailable',checkedAt:new Date().toISOString()};
}
