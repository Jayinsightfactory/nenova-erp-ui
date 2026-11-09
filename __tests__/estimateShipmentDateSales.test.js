import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSalesMatrix, rangeWeeks, storedPriceBuckets, visibleSalesPeriods } from '../lib/estimateShipmentDateMatrix.js';
import { settlementPeriods, validateSalesRequest, summarizeSales, quantityFormula, shipmentDateSalesSql } from '../lib/estimateShipmentDateSales.js';

assert.deepEqual(settlementPeriods('2026-11-06', 1, 5, 1), [{ startDate:'2026-11-02', endDate:'2026-11-06' }]);
assert.deepEqual(settlementPeriods('2027-01-02', 2, 1, 1), [{ startDate:'2026-12-29', endDate:'2027-01-04' }]);
assert.deepEqual(settlementPeriods('2026-11-08', 0, 0, 1), [{ startDate:'2026-11-08', endDate:'2026-11-08' }]);
assert.equal(settlementPeriods('2026-11-08', 0, 6).length, 12);
const scope = validateSalesRequest({custKey:'1', mode:'history', anchor:'2026-11-06', startDay:'1', endDay:'5'});
assert.equal(scope.endDate,'2026-11-06');
for (const bad of [{custKey:'0'}, {custKey:'1x'}, {custKey:true}, {startDate:'2026-02-30'}, {startDate:'2026-1-01'}, {endDate:'2025-01-01'}, {endDate:'2028-01-01'}, {mode:'unknown'}]) {
  assert.throws(()=>validateSalesRequest({custKey:'1',startDate:'2026-11-01',endDate:'2026-11-06',...bad}));
}
for (const value of ['',undefined,'7',false,'1x']) assert.throws(()=>settlementPeriods('2026-11-06',value,5));
const row = {Kind:'shipment',RowKey:1,OrderYear:'2026',OrderWeek:'44-01',ProdKey:1,ProdName:'연습 장미',Unit:'단',SaleDate:'2026-11-03',Quantity:30,Cost:1100,Amount:30000,Vat:3000};
const rows = [row,{...row,RowKey:2,OrderWeek:'44-02',Quantity:60,Amount:60000,Vat:6000},
  {...row,RowKey:3,ProdKey:2,Unit:'송이',Quantity:10,Amount:10000,Vat:1000},
  {...row,Kind:'adjustment',RowKey:4,Quantity:-2,Amount:-2000,Vat:-200},
  {...row,RowKey:5,SaleDate:'2025-11-03',OrderYear:'2025',Quantity:999},
  {...row,RowKey:6,SaleDate:'2026-11-07',Quantity:999}];
const snapshot=JSON.stringify(rows);
const summary=summarizeSales(rows,[{startDate:'2026-11-02',endDate:'2026-11-06'}])[0];
assert.equal(summary.totalAmount,107800);
assert.equal(summary.adjustmentAmount,-2200);
assert.deepEqual(summary.quantities,[{unit:'단',quantity:90},{unit:'송이',quantity:10}]);
assert.equal(quantityFormula(summary.products[0]),'90 = 30(44-1) / 60(44-2)');
assert.equal(JSON.stringify(rows),snapshot);
const cross=summarizeSales([{...row,OrderYear:'2025',SaleDate:'2026-01-01'},{...row,RowKey:8,SaleDate:'2026-01-02'}],[{startDate:'2025-12-30',endDate:'2026-01-05'}])[0];
assert.equal(cross.products[0].sources.length,2,'same week across years keeps separate provenance');
assert.equal(cross.products[0].quantity,60);
assert.equal(summarizeSales([],scope.periods).length,12,'empty periods remain visible');
assert.match(shipmentDateSalesSql,/vo.OrderYear=vs.OrderYear/);
assert.match(shipmentDateSalesSql,/vo.OrderWeek=vs.OrderWeek/);
assert.match(shipmentDateSalesSql,/EXISTS/);
assert.doesNotMatch(shipmentDateSalesSql,/JOIN PeriodDay|@orderYear|@orderWeek|\b(?:INSERT|UPDATE|DELETE|CREATE|EXEC)\b/i);
assert.match(shipmentDateSalesSql,/DATEADD\(day,1,@endDate\)/);
assert.match(shipmentDateSalesSql,/DetailFix=1/);
console.log('PASS shipment-date sales: recurring/Sunday/cross-year periods; strict inputs; mixed units; deductions; boundaries; 90=30(44-1)/60(44-2); immutable records');

const calls=[]; let fail=false;
const context={validateSalesRequest,shipmentDateSalesSql,summarizeSales,withAuth:h=>h,sql:{Int:'Int',Date:'Date'},console:{error(){}},
  query:async(q,p)=>{calls.push({q,p});if(fail)throw Error('private sql details');return {recordset:rows};},handler:null};
const api=fs.readFileSync(new URL('../pages/api/estimate/shipment-date-sales.js',import.meta.url),'utf8');
vm.runInNewContext(api.replace(/^import .*;\r?\n/gm,'').replace('export default withAuth','handler=withAuth'),context);
async function request(method,query){const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(body){this.body=body;return this;}};await context.handler({method,query},res);return res;}
assert.equal((await request('POST',{})).code,405);assert.equal(calls.length,0);
assert.equal((await request('GET',{custKey:'1'})).code,400);assert.equal(calls.length,0);
const payload={custKey:'1',mode:'range',startDate:'2026-11-02',endDate:'2026-11-06',orderYear:'2025',orderWeek:'01-01'};
let response=await request('GET',payload);
assert.equal(response.code,200);assert.equal(response.body.periods[0].totalAmount,107800);
assert.equal(calls[0].p.startDate.value,'2026-11-02');assert.equal(calls[0].p.custKey.value,1);assert.equal(Object.keys(calls[0].p).length,3);
assert.match(response.headers['Cache-Control'],/no-store/);
fail=true;response=await request('GET',payload);assert.equal(response.code,500);assert.doesNotMatch(response.body.error,/private/);
console.log('PASS shipment-date API: method/input rejection before DB, parameter binding, ignores legacy week filters, errors do not become zero sales');

assert.deepEqual(rangeWeeks('2026-12-28','2027-01-10'),[{startDate:'2026-12-28',endDate:'2027-01-03'},{startDate:'2027-01-04',endDate:'2027-01-10'}]);
assert.equal(rangeWeeks('2026-11-03','2026-11-11')[1].endDate,'2026-11-11');
assert.throws(()=>rangeWeeks('2026-02-30','2026-03-01'));
const matrixRows=[row,{...row,RowKey:2,SaleDate:'2026-11-04',OrderWeek:'44-02',Quantity:60,Amount:60000,Vat:6000},
  {...row,RowKey:3,SaleDate:'2026-11-10',Quantity:10,Amount:10000,Vat:1000},
  {...row,RowKey:4,Kind:'adjustment',SaleDate:'2026-11-04',Quantity:-2,Amount:-2000,Vat:-200},
  {...row,RowKey:5,ProdKey:2,Unit:'송이',Quantity:7,Amount:0,Vat:0}];
const matrixInput=summarizeSales(matrixRows,[{startDate:'2026-11-02',endDate:'2026-11-15'}]);
const beforeMatrix=JSON.stringify(matrixInput),matrix=buildSalesMatrix(matrixInput,'range');
assert.equal(matrix.weeks.length,2);assert.equal(matrix.rows.length,3);assert.equal(matrix.totalAmount,107800);
assert.deepEqual(matrix.weeks[0].dailyAmounts,[0,33000,63800,0,0,0,0]);
assert.equal(matrix.weeks[1].dailyAmounts[1],11000);
const flower=matrix.rows.find(r=>r.prodKey===1&&r.kind==='shipment');
assert.equal(quantityFormula(flower.weeks[0].product),'90 = 30(44-1) / 60(44-2)');
assert.equal(flower.weeks[0].cells[1].quantity,30);assert.equal(flower.weeks[0].cells[2].quantity,60);
assert.equal(flower.weeks[1].cells[1].quantity,10);assert.equal(flower.weeks[0].cells[0].details.length,0);
assert.equal(matrix.rows.find(r=>r.prodKey===2).weeks[0].product.amount,0,'stored zero remains zero');
assert.equal(JSON.stringify(matrixInput),beforeMatrix,'matrix does not modify server facts');
assert.equal(buildSalesMatrix([], 'range').rows.length,0);
assert.equal(buildSalesMatrix(summarizeSales([],scope.periods),'history').weeks.length,12);
const crossMatrix=buildSalesMatrix(summarizeSales([{...row,SaleDate:'2026-12-31',OrderYear:'2025'},{...row,RowKey:6,SaleDate:'2027-01-01',OrderYear:'2026'}],[{startDate:'2026-12-28',endDate:'2027-01-03'}]),'range');
assert.equal(crossMatrix.rows[0].weeks[0].product.sources.length,2);
console.log('PASS calendar matrix: start-anchored seven days, partial/cross-year weeks, mixed units, stored zero/deductions, per-day/weekly totals, source quantity and immutable API facts');

const priceMatrix=buildSalesMatrix(summarizeSales([{...row,Cost:0},{...row,RowKey:20,Quantity:60,Cost:2200,SaleDate:'2026-11-04',Amount:120000,Vat:12000}], [{startDate:'2026-11-02',endDate:'2026-11-08'}]),'history');
assert.deepEqual(storedPriceBuckets(priceMatrix.rows[0]),[{cost:0,quantity:30},{cost:2200,quantity:60}]);
assert.equal(priceMatrix.supplyAmount,150000);assert.equal(priceMatrix.vatAmount,15000);assert.equal(priceMatrix.totalAmount,165000);
const history=settlementPeriods('2027-01-02',2,1).map((p,i)=>({...p,index:i}));
assert.deepEqual(visibleSalesPeriods(history,'history').map(p=>p.index),[0,1]);
assert.deepEqual(visibleSalesPeriods(history,'history',1).map(p=>p.index),[2,3]);
assert.equal(visibleSalesPeriods(history,'history',0,true).length,12);
assert.equal(visibleSalesPeriods(history,'range').length,12,'direct range is not truncated');
assert.equal(visibleSalesPeriods([],'history').length,0);
for(const bad of [-1,1.5,false])assert.throws(()=>visibleSalesPeriods(history,'history',bad));
assert.equal(visibleSalesPeriods(history,'history')[0].startDate,'2026-12-29');
console.log('PASS favorite quick view: latest two, zero page, previous/all/direct scope, cross-year, distinct stored zero/multiple prices and exact supply/VAT totals');
