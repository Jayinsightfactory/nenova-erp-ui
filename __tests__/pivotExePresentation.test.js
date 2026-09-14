import assert from 'node:assert/strict';
import { buildPivotModel, EXE_FIELDS, pivotAxisKey } from '../lib/pivotExeModel.js';
import {
  buildPivotExePresentation,
  buildPivotExeRowHeaderCells,
  formatPivotExeNumber,
  getPivotExeDataColumnId,
  getPivotExeGroupKeys,
  getPivotExeDataWidth,
} from '../lib/pivotExePresentation.js';

const layout = {
  row: ['CounName', 'FlowerName', 'ProdName'], column: ['OrderYear', 'OrderWeek'], data: ['Quantity'],
  filter: EXE_FIELDS.map((field) => field.id).filter((id) => !['CounName', 'FlowerName', 'ProdName', 'OrderYear', 'OrderWeek', 'Quantity'].includes(id)),
};
const model = buildPivotModel([
  { CounName: '콜롬비아', FlowerName: '장미', ProdName: 'Red', OrderYear: 2026, OrderWeek: '36-01', Quantity: 1.25 },
  { CounName: '콜롬비아', FlowerName: '장미', ProdName: 'Pink', OrderYear: 2026, OrderWeek: '36-01', Quantity: 2.5 },
  { CounName: '콜롬비아', FlowerName: '수국', ProdName: 'Blue', OrderYear: 2026, OrderWeek: '36-01', Quantity: 3 },
], { layout, showGrandTotals: false, showColumnTotals: false });
const dataId = getPivotExeDataColumnId(model.columnAxis[0], model.measures[0]);
const presentation = buildPivotExePresentation(model, { widths: { __data: 111, [dataId]: 137 }, rowHeight: 28 });

assert.equal(presentation.rowWidths[0].width, 90, 'country keeps its native default width');
assert.equal(presentation.rowWidths[2].width, 220, 'product keeps its native default width');
assert.equal(presentation.dataColumns[0].width, 137, 'individual data column width beats __data');
assert.equal(presentation.rowHeight, 28, 'row height is normalized once for all consumers');
assert.equal(presentation.headerRows.length, 3, 'axis paths generate one merged header row per column field plus measure');
assert.equal(presentation.headerRows[0][0].columnSpan, 1, 'top-level header owns its visible leaf span');
assert.equal(presentation.headerRows[0][0].label, '2026', 'compact headers do not repeat their field label');
assert.equal(presentation.headerRows[0][0].title, '주문년도: 2026', 'the full field/value text remains accessible');
assert.equal(presentation.headerRows[1][0].label, '36-01');

const firstCountry = presentation.rowHeaderCells[0][0];
assert.equal(firstCountry.label, '콜롬비아');
assert.equal(firstCountry.rowSpan, 2, 'country labels merge only the contiguous same-country detail rows');
const subtotalIndex = model.rowAxis.findIndex((axis) => axis.isTotal && axis.depth === 1 && axis.path[1] === '장미');
assert.ok(subtotalIndex >= 0, 'fixture contains a flower subtotal boundary');
assert.equal(presentation.rowHeaderCells[subtotalIndex][0].rowSpan, 1, 'subtotal rows break country merges');
assert.equal(presentation.rowHeaderCells[subtotalIndex][1].rowSpan, 1, 'subtotal rows break flower merges');
assert.equal(buildPivotExeRowHeaderCells(model.rowAxis, layout.row)[subtotalIndex][1].label, '장미 합계');
assert.equal(formatPivotExeNumber(0, 2, false), '', 'zero hiding remains presentation-only');
assert.equal(formatPivotExeNumber(1.25, 2, true), '1.25', 'formatting does not change the raw number');

const multiYear = buildPivotModel([
  { CounName: 'A', FlowerName: '장미', ProdName: 'R', OrderYear: 2025, OrderWeek: '36-01', Quantity: 1 },
  { CounName: 'A', FlowerName: '장미', ProdName: 'R', OrderYear: 2026, OrderWeek: '36-01', Quantity: 1 },
  { CounName: 'A', FlowerName: '장미', ProdName: 'R', OrderYear: 2026, OrderWeek: '37-01', Quantity: 1 },
], { layout, showGrandTotals: false, showRowTotals: false, showColumnTotals: false });
const multiYearPresentation = buildPivotExePresentation(multiYear);
const year2026 = multiYearPresentation.headerRows[0].find((cell) => cell.label === '2026');
assert.equal(year2026.columnSpan, 2, 'one year groups only its own visible weeks');
assert.equal(year2026.axisKey, pivotAxisKey('column', [2026]), 'a group click receives its real prefix axis key');
assert.equal(multiYearPresentation.headerRows[0].filter((cell) => cell.label === '2025').length, 1, 'same week labels never merge across years');
assert.equal(getPivotExeDataWidth(multiYear.columnAxis[0], multiYear.measures[0], { __data: null }), 96, 'stale null numeric width falls back to the native default');
assert.equal(getPivotExeDataWidth(multiYear.columnAxis[0], multiYear.measures[0], { __data: 0 }), 48, 'zero numeric width is clamped to a usable minimum');
assert.equal(getPivotExeDataWidth(multiYear.columnAxis[0], multiYear.measures[0], { __data: 10000 }), 640, 'stale oversized width is bounded');
const withoutTotals = buildPivotModel(model.rows, {layout,showRowTotals:false,showColumnTotals:false,showGrandTotals:false});
const collapsedWithoutTotals = buildPivotModel(model.rows, {layout,showRowTotals:false,showColumnTotals:false,showGrandTotals:false,collapsedRows:getPivotExeGroupKeys(withoutTotals,'row'),collapsedColumns:getPivotExeGroupKeys(withoutTotals,'column')});
assert.ok(collapsedWithoutTotals.rowAxis.length < withoutTotals.rowAxis.length, 'groups collapse even without subtotal rows');
assert.ok(getPivotExeGroupKeys(withoutTotals,'column').size > 0, 'column group controls do not depend on subtotal columns');
console.log('pivotExePresentation tests passed');
