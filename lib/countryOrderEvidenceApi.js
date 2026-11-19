import {countryOrderHistoryScope} from './countryOrderReconciliation.js';
import {COUNTRY_ORDER_COUNTRIES,normalizeCountryOrderUnit} from './countryOrderSource.js';
// Bounded read fence, not a retry: never combine a changing aggregate with a
// different detail/history snapshot and silently treat it as one observation.
export async function readStableCountryOrderSnapshot(readOnce) {
  const first=await readOnce(),second=await readOnce();
  const identity=({queriedAt,...snapshot})=>JSON.stringify(snapshot);
  if(identity(first)!==identity(second))throw Object.assign(Error('조회 중 전산 주문 또는 변경 근거가 바뀌었습니다. 원문 대조를 명시적으로 다시 조회하세요.'),{statusCode:409,code:'COUNTRY_ORDER_SOURCE_CHANGED'});
  return second;
}
export const COUNTRY_ORDER_DETAILS_SQL=`SELECT TOP (100001) v.OrderDetailKey,v.CustKey,v.CustName,c.OrderCode AS CustOrderCode,v.ProdKey,v.ProdName,p.OutUnit,v.OutQuantity,
 CONVERT(nvarchar(33),TODATETIMEOFFSET(od.CreateDtm,'+09:00'),127) AS CreatedAt,
 CONVERT(nvarchar(33),TODATETIMEOFFSET(od.LastUpdateDtm,'+09:00'),127) AS UpdatedAt
 FROM ViewOrder v JOIN OrderDetail od ON od.OrderDetailKey=v.OrderDetailKey
 JOIN Product p ON p.ProdKey=v.ProdKey JOIN Customer c ON c.CustKey=v.CustKey
 WHERE v.OrderYear=@orderYear AND v.OrderWeek=@orderWeek AND v.CounName=@counName
 ORDER BY v.OrderDetailKey`;
export const COUNTRY_ORDER_EVENTS_SQL=`SELECT TOP (100001) oh.OrderHistoryKey,oh.OrderDetailKey,om.CustKey,od.ProdKey,p.OutUnit,
 CONVERT(nvarchar(33),TODATETIMEOFFSET(oh.ChangeDtm,'+09:00'),127) AS At,
 oh.ChangeType,oh.ColumName,oh.BeforeValue,oh.AfterValue
 FROM OrderHistory oh JOIN OrderDetail od ON od.OrderDetailKey=oh.OrderDetailKey
 JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey JOIN Product p ON p.ProdKey=od.ProdKey
 WHERE om.OrderYear=@orderYear AND om.OrderWeek=@orderWeek AND p.CounName=@counName
 AND oh.ColumName=N'주문수량'
 ORDER BY oh.ChangeDtm,oh.OrderHistoryKey`;
export async function readCountryOrderEvidence({scope,queryFn,types,now=()=>new Date()}) {
  scope=countryOrderHistoryScope(scope);
  if(!Object.hasOwn(COUNTRY_ORDER_COUNTRIES,scope.country))throw Object.assign(Error('국가를 확인하세요.'),{statusCode:400});
  const params={orderYear:{type:types.NVarChar(4),value:String(scope.year)},orderWeek:{type:types.NVarChar(50),value:scope.orderWeek},counName:{type:types.NVarChar(20),value:COUNTRY_ORDER_COUNTRIES[scope.country]}};
  // Native uses GETDATE() for ChangeDtm. Do not label naive DB values UTC.
  const clock=await queryFn('SELECT DATEPART(TZOFFSET,SYSDATETIMEOFFSET()) AS OffsetMinutes',{});
  if(Number(clock.recordset?.[0]?.OffsetMinutes)!==540)throw Object.assign(Error('전산 서버 시각 기준을 확인해야 합니다. 동일 건 자동 판정을 보류합니다.'),{statusCode:409});
  const [details,history]=await Promise.all([queryFn(COUNTRY_ORDER_DETAILS_SQL,params),queryFn(COUNTRY_ORDER_EVENTS_SQL,params)]);
  if(details.recordset.length>100000||history.recordset.length>100000)throw Object.assign(Error('전체 근거를 읽지 못했습니다.'),{statusCode:413});
  const rows=details.recordset.map(r=>({orderDetailKey:r.OrderDetailKey,custKey:r.CustKey,customer:r.CustName,customerCode:r.CustOrderCode,prodKey:r.ProdKey,product:r.ProdName,unit:normalizeCountryOrderUnit(r.OutUnit),quantity:r.OutQuantity,createdAt:r.CreatedAt,updatedAt:r.UpdatedAt}));
  const events=history.recordset.map(r=>({id:`history:${r.OrderHistoryKey}`,scope,orderDetailKey:r.OrderDetailKey,custKey:r.CustKey,prodKey:r.ProdKey,unit:normalizeCountryOrderUnit(r.OutUnit),at:r.At,before:r.BeforeValue,after:r.AfterValue,changeType:r.ChangeType,kind:r.AfterValue>r.BeforeValue?'increase':r.AfterValue<r.BeforeValue?'decrease':'unchanged'}));
  return {scope,queriedAt:now().toISOString(),details:rows,events};
}
