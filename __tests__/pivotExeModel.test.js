import assert from 'node:assert/strict';
import { createPivotValueOrderComparator } from '../lib/pivotExeValueOrder.js';
import './pivotExeValueOrder.test.js';
import {
  EXE_DEFAULT_LAYOUT, EXE_FIELDS, assertPivotRenderLimit, buildPivotModel, filterRows, matchesFilterCondition, moveField, normalizeLayout, pivotAxisKey, pivotCellKey, pivotModelToAoA,
} from '../lib/pivotExeModel.js';

// Custom ranks use the filter list's ascending natural fallback on both axes.
for (const zone of ['row', 'column']) {
  const values = ['값10', '우선', '값2', '값1'];
  const source = values.map(CustName => ({ CustName, Quantity: 1 }));
  const options = { layout: { row: [], column: [], [zone]: ['CustName'], data: ['Quantity'] }, showGrandTotals: false };
  const axis = zone === 'row' ? 'rowAxis' : 'columnAxis';
  const paths = model => model[axis].map(item => item.path[0]);
  const order = ['우선'];
  const custom = buildPivotModel(source, { ...options, valueOrders: { CustName: order } });
  assert.deepEqual(paths(custom), ['우선', '값1', '값2', '값10']);
  assert.deepEqual(paths(custom), [...values].sort(createPivotValueOrderComparator(order, 'asc')));
  assert.deepEqual(paths(buildPivotModel(source, { ...options, valueOrders: { CustName: order }, sort: { CustName: 'desc' } })), ['우선', '값10', '값2', '값1']);
  assert.deepEqual(paths(buildPivotModel(source, options)), values, 'no custom order preserves encounter order');
  assert.deepEqual(paths(buildPivotModel(source, { ...options, valueOrders: { CustName: [] } })), values);
}

const rows = [
  { CounName: '콜롬비아', FlowerName: '수국', ProdName: '화이트', OrderYear: 2025, OrderWeek: '01-01', ListType: '02. 주문', CustName: 'A', Quantity: 1.5, UPrice: 1.25, CustDescr: '' },
  { CounName: '콜롬비아', FlowerName: '수국', ProdName: '화이트', OrderYear: 2026, OrderWeek: '01-01', ListType: '02. 주문', CustName: 'A', Quantity: 2.25, UPrice: 2.5, CustDescr: null },
  { CounName: '콜롬비아', FlowerName: '수국', ProdName: '블루', OrderYear: 2026, OrderWeek: '01-01', ListType: '02. 주문', CustName: 'B', Quantity: 0, UPrice: 0, CustDescr: '=unsafe' },
];

assert.equal(EXE_FIELDS.length, 18, 'native columns, web prices and customer master order code are exposed');
assert.deepEqual(normalizeLayout(EXE_DEFAULT_LAYOUT), EXE_DEFAULT_LAYOUT, 'default layout is stable');
const codeRows = [
  {CustOrderCode:'0017',OrderYear:2025,OrderWeek:'37-01',Quantity:1.25},
  {CustOrderCode:'0017',OrderYear:2026,OrderWeek:'37-01',Quantity:2.5},
  {CustOrderCode:'CL88',OrderYear:2026,OrderWeek:'37-01',Quantity:4},
  {CustOrderCode:'',OrderYear:2026,OrderWeek:'37-01',Quantity:0},
  {CustOrderCode:null,OrderYear:2026,OrderWeek:'37-01',Quantity:-1},
];

{
  const source = [];
  for (const CounName of ['A', 'B', 'C']) for (const ProdName of ['p1', 'p2'])
    for (const OrderYear of [2025, 2026]) for (const OrderWeek of ['37-01', '38-01'])
      source.push(Object.freeze({ CounName, ProdName, OrderYear, OrderWeek, Quantity: source.length + 1 }));
  Object.freeze(source);
  const snapshot = JSON.stringify(source);
  const options = { layout: { row: ['CounName', 'ProdName'], column: ['OrderYear', 'OrderWeek'], data: ['Quantity'] } };
  const baseline = buildPivotModel(source, options);
  const custom = buildPivotModel(source, { ...options, valueOrders: { CounName: ['B'], ProdName: ['p2'], OrderYear: [2026], OrderWeek: ['38-01'] }, sort: { CounName: 'desc', ProdName: 'asc', OrderYear: 'asc' } });
  assert.deepEqual(custom.rowAxis.filter(a => !a.isTotal).map(a => a.path), [['B','p2'],['B','p1'],['C','p2'],['C','p1'],['A','p2'],['A','p1']]);
  assert.deepEqual(custom.columnAxis.filter(a => !a.isTotal).map(a => a.path), [[2026,'38-01'],[2026,'37-01'],[2025,'38-01'],[2025,'37-01']]);
  assert.equal(new Set(custom.columnAxis.map(a => a.key)).size, custom.columnAxis.length);
  assert.deepEqual(custom.cellMap, baseline.cellMap, 'reordering cannot alter any aggregate or cross-year identity');
  assert.equal(JSON.stringify(source), snapshot);
  assert.deepEqual(buildPivotModel(source, { ...options, valueOrders: { CounName: [] } }).rowAxis, baseline.rowAxis);
  const typed = [null, '', 0, false, '00', '0'];
  const typedModel = buildPivotModel(typed.map(CustName => ({ CustName, Quantity: 1 })), { layout: { row: ['CustName'], column: [], data: ['Quantity'] }, valueOrders: { CustName: [...typed].reverse() }, showGrandTotals: false });
  assert.deepEqual(typedModel.rowAxis.map(a => a.path[0]), [...typed].reverse());
}
assert.equal(EXE_FIELDS.find(f=>f.id==='CustOrderCode').label,'거래처 주문코드');
assert.equal(EXE_DEFAULT_LAYOUT.filter[EXE_DEFAULT_LAYOUT.filter.indexOf('CustArea')+1],'CustOrderCode');
for (const zone of ['row','column','filter','data']) {
  const next=moveField(EXE_DEFAULT_LAYOUT,'CustOrderCode',zone,0);
  assert.equal(next[zone][0],'CustOrderCode');
  assert.equal(Object.values(next).flat().filter(id=>id==='CustOrderCode').length,1);
}
for (const zone of ['row','column']) {
  const codeModel=buildPivotModel(codeRows,{layout:{row:zone==='row'?['CustOrderCode']:['OrderYear'],column:zone==='column'?['CustOrderCode']:['OrderYear'],data:['Quantity']},fieldFilters:{CustOrderCode:['0017']},showGrandTotals:false});
  assert.equal(codeModel.filteredRowCount,2);
  assert.deepEqual(codeModel.cells.map(c=>c.value),[1.25,2.5],'same week remains separated across years');
  assert.ok(JSON.stringify(pivotModelToAoA(codeModel)).includes('0017'));
}
assert.equal(filterRows(codeRows,{fieldFilters:{CustOrderCode:['']}}).length,1);
assert.equal(filterRows(codeRows,{fieldFilters:{CustOrderCode:[null]}}).length,1);
const codeCount=buildPivotModel(codeRows,{layout:{row:[],column:[],data:['CustOrderCode']},showGrandTotals:true});
assert.equal(codeCount.measures[0].summary,'count');
assert.equal(codeCount.cellMap[pivotCellKey(codeCount.rowAxis.find(a=>a.isGrandTotal).key,codeCount.columnAxis.find(a=>a.isGrandTotal).key)].value,3,'code count includes populated source rows, excludes null and empty, and does not count distinct codes');
const moved = moveField(EXE_DEFAULT_LAYOUT, 'CustName', 'row', 1);
assert.equal(moved.row[1], 'CustName');
assert.equal(new Set(Object.values(moved).flat()).size, 18, 'a moved field has exactly one zone');

assert.equal(filterRows(rows, { fieldFilters: { OrderYear: [2026] } }).length, 2, 'numeric field filters retain the selected year only');
assert.equal(filterRows(rows, { fieldFilters: { OrderYear: [] } }).length, 0, 'an explicit empty checkbox selection means no values');
assert.equal(filterRows(rows, { filterTree: { operator: 'AND', children: [
  { field: 'ProdName', operator: 'contains', value: '화' },
  { operator: 'NOT', children: [{ field: 'Quantity', operator: 'lt', value: 2 }] },
] } }).length, 1, 'recursive AND/NOT filters work without expression evaluation');
assert.equal(filterRows(rows, { filterTree: { field: 'CustDescr', operator: 'isNull' } }).length, 1, 'null remains distinct from empty text');
assert.equal(filterRows(rows, { filterTree: { field: 'CustDescr', operator: 'eq', value: '' } }).length, 1, 'empty text remains distinct from null');
assert.equal(filterRows(rows, { filterTree: { kind: 'not', child: { kind: 'condition', field: 'Quantity', operator: 'between', value: 1, value2: 2 } } }).length, 2, 'UI kind:not and value/value2 between AST shape is accepted');
const predicateRow = { ProdName: 'Hydrangea White', Quantity: 2.5, CustDescr: null };
for (const [operator, value, expected] of [
  ['eq', 2.5, true], ['neq', 2, true], ['contains', 'white', true], ['notContains', 'rose', true],
  ['startsWith', 'hydra', true], ['endsWith', 'white', true], ['in', ['x', 'Hydrangea White'], true],
  ['notIn', ['rose'], true], ['gt', 2, true], ['gte', 2.5, true], ['lt', 3, true], ['lte', 2.5, true],
  ['between', [2, 3], true], ['isNull', undefined, true], ['isNotNull', undefined, false],
]) {
  const field = ['isNull', 'isNotNull'].includes(operator) ? 'CustDescr' : (typeof value === 'string' || Array.isArray(value) && typeof value[0] === 'string' ? 'ProdName' : 'Quantity');
  assert.equal(matchesFilterCondition(predicateRow, { field, operator, value }), expected, `${operator} is a supported safe predicate`);
}

const layout = { row: ['ProdName'], column: ['OrderYear'], filter: EXE_FIELDS.map(field => field.id).filter(id => !['ProdName', 'OrderYear', 'Quantity'].includes(id)), data: ['Quantity'] };
const model = buildPivotModel(rows, { layout, summaryTypes: { Quantity: ['sum', 'avg'] }, showRowTotals: true, showColumnTotals: true, showGrandTotals: true });
assert.equal(model.filteredRowCount, 3);
assert.ok(model.rowAxis.some(axis => axis.isGrandTotal));
assert.ok(model.columnAxis.some(axis => axis.label === '2025'), 'cross-year values remain separate columns');
const grandRow = model.rowAxis.find(axis => axis.isGrandTotal);
const grandColumn = model.columnAxis.find(axis => axis.isGrandTotal);
assert.equal(model.cellMap[pivotCellKey(grandRow.key, grandColumn.key)].values['Quantity:sum'], 3.75, 'grand total comes from original fractional rows');
assert.equal(model.cellMap[pivotCellKey(grandRow.key, grandColumn.key)].values['Quantity:avg'], 1.25, 'average is not an average of subtotals');
const priceLayout = { row:['ProdName'], column:[], filter:EXE_FIELDS.map(field=>field.id).filter(id=>!['ProdName','DistCost'].includes(id)), data:['DistCost'] };
const weightedPrice = buildPivotModel([
  {ProdName:'A',DistCost:100,Quantity:1},{ProdName:'A',DistCost:200,Quantity:3},
], {layout:priceLayout,showGrandTotals:true,showRowTotals:false,showColumnTotals:false});
assert.equal(weightedPrice.measures[0].summary,'weightedavg');
assert.equal(weightedPrice.cellMap[pivotCellKey(weightedPrice.rowAxis.find(axis=>axis.isGrandTotal).key,weightedPrice.columnAxis.find(axis=>axis.isGrandTotal).key)].value,175,'분배단가는 출고수량 가중평균으로 집계한다');
assert.ok(pivotModelToAoA(model).some(row => row.includes(0)), 'an actual zero remains numeric in the visible AOA');
assert.ok(model.aoa[0].some(header => header.includes('주문년도: 2025')), 'AOA headers retain the complete column hierarchy');
const sparseModel = buildPivotModel([{ProdName:'A',OrderYear:2025,Quantity:1},{ProdName:'B',OrderYear:2026,Quantity:1}], { layout, showGrandTotals:false, showRowTotals:false, showColumnTotals:false });
assert.ok(sparseModel.cells.length < sparseModel.visibleCoordinateCount, 'empty matrix intersections stay sparse in the model');
const textMeasureLayout = { row: ['ProdName'], column: [], filter: EXE_FIELDS.map(field => field.id).filter(id => !['ProdName', 'CustName'].includes(id)), data: ['CustName'] };
const textMeasure = buildPivotModel(rows, { layout: textMeasureLayout, showRowTotals: false, showColumnTotals: false, showGrandTotals: true });
assert.equal(textMeasure.measures[0].summary, 'count', 'a text field moved to data uses count');
assert.equal(textMeasure.cellMap[pivotCellKey(textMeasure.rowAxis.find(axis => axis.isGrandTotal).key, textMeasure.columnAxis.find(axis => axis.isGrandTotal).key)].value, 3);
const nestedLayout = { ...layout, row: ['CounName', 'ProdName'], filter: layout.filter.filter(id => id !== 'CounName') };
const collapsed = buildPivotModel(rows, { layout: nestedLayout, collapsedRows: [pivotAxisKey('row', ['콜롬비아'])], showGrandTotals: false });
assert.ok(collapsed.rowAxis.some(axis => axis.collapsed && axis.label === '콜롬비아'), 'collapsed groups retain an aggregate visible row');
const separatorRows = [
  { CounName: 'a|b', FlowerName: 'c', OrderYear: 2026, Quantity: 1 },
  { CounName: 'a', FlowerName: 'b|string:c', OrderYear: 2026, Quantity: 1 },
];
const separatorModel = buildPivotModel(separatorRows, { layout: { row:['CounName','FlowerName'], column:['OrderYear'], filter:EXE_FIELDS.map(field=>field.id).filter(id=>!['CounName','FlowerName','OrderYear','Quantity'].includes(id)), data:['Quantity'] }, showGrandTotals:false, showRowTotals:false, showColumnTotals:false });
assert.equal(new Set(separatorModel.rowAxis.map(axis => axis.key)).size, separatorModel.rowAxis.length, 'separator-bearing native values cannot collide in axis keys');
assert.throws(() => assertPivotRenderLimit({ visibleCellCount: 250001 }), error => error.code === 'PIVOT_RENDER_CELL_LIMIT', 'large non-virtualized matrices fail explicitly, never by truncation');
const highCardinality = buildPivotModel(Array.from({ length: 5000 }, (_, index) => ({
  ProdName: `품목 ${index}`, CustName: `거래처 ${index}`, Quantity: 1,
})), { layout: { row: ['ProdName'], column: ['CustName'], data: ['Quantity'], filter: [] },
  showGrandTotals: false, showRowTotals: false, showColumnTotals: false });
assert.equal(highCardinality.visibleCoordinateCount, 25000000);
assert.equal(highCardinality.populatedCellCount, 5000, 'high-cardinality source remains sparse before rendering');
assert.throws(() => assertPivotRenderLimit(highCardinality), error => error.code === 'PIVOT_RENDER_CELL_LIMIT');
console.log('pivotExeModel tests passed');
