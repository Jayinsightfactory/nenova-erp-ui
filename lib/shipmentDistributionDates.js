import { createHash } from 'node:crypto';

export const DISTRIBUTION_DATE_CALENDAR_SQL=`SELECT pd.WeekDay,CONVERT(nvarchar(23),CONVERT(datetime,pd.BaseYmd,121),121) AS Timestamp,
    (SELECT COUNT(*) FROM PeriodDay other WITH(HOLDLOCK) WHERE CONVERT(datetime,other.BaseYmd,121)=CONVERT(datetime,pd.BaseYmd,121)) AS MatchCount
    FROM PeriodDay pd WITH(UPDLOCK,HOLDLOCK) WHERE pd.OrderYearWeek=@ywk ORDER BY pd.WeekDay`;

const EPS = 0.000001;
const same = (a,b) => Math.abs(a-b) <= EPS;
const sum = (rows,field) => rows.reduce((n,r)=>n+Number(r[field]),0);
export function dateDistributionError(message, code='DATE_DISTRIBUTION_INVALID') {
  return Object.assign(new Error(message),{code,statusCode:409});
}
function need(ok,message,code) { if(!ok) throw dateDistributionError(message,code); }
export function distributionDateScope(input={}) {
  const orderYear=String(input.orderYear??''), orderWeek=String(input.orderWeek??'');
  const custKey=Number(input.custKey),prodKey=Number(input.prodKey);
  need(/^\d{4}$/.test(orderYear)&&/^(0[1-9]|[1-4]\d|5[0-2])-0[1-4]$/.test(orderWeek),'선택 연도와 차수가 필요합니다.');
  need([custKey,prodKey].every(n=>Number.isSafeInteger(n)&&n>0),'업체·품목을 확인하세요.');
  return {orderYear,orderWeek,custKey,prodKey};
}
export const distributionDateSnapshot = context => createHash('sha256').update(JSON.stringify(context)).digest('hex');
// System.Decimal Math.Round default: midpoint to even (EXE date save).
export function nativeDateRound(value) {
  const base=Math.floor(value),fraction=value-base;
  return Math.abs(fraction-.5)<1e-9 ? base+(base%2) : Math.round(value);
}
export function nativeDateEstimate(p,qty) {
  if(p.OutUnit===p.EstUnit) return qty;
  const b=Number(p.BunchOf1Box),s=Number(p.SteamOf1Bunch),bs=Number(p.SteamOf1Box);
  let box=0,bunch=0,steam=0;
  if(p.OutUnit==='박스'){box=qty;if(b>0)bunch=box*b;if(s>0)steam=bunch*s;if(bs>0)steam=box*bs;}
  else if(p.OutUnit==='단'){bunch=qty;if(b>0)box=bunch/b;if(s>0)steam=bunch*s;}
  else if(p.OutUnit==='송이'){steam=qty;if(s>0)bunch=steam/s;if(b>0)box=bunch/b;if(bs>0)box=steam/bs;}
  else throw dateDistributionError('출고 단위를 확인할 수 없습니다.');
  const result={'박스':box,'단':bunch,'송이':steam}[p.EstUnit];
  need(Number.isFinite(result)&&result>0,'견적 단위 환산계수가 없어 저장할 수 없습니다.');
  return result;
}
export function planDistributionDates(context, allocations) {
  const {detail,dates,calendar}=context;
  const scope=distributionDateScope(context.scope),year=Number(scope.orderYear),major=Number(scope.orderWeek.slice(0,2));
  need(calendar.every(r=>{const y=Number(r.Timestamp.slice(0,4));return y===year||(major===1&&y===year-1)||(major===52&&y===year+1);}), '차수 달력의 연도가 선택 연도와 다릅니다.');
  need(calendar.length===7&&new Set(calendar.map(r=>r.WeekDay)).size===7,'차수 달력 7개 요일이 없거나 중복됩니다.');
  need(calendar.every(r=>r.MatchCount===undefined||r.MatchCount===1),'동일 날짜의 전산 달력이 중복되어 견적 노출을 보장할 수 없습니다.');
  const times=calendar.map(r=>r.Timestamp).sort();
  need(new Set(times).size===7&&times.every((t,i)=>/^\d{4}-\d{2}-\d{2} 00:00:00\.000$/.test(t)&&(!i||Date.parse(t.replace(' ','T')+'Z')-Date.parse(times[i-1].replace(' ','T')+'Z')===86400000)),'차수 달력의 날짜·시각이 올바르지 않습니다.');
  need(calendar.every(r=>r.WeekDay===new Date(r.Timestamp.slice(0,10)+'T00:00:00Z').getUTCDay()+1),'달력 요일이 실제 날짜와 다릅니다.');
  need([detail.DetailFix,detail.MasterFix].every(v=>v===true||v===false||v===0||v===1),'확정 상태를 확인할 수 없습니다.');
  need(detail.OutQuantity>0,'출고수량 저장 후 출고일을 지정하세요.');
  need(dates.length>0&&same(sum(dates,'ShipmentQuantity'),detail.OutQuantity),'기존 날짜 수량 합계가 출고수량과 다릅니다. 먼저 원장을 확인하세요.');
  const valid=new Map(calendar.map(r=>[r.Timestamp,r]));
  need(dates.every(r=>valid.has(r.Timestamp)),'기존 출고일이 해당 차수 달력과 정확히 일치하지 않습니다.');
  need(new Set(dates.map(r=>r.Timestamp)).size===dates.length,'기존 날짜행이 중복되어 먼저 확인이 필요합니다.');
  need(dates.every(r=>['ShipmentQuantity','EstQuantity','Cost','Amount','Vat'].every(k=>r[k]!==null&&Number.isFinite(Number(r[k]))&&Number(r[k])>=0)),'견적수량·단가·금액이 없는 기존 날짜행은 먼저 검증·보정해야 합니다.');
  need(Number.isFinite(detail.Cost)&&dates.every(r=>same(r.Cost,detail.Cost)),'날짜별 단가가 달라 자동 날짜 분배를 저장할 수 없습니다.');
  const descrs=[...new Set(dates.map(r=>r.Descr??''))];
  need(descrs.length===1,'날짜별 비고가 달라 자동 병합할 수 없습니다.');
  need(dates.every(r=>same(nativeDateEstimate(detail,r.ShipmentQuantity),r.EstQuantity)),'기존 견적수량이 전산 환산값과 달라 먼저 확인이 필요합니다.');
  need(Array.isArray(allocations)&&allocations.length<=7&&allocations.length>0,'날짜별 수량을 입력하세요.');
  const seen=new Set();
  const planned=allocations.map(r=>{
    need(valid.has(r.timestamp)&&!seen.has(r.timestamp),'출고일이 해당 차수 달력에 없거나 중복됩니다.');seen.add(r.timestamp);
    need(r.quantity!==''&&r.quantity!==null&&typeof r.quantity!=='boolean','날짜별 수량을 확인하세요.');
    const qty=Number(r.quantity);
    need(Number.isFinite(qty)&&qty>=0&&same(qty*1000,Math.round(qty*1000)),'수량은 0 이상, 소수 셋째 자리까지 입력하세요.');
    if(qty===0)return null;
    const est=nativeDateEstimate(detail,qty),gross=detail.Cost*nativeDateRound(est),amount=nativeDateRound(gross/1.1);
    return {Timestamp:r.timestamp,ShipmentQuantity:qty,EstQuantity:est,Cost:detail.Cost,Amount:amount,Vat:gross-amount,Descr:descrs[0],WeekDay:valid.get(r.timestamp).WeekDay};
  }).filter(Boolean).sort((a,b)=>a.WeekDay-b.WeekDay);
  need(same(sum(planned,'ShipmentQuantity'),detail.OutQuantity),'날짜별 수량 합계가 현재 출고수량과 같아야 합니다.');
  need(same(sum(planned,'EstQuantity'),sum(dates,'EstQuantity')),'분배 후 견적수량 합계가 바뀌어 저장할 수 없습니다.');
  const gross=rows=>sum(rows,'Amount')+sum(rows,'Vat');
  need(same(gross(planned),gross(dates)),'날짜별 견적수량 반올림으로 매출이 바뀝니다. 분배 수량을 조정하세요.');
  need(same(gross(dates),detail.Amount+detail.Vat),'기존 날짜금액과 출고 매출 합계가 달라 먼저 확인이 필요합니다.');
  return {dates:planned,representative:planned.at(-1).Timestamp,total:detail.OutQuantity,estimateTotal:sum(planned,'EstQuantity'),gross:gross(planned),amountDelta:sum(planned,'Amount')-sum(dates,'Amount'),fixed:!!detail.DetailFix};
}

// This exact reader is used by display, preview, transaction preflight and readback.
export async function readDistributionDateContext(tQ,sql,input) {
  const scope=distributionDateScope(input);
  const params={yr:{type:sql.NVarChar,value:scope.orderYear},wk:{type:sql.NVarChar,value:scope.orderWeek},ck:{type:sql.Int,value:scope.custKey},pk:{type:sql.Int,value:scope.prodKey}};
  const masters=await tQ(`SELECT ShipmentKey,OrderYearWeek,isFix AS MasterFix FROM ShipmentMaster WITH(UPDLOCK,HOLDLOCK)
    WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND isDeleted=0`,params);
  need(masters.recordset.length===1,'현재 연도·차수·업체의 출고 원장이 없거나 중복됩니다.');
  const master=masters.recordset[0];
  need(String(master.OrderYearWeek)===scope.orderYear+scope.orderWeek.slice(0,2),'출고 원장의 원차수 연결이 올바르지 않습니다.');
  params.sk={type:sql.Int,value:master.ShipmentKey};
  const rows=await tQ(`SELECT sd.SdetailKey,sd.ShipmentKey,sd.ProdKey,sd.CustKey AS RawCustKey,sd.OutQuantity,sd.EstQuantity,
    sd.BoxQuantity,sd.BunchQuantity,sd.SteamQuantity,sd.Cost,sd.Amount,sd.Vat,sd.isFix AS DetailFix,sd.Descr,
    CONVERT(nvarchar(23),sd.ShipmentDtm,121) AS Timestamp,p.OutUnit,p.EstUnit,p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box
    FROM ShipmentDetail sd WITH(UPDLOCK,HOLDLOCK) JOIN Product p WITH(HOLDLOCK) ON p.ProdKey=sd.ProdKey
    WHERE sd.ShipmentKey=@sk AND sd.ProdKey=@pk`,params);
  need(rows.recordset.length===1,'선택 품목의 출고 상세가 없거나 중복됩니다.');
  const detail={...rows.recordset[0],MasterFix:master.MasterFix};
  need(detail.RawCustKey===null||detail.RawCustKey===scope.custKey,'출고 상세의 거래처 연결이 다릅니다.');
  const visible=await tQ(`SELECT COUNT(*) AS N FROM ViewShipment vs WHERE vs.SdetailKey=@dk AND vs.OrderYear=@yr AND vs.OrderWeek=@wk AND vs.CustKey=@ck AND vs.ProdKey=@pk
    AND EXISTS(SELECT 1 FROM ViewOrder vo WHERE vo.OrderYear=vs.OrderYear AND vo.OrderWeek=vs.OrderWeek AND vo.CustKey=vs.CustKey AND vo.ProdKey=vs.ProdKey)`,{...params,dk:{type:sql.Int,value:detail.SdetailKey}});
  need(visible.recordset[0].N===1,'전산 주문·출고 연결이 확인되지 않아 저장할 수 없습니다.');
  const dates=await tQ(`SELECT SdateKey,CONVERT(nvarchar(23),ShipmentDtm,121) AS Timestamp,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr
    FROM ShipmentDate WITH(UPDLOCK,HOLDLOCK) WHERE SdetailKey=@dk ORDER BY SdateKey`,{dk:{type:sql.Int,value:detail.SdetailKey}});
  const calendar=await tQ(DISTRIBUTION_DATE_CALENDAR_SQL,{ywk:{type:sql.NVarChar,value:scope.orderYear+scope.orderWeek.slice(0,2)}});
  return {scope,detail,dates:dates.recordset,calendar:calendar.recordset};
}
export async function executeDistributionDateSave(tQ,sql,input,{snapshot,allocations},actor) {
  const context=await readDistributionDateContext(tQ,sql,input);
  need(typeof snapshot==='string'&&snapshot===distributionDateSnapshot(context),'다른 화면에서 변경되었습니다. 재조회 후 다시 입력하세요.','STALE_DATA');
  const plan=planDistributionDates(context,allocations);
  const dk={type:sql.Int,value:context.detail.SdetailKey};
  await tQ('DELETE FROM ShipmentDate WHERE SdetailKey=@dk',{dk});
  for(const row of plan.dates){
    const params={dk,dt:{type:sql.NVarChar,value:row.Timestamp},descr:{type:sql.NVarChar,value:row.Descr}};
    for(const field of ['ShipmentQuantity','EstQuantity','Cost','Amount','Vat'])params[field]={type:sql.Float,value:row[field]};
    await tQ(`INSERT INTO ShipmentDate(SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      VALUES(@dk,CONVERT(datetime,@dt,121),@ShipmentQuantity,@EstQuantity,@Cost,@Amount,@Vat,@descr)`,params);
  }
  await tQ('UPDATE ShipmentDetail SET ShipmentDtm=CONVERT(datetime,@dt,121) WHERE SdetailKey=@dk',{dk,dt:{type:sql.NVarChar,value:plan.representative}});
  const after=await readDistributionDateContext(tQ,sql,input);
  const protectedDetail=d=>{const {Timestamp,...rest}=d;return rest;};
  need(JSON.stringify(protectedDetail(context.detail))===JSON.stringify(protectedDetail(after.detail)),'출고 원장 보존 검증에 실패했습니다.');
  const checked=planDistributionDates(after,allocations);
  need(after.detail.Timestamp===plan.representative&&after.dates.length===plan.dates.length,'저장된 날짜 재조회가 일치하지 않습니다.');
  for(const row of plan.dates){const saved=after.dates.find(r=>r.Timestamp===row.Timestamp);need(saved&&['ShipmentQuantity','EstQuantity','Cost','Amount','Vat'].every(k=>same(saved[k],row[k]))&&saved.Descr===row.Descr,'저장된 날짜 수량·금액 재조회가 일치하지 않습니다.');}
  await tQ(`INSERT INTO SystemActionLog(Actor,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc)
    VALUES(@actor,'SHIPMENT_DATE_ALLOCATION','POST','/api/shipment/distribution-dates','ShipmentDate',@n,@payload,'SUCCESS',N'총량·매출 보존 날짜분배')`,{
    actor:{type:sql.NVarChar,value:String(actor||'').slice(0,100)},n:{type:sql.Int,value:plan.dates.length},payload:{type:sql.NVarChar(sql.MAX),value:JSON.stringify({scope:context.scope,sdetailKey:context.detail.SdetailKey,before:context.dates,after:after.dates})}});
  return {success:true,plan:checked,context:after,snapshot:distributionDateSnapshot(after)};
}
