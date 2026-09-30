import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeWeekdayPrintRequest, validateWeekdayPrintDates, mapWeekdayPrintRow } from '../lib/weekdayEstimatePrint.js';
import { normalizeCycleRequest,buildShippingCycles,shiftDate,SHIPPING_DAYS } from '../lib/weekdayEstimateCycle.js';
import { sqlEstimateGetPrintDetail } from '../lib/exeEstimateViewSql.js';

const periods=[];
for(let i=-7;i<14;i++) {
  const day=SHIPPING_DAYS[((i%7)+7)%7];
  periods.push({BaseYmd:shiftDate('2026-09-17',i),WeekDay:day.code,OrderYearWeek:`2026${38+Math.floor(i/7)+(day.suffix==='02'?1:0)}`});
}
const cycles=buildShippingCycles(periods,normalizeCycleRequest({year:2026,majorWeek:38}));
const request={year:2026,majorWeek:38,custKey:533,mode:'dates',dates:['2026-09-22','2026-09-17','2026-09-22']};
const scope=normalizeWeekdayPrintRequest(request);
assert.deepEqual(scope.dates,['2026-09-17','2026-09-22']);
assert.equal(validateWeekdayPrintDates(scope,cycles),scope);
for(const bad of [{year:null},{custKey:0},{mode:'all'},{dates:[]},{dates:['2026-02-30']}]) {
  assert.throws(()=>normalizeWeekdayPrintRequest({...request,...bad}));
}
assert.throws(()=>validateWeekdayPrintDates({...scope,dates:['2026-09-24']},cycles));
assert.throws(()=>validateWeekdayPrintDates({...scope,year:2025},cycles));
const missing=structuredClone(cycles);missing[1].days[5].calendarState='MISSING';
assert.throws(()=>validateWeekdayPrintDates(scope,missing));
const major=normalizeWeekdayPrintRequest({...request,mode:'major'});
assert.deepEqual(major.dates,[]);
const defaultSql=sqlEstimateGetPrintDetail({orderYearWeek:'202638',custKey:533,weekDayIn:'1,2,3,4,5,6,7'});
assert.doesNotMatch(defaultSql,/@printDate|vs.OrderYear = @year|sm.OrderYear = @year/);
const selectedSql=sqlEstimateGetPrintDetail({orderYearWeek:'202638',custKey:533,weekDayIn:'1,2,3,4,5,6,7',dateFilterCount:2,enforceYear:true});
assert.match(selectedSql,/vs.OrderYear = @year/);
assert.match(selectedSql,/sm.OrderYear = @year/);
assert.match(selectedSql,/CONVERT\(date,sdd.ShipmentDtm\) IN \(@printDate0,@printDate1\)/);
assert.match(selectedSql,/CONVERT\(date,e.EstimateDtm\) IN \(@printDate0,@printDate1\)/);
assert.match(selectedSql,/vs.DetailFix\s*=\s*1/);
assert.match(selectedSql,/LEFT JOIN CodeInfo/);
assert.throws(()=>sqlEstimateGetPrintDetail({dateFilterCount:8}));
assert.throws(()=>sqlEstimateGetPrintDetail({dateFilterCount:'1 OR 1=1'}));
const mapped=mapWeekdayPrintRow({ProdKey:69,ProdName:'Blue',Sort:0,EstQuantity:'10',Cost:'100',Amount:'900',Vat:'100'});
assert.equal(mapped.Quantity,10);assert.equal(mapped.EstimateType,'정상출고');assert.equal(mapped._exePrint,true);
const read=relative=>fs.readFileSync(new URL(`../${relative}`,import.meta.url),'utf8');
for(const file of ['pages/api/estimate/weekday-print.js','pages/api/estimate/weekday-products.js']) {
  const text=read(file);
  assert.match(text,/withAuth/);assert.match(text,/readOnly:true/);
  assert.doesNotMatch(text,/\b(?:INSERT|UPDATE|DELETE|MERGE)\s+(?:INTO\s+)?(?:Order|Shipment|Estimate|Stock)/i);
}
const products=read('pages/api/estimate/weekday-products.js');
assert.match(products,/sm.OrderYear=@year AND sm.CustKey=@custKey/);
assert.match(products,/om.OrderYear=@year AND om.CustKey=@custKey/);
assert.match(products,/sd.CustKey=sm.CustKey/);
assert.match(products,/TOP 501/);assert.match(products,/length>500/);
assert.match(products,/LEFT\(sm.OrderWeek,2\) IN/);
assert.match(products,/LEFT\(om.OrderWeek,2\) IN/);
assert.match(products,/result.recordsets\?\.\[1\]/);
console.log('Weekday print contract: date/major scopes, year bounds, readonly APIs and EXE mapping passed');
