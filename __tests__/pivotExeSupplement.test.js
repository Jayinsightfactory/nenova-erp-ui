import assert from 'node:assert/strict';
import { enrichPivotExeRows, sqlPivotExeDistributionCosts, sqlPivotExeCustomerOrderCodes } from '../lib/pivotExeSupplement.js';

const source = [
  { ListType:'04. 출고', OrderYear:'2026', OrderWeek:'37-01', CustKey:7, ProdKey:10, Quantity:2 },
  { ListType:'04. 출고', OrderYear:'2025', OrderWeek:'37-01', CustKey:7, ProdKey:10, Quantity:3 },
  { ListType:'03. 입고', OrderYear:'2026', OrderWeek:'37-01', CustKey:null, ProdKey:10, Quantity:5 },
  { ListType:'02. 주문', OrderYear:'2026', OrderWeek:'37-01', CustKey:7, ProdKey:10, Quantity:2 },
];
const rows = enrichPivotExeRows(source, [
  {OrderYear:'2026',OrderWeek:'37-01',CustKey:7,ProdKey:10,DistCost:12500},
  {OrderYear:'2025',OrderWeek:'37-01',CustKey:7,ProdKey:10,DistCost:9000},
], {10:{arrivalCost:17300}});
assert.equal(rows[0].DistCost,12500);
assert.equal(rows[1].DistCost,9000,'같은 차수 번호라도 연도가 다르면 분배단가를 섞지 않는다');
assert.equal(rows[2].ArrivalCost,17300);
assert.equal(rows[3].DistCost,12500,'분배단가는 같은 업체·품목·차수의 주문 열에서도 표시한다');
assert.equal(enrichPivotExeRows([{...source[2],ListType:'03. 미발주수량'}], [{OrderYear:'2026',OrderWeek:'37-01',CustKey:7,ProdKey:10,DistCost:12500}])[0].DistCost, null, '미발주수량에는 분배단가를 복제하지 않는다');
assert.match(sqlPivotExeDistributionCosts(),/sm\.OrderYear \+ REPLACE\(sm\.OrderWeek,'-',''\).*BETWEEN @weekFrom AND @weekTo/s);
assert.match(sqlPivotExeDistributionCosts(),/SUM\(CONVERT\(float, ISNULL\(sd\.OutQuantity,0\)\) \* CONVERT\(float, ISNULL\(sd\.Cost,0\)\)\)/);
assert.doesNotMatch(sqlPivotExeDistributionCosts(),/\b(?:INSERT|UPDATE|DELETE|EXEC)\b/i);
console.log('pivot EXE supplemental values: year-scoped distribution cost and read-only arrival enrichment passed');

assert.match(sqlPivotExeCustomerOrderCodes(),/^SELECT CustKey, OrderCode FROM Customer WHERE isDeleted=0$/);
const customers = [{CustKey:7,OrderCode:'0017',CustName:'same'}, {CustKey:8,OrderCode:'CL88',CustName:'same'},
  {CustKey:9,OrderCode:''}, {CustKey:10,OrderCode:null}, {CustKey:11,OrderCode:'  007  '},
  {CustKey:0,OrderCode:'invalid'}, {CustKey:true,OrderCode:'invalid'}];
const customerSource = [
  ...source,
  ...['02. 주문','03. 미발주수량','04. 출고'].map(ListType=>({ListType,CustKey:'8',CustName:'same',Quantity:0.125})),
  ...[9,10,11,99,null,0,-1,true,'7x','7.5','7e0','',undefined].map(CustKey=>({ListType:'02. 주문',CustKey,CustName:'same',Quantity:2})),
  ...['01. 전재고','03. 입고','05. 현재고','04. unknown'].map(ListType=>({ListType,CustKey:7,CustName:'same',Quantity:4})),
];
const before=structuredClone(customerSource);
const enriched=enrichPivotExeRows(customerSource,[],{},customers);
assert.deepEqual(enriched.map(({CustOrderCode,DistCost,ArrivalCost,...native})=>native),before);
assert.deepEqual(customerSource,before,'enrichment never mutates native rows');
assert.deepEqual(enriched.slice(0,7).map(r=>r.CustOrderCode),['0017','0017',null,'0017','CL88','CL88','CL88']);
assert.deepEqual(enriched.slice(7,10).map(r=>r.CustOrderCode),['',null,'  007  ']);
assert.ok(enriched.slice(10).every(r=>r.CustOrderCode===null),'invalid/missing customer keys and farm/stock types cannot join by name');
assert.ok(enrichPivotExeRows(customerSource).every(r=>r.CustOrderCode===null),'optional fourth argument preserves existing callers');
for (const OrderCode of ['0','0000','-01','',null]) {
  assert.equal(enrichPivotExeRows([source[0]],[],{},[{CustKey:7,OrderCode}])[0].CustOrderCode,OrderCode);
}
