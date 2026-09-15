import assert from 'node:assert/strict';
import { enrichPivotExeRows, sqlPivotExeDistributionCosts } from '../lib/pivotExeSupplement.js';

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
assert.equal(rows[3].DistCost,null,'분배단가는 출고 행에만 붙여 수량가중 집계를 중복시키지 않는다');
assert.match(sqlPivotExeDistributionCosts(),/sm\.OrderYear \+ REPLACE\(sm\.OrderWeek,'-',''\).*BETWEEN @weekFrom AND @weekTo/s);
assert.match(sqlPivotExeDistributionCosts(),/SUM\(CONVERT\(float, ISNULL\(sd\.OutQuantity,0\)\) \* CONVERT\(float, ISNULL\(sd\.Cost,0\)\)\)/);
assert.doesNotMatch(sqlPivotExeDistributionCosts(),/\b(?:INSERT|UPDATE|DELETE|EXEC)\b/i);
console.log('pivot EXE supplemental values: year-scoped distribution cost and read-only arrival enrichment passed');
