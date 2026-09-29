import assert from 'node:assert/strict';
import { buildPivotArrivalReferences, pivotArrivalKey } from '../lib/pivotArrivalReference.js';
import { enrichPivotExeRows } from '../lib/pivotExeSupplement.js';
import { formatPivotExeNumber } from '../lib/pivotExePresentation.js';
import { buildPivotModel } from '../lib/pivotExeModel.js';
import { buildPivotExeWorkbook } from '../lib/pivotExeExport.js';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import vm from 'node:vm';
import { pivotArrivalWeek } from '../lib/pivotArrivalReference.js';

const target = {OrderYear:'2026',OrderWeek:'38-01',ProdKey:1330,ListType:'02. 주문',Quantity:2,ProdName:'Rose'};
const source = {OrderYear:'2026',OrderWeek:'37-1',ProdKey:1330,ArrivalUnit:'단',OutUnit:'단',SelectedArrivalCostKRW:10205.75};
const get = (sources, row=target) => buildPivotArrivalReferences([row],sources)[pivotArrivalKey(row)];
assert.equal(get([source]).arrivalCost,10205.75);
assert.equal(get([source]).isFallback,true);
assert.equal(get([source,{...source,OrderWeek:'38-1',SelectedArrivalCostKRW:9000}]).arrivalCost,9000,'정확 차수 우선');
assert.equal(get([source,{...source,SelectedArrivalCostKRW:9000}]).arrivalCost,10205.75,'같은 차수 최고가');
for (const change of [{OrderYear:'2025'},{OrderWeek:'39-1'},{ProdKey:1331},{IsCurrent:0},{OrderWeek:'38-02'},{OrderWeek:'38-1A'}]) assert.equal(get([{...source,...change}]),null);
assert.equal(get([{...source,OrderWeek:'9-2'},{...source,OrderWeek:'10-1',SelectedArrivalCostKRW:123}]).arrivalCost,123,'숫자 차수');
assert.equal(get([{...source,ArrivalUnit:'송이',OutUnit:'단',SteamOf1Bunch:10,SelectedArrivalCostKRW:100}]).arrivalCost,1000);
assert.equal(get([{...source,ArrivalUnit:'단-5스팀',OutUnit:'송이',SelectedArrivalCostKRW:100}]).arrivalCost,20);
assert.equal(get([{...source,OutUnit:'송이',SourceStemsPerBunch:5,SteamOf1Bunch:10,SelectedArrivalCostKRW:100}]).arrivalCost,20);
assert.equal(get([{...source,OutUnit:'박스'}]),null,'환산 근거 없으면 공란');
assert.equal(get([source,{...source,OrderWeek:'38-1',OutUnit:'박스'}]),null,'최신 환산 오류를 과거 원가로 숨기지 않는다');
assert.equal(get([{...source,SelectedArrivalCostKRW:0}]).arrivalCost,0);
assert.equal(get([{...source,SelectedArrivalCostKRW:null}]),null);
const types=['01. 전재고','02. 주문','03. 미발주수량','03. 입고','04. 출고','05. 현재고'];
const native=types.map(ListType=>({...target,ListType}));
const original=structuredClone(native);
const enriched=enrichPivotExeRows(native,[],buildPivotArrivalReferences(native,[source]));
assert.ok(enriched.every(row=>row.ArrivalCost===10205.75));
assert.deepEqual(native,original);
assert.equal(formatPivotExeNumber(10205.75,2,true,'ArrivalCost'),'10,206');
assert.equal(formatPivotExeNumber(1.25,2,true,'Quantity'),'1.25');
assert.equal(formatPivotExeNumber(null,2,true,'ArrivalCost'),'');
assert.equal(formatPivotExeNumber(0,2,true,'ArrivalCost'),'0');
const model=buildPivotModel([enriched[1]],{layout:{row:['ProdName'],column:['OrderYear','OrderWeek'],data:['ArrivalCost']},showRowTotals:false,showColumnTotals:false,showGrandTotals:false});
const workbook=new ExcelJS.Workbook(); await workbook.xlsx.load(await buildPivotExeWorkbook(model,{decimalPlaces:2}));
let found=false;
workbook.worksheets[0].eachRow(row=>row.eachCell(cell=>{if(cell.value===10205.75){found=true;assert.equal(cell.numFmt,'#,##0');}}));
assert.ok(found,'엑셀 숫자는 소수점 원본을 유지한다');
console.log('pivot uploaded arrival references and integer display passed');

// Execute the loader with bound, read-only fake requests; production probe uses
// this exact loader as well. No credentials or ERP mutations in this fixture.
const referenceSql=fs.readFileSync(new URL('../lib/raumPnlArrivalReference.js',import.meta.url),'utf8').match(/export const RAUM_PNL_ARRIVAL_REFERENCE_SQL = `([\s\S]*?)`;/)[1];
const calls=[];
const context={buildPivotArrivalReferences,pivotArrivalWeek,RAUM_PNL_ARRIVAL_REFERENCE_SQL:referenceSql,sql:{NVarChar:'str',Int:'int'},query:async(statement,params)=>{calls.push({statement,params});return {recordset:[source]};}};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../lib/pivotArrivalLedger.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function')+'\nthis.load=loadPivotArrivalLedger;',context);
await context.load([...Array.from({length:501},(_,i)=>({...target,ProdKey:i+1})),{...target,OrderYear:'2025'}]);
assert.equal(calls.length,3);
assert.deepEqual(calls.map(call=>call.params.yr.value),['2026','2026','2025']);
for(const call of calls){
  assert.match(call.statement,/l.OrderYear=@yr/);assert.match(call.statement,/ISNULL\(l.IsCurrent,0\)=1/);
  assert.match(call.statement,/l.ProdKey IN \(@pk0/);
  assert.doesNotMatch(call.statement,/\b(?:INSERT|UPDATE|DELETE|EXEC)\b/i);
  assert.ok(Object.keys(call.params).length<=502);
}
await assert.rejects(()=>context.load([target],async()=>{throw Error('read failed');}),/read failed/);
