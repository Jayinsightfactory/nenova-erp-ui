import assert from 'node:assert/strict';
import { buildPivotModel, pivotModelToAoA } from '../lib/pivotExeModel.js';
import { pivotIncludedWeeks, pivotIncomingSelections, projectPivotMainWeeks } from '../lib/pivotExeWeekGrouping.js';
import { normalizePivotExeView } from '../lib/pivotExeViewState.js';
import { applyPivotValueSelection, describePivotValueSelection } from '../lib/pivotExeInteraction.js';

const rows = [
  {OrderYear:2026,OrderWeek:'01-01',ProdName:'Rose',ListType:'03. 입고',Quantity:10,DistCost:100},
  {OrderYear:2026,OrderWeek:'01-02',ProdName:'Rose',ListType:'03. 입고',Quantity:30,DistCost:200},
  {OrderYear:2025,OrderWeek:'01-01',ProdName:'Rose',ListType:'03. 입고',Quantity:7,DistCost:50},
  {OrderYear:2026,OrderWeek:'02-01',ProdName:'Rose',ListType:'03. 입고',Quantity:0,DistCost:300},
].map(Object.freeze);
const layout={row:['ProdName'],column:['OrderYear','OrderWeek'],data:['Quantity','DistCost']};
const options={layout,showRowTotals:false,showColumnTotals:false,showGrandTotals:false};
const snapshot=JSON.stringify(rows);
for(const mode of [undefined,false,0,'subweek','invalid']) assert.equal(buildPivotModel(rows,{...options,weekGrouping:mode}).columnAxis.length,4);
const main=buildPivotModel(rows,{...options,weekGrouping:'main'});
assert.equal(main.columnAxis.length,3);
assert.deepEqual(main.cells.map(c=>c.values['Quantity:sum']),[40,7,0]);
assert.equal(main.cells[0].values['DistCost:weightedavg'],175);
assert.ok(JSON.stringify(pivotModelToAoA(main)).includes('01차'));
assert.equal(JSON.stringify(rows),snapshot);
assert.equal(buildPivotModel(rows,{...options,weekGrouping:'main',fieldFilters:{OrderWeek:['01-02']}}).cells[0].values['Quantity:sum'],30);
assert.equal(buildPivotModel(rows,{...options,weekGrouping:'main',fieldFilters:{OrderWeek:[]}}).filteredRowCount,0);
assert.equal(buildPivotModel(rows,{...options,weekGrouping:'main',fieldFilters:{OrderWeek:['old']}}).filteredRowCount,0);
const noYear=buildPivotModel(rows,{...options,layout:{...layout,column:['OrderWeek']},weekGrouping:'main'});
assert.deepEqual(noYear.columnAxis.map(c=>c.path),[['2026 01차'],['2025 01차'],['2026 02차']]);
assert.deepEqual(pivotIncludedWeeks(rows),['2025 01-01','2026 01-01','2026 01-02','2026 02-01']);
assert.equal(projectPivotMainWeeks([{OrderYear:2026,OrderWeek:'34-02B'}],layout,'main')[0].OrderWeek,'34차');
assert.equal(projectPivotMainWeeks([{OrderYear:null,OrderWeek:'01-01'}],layout,'main')[0].OrderWeek,'01-01');
assert.equal(projectPivotMainWeeks([{OrderYear:2026,OrderWeek:'invalid'}],layout,'main')[0].OrderWeek,'invalid');
assert.deepEqual(pivotIncomingSelections({CounName:['콜롬비아'],FlowerName:['장미'],CustArea:['지방'],CustOrderCode:['CL16'],ListType:['02. 주문']}),{CounName:['콜롬비아'],FlowerName:['장미'],ListType:['03. 입고']});
assert.equal(normalizePivotExeView({weekGrouping:'main'}).weekGrouping,'main');
assert.equal(normalizePivotExeView({}).weekGrouping,'subweek');
assert.equal(describePivotValueSelection([],[],true).active,true,'0 options does not disguise an empty filter as all');
assert.equal(describePivotValueSelection(['x'],['old'],true).label,'선택 없음');
assert.deepEqual(applyPivotValueSelection({},'OrderWeek',[],[]),{OrderWeek:[]});
console.log('pivot main week/filter regressions passed');
