import assert from 'node:assert/strict';
import { normalizeWeekdayPrintRequest,assessWeekdayPrintEligibility,readWeekdayPrintInTransaction,
  reconcileWeekdayPrintQuote,WEEKDAY_PRINT_DETAILS_SQL,WEEKDAY_PRINT_DATES_SQL } from '../lib/weekdayEstimatePrint.js';
import { shiftDate,SHIPPING_DAYS } from '../lib/weekdayEstimateCycle.js';

const scope=normalizeWeekdayPrintRequest({year:2026,majorWeek:38,custKey:533,mode:'major'});
const row=(overrides={})=>({OrderYear:2026,OrderWeek:'38-01',OrderYearWeek:'202638',ShipmentKey:11,
  MasterCustKey:533,DetailCustKey:533,ActiveCustKey:533,ProdKey:69,ActiveProdKey:69,
  SdetailKey:101,OutQuantity:10,EstQuantity:10,Cost:110,Amount:1000,Vat:100,isFix:1,
  ViewShipmentCount:1,ViewOrderCount:1,...overrides});
const day=(overrides={})=>({SdetailKey:101,SdateKey:1,ShipmentQuantity:10,EstQuantity:10,
  Cost:110,Amount:1000,Vat:100,ShipmentTimestamp:'2026-09-17 00:00:00.000',ExactPeriodDayCount:1,...overrides});
const check=(rows=[row()],dates=[day()])=>assessWeekdayPrintEligibility(scope,rows,dates);
for(const [quantity,cost,amount,vat] of [[4.5,110,400,40],[4.5,110,500,50],[1,2.75,2,0.75],[1,2.75,3,-0.25]]) {
  if(vat<0) continue; // A nonnegative VAT is still required.
  assert.equal(check([row({OutQuantity:quantity,EstQuantity:quantity,Cost:cost,Amount:amount,Vat:vat})],
    [day({ShipmentQuantity:quantity,EstQuantity:quantity,Cost:cost,Amount:amount,Vat:vat})]).eligible,true,'EXE decimal and existing web complete money tuples accepted');
}
assert.equal(check([row({OutQuantity:4.5,EstQuantity:4.5,Cost:110,Amount:400,Vat:50})],
  [day({ShipmentQuantity:4.5,EstQuantity:4.5,Cost:110,Amount:400,Vat:50})]).eligible,false,'cannot mix different rounding rules');
assert.equal(check().eligible,true,'fully fixed and visible');
assert.equal(check([row({Cost:0,Amount:0,Vat:0})],[day({Cost:0,Amount:0,Vat:0})]).eligible,true,
  'EXE print has no positive-cost predicate; explicit zero price and zero money are preserved');
assert.equal(check([row(),row({SdetailKey:102,ShipmentKey:12,MasterCustKey:999,DetailCustKey:999,ActiveCustKey:999,isFix:0})],
  [day(),day({SdetailKey:102,SdateKey:2})]).unfixedCount,1,'other customer in same main blocks');
assert.equal(check([row(),row({SdetailKey:102,ShipmentKey:12,MasterCustKey:999,
  DetailCustKey:0,ActiveCustKey:null,ActiveProdKey:null,isFix:1,ViewShipmentCount:0,ViewOrderCount:0})],
  [day()]).eligible,true,'fixed other-customer link warning does not block selected quote');
assert.equal(check([row(),row({SdetailKey:102,OrderWeek:'38-02',isFix:null})],
  [day(),day({SdetailKey:102,SdateKey:2})]).eligible,false,'other subcycle blocks');
assert.throws(()=>check([row(),row({OrderYear:2025,OrderYearWeek:'202538',SdetailKey:102,isFix:0})],
  [day()]),/범위/,'wrong-year data must not be passed to assessor');
assert.match(WEEKDAY_PRINT_DETAILS_SQL,/sm.OrderYear=@year AND LEFT\(sm.OrderWeek,2\)=@majorWeek/);
assert.match(WEEKDAY_PRINT_DATES_SQL,/sm.OrderYear=@year AND LEFT\(sm.OrderWeek,2\)=@majorWeek/);
for(const [label,change] of [
  ['missing customer',{ActiveCustKey:null}],['missing product',{ActiveProdKey:null}],
  ['mismatched customer',{DetailCustKey:88}],['missing ViewShipment',{ViewShipmentCount:0}],
  ['duplicate ViewShipment',{ViewShipmentCount:2}],['missing ViewOrder',{ViewOrderCount:0}],
  ['duplicate ViewOrder',{ViewOrderCount:2}],['raw parent week',{OrderYearWeek:'20263801'}],
  ['malformed subcycle',{OrderWeek:'3801'}],['zero out with live estimate',{OutQuantity:0}],
  ['negative estimate',{EstQuantity:-1}],['null estimate',{EstQuantity:null}],
  ['money mismatch',{Amount:990}],['unknown fix',{isFix:9}],
  ['same gross wrong VAT split',{Amount:990,Vat:110}],
  ['one-won same-gross split',{Amount:999,Vat:101}],
  ['false fix',{isFix:false}],['NULL fix',{isFix:null}],
]) assert.equal(check([row(change)]).eligible,false,label);
for(const [label,change] of [
  ['missing calendar',{ExactPeriodDayCount:0}],['duplicate calendar',{ExactPeriodDayCount:2}],
  ['negative date shipment',{ShipmentQuantity:-1}],['null date estimate',{EstQuantity:null}],
  ['date money mismatch',{Vat:90}],['missing exact timestamp',{ShipmentTimestamp:null}],
  ['date one-won same-gross split',{Amount:999,Vat:101}],
]) assert.equal(check([row()],[day(change)]).eligible,false,label);
assert.equal(check([row()],[day({ShipmentQuantity:9})]).eligible,false,'date sum');
assert.equal(check([row()],[day({ShipmentQuantity:5,EstQuantity:5,Amount:500,Vat:50}),
  day({SdateKey:2,ShipmentQuantity:5,EstQuantity:5,Amount:500,Vat:50})]).eligible,false,'duplicate date');
assert.equal(check([row()],[day(),day({SdateKey:2,ShipmentQuantity:0,EstQuantity:null,
  Amount:null,Vat:null,ShipmentTimestamp:null,ExactPeriodDayCount:0})]).eligible,true,
  'harmless legacy zero date is not a print candidate');
assert.equal(check([row(),row({SdetailKey:102,OutQuantity:0,EstQuantity:0,isFix:0})],
  [day(),day({SdetailKey:102,SdateKey:2,ShipmentQuantity:0,EstQuantity:0,Amount:0,Vat:0})]).eligible,true,
  'legacy zero cancellation is not positive allocation');
assert.equal(check([row(),row({SdetailKey:102,OutQuantity:null,EstQuantity:null,isFix:0})],
  [day(),day({SdetailKey:102,SdateKey:2})]).eligible,false,'null raw quantity with live date cannot disappear');

const sql={Int:'Int',NVarChar:n=>`NVarChar(${n})`};
const periods=[];
for(let i=-7;i<14;i++) {
  const day=SHIPPING_DAYS[((i%7)+7)%7];
  periods.push({BaseYmd:shiftDate('2026-09-17',i),WeekDay:day.code,
    OrderYearWeek:`2026${38+Math.floor(i/7)+(day.suffix==='02'?1:0)}`});
}
const quote=[{ProdKey:69,ProdName:'Blue',Sort:0,EstQuantity:10,Cost:110,Amount:1000,Vat:100},
  {ProdKey:70,ProdName:'[차감] Test',Sort:1,EstimateTypeRaw:'차감',EstQuantity:-1,Cost:110,Amount:-100,Vat:-10}];
async function execute(inputRows=[row()],inputDates=[day()],inputScope=scope,quoteRows=quote) {
  const calls=[];
  const tQuery=async (statement,params={})=>{
    calls.push({statement,params});
    if(statement.startsWith('SET TRANSACTION')) return {recordset:[]};
    if(statement.startsWith('WITH anchor AS')) return {recordset:periods};
    if(statement.startsWith('SELECT CustKey,CustName')) return {recordset:[{CustKey:533,CustName:'주광'}]};
    if(statement===WEEKDAY_PRINT_DETAILS_SQL) return {recordset:inputRows.filter(r=>Number(r.OrderYear)===params.year.value
      && String(r.OrderWeek).startsWith(params.majorWeek.value))};
    if(statement===WEEKDAY_PRINT_DATES_SQL) return {recordset:inputDates.filter(d=>inputRows.some(r=>r.SdetailKey===d.SdetailKey
      && Number(r.OrderYear)===params.year.value && String(r.OrderWeek).startsWith(params.majorWeek.value)
      && Number(r.MasterCustKey)===params.custKey.value))};
    if(statement.includes('WITH list AS')) return {recordset:quoteRows};
    throw new Error(`unexpected SQL: ${statement.slice(0,60)}`);
  };
  try {return {value:await readWeekdayPrintInTransaction(inputScope,tQuery,sql),calls};}
  catch(error) {return {error,calls};}
}
const passed=await execute();
assert.equal(passed.value.items.length,2,'registered deduction preserved');
assert.equal(passed.value.items[1].EstimateType,'차감');
assert.equal(passed.calls[0].statement,'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
assert.equal(passed.calls.at(-1).params.year.value,2026);
assert.equal(passed.calls.at(-1).params.custKey.value,533);
assert.equal(check([row({DetailCustKey:null})]).eligible,true,'native NULL detail customer is printable and raw NULL is not mutated');
assert.equal(check([row({DetailCustKey:0})]).eligible,false,'explicit zero is not native NULL');
assert.equal(check([row({DetailCustKey:88})]).eligible,false,'a different positive detail customer is not native NULL');
const adjacent=await execute([row(),row({OrderYear:2025,OrderYearWeek:'202538',SdetailKey:102,isFix:0})],
  [day(),day({SdetailKey:102,SdateKey:2})]);
assert.equal(adjacent.value.eligibility.unfixedCount,0,'adjacent-year same week not included');
const partial=await execute([row(),row({SdetailKey:102,isFix:0,MasterCustKey:999,DetailCustKey:999,ActiveCustKey:999})],
  [day(),day({SdetailKey:102,SdateKey:2})]);
assert.equal(partial.error.status,409);
assert.equal(partial.error.eligibility.unfixedCount,1);
assert.equal(partial.calls.some(call=>call.statement.includes('WITH list AS')),false,'no partial quote');
const dateScope=normalizeWeekdayPrintRequest({year:2026,majorWeek:38,custKey:533,mode:'dates',dates:['2026-09-17']});
const datePartial=await execute([row(),row({SdetailKey:102,OrderWeek:'38-02',isFix:0})],
  [day(),day({SdetailKey:102,SdateKey:2})],dateScope);
assert.equal(datePartial.error.status,409,'selected actual date includes an unfixed detail and must reject the whole quote');
assert.equal(datePartial.calls.some(call=>call.statement.includes('WITH list AS')),false);
const datePassed=await execute([row()],[day()],dateScope);
assert.equal(datePassed.value.items.length,2);
assert.equal(datePassed.calls.at(-1).params.printDate0.value,'2026-09-17');
const unrelatedUnfixed=await execute([row(),row({SdetailKey:102,isFix:0,MasterCustKey:999})],
  [day(),day({SdetailKey:102,SdateKey:2})],dateScope);
assert.equal(unrelatedUnfixed.value.items.length,2,'other customer does not block selected confirmed date');
const differentDayUnfixed=await execute([row(),row({SdetailKey:102,isFix:0})],
  [day(),day({SdetailKey:102,SdateKey:2,ShipmentTimestamp:'2026-09-18 00:00:00.000'})],dateScope);
assert.equal(differentDayUnfixed.value.items.length,2,'other date does not block selected confirmed date');
const altered=await execute([row()],[day()],scope,[{...quote[0],Amount:99999},quote[1]]);
assert.equal(altered.error.status,409,'mutated quote cannot pass');
const zeroPriceRow=row({Cost:0,Amount:0,Vat:0});
const zeroPriceDay=day({Cost:0,Amount:0,Vat:0});
const zeroPriceQuote={...quote[0],Cost:0,Amount:0,Vat:0};
assert.equal((await execute([zeroPriceRow],[zeroPriceDay],scope,[zeroPriceQuote])).value.items.length,1);
for (const cost of [null,undefined,'','  ',NaN,Infinity,-1]) {
  assert.equal((await execute([zeroPriceRow],[zeroPriceDay],scope,[{...zeroPriceQuote,Cost:cost}])).error.status,409,
    'missing/invalid quote cost must not alias an explicit zero price');
}
assert.equal((await execute([row()],[day()],scope,[{...quote[0],EstQuantity:999},quote[1]])).error.status,409,
  'mutated returned quantity cannot pass');
const alteredVat=await execute([row()],[day()],scope,[{...quote[0],Vat:999},quote[1]]);
assert.equal(alteredVat.error.status,409,'mutated VAT cannot pass');
const mixedRow=row({OutQuantity:7,EstQuantity:7,Cost:4,Amount:25,Vat:3});
const mixedDates=Array.from({length:7},(_,i)=>day({SdateKey:i+1,ShipmentQuantity:1,EstQuantity:1,
  Cost:i===6?5:4,Amount:i===6?5:4,Vat:0,
  ShipmentTimestamp:`${shiftDate('2026-09-17',i)} 00:00:00.000`}));
const mixedQuote=[{...quote[0],Cost:4,EstQuantity:6,Amount:24,Vat:0},
  {...quote[0],Cost:5,EstQuantity:1,Amount:5,Vat:0}];
assert.equal(check([mixedRow],mixedDates).eligible,true,'native per-date rounding and mixed costs allowed');
assert.equal(reconcileWeekdayPrintQuote(scope,[mixedRow],mixedDates,mixedQuote).normalGroupCount,2);
const mixedPass=await execute([mixedRow],mixedDates,scope,mixedQuote);
assert.equal(mixedPass.value.items.length,2,'mixed cost buckets and date money accepted');
const mixedDateQuote=[{...quote[0],Cost:4,EstQuantity:1,Amount:4,Vat:0}];
assert.equal((await execute([mixedRow],mixedDates,dateScope,mixedDateQuote)).value.items.length,1,
  'selected actual date reconciles only its own bucket');
assert.equal((await execute([mixedRow],mixedDates,dateScope,[{...mixedDateQuote[0],Amount:999}])).error.status,409);
// A simulated competing unfix cannot interleave before quote: the one tQuery
// enters SERIALIZABLE before any read and keeps that transaction through quote.
let locked=false,quoteRead=false;
const concurrent=await readWeekdayPrintInTransaction(scope,async statement=>{
  if(statement.startsWith('SET TRANSACTION')) {locked=true;return {recordset:[]};}
  assert.equal(locked,true);
  if(statement.startsWith('SELECT CustKey,CustName')) return {recordset:[{CustKey:533}]};
  if(statement===WEEKDAY_PRINT_DETAILS_SQL) return {recordset:[row()]};
  if(statement===WEEKDAY_PRINT_DATES_SQL) return {recordset:[day()]};
  if(statement.includes('WITH list AS')) {quoteRead=true;return {recordset:quote};}
  throw new Error('unexpected SQL');
},sql);
assert.equal(quoteRead,true);assert.equal(concurrent.eligibility.eligible,true);
console.log('Weekday print eligibility: all-customer/raw/date/amount/serializable quote fixtures passed');
