import assert from 'node:assert/strict';
import { pivotLinkedValues, applyLinkedPivotSelection } from '../lib/pivotLinkedFilters.js';
const rows = [
 {OrderYear:2026,OrderWeek:'01-01',CounName:'콜롬비아',FlowerName:'장미',ProdName:'Rose',CustName:'A',ListType:'주문',Quantity:0},
 {OrderYear:2026,OrderWeek:'01-02',CounName:'중국',FlowerName:'장미',ProdName:'China Rose',CustName:'B',ListType:'입고',Quantity:2},
 {OrderYear:2026,OrderWeek:'01-02',CounName:'네덜란드',FlowerName:'튤립',ProdName:'Tulip',CustName:'C',ListType:'입고',Quantity:3},
 {OrderYear:2025,OrderWeek:'01-01',CounName:'콜롬비아',FlowerName:'수국',ProdName:'Old',CustName:null,ListType:'입고',Quantity:1},
];
const get=(field,fieldFilters={},extra={})=>pivotLinkedValues(rows,field,{fieldFilters,...extra},String);
assert.deepEqual(get('FlowerName',{CounName:['콜롬비아'],OrderYear:[2026]}),['장미']);
assert.deepEqual(get('CounName',{FlowerName:['장미']}),['콜롬비아','중국']);
assert.deepEqual(get('FlowerName',{FlowerName:['튤립']}),['장미','튤립','수국'],'self selection does not lock alternatives');
assert.deepEqual(get('OrderWeek',{CustName:['A'],OrderYear:[2026]}),['01-01']);
assert.deepEqual(get('CustName',{ListType:['입고'],OrderYear:[2026]}),['B','C']);
assert.deepEqual(get('ProdName',{Quantity:[0]}),['Rose'],'zero is not missing');
assert.deepEqual(get('Quantity',{CustName:['A']}),['0']);
assert.deepEqual(get('CustName',{OrderYear:[2025]}),['null']);
assert.deepEqual(get('FlowerName',{CounName:[]}),[]);
assert.deepEqual(get('FlowerName',{CounName:['missing']}),[]);
assert.equal(get('FlowerName',{CounName:[]},{filterEnabled:false}).length,3);
assert.deepEqual(get('CustName',{}, {filterTree:{op:'OR',children:[{field:'Quantity',operator:'=',value:0},{field:'OrderYear',operator:'=',value:2025}]}}),['A','null']);
assert.deepEqual(get('ProdName',{}, {filterTree:{kind:'not',child:{kind:'condition',field:'OrderYear',operator:'=',value:2026}}}),['Old']);
assert.deepEqual(applyLinkedPivotSelection({},'FlowerName',['장미'],['장미','튤립']),{FlowerName:['장미']});
assert.deepEqual(applyLinkedPivotSelection({},'FlowerName',['장미','튤립'],['장미','튤립']),{});
assert.deepEqual(applyLinkedPivotSelection({},'FlowerName',[],['장미']),{FlowerName:[]});
assert.deepEqual(applyLinkedPivotSelection({},'FlowerName',['stale'],['장미']),{FlowerName:['stale']});
console.log('linked pivot facets: bidirectional, year/week/customer/type/zero/null, AST, disabled, stale and contextual select-all passed');
