// Diagnostic reads only. A candidate is never an automatic registration decision.
const major=a=>`TRY_CONVERT(int,LEFT(${a}.OrderWeek,CHARINDEX(N'-',${a}.OrderWeek+N'-')-1))`;
export const REVIEW_SOURCE_SQL=`SELECT d.DeductionKey,d.OrderYear,d.OrderWeek,d.AppliedOrderYear,d.AppliedOrderWeek,
 d.CustKey,d.CustName,d.ProdKey,d.ProdName,d.ColorName,d.Quantity,d.SourceUnit,d.Note,d.SourceFileName,
 d.EstimateKey,d.EstimateCost,d.Status,d.IsDeleted,
 CONVERT(varchar(19),d.CreatedAt,120) CreatedAt,CONVERT(varchar(19),d.UpdatedAt,120) UpdatedAt
 FROM WebSalesDefectDeduction d WHERE d.DeductionKey=@id
 AND COALESCE(d.AppliedOrderYear,d.OrderYear)=@year
 AND TRY_CONVERT(int,LEFT(COALESCE(d.AppliedOrderWeek,d.OrderWeek),CHARINDEX(N'-',COALESCE(d.AppliedOrderWeek,d.OrderWeek)+N'-')-1))=@week`;
export const REVIEW_HISTORY_SQL=`SELECT HistoryKey,ActionType,CONVERT(varchar(19),ChangedAt,120) ChangedAt,BeforeJson,AfterJson
 FROM WebSalesDefectDeductionHistory WHERE DeductionKey=@id ORDER BY HistoryKey`;
export const REVIEW_ESTIMATES_SQL=`SELECT e.EstimateKey,e.ProdKey,e.Quantity,e.Unit,e.Cost,e.Amount,e.Vat,e.EstimateDtm,
 sm.OrderYear,sm.OrderWeek,sm.CustKey,sm.isDeleted MasterDeleted,
 CASE WHEN sm.OrderYear=@year AND ${major('sm')}=@week THEN 1 ELSE 0 END InCurrentScope,
 d.DeductionKey OwnerKey,d.OrderYear SourceYear,d.OrderWeek SourceWeek,d.Quantity SourceQuantity,d.SourceUnit,d.IsDeleted SourceDeleted
 FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
 LEFT JOIN WebSalesDefectDeduction d ON d.EstimateKey=e.EstimateKey
 OR EXISTS(SELECT 1 FROM WebSalesCarryoverApplication a WHERE a.EstimateKey=e.EstimateKey AND a.DeductionKey=d.DeductionKey)
 WHERE sm.CustKey=@cust AND e.ProdKey=@prod AND (sm.OrderYear=@year OR sm.OrderYear=@sourceYear)
 ORDER BY sm.OrderYear DESC,sm.OrderWeek DESC,e.EstimateKey,d.DeductionKey`;
// Do not call ensureSnapshotTables: this diagnostic must never create tables.
export const REVIEW_SALES_SQL=`SELECT SnapshotKey,OrderYear,OrderWeek,SnapshotType,
 CONVERT(varchar(19),TakenAt,120) TakenAt FROM WebSalesSnapshot
 WHERE OrderYear=@year AND TRY_CONVERT(int,LEFT(OrderWeek,CHARINDEX(N'-',OrderWeek+N'-')-1))=@week
 ORDER BY TakenAt,SnapshotKey`;
export async function readReviewSales(query,params) {
 const columns=(await query(`SELECT name FROM sys.columns WHERE object_id=OBJECT_ID(N'WebSalesSnapshot')`,{})).recordset||[];
 if(!['SnapshotKey','OrderYear','OrderWeek','SnapshotType','TakenAt'].every(n=>columns.some(c=>c.name===n)))return {status:'unavailable',rows:[]};
 return {status:'checked',rows:(await query(REVIEW_SALES_SQL,params)).recordset||[]};
}
const snapshotFields=['orderYear','orderWeek','appliedOrderYear','appliedOrderWeek','customerName','productName','colorName','quantity','sourceUnit','note','sourceFileName','estimateKey','estimateCost','status'];
export function reviewSnapshot(raw) {
 let value;try{value=JSON.parse(raw);}catch{return null;}
 if(!value || typeof value!=='object' || Array.isArray(value))return null;
 return Object.fromEntries(snapshotFields.filter(k=>value[k]!=null && ['string','number','boolean'].includes(typeof value[k])).map(k=>[k,value[k]]));
}
const unit=v=>['송이','대','스팀','스팀(대)'].includes(String(v).trim())?'스팀(대)':String(v??'').trim();
export function compareReviewCandidate(source,row) {
 const differences=[];
 if(Number(row.MasterDeleted))differences.push('삭제된 출고 헤더');
 if(Math.abs(Number(row.Quantity))!==Number(source.Quantity))differences.push('수량 다름');
 if(!unit(row.Unit)||!unit(source.SourceUnit)||unit(row.Unit)!==unit(source.SourceUnit))differences.push('단위 다름 또는 미확인');
 if(source.EstimateCost!=null && Number(row.Cost)!==Number(source.EstimateCost))differences.push('단가 다름');
 if(row.OwnerKey && Number(row.OwnerKey)!==Number(source.DeductionKey))differences.push('다른 신고 연결');
 return differences.length?differences.join(' · '):'수량·단위 대조 후보 (동일 신고 확정 아님)';
}
export async function readEstimateLedgerReview(query,sql,input) {
 const year=String(input.year??''),week=Number(input.week),id=Number(input.deductionKey);
 if(!/^\d{4}$/.test(year)||!/^\d{1,2}$/.test(String(input.week))||week<1||week>53||!/^\d+$/.test(String(input.deductionKey))||!Number.isSafeInteger(id)||id<1||id>2147483647) {
  const error=new Error('조회할 연도·차수·신고 번호를 확인하세요.');error.statusCode=400;throw error;
 }
 const params={year:{type:sql.NVarChar,value:year},week:{type:sql.Int,value:week},id:{type:sql.Int,value:id}};
 const source=(await query(REVIEW_SOURCE_SQL,params)).recordset?.[0];
 if(!source){const error=new Error('선택한 차수의 신고를 찾을 수 없습니다. 알림을 다시 확인하세요.');error.statusCode=404;throw error;}
 const history=((await query(REVIEW_HISTORY_SQL,params)).recordset||[]).map(h=>({HistoryKey:h.HistoryKey,ActionType:h.ActionType,ChangedAt:h.ChangedAt,before:reviewSnapshot(h.BeforeJson),after:reviewSnapshot(h.AfterJson)}));
 const estimates=(await query(REVIEW_ESTIMATES_SQL,{...params,cust:{type:sql.Int,value:source.CustKey},prod:{type:sql.Int,value:source.ProdKey},sourceYear:{type:sql.NVarChar,value:String(source.OrderYear)}})).recordset||[];
 const sales=await readReviewSales(query,params);
 return {source,sales,original:history.find(h=>h.ActionType==='CREATE')?.after||null,history,
 current:estimates.filter(e=>Number(e.InCurrentScope)===1),
 candidates:estimates.filter(e=>Number(e.EstimateKey)!==Number(source.EstimateKey)&&Number(e.Quantity)<0).map(e=>({...e,comparison:compareReviewCandidate(source,e)})),
 checkedAt:new Date().toISOString()};
}
