import test from 'node:test';
import assert from 'node:assert/strict';
import { compareHotelArrival,arrivalHistoryWeeks } from '../lib/hotelArrivalDisplay.js';
import { buildRaumPnlArrivalReferences } from '../lib/raumPnlArrivalReference.js';
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
