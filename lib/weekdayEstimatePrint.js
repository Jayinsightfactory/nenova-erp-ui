import { normalizeCycleRequest, dateKey } from './weekdayEstimateCycle.js';
import { buildShippingCycles } from './weekdayEstimateCycle.js';
import { sqlEstimateGetPrintDetail } from './exeEstimateViewSql.js';
import { exeDateAmountVat } from './estimateDateQuantity.js';
import { exeDecimalToEvenAmountVat } from './weekdayErpCompatibility.js';
import { weekdayDetailCustomerMatchesMaster } from './weekdayCustomerLink.js';

// This is a user policy, not an EXE GetPrintDetail predicate. Read raw rows:
// ViewShipment removes missing/deleted products and customers before we can audit them.
export const WEEKDAY_PRINT_DETAILS_SQL = `SELECT sm.OrderYear,sm.OrderWeek,sm.OrderYearWeek,
 sm.ShipmentKey,sm.CustKey AS MasterCustKey,sd.SdetailKey,sd.CustKey AS DetailCustKey,
 sd.ProdKey,sd.OutQuantity,sd.EstQuantity,sd.Cost,sd.Amount,sd.Vat,sd.isFix,
 c.CustKey AS ActiveCustKey,p.ProdKey AS ActiveProdKey,
 CASE WHEN sm.CustKey=@custKey THEN (SELECT COUNT_BIG(*) FROM ViewShipment vs WHERE vs.SdetailKey=sd.SdetailKey
   AND vs.OrderYear=sm.OrderYear AND vs.OrderWeek=sm.OrderWeek
   AND vs.CustKey=sm.CustKey AND vs.ProdKey=sd.ProdKey) END AS ViewShipmentCount,
 CASE WHEN sm.CustKey=@custKey THEN (SELECT COUNT_BIG(*) FROM ViewOrder vo WHERE vo.OrderYear=sm.OrderYear
   AND vo.OrderWeek=sm.OrderWeek AND vo.CustKey=sm.CustKey
   AND vo.ProdKey=sd.ProdKey) END AS ViewOrderCount
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 LEFT JOIN Customer c ON c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0
 LEFT JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
 WHERE sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@majorWeek
   AND ISNULL(sm.isDeleted,0)=0`;

export const WEEKDAY_PRINT_DATES_SQL = `SELECT sd.SdetailKey,sdd.SdateKey,sdd.ShipmentQuantity,
 sdd.EstQuantity,sdd.Cost,sdd.Amount,sdd.Vat,
 CONVERT(nvarchar(23),sdd.ShipmentDtm,121) AS ShipmentTimestamp,
 (SELECT COUNT_BIG(*) FROM PeriodDay pd WHERE pd.BaseYmd=sdd.ShipmentDtm) AS ExactPeriodDayCount
 FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
 JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
 WHERE sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@majorWeek
   AND sm.CustKey=@custKey AND ISNULL(sm.isDeleted,0)=0`;

const numeric = value => value == null || (typeof value === 'string' && value.trim() === '') ? null : Number(value);
const valid = value => value !== null && Number.isFinite(value);
const same = (a,b,tolerance=0.001) => Math.abs(a-b) <= tolerance;
const grossOk = (cost,qty,amount,vat) => {
  if (!valid(cost) || cost<0 || !valid(qty) || !valid(amount) || !valid(vat)
    || amount<0 || vat<0 || !Number.isSafeInteger(Math.round(qty))) return false;
  // Existing web helper / SQL ROUND is half-up; the EXE weekday form uses
  // C# decimal midpoint-to-even. Accept either complete evidenced tuple,
  // never mix Quantity rounding from one rule with Amount/Vat from another.
  const candidates=[exeDateAmountVat(cost,qty),exeDecimalToEvenAmountVat(cost,qty)];
  return candidates.some(expected=>Math.abs(expected.gross)<=Number.MAX_SAFE_INTEGER
    && same(amount+vat,expected.gross,0.01) && same(amount,expected.amount,0.01)
    && same(vat,expected.vat,0.01));
};

export function assessWeekdayPrintEligibility(scope,details,dates) {
  if (!Array.isArray(details) || !Array.isArray(dates)) throw new Error('인쇄 전 원본 출고 자료가 없습니다.');
  const byDetail = new Map();
  for (const row of details) {
    if (Number(row.OrderYear)!==scope.year || !String(row.OrderWeek??'').startsWith(scope.majorWeek))
      throw new Error('인쇄 전 출고 조회 범위가 일치하지 않습니다.');
    if (byDetail.has(Number(row.SdetailKey))) {
      const error=new Error('인쇄 전 출고 상세가 중복되었습니다.');error.status=409;throw error;
    }
    byDetail.set(Number(row.SdetailKey),{row,dates:[]});
  }
  for (const date of dates) {
    const group=byDetail.get(Number(date.SdetailKey));
    if (!group) throw new Error('인쇄 전 출고일의 상세 연결이 없습니다.');
    group.dates.push(date);
  }
  let positiveCount=0,unfixedCount=0,invalidCount=0;
  const reasons=[];
  for (const {row,dates:dayRows} of byDetail.values()) {
    // A weekday quote checks the actual selected customer's date allocations.
    // Unrelated customers/days do not prevent printing a confirmed selected day.
    if(scope.mode==='dates' && (Number(row.MasterCustKey)!==scope.custKey
      || !dayRows.some(day=>scope.dates.includes(String(day.ShipmentTimestamp??'').slice(0,10))
        && (numeric(day.ShipmentQuantity)>0 || numeric(day.EstQuantity)>0)))) continue;
    const out=numeric(row.OutQuantity),est=numeric(row.EstQuantity);
    // Main-cycle completion is raw isFix for every customer's positive detail.
    // Existing link warnings outside the printed customer are diagnostic only.
    if (Number(row.MasterCustKey)!==scope.custKey) {
      if (out>0) {
        positiveCount++;
        if (row.isFix==null || Number(row.isFix)!==1) unfixedCount++;
      }
      continue;
    }
    const dateActive=dayRows.some(day=>numeric(day.ShipmentQuantity)>0 || numeric(day.EstQuantity)>0);
    // Legacy zero/cancelled rows do not participate in a positive allocation.
    // A negative/null detail with live dates is corruption, not a cancellation.
    if (!(out>0 || est>0 || dateActive || out===null || out<0 || est<0)) continue;
    if (out>0) positiveCount++;
    const problems=[];
    if (!valid(out) || out<=0 || !valid(est) || est<=0) problems.push('수량');
    if (out>0 && (Number(row.isFix)!==1 || row.isFix==null)) unfixedCount++;
    if (row.isFix!=null && Number(row.isFix)!==0 && Number(row.isFix)!==1) problems.push('확정상태');
    if (!weekdayDetailCustomerMatchesMaster(row.DetailCustKey,row.MasterCustKey)
      || row.ActiveCustKey==null || Number(row.ProdKey)<=0 || row.ActiveProdKey==null)
      problems.push('거래처/품목');
    if (String(row.OrderYearWeek??'')!==scope.orderYearWeek
      || !/^\d{2}-\d{2}$/.test(String(row.OrderWeek??''))) problems.push('차수');
    if (Number(row.ViewShipmentCount)!==1 || Number(row.ViewOrderCount)!==1) problems.push('전산 연결');
    if (valid(est) && est>0 && !grossOk(numeric(row.Cost),est,numeric(row.Amount),numeric(row.Vat)))
      problems.push('상세 금액');
    if (!dayRows.length) problems.push('출고일 없음');
    let shipSum=0,estSum=0;
    const timestamps=new Set();
    for (const day of dayRows) {
      const ship=numeric(day.ShipmentQuantity),dateEst=numeric(day.EstQuantity);
      const amount=numeric(day.Amount),vat=numeric(day.Vat),cost=numeric(day.Cost);
      // Old cancelled/zero date rows are not GetPrintDetail candidates. Keep
      // them out of calendar and money checks only when they carry no amount.
      if (ship===0 && (dateEst===0 || dateEst===null)
        && (amount===0 || amount===null) && (vat===0 || vat===null)) continue;
      const timestamp=String(day.ShipmentTimestamp??'');
      if (!valid(ship) || ship<0 || !valid(dateEst) || dateEst<0
        || !valid(amount) || amount<0 || !valid(vat) || vat<0) problems.push('출고일 수량/금액');
      if (!timestamp || timestamps.has(timestamp) || Number(day.ExactPeriodDayCount)!==1)
        problems.push('출고일/달력');
      timestamps.add(timestamp);
      if (valid(dateEst) && dateEst>0 && !grossOk(cost,dateEst,amount,vat)) problems.push('출고일 단가/금액');
      if (valid(ship)) shipSum+=ship;
      if (valid(dateEst)) estSum+=dateEst;
    }
    if (valid(out) && !same(shipSum,out) || valid(est) && !same(estSum,est)) problems.push('출고일 합계');
    if (problems.length) {
      invalidCount++;
      if (reasons.length<5) reasons.push(`상세 ${row.SdetailKey}: ${[...new Set(problems)].join(', ')}`);
    }
  }
  return {eligible:positiveCount>0 && unfixedCount===0 && invalidCount===0,
    positiveCount,unfixedCount,invalidCount,reasons};
}

// GetPrintDetail must neither omit nor multiply the selected customer's
// validated date allocations. Estimate deduction rows are separate and keep
// the existing optional date filter; only Sort=0 normal rows are reconciled.
export function reconcileWeekdayPrintQuote(scope,details,dates,quoteRows) {
  if (!Array.isArray(quoteRows)) throw new Error('인쇄 견적 결과를 확인할 수 없습니다.');
  const selected=new Map(details.filter(row=>Number(row.MasterCustKey)===scope.custKey
    && numeric(row.OutQuantity)>0).map(row=>[Number(row.SdetailKey),row]));
  const requested=new Set(scope.dates);
  const expected=new Map();
  const key=(prod,cost)=>`${Number(prod)}|${Number(cost)}`;
  for (const day of dates) {
    const detail=selected.get(Number(day.SdetailKey));
    if (!detail || !(numeric(day.EstQuantity)>0)) continue;
    if (scope.mode==='dates' && !requested.has(String(day.ShipmentTimestamp??'').slice(0,10))) continue;
    const groupKey=key(detail.ProdKey,day.Cost);
    const group=expected.get(groupKey) || {quantity:0,amount:0,vat:0};
    group.quantity+=Number(day.EstQuantity);
    group.amount+=Number(day.Amount);
    group.vat+=Number(day.Vat);
    expected.set(groupKey,group);
  }
  const seen=new Set();
  let mismatch=false;
  for (const row of quoteRows) {
    if (Number(row.Sort)!==0) continue;
    const cost=numeric(row.Cost);
    if (!valid(cost) || cost<0) {mismatch=true;continue;}
    const groupKey=key(row.ProdKey,row.Cost),source=expected.get(groupKey);
    if (!source || seen.has(groupKey) || !valid(numeric(row.EstQuantity))
      || !valid(numeric(row.Amount)) || !valid(numeric(row.Vat))
      || !same(Number(row.EstQuantity),Math.round(source.quantity),0.000001)
      || !same(Number(row.Amount),source.amount,0.01)
      || !same(Number(row.Vat),source.vat,0.01)) mismatch=true;
    seen.add(groupKey);
  }
  if (mismatch || seen.size!==expected.size) {
    const error=new Error('선택 거래처의 실제 출고일과 인쇄 견적의 품목·단가별 수량/공급가/VAT가 일치하지 않습니다.');
    error.status=409;throw error;
  }
  return {normalGroupCount:expected.size};
}

export async function readWeekdayPrintInTransaction(scope,tQuery,sql) {
  await tQuery('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  if(scope.mode==='dates') {
    const calendar=await tQuery(`WITH anchor AS (SELECT BaseYmd FROM PeriodDay WHERE OrderYearWeek=@yearWeek AND WeekDay=5)
      SELECT pd.OrderYearWeek,pd.WeekDay,CONVERT(nvarchar(23),pd.BaseYmd,121) BaseYmd FROM PeriodDay pd
      WHERE EXISTS(SELECT 1 FROM anchor a WHERE pd.BaseYmd>=DATEADD(day,-7,a.BaseYmd) AND pd.BaseYmd<DATEADD(day,14,a.BaseYmd))`,
      {yearWeek:{type:sql.NVarChar(6),value:scope.orderYearWeek}});
    try {validateWeekdayPrintDates(scope,buildShippingCycles(calendar.recordset,scope));}
    catch(error) {error.status=409;throw error;}
  }
  const customer=await tQuery('SELECT CustKey,CustName FROM Customer WHERE CustKey=@custKey AND ISNULL(isDeleted,0)=0',
    {custKey:{type:sql.Int,value:scope.custKey}});
  if(customer.recordset.length!==1) {
    const error=new Error('활성 거래처를 찾을 수 없습니다.');error.status=404;throw error;
  }
  const eligibilityParams={year:{type:sql.Int,value:scope.year},
    majorWeek:{type:sql.NVarChar(2),value:scope.majorWeek},
    custKey:{type:sql.Int,value:scope.custKey}};
  const raw=await tQuery(WEEKDAY_PRINT_DETAILS_SQL,eligibilityParams);
  const dates=await tQuery(WEEKDAY_PRINT_DATES_SQL,eligibilityParams);
  const eligibility=assessWeekdayPrintEligibility(scope,raw.recordset,dates.recordset);
  if(!eligibility.eligible) {
    const error=new Error(`${scope.mode==='dates'?'선택 업체·출고일':'메인차수 전체 거래처'}의 출고 확정·견적 연결을 확인하세요. 미확정 ${eligibility.unfixedCount}건, 연결/수량/금액 오류 ${eligibility.invalidCount}건${eligibility.positiveCount===0?' (양수 출고 없음)':''}. ${eligibility.reasons.join('; ')}`);
    error.status=409;error.eligibility=eligibility;throw error;
  }
  const params={year:{type:sql.Int,value:scope.year},orderYearWeek:{type:sql.NVarChar(6),value:scope.orderYearWeek},custKey:{type:sql.Int,value:scope.custKey}};
  scope.dates.forEach((date,i)=>{params[`printDate${i}`]={type:sql.NVarChar(10),value:date};});
  const result=await tQuery(sqlEstimateGetPrintDetail({orderYearWeek:scope.orderYearWeek,custKey:scope.custKey,
    weekDayIn:'1,2,3,4,5,6,7',dateFilterCount:scope.dates.length,enforceYear:true}),params);
  reconcileWeekdayPrintQuote(scope,raw.recordset,dates.recordset,result.recordset);
  return {customer:customer.recordset[0],items:result.recordset.map(mapWeekdayPrintRow),eligibility};
}

export function normalizeWeekdayPrintRequest(body={}) {
  const scope=normalizeCycleRequest(body);
  const custKey=Number(body.custKey);
  if(!Number.isInteger(custKey)||custKey<=0) throw new Error('출력 거래처를 확인하세요.');
  if(!['dates','major'].includes(body.mode)) throw new Error('날짜 또는 대차수 출력 방식을 지정하세요.');
  const dates=body.mode==='major' ? [] : [...new Set((Array.isArray(body.dates)?body.dates:[]).map(dateKey))].sort();
  if(body.mode==='dates' && (!dates.length||dates.length>7)) throw new Error('같은 업무 주기의 출력 날짜를 1~7개 선택하세요.');
  return {...scope,custKey,mode:body.mode,dates};
}

export function validateWeekdayPrintDates(scope,cycles) {
  if(scope.mode==='major') return scope;
  const cycle=cycles.find(row=>row.offset===0 && row.year===scope.year && row.majorWeek===scope.majorWeek);
  if(!cycle || cycle.calendarState!=='FOUND' || scope.dates.some(date=>!cycle.days.some(day=>day.date===date&&day.calendarState==='FOUND'))) {
    throw new Error('선택 날짜가 해당 차수의 확인된 목~수 전산 달력에 없습니다.');
  }
  return scope;
}

export function mapWeekdayPrintRow(row) {
  return {ProdKey:row.ProdKey,ProdName:row.ProdName,Quantity:Number(row.EstQuantity)||0,
    Cost:Number(row.Cost)||0,Amount:Number(row.Amount)||0,Vat:Number(row.Vat)||0,
    Descr:row.Descr||'',EstimateType:Number(row.Sort)===0?'정상출고':row.EstimateTypeRaw||'',
    UnitQuantity:row.UnitQuantity,RowNum:row.RowNum,OrderNo:row.OrderNo,GroupNo:row.GroupNo,GroupName:row.GroupName,
    _exeParity:true,_exePrint:true};
}
