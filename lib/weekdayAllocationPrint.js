import { normalizeWeekdayPrintRequest, validateWeekdayPrintDates } from './weekdayEstimatePrint.js';
import { buildShippingCycles } from './weekdayEstimateCycle.js';
import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { weekdayDetailCustomerMatchesMaster } from './weekdayCustomerLink.js';
import { shipmentUnitsFromUserInput, amountVatFromCostEst } from './distributeUnits.js';
import { exeDecimalToEvenAmountVat } from './weekdayErpCompatibility.js';

export { normalizeWeekdayPrintRequest };
// Identical priority to native GetPrintDetail's ProductSortLookup.
const productSortLookup=`WITH ProductSortLookup AS (
  SELECT p.ProdKey,ps.OrderNo,ps.GroupNo,ps.GroupName,
    ROW_NUMBER() OVER(PARTITION BY p.ProdKey ORDER BY CASE
      WHEN p.CounName=ps.CounName AND p.FlowerName=ps.FlowerName THEN 1
      WHEN p.CountryFlower=ps.CountryFlower THEN 2 ELSE 99 END) rank_priority
  FROM Product p JOIN ProductSort ps ON (p.CounName=ps.CounName AND p.FlowerName=ps.FlowerName)
    OR p.CountryFlower=ps.CountryFlower
)`;
const number=value=>value==null || typeof value==='boolean' || String(value).trim()==='' ? null : Number(value);
const valid=value=>Number.isFinite(value) && value!==null;
const same=(a,b,tolerance=0.000001)=>valid(a)&&valid(b)&&Math.abs(a-b)<=tolerance;
function fail(message) { const error=new Error(message);error.status=409;throw error; }

export function buildWeekdayAllocationPrintItems(scope,details,dates,deductions=[]) {
  const byDetail=new Map(),groups=new Map(),diagnostics=[];
  for(const row of details) {
    if(Number(row.OrderYear)!==scope.year || String(row.OrderWeek).slice(0,2)!==scope.majorWeek
      || Number(row.MasterCustKey)!==scope.custKey) fail('분배 출력 업무 범위가 다릅니다.');
    const id=Number(row.SdetailKey);
    if(!Number.isSafeInteger(id)||id<=0||byDetail.has(id)) fail('분배 출력 상세 연결이 중복되었습니다.');
    byDetail.set(id,{row,dates:[]});
  }
  for(const date of dates) {
    const group=byDetail.get(Number(date.SdetailKey));
    if(!group)fail('분배 출고일의 상세 연결이 없습니다.');group.dates.push(date);
  }
  let fixedCount=0,unfixedCount=0,unknownCount=0;
  for(const {row,dates:dayRows} of byDetail.values()) {
    const selected=dayRows.filter(day=>scope.mode==='major'||scope.dates.includes(String(day.ShipmentTimestamp).slice(0,10)));
    if(scope.mode==='dates'&&!selected.length)continue;
    if(number(row.OutQuantity)>0 && !dayRows.length)fail('양수 분배의 저장 출고일 연결이 없습니다.');
    const positive=dayRows.some(day=>number(day.ShipmentQuantity)>0);
    if(!positive && number(row.OutQuantity)===0)continue;
    if(!weekdayDetailCustomerMatchesMaster(row.DetailCustKey,row.MasterCustKey)
      || row.ActiveCustKey==null || row.ActiveProdKey==null || !String(row.ProdName||'').trim())fail('분배 출력의 거래처·품목 연결을 확인하세요.');
    if(!/^\d{2}-\d{2}$/.test(String(row.OrderWeek)) || String(row.OrderYearWeek)!==scope.orderYearWeek)fail('분배 출력 차수 연결이 다릅니다.');
    const outUnit=normalizeWeekdayUnit(row.OutUnit),estUnit=normalizeWeekdayUnit(row.EstUnit);
    if(!outUnit||!estUnit)fail('분배 출력 단위를 확인할 수 없습니다.');
    const seen=new Set();let total=0;
    for(const day of dayRows) {
      const ship=number(day.ShipmentQuantity),stamp=String(day.ShipmentTimestamp||'');
      if(!valid(ship)||ship<0||seen.has(stamp))fail('분배 출고일 수량 또는 날짜가 중복·미확인입니다.');
      seen.add(stamp);total+=ship;
      if(ship>0 && Number(day.ExactPeriodDayCount)!==1)fail('분배 출고일과 전산 달력의 정확한 연결이 없습니다.');
    }
    if(!same(number(row.OutQuantity),total))fail('저장 분배 상세와 날짜 수량 합계가 다릅니다.');
    const fixed=row.isFix===true||row.isFix===1;
    if(fixed)fixedCount++;else if(row.isFix===false||row.isFix===0)unfixedCount++;else unknownCount++;
    for(const day of selected) {
      const ship=number(day.ShipmentQuantity);if(ship===0)continue;
      const factorOk=outUnit===estUnit || (outUnit==='박스'&&estUnit==='단'&&number(row.BunchOf1Box)>0)
        || (outUnit==='박스'&&estUnit==='송이'&&(number(row.SteamOf1Box)>0 || number(row.BunchOf1Box)>0&&number(row.SteamOf1Bunch)>0))
        || (outUnit==='단'&&estUnit==='박스'&&number(row.BunchOf1Box)>0)
        || (outUnit==='단'&&estUnit==='송이'&&number(row.SteamOf1Bunch)>0)
        || (outUnit==='송이'&&estUnit==='단'&&number(row.SteamOf1Bunch)>0)
        || (outUnit==='송이'&&estUnit==='박스'&&(number(row.SteamOf1Box)>0 || number(row.BunchOf1Box)>0&&number(row.SteamOf1Bunch)>0));
      const units=shipmentUnitsFromUserInput(ship,outUnit,row),derivedQuantity=factorOk ? Number(units.estQty) : null,cost=number(day.Cost ?? row.DetailCost);
      if(!valid(cost)||cost<0)fail('분배 견적 단가를 확인할 수 없습니다.');
      const savedQuantity=number(day.EstQuantity);
      let quantity=derivedQuantity,amount=number(day.Amount),vat=number(day.Vat);
      const moneyMatches=qty=>[amountVatFromCostEst(cost,qty),exeDecimalToEvenAmountVat(cost,qty)]
        .some(money=>same(amount,money.amount,0.01)&&same(vat,money.vat,0.01));
      if(Number.isSafeInteger(savedQuantity)&&savedQuantity>0&&moneyMatches(savedQuantity)) {
        // A complete native stored tuple can embody historical packaging. Do
        // not overwrite that evidenced tuple with today's Product factors.
        quantity=savedQuantity;
        if(!same(savedQuantity,derivedQuantity))diagnostics.push({sdetailKey:Number(row.SdetailKey),
          date:String(day.ShipmentTimestamp).slice(0,10),code:'ALLOCATION_HISTORICAL_EST_PRESERVED'});
      } else if(!Number.isSafeInteger(derivedQuantity)||derivedQuantity<=0)fail('분배 견적 단위 환산 기준이 없습니다.');
      else if(!same(savedQuantity,derivedQuantity)) {
        ({amount,vat}=amountVatFromCostEst(cost,derivedQuantity));
        diagnostics.push({sdetailKey:Number(row.SdetailKey),date:String(day.ShipmentTimestamp).slice(0,10),
          code:'ALLOCATION_EST_RECALCULATED'});
      } else fail('분배 출고일의 저장 금액이 환산 수량과 다릅니다.');
      if(!valid(amount)||!valid(vat)||amount<0||vat<0)fail('분배 출력 금액이 올바르지 않습니다.');
      const key=`${row.ProdKey}|${cost}`;
      const group=groups.get(key)||{ProdKey:Number(row.ProdKey),ProdName:row.ProdName,CounName:row.CounName||'',FlowerName:row.FlowerName||'',Quantity:0,Cost:cost,Amount:0,Vat:0,
        Unit:estUnit,EstimateType:'정상출고',Descr:'',OrderNo:Number(row.OrderNo ?? 99),GroupNo:Number(row.GroupNo ?? 99),GroupName:row.GroupName || '',source:'ALLOCATION',_exeParity:true,_exePrint:true};
      group.Quantity+=quantity;group.Amount+=amount;group.Vat+=vat;
      if(day.Descr)group.Descr=[...new Set([group.Descr,day.Descr].filter(Boolean))].join(' / ');
      groups.set(key,group);
    }
  }
  const items=[...groups.values()].sort((a,b)=>a.OrderNo-b.OrderNo||a.CounName.localeCompare(b.CounName,'ko')||a.ProdName.localeCompare(b.ProdName,'ko')||a.Cost-b.Cost);
  for(const row of deductions) {
    if(['Quantity','Cost','Amount','Vat'].some(key=>!valid(number(row[key]))))fail('등록 차감 금액 또는 수량이 미확인입니다.');
    items.push({...row,Quantity:Number(row.Quantity),Cost:Number(row.Cost),Amount:Number(row.Amount),Vat:Number(row.Vat),source:'ALLOCATION',_exeParity:true,_exePrint:true});
  }
  items.forEach((item,index)=>{item.RowNum=index+1;item.UnitQuantity=`${item.Quantity}${item.Unit||''}`;});
  return {items,confirmation:{fixedCount,unfixedCount,unknownCount,required:false},diagnostics};
}

export async function readWeekdayAllocationPrintInTransaction(scope,tQuery,sql) {
  await tQuery('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  const params={year:{type:sql.Int,value:scope.year},majorWeek:{type:sql.NVarChar(2),value:scope.majorWeek},
    yearWeek:{type:sql.NVarChar(6),value:scope.orderYearWeek},custKey:{type:sql.Int,value:scope.custKey}};
  scope.dates.forEach((date,index)=>{params[`printDate${index}`]={type:sql.NVarChar(10),value:date};});
  if(scope.mode==='dates') {
    const calendar=await tQuery(`WITH anchor AS (SELECT BaseYmd FROM PeriodDay WHERE OrderYearWeek=@yearWeek AND WeekDay=5)
      SELECT pd.OrderYearWeek,pd.WeekDay,CONVERT(nvarchar(23),pd.BaseYmd,121) BaseYmd FROM PeriodDay pd
      WHERE EXISTS(SELECT 1 FROM anchor a WHERE pd.BaseYmd>=DATEADD(day,-7,a.BaseYmd) AND pd.BaseYmd<DATEADD(day,14,a.BaseYmd))`,params);
    try{validateWeekdayPrintDates(scope,buildShippingCycles(calendar.recordset,scope));}catch(error){error.status=409;throw error;}
  }
  const customer=await tQuery('SELECT CustKey,CustName FROM Customer WHERE CustKey=@custKey AND ISNULL(isDeleted,0)=0',params);
  if(customer.recordset?.length!==1){const error=new Error('활성 거래처를 찾을 수 없습니다.');error.status=404;throw error;}
  const details=await tQuery(`${productSortLookup} SELECT sm.OrderYear,sm.OrderWeek,sm.OrderYearWeek,sm.CustKey MasterCustKey,
    sd.SdetailKey,sd.CustKey DetailCustKey,sd.ProdKey,sd.OutQuantity,sd.Cost DetailCost,sd.isFix,
    c.CustKey ActiveCustKey,p.ProdKey ActiveProdKey,p.ProdName,p.CounName,p.FlowerName,p.OutUnit,p.EstUnit,p.BunchOf1Box,p.SteamOf1Box,p.SteamOf1Bunch,ISNULL(psl.OrderNo,99) OrderNo,ISNULL(psl.GroupNo,99) GroupNo,ISNULL(psl.GroupName,N'') GroupName
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    LEFT JOIN Customer c ON c.CustKey=sm.CustKey AND ISNULL(c.isDeleted,0)=0
    LEFT JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
    LEFT JOIN ProductSortLookup psl ON psl.ProdKey=p.ProdKey AND psl.rank_priority=1
    WHERE sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@majorWeek AND sm.CustKey=@custKey AND ISNULL(sm.isDeleted,0)=0`,params);
  const selectedDateSql=scope.dates.length ? `CASE WHEN CONVERT(date,sdd.ShipmentDtm) IN (${scope.dates.map((_,i)=>`@printDate${i}`).join(',')}) THEN 1 ELSE 0 END` : '1';
  const dates=await tQuery(`SELECT sd.SdetailKey,sdd.SdateKey,sdd.ShipmentQuantity,sdd.EstQuantity,sdd.Cost,sdd.Amount,sdd.Vat,sdd.Descr,${selectedDateSql} IsSelected,
    CONVERT(nvarchar(23),sdd.ShipmentDtm,121) ShipmentTimestamp,
    (SELECT COUNT_BIG(*) FROM PeriodDay pd WHERE pd.BaseYmd=sdd.ShipmentDtm) ExactPeriodDayCount
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
    WHERE sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@majorWeek AND sm.CustKey=@custKey AND ISNULL(sm.isDeleted,0)=0`,params);
  const dateFilter=scope.dates.length ? `AND CONVERT(date,e.EstimateDtm) IN (${scope.dates.map((_,i)=>`@printDate${i}`).join(',')})` : '';
  const deductions=await tQuery(`${productSortLookup} SELECT e.ProdKey,
    N'['+COALESCE(NULLIF(ci.Descr2,N''),NULLIF(e.EstimateType,N''),N'기타')+N'] '+ISNULL(p.ProdName,N'') ProdName,e.Quantity,e.Cost,e.Amount,e.Vat,e.Descr,
    COALESCE(NULLIF(ci.Descr2,N''),NULLIF(e.EstimateType,N''),N'기타') EstimateType,p.EstUnit Unit,
    ISNULL(psl.OrderNo,99) OrderNo,ISNULL(psl.GroupNo,99) GroupNo,ISNULL(psl.GroupName,N'') GroupName
    FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    LEFT JOIN Product p ON p.ProdKey=e.ProdKey
    LEFT JOIN ProductSortLookup psl ON psl.ProdKey=p.ProdKey AND psl.rank_priority=1
    LEFT JOIN CodeInfo ci ON e.EstimateType=ci.DetailCode AND ci.Category=N'EstimateType'
    WHERE sm.OrderYear=@year AND sm.OrderYearWeek=@yearWeek AND sm.CustKey=@custKey AND ISNULL(sm.isDeleted,0)=0 ${dateFilter}
    ORDER BY e.EstimateType,ISNULL(psl.OrderNo,99),p.CounName,p.ProdName,e.EstimateKey`,params);
  return {customer:customer.recordset[0],...buildWeekdayAllocationPrintItems(scope,details.recordset||[],dates.recordset||[],deductions.recordset||[])};
}
