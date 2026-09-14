import assert from 'node:assert/strict';
import {
  EXE_DEFAULT_LAYOUT, EXE_FIELDS, assertPivotRenderLimit, buildPivotModel, filterRows, matchesFilterCondition, moveField, normalizeLayout, pivotAxisKey, pivotCellKey, pivotModelToAoA,
} from '../lib/pivotExeModel.js';

const rows = [
  { CounName: '콜롬비아', FlowerName: '수국', ProdName: '화이트', OrderYear: 2025, OrderWeek: '01-01', ListType: '02. 주문', CustName: 'A', Quantity: 1.5, UPrice: 1.25, CustDescr: '' },
  { CounName: '콜롬비아', FlowerName: '수국', ProdName: '화이트', OrderYear: 2026, OrderWeek: '01-01', ListType: '02. 주문', CustName: 'A', Quantity: 2.25, UPrice: 2.5, CustDescr: null },
  { CounName: '콜롬비아', FlowerName: '수국', ProdName: '블루', OrderYear: 2026, OrderWeek: '01-01', ListType: '02. 주문', CustName: 'B', Quantity: 0, UPrice: 0, CustDescr: '=unsafe' },
];

assert.equal(EXE_FIELDS.length, 15, 'all native EXE columns are exposed');
assert.deepEqual(normalizeLayout(EXE_DEFAULT_LAYOUT), EXE_DEFAULT_LAYOUT, 'default layout is stable');
const moved = moveField(EXE_DEFAULT_LAYOUT, 'CustName', 'row', 1);
assert.equal(moved.row[1], 'CustName');
assert.equal(new Set(Object.values(moved).flat()).size, 15, 'a moved field has exactly one zone');

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
