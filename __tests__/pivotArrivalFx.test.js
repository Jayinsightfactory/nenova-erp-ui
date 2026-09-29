import assert from 'node:assert/strict';
import { buildPivotArrivalReferences, pivotArrivalKey } from '../lib/pivotArrivalReference.js';
import { enrichPivotExeRows } from '../lib/pivotExeSupplement.js';
import { applyPivotArrivalFx, normalizePivotFxRates } from '../lib/pivotArrivalFx.js';
import { buildPivotModel } from '../lib/pivotExeModel.js';
import { buildPivotExeWorkbook } from '../lib/pivotExeExport.js';
import ExcelJS from 'exceljs';

const target={OrderYear:'2026',OrderWeek:'38-01',ProdKey:1,ProdName:'Rose',Quantity:2,DistCost:12500,ListType:'02. 주문'};
const raw={meta:{exchangeRate:1450},cells:{'CNF (송이)':1,'CNF (원화)':1450,'도착원가(송이)':1500,'단당 수량':10}};
const source={OrderYear:'2026',OrderWeek:'37-1',ProdKey:1,CountryName:'콜롬비아',ArrivalUnit:'단',OutUnit:'단',SelectedArrivalCostKRW:15000,ExchangeRate:1450,AllocationBasis:'SOURCE',RawJson:JSON.stringify(raw)};
const rowsFor=sources=>enrichPivotExeRows([target],[],buildPivotArrivalReferences([target],sources));
const original=rowsFor([source]); const snapshot=structuredClone(original);
assert.equal(original[0].ArrivalCost,15000);
assert.equal(applyPivotArrivalFx(original,{USD:1400})[0].ArrivalCost,14500,'원화500원 유지');
assert.equal(applyPivotArrivalFx(original,{USD:1450})[0].ArrivalCost,15000,'같은 환율 재현');
assert.equal(applyPivotArrivalFx(rowsFor([{...source,SelectedArrivalCostKRW:15000.25}]),{USD:1450})[0].ArrivalCost,15000.25,'저장 원가의 반올림 차이 보존');
assert.equal(applyPivotArrivalFx(rowsFor([{...source,RawJson:JSON.stringify({...raw,meta:{exchangeRate:1450,country:'중국'}})}]),{USD:1400})[0].ArrivalCost,null,'국가 통화 불일치 거부');
assert.equal(applyPivotArrivalFx(original,{EUR:1600})[0].ArrivalCost,15000,'다른 통화 보존');
assert.equal(applyPivotArrivalFx(original,{}),original,'원본 복원');
assert.deepEqual(original,snapshot);
assert.equal(applyPivotArrivalFx(original,{USD:1400})[0].Quantity,2);
for(const value of [0,-1,Infinity,NaN,'abc',false]) assert.throws(()=>normalizePivotFxRates({USD:value}));
assert.deepEqual(normalizePivotFxRates({USD:'1450.5',EUR:'',JPY:null}),{USD:1450.5});
assert.deepEqual(normalizePivotFxRates(),{});
assert.throws(()=>normalizePivotFxRates({ZZZ:12}));
for(const change of [{RawJson:null},{RawJson:'invalid'},{ExchangeRate:1500},{AllocationBasis:'WEIGHT'},{CountryName:'미확인'},{SelectedArrivalCostKRW:13000},{OutUnit:'박스'}]) {
  const result=applyPivotArrivalFx(rowsFor([{...source,...change}]),{USD:1400})[0];
  assert.equal(result.ArrivalCost,null,JSON.stringify(change));
}
for(const cells of [{'CNF (원화)':1400},{'CNF (송이)':null},{'도착원가(송이)':1000},{'단당 수량':null}]) {
  const result=applyPivotArrivalFx(rowsFor([{...source,RawJson:JSON.stringify({...raw,cells:{...raw.cells,...cells}})}]),{USD:1400})[0];
  assert.equal(result.ArrivalCost,null);
}
const alt={...source,SelectedArrivalCostKRW:14900,RawJson:JSON.stringify({meta:{exchangeRate:1450},cells:{'CNF (송이)':.8,'CNF (원화)':1160,'도착원가(송이)':1490,'단당 수량':10}})};
assert.equal(applyPivotArrivalFx(rowsFor([source,alt]),{USD:1000})[0].ArrivalCost,11300,'환율 적용 후 최고 농장 재선정');
assert.equal(applyPivotArrivalFx(rowsFor([source,{...alt,RawJson:null}]),{USD:1000})[0].ArrivalCost,null,'일부 농장 미확인을 낮은 최고가로 숨기지 않는다');
const cn={...source,CountryName:'중국',ExchangeRate:220,SelectedArrivalCostKRW:7600,RawJson:JSON.stringify({meta:{exchangeRate:220},cells:{FOB:20,'운송비\n(단)':10,'CNF (단)':6600,'도착원가(단)':7600}})};
assert.equal(applyPivotArrivalFx(rowsFor([cn]),{CNY:200})[0].ArrivalCost,7000);
const yearRows=[target,{...target,OrderYear:'2025'}];
const refs=buildPivotArrivalReferences(yearRows,[source]);
assert.equal(refs[pivotArrivalKey(yearRows[1])],null);
const adjusted=applyPivotArrivalFx(original,{USD:1400});
const model=buildPivotModel(adjusted,{layout:{row:['ProdName'],column:['OrderYear','OrderWeek'],data:['ArrivalCost']},showRowTotals:false,showColumnTotals:false,showGrandTotals:false});
const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await buildPivotExeWorkbook(model,{arrivalFxRates:{USD:1400},arrivalFxRows:adjusted}));
assert.equal(workbook.worksheets.length,2);
assert.ok(JSON.stringify(workbook.worksheets[0].getSheetValues()).includes('14500'));
assert.ok(JSON.stringify(workbook.worksheets[1].getSheetValues()).includes('USD'));
assert.ok(JSON.stringify(workbook.worksheets[1].getSheetValues()).includes('1400'));
console.log('pivot arrival FX: components, units, missing evidence, multi-farm MAX, years, restore, XLSX passed');
