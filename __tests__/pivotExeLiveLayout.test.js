import assert from 'node:assert/strict';
import { buildPivotModel, filterRows, pivotCellKey } from '../lib/pivotExeModel.js';

const rows = [
  { OrderYear: 2025, OrderWeek: '37-01', CounName: '콜롬비아', CustName: '거래처A', Quantity: 1.25 },
  { OrderYear: 2026, OrderWeek: '37-01', CounName: '콜롬비아', CustName: '거래처A', Quantity: 2.5 },
  { OrderYear: 2026, OrderWeek: '37-02', CounName: '에콰도르', CustName: '거래처B', Quantity: 3.75 },
  { OrderYear: 2026, OrderWeek: '37-01', CounName: '콜롬비아', CustName: '', Quantity: 0 },
];

const layout = (row, column, data = ['Quantity']) => ({ row, column, data, filter: [] });
const valueAt = (model, rowAxis, columnAxis, measure = 'Quantity') =>
  model.cellMap[pivotCellKey(rowAxis.key, columnAxis.key)]?.values?.[measure];
const grandCell = model => valueAt(
  model,
  model.rowAxis.find(axis => axis.isGrandTotal),
  model.columnAxis.find(axis => axis.isGrandTotal),
);

// Swapping the same dimensions between axes changes grouping, not source totals.
const byCountryThenYear = buildPivotModel(rows, {
  layout: layout(['CounName'], ['OrderYear']),
});
assert.deepEqual(byCountryThenYear.rowAxis.filter(axis => !axis.isGrandTotal && !axis.isTotal).map(axis => axis.label), ['콜롬비아', '에콰도르']);
assert.deepEqual(byCountryThenYear.columnAxis.filter(axis => !axis.isGrandTotal && !axis.isTotal).map(axis => axis.label), ['2025', '2026']);
assert.equal(grandCell(byCountryThenYear), 7.5, 'country/year view aggregates the original fractional quantities');

const byYearThenCountry = buildPivotModel(rows, {
  layout: layout(['OrderYear'], ['CounName']),
});
assert.deepEqual(byYearThenCountry.rowAxis.filter(axis => !axis.isGrandTotal && !axis.isTotal).map(axis => axis.label), ['2025', '2026']);
assert.deepEqual(byYearThenCountry.columnAxis.filter(axis => !axis.isGrandTotal && !axis.isTotal).map(axis => axis.label), ['콜롬비아', '에콰도르']);
assert.equal(grandCell(byYearThenCountry), 7.5, 'transposing dimensions preserves the grand sum');
const year2025 = byYearThenCountry.rowAxis.find(axis => axis.path?.[0] === 2025 && !axis.isGrandTotal);
const countryColombia = byYearThenCountry.columnAxis.find(axis => axis.path?.[0] === '콜롬비아' && !axis.isGrandTotal);
assert.equal(valueAt(byYearThenCountry, year2025, countryColombia), 1.25, 'same OrderWeek in 2025 remains isolated');
const year2026 = byYearThenCountry.rowAxis.find(axis => axis.path?.[0] === 2026 && !axis.isGrandTotal);
assert.equal(valueAt(byYearThenCountry, year2026, countryColombia), 2.5, 'same OrderWeek in 2026 remains isolated from 2025');

// Filter-zone fields stay available as predicates and aggregates recalculate from matched rows.
const colombiaRows = filterRows(rows, { fieldFilters: { CounName: ['콜롬비아'] } });
const filtered = buildPivotModel(colombiaRows, {
  layout: layout([], [], ['Quantity', 'CustName']),
  summaryTypes: { Quantity: 'sum', CustName: 'count' },
});
const filteredGrand = filtered.cellMap[pivotCellKey(filtered.rowAxis[0].key, filtered.columnAxis[0].key)];
assert.equal(filtered.filteredRowCount, 3);
assert.equal(filteredGrand.values.Quantity, 3.75, 'filter recalculates the sum from the three matched fixture rows');
assert.equal(filteredGrand.values['CustName:count'], 2, 'text measure count ignores the empty fixture value');

// Empty row/column axes still produce one usable grand-total cell, including an actual zero sum.
const emptyAxes = buildPivotModel([{ Quantity: 0 }], {
  layout: layout([], [], ['Quantity']),
  showGrandTotals: true,
  showRowTotals: false,
  showColumnTotals: false,
});
assert.equal(emptyAxes.rowAxis.length, 1);
assert.equal(emptyAxes.columnAxis.length, 1);
assert.equal(grandCell(emptyAxes), 0, 'empty axes preserve an explicit numeric zero');

console.log('pivotExeLiveLayout tests passed');
