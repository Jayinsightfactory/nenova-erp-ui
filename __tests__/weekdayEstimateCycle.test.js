import assert from 'node:assert/strict';
import { SHIPPING_DAYS, normalizeCycleRequest, buildShippingCycles, shiftDate, dateKey, moveWeekdayPlan, buildWeekdayMatrix } from '../lib/weekdayEstimateCycle.js';

const scope = normalizeCycleRequest({year:2026,majorWeek:38});
assert.deepEqual(scope,{year:2026,majorWeek:'38',orderYearWeek:'202638'});
for (const body of [{majorWeek:38},{year:2026,majorWeek:0},{year:2026,majorWeek:54},{year:0,majorWeek:38}]) assert.throws(()=>normalizeCycleRequest(body));
assert.throws(()=>dateKey('2026-02-30'));
assert.throws(()=>dateKey(''));
const periods = [];
for(let i=-7;i<14;i++) {
  const date=shiftDate('2026-09-17',i);
  const day=SHIPPING_DAYS[((i%7)+7)%7];
  // Mon..Wed belong to next PeriodDay key, but still current shipping-business cycle.
  const major=38+Math.floor(i/7)+(day.suffix==='02'?1:0);
  periods.push({BaseYmd:date+' 00:00:00.000',WeekDay:day.code,OrderYearWeek:`2026${major}`});
}
const cycles=buildShippingCycles(periods,scope);
assert.deepEqual(cycles.map(x=>x.majorWeek),['37','38','39']);
assert.deepEqual(cycles[1].days.map(x=>x.label),['목','금','토','일','월','화','수']);
assert.equal(cycles[1].days[4].date,'2026-09-21');
assert.equal(cycles[1].days[4].orderWeek,'38-02');
assert.throws(()=>buildShippingCycles(periods.filter(x=>x.BaseYmd.slice(0,10)!=='2026-09-17'),scope));
assert.throws(()=>buildShippingCycles([...periods,periods.find(x=>x.BaseYmd.startsWith('2026-09-17'))],scope));
const missing=buildShippingCycles(periods.filter(x=>!x.BaseYmd.startsWith('2026-09-21')),scope);
assert.equal(missing[1].days[4].calendarState,'MISSING');

const original={id:'F3',year:2026,custKey:533,prodKey:101,prodName:'Blue',orderWeek:'38-02',date:'2026-09-22',quantity:10,unit:'박스',sourceYear:2026,sourceOrderWeek:'39-01',wdetailKey:98};
const sameCycle=moveWeekdayPlan([original],{id:'F3',quantity:10,date:'2026-09-21',reason:'현장 일정 변경',eventId:'m1'},cycles);
assert.equal(sameCycle.plans[0].orderWeek,'38-02');
assert.equal(sameCycle.plans[0].sourceOrderWeek,'39-01');
assert.equal(sameCycle.event.applied,false);
assert.equal(sameCycle.event.before.date,'2026-09-22');
const transfer=moveWeekdayPlan([original],{id:'F3',quantity:3,date:'2026-09-24',reason:'다음 차수 출고',eventId:'m2'},cycles);
assert.equal(transfer.plans.length,2);
assert.equal(transfer.plans.reduce((s,x)=>s+x.quantity,0),10);
assert.equal(transfer.plans[1].orderWeek,'39-01');
assert.equal(transfer.plans[1].wdetailKey,98);
assert.deepEqual(transfer.event.source,{year:2026,orderWeek:'39-01',wdetailKey:98});
for(const patch of [{quantity:0},{quantity:11},{quantity:NaN},{date:'2026-10-01'},{reason:''}]) assert.throws(()=>moveWeekdayPlan([original],{id:'F3',quantity:3,date:'2026-09-24',reason:'x',eventId:'m3',...patch},cycles));
assert.throws(()=>moveWeekdayPlan([original],{id:'F3',quantity:3,date:'2026-09-21',reason:'x',eventId:'m3'},missing));
assert.throws(()=>moveWeekdayPlan(transfer.plans,{id:'F3',quantity:3,date:'2026-09-24',reason:'x',eventId:'m2'},cycles));

const actual=[
 {year:2026,orderWeek:'38-01',prodKey:101,outUnit:'박스',shipmentOutQuantity:2,fixed:true,shipmentDates:[{date:'2026-09-20',shipmentQuantity:2}]},
 {year:2026,orderWeek:'38-02',prodKey:101,outUnit:'박스',shipmentOutQuantity:10,fixed:true,shipmentDates:[{date:'2026-09-20',shipmentQuantity:10}]},
 {year:2025,orderWeek:'38-02',prodKey:101,outUnit:'박스',shipmentOutQuantity:999,fixed:true,shipmentDates:[{date:'2026-09-20',shipmentQuantity:999}]},
];
const matrix=buildWeekdayMatrix(cycles[1],[original],actual)[0];
assert.equal(matrix.currentTotal,12,'prior-year near-miss excluded');
assert.equal(matrix.days[3].current,12,'01 and 02 actual Sunday quantities retained');
assert.equal(matrix.days[3].assignedWeekMismatch,true,'legacy subweek/date mismatch is visible, not rewritten');
assert.equal(matrix.days[3].remaining,null,'absence of daily inventory is never zero');
assert.equal(matrix.days[5].delta,10);
assert.equal(buildWeekdayMatrix(cycles[1],[{...original,unit:'단'}],actual)[0].unitState,'REVIEW');
assert.equal(buildWeekdayMatrix(cycles[1],[{...original,unit:'단'}],actual)[0].days[5].delta,null);
assert.equal(buildWeekdayMatrix(cycles[1],[original],actual.map(row=>({...row,outUnit:'BOX'})))[0].unitState,'MATCHED');
assert.equal(buildWeekdayMatrix(cycles[1],[original],actual.map(row=>({...row,outUnit:null})))[0].days[5].delta,null);
const outside=buildWeekdayMatrix(cycles[1],[],[{...actual[0],shipmentDates:[{date:'2026-09-27',shipmentQuantity:2}]}])[0];
assert.equal(outside.outside.length,1,'dates outside quote cycle are not silently omitted');

const boundaryPeriods=[];
for(let i=-7;i<14;i++) {
 const date=shiftDate('2026-12-31',i); const day=SHIPPING_DAYS[((i%7)+7)%7];
 const block=Math.floor(i/7)+(day.suffix==='02'?1:0);
 const key=block<0?'202652':block===0?'202653':'202701';
 boundaryPeriods.push({BaseYmd:date,WeekDay:day.code,OrderYearWeek:key});
}
const boundary=buildShippingCycles(boundaryPeriods,normalizeCycleRequest({year:2026,majorWeek:53}));
assert.equal(boundary[1].days[4].orderWeek,'53-02');
assert.equal(boundary[1].days[4].date,'2027-01-04');
assert.equal(boundary[2].year,2027);
assert.equal(boundary[2].majorWeek,'01');
console.log('Weekday cycle tests passed: calendar, prior year, legacy date mismatch, unit mismatch, source-preserving moves, year boundary');
