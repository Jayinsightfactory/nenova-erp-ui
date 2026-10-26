import test from 'node:test';
import assert from 'node:assert/strict';
import { compareHotelArrival,arrivalHistoryWeeks } from '../lib/hotelArrivalDisplay.js';
import { buildRaumPnlArrivalReferences, hotelSourceStemCost, hotelSourceStemCount } from '../lib/raumPnlArrivalReference.js';
import { invoiceArrivalRows } from '../lib/arrivalInvoiceSource.js';

test('FX changes display only, scales duty but preserves KRW fixed charges',()=>{
  const ref={sourceKind:'INVOICE',currency:'USD',exchangeRate:1000,rawCost:1200,cost:120,unit:'송이',fixedPerUnitKRW:200};
  const before=JSON.stringify(ref);
  assert.equal(compareHotelArrival(ref,{USD:1400}).cost,160);
  assert.equal(compareHotelArrival(ref,{EUR:1400}).cost,120);
  for(const fx of [0,-1,Infinity,'bad']) assert.equal(compareHotelArrival(ref,{USD:fx}).applied,false);
  assert.equal(compareHotelArrival(ref,{USD:''}).applied,false);
  assert.equal(compareHotelArrival({...ref,fixedPerUnitKRW:null},{USD:1400}).applied,false);
  assert.equal(compareHotelArrival({...ref,currency:''},{USD:1400}).applied,false);
  assert.equal(JSON.stringify(ref),before);
});
test('history is numeric latest subweek, exact year, every farm retained',()=>{
 const rows=['9-2','40-01','42-02'].map((OrderWeek,i)=>({OrderYear:'2026',OrderWeek,ProdKey:1,ArrivalLineKey:i+1,ArrivalUnit:'단',SelectedArrivalCostKRW:100,FarmNameRaw:'A'}));
 rows.push({...rows[2],OrderYear:'2025',OrderWeek:'52-2'}, {...rows[2],ArrivalLineKey:9,FarmNameRaw:'B'});
 const refs=buildRaumPnlArrivalReferences([{itemKey:1,prodKey:1,unit:'단'}],rows,39,'2026',true)[1];
 assert.deepEqual(arrivalHistoryWeeks(refs),['9-2','40-1','42-2']);
 assert.equal(refs.filter(r=>r.week==='42-2').length,2);
 assert.ok(refs.every(r=>r.orderYear==='2026'));
});
test('invoice FX evidence requires reconciliation, test-only excluded',()=>{
 const actual={status:'APPROVED',storedStatus:'APPROVED',basis:'ACTUAL',liveReceiptStatus:'MATCH',orderYear:'2026',orderWeek:'42-1',documentId:'d',documentRevision:1,operationId:'o',warehouseKey:1,costRevisionId:'r',
 editableInput:{input:{nativeCurrency:'USD',exchangeRateKRW:1000,expenseBasis:'CONFIRMED'}},
 lines:[{lineId:'l',prodKey:1,unit:'BUNCH',quantity:10,costPerUnitKRW:1200,componentAmounts:{goodsKRW:8000,freightKRW:1000,tariffKRW:1000,customsKRW:2000,otherKRW:0}}]};
 const costs={status:'APPROVED',documentCostStatus:'APPROVED',documentId:'d',documentRevision:1,operationId:'o',currentActual:actual};
 assert.equal(invoiceArrivalRows(costs,{WarehouseKey:1},'2026')[0].FixedPerUnitKRW,200);
 actual.lines[0].componentAmounts.customsKRW=3000;
 assert.equal(invoiceArrivalRows(costs,{WarehouseKey:1},'2026')[0].FixedPerUnitKRW,null);
 actual.expenseBasis='TEST_ONLY';
 assert.deepEqual(invoiceArrivalRows(costs,{WarehouseKey:1},'2026'),[]);
});

test('legacy workbook aliases and country currency reach the displayed won cost without changing saved costs',()=>{
 const cells={'도착원가(송이) (부가세 별도)':1901.697673086564,'도착원가(단) (부가세 포함)':20918.6744,'단당  수량':10};
 const source={OrderYear:'2026',OrderWeek:'40-1',ProdKey:1,ArrivalLineKey:41837,CountryName:'네덜란드',ArrivalUnit:'단',SelectedArrivalCostKRW:19017,ExchangeRate:1760,SourceStemsPerBunch:10,AllocationBasis:'SOURCE',CustomsPerUnitKRW:0,OtherPerUnitKRW:142.1982,RawJson:JSON.stringify({cells})};
 const item={itemKey:1,prodKey:1,unit:'단',costPrice:9000};
 const before=JSON.stringify({item,source});
 const refs=buildRaumPnlArrivalReferences([item],[source,{...source,OrderYear:'2025',SelectedArrivalCostKRW:99999}],40,'2026',true)[1];
 assert.equal(refs.length,1);
 assert.equal(refs[0].fxExpenseFactor,10);
 const result=compareHotelArrival(refs[0],{EUR:1900});
 assert.equal(result.applied,true);
 assert.equal(Math.round(result.cost),20417);
 assert.equal(compareHotelArrival(refs[0],{}).cost,19017);
 assert.equal(compareHotelArrival(refs[0],{USD:1900}).reason,'EUR 환율 미입력');
 assert.equal(JSON.stringify({item,source}),before);
 for(const [country,currency] of [['중국','CNY'],['태국','USD'],['베트남','USD'],['에콰도르','USD']]) {
   const ref=buildRaumPnlArrivalReferences([item],[{...source,CountryName:country,RawJson:JSON.stringify({cells:{'도착원가(단)':1200,'단당수량':1}}),SelectedArrivalCostKRW:1200,ExchangeRate:1000,SourceStemsPerBunch:1,OtherPerUnitKRW:200}],40,'2026')[1][0];
   assert.equal(ref.currency,currency);
   assert.equal(compareHotelArrival(ref,{[currency]:1400}).cost,1600);
 }
 const explicit=buildRaumPnlArrivalReferences([item],[{...source,CountryName:'중국',Currency:' usd '}],40,'2026')[1][0];
 assert.equal(explicit.currency,'USD');
 const unknown=buildRaumPnlArrivalReferences([item],[{...source,CountryName:'알수없음'}],40,'2026')[1][0];
 assert.equal(compareHotelArrival(unknown,{USD:1400}).applied,false);
 const mismatch=buildRaumPnlArrivalReferences([item],[{...source,SelectedArrivalCostKRW:25000}],40,'2026')[1][0];
 assert.equal(compareHotelArrival(mismatch,{EUR:1900}).applied,false);
});

test('stem evidence accepts whitespace/송의/exclusive VAT, rejects inclusive VAT and conflicting aliases',()=>{
 for(const header of ['도착원가(송이)','도착원가(송의)','도착원가(송이)\r\n(부가세 별도)']) {
   assert.equal(hotelSourceStemCost({cells:{[header]:100}}),100);
 }
 for(const raw of [{cells:{'도착원가(송이) (부가세 포함)':110}}, {cells:{'도착원가(송이)':100,'도착원가(송의)':200}}, {cells:{'도착원가(송이)':null}}, '{broken']) {
   assert.equal(hotelSourceStemCost(raw,100),null);
 }
 assert.equal(hotelSourceStemCost(undefined,100),100);
});

test('early parallel header/cell arrays recover original pack evidence without trusting Product defaults',()=>{
 const raw={headers:['그외통관(송이당)','도착원가(송이)','단당  수량','도착원가(단)'],cells:[76.3064892495204,1992.70052598368,10,19927.0052598368]};
 assert.equal(hotelSourceStemCount(raw),10);
 const row={OrderYear:'2026',OrderWeek:'52-2',ProdKey:1,ArrivalLineKey:941,CountryName:'네덜란드',ArrivalUnit:'단',SelectedArrivalCostKRW:19927,ExchangeRate:1750,AllocationBasis:'SOURCE',CustomsPerUnitKRW:0,OtherPerUnitKRW:76,RawJson:JSON.stringify(raw),SteamOf1Bunch:5};
 const ref=buildRaumPnlArrivalReferences([{itemKey:1,prodKey:1,unit:'송이'}],[row],40,'2026',true)[1][0];
 assert.equal(ref.sourceStemsPerBunch,10);
 assert.equal(ref.fxExpenseFactor,10);
 assert.equal(ref.cost,1992.7);
 assert.equal(Math.round(compareHotelArrival(ref,{EUR:1900}).cost),2157);
 assert.equal(hotelSourceStemCount({...raw,headers:[...raw.headers,'단당수량'],cells:[...raw.cells,5]}),null);
 assert.equal(hotelSourceStemCost({...raw,headers:raw.headers.slice(1)}),null);
});
