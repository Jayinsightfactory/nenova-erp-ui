import assert from 'node:assert/strict';
import { buildPivotModel } from '../lib/pivotExeModel.js';
import { buildPivotExeStructure } from '../lib/pivotExePresentation.js';
import {
  buildPivotExeColumnPrefix,
  clipPivotExeHeaderCells,
  getPivotExeColumnWindow,
  getPivotExeRowWindow,
  getPivotExeWindowedRowHeaderCells,
  shouldWindowPivotExe,
} from '../lib/pivotExeWindow.js';

assert.equal(shouldWindowPivotExe(100, 50), false, 'exactly 5,000 logical cells keep the native DOM');
assert.equal(shouldWindowPivotExe(100, 51), true, 'more than 5,000 logical cells use a window');

assert.deepEqual(getPivotExeRowWindow({ totalRows: 100, scrollTop: 0, clientHeight: 124, headerHeight: 48, rowHeight: 24 }), { start: 0, end: 10, topHeight: 0, bottomHeight: 2160 }, 'first viewport reserves sticky-header height only from the visible body area and adds six rows of overscan');
assert.deepEqual(getPivotExeRowWindow({ totalRows: 100, scrollTop: 1248, clientHeight: 144, headerHeight: 48, rowHeight: 24 }), { start: 46, end: 62, topHeight: 1104, bottomHeight: 912 }, 'middle viewport uses scroll coordinates beneath the sticky overlay exactly once');
const tallHeaderBottom = getPivotExeRowWindow({ totalRows: 100, scrollTop: 2496, clientHeight: 144, headerHeight: 240, rowHeight: 24 });
assert.deepEqual(tallHeaderBottom, { start: 93, end: 100, topHeight: 2232, bottomHeight: 0 }, 'a ten-row sticky header cannot leave a blank at the actual maximum scroll position');

const widths = [48, 96, 400, 80];
const prefix = buildPivotExeColumnPrefix(widths);
assert.deepEqual(prefix, [0, 48, 144, 544, 624], 'prefix widths retain 48px minimum and 400px wide leaves');
assert.deepEqual(getPivotExeColumnWindow({ widths, prefix, scrollLeft: 0, clientWidth: 280, rowHeaderWidth: 120 }), { start: 0, end: 4, leftWidth: 0, rightWidth: 0 }, 'small viewport retains overscanned leading leaves');
assert.deepEqual(getPivotExeColumnWindow({ widths, prefix, scrollLeft: 180, clientWidth: 280, rowHeaderWidth: 120 }), { start: 0, end: 4, leftWidth: 0, rightWidth: 0 }, 'wide leaf is discoverable from its middle');
assert.deepEqual(getPivotExeColumnWindow({ widths, prefix, scrollLeft: 580, clientWidth: 280, rowHeaderWidth: 120 }), { start: 1, end: 4, leftWidth: 48, rightWidth: 0 }, 'right viewport preserves a left spacer for skipped leaves');

const rowHeaders = [
  [{ label: 'A', rowSpan: 3 }, { label: 'x', rowSpan: 1 }],
  [{ hidden: true }, { label: 'y', rowSpan: 1 }],
  [{ hidden: true }, { label: 'z', rowSpan: 1 }],
  [{ label: 'B', rowSpan: 1 }, { label: 'q', rowSpan: 1 }],
];
const clippedRows = getPivotExeWindowedRowHeaderCells(rowHeaders, 1, 4);
assert.equal(clippedRows[0][0].label, 'A', 'a window beginning inside a rowSpan repeats its origin label');
assert.equal(clippedRows[0][0].rowSpan, 2, 'repeated row header span is clipped at its original boundary');
assert.equal(clippedRows[2][0].label, 'B', 'the following group remains separate');

const headers = [
  { label: '2025', columnStart: 0, columnSpan: 2 },
  { label: '2026', columnStart: 2, columnSpan: 3 },
];
assert.deepEqual(clipPivotExeHeaderCells(headers, 1, 4).map(({ label, columnStart, columnSpan }) => ({ label, columnStart, columnSpan })), [
  { label: '2025', columnStart: 0, columnSpan: 1 },
  { label: '2026', columnStart: 2, columnSpan: 2 },
], 'multi-year header spans are clipped to global numeric leaves');

const model = buildPivotModel([{ CounName: 'A', OrderYear: 2026, Quantity: 1 }], {
  layout: { row: ['CounName'], column: ['OrderYear'], data: ['Quantity'], filter: [] },
  showGrandTotals: false,
  showRowTotals: false,
  showColumnTotals: false,
});
const before = JSON.stringify(model);
buildPivotExeStructure(model);
getPivotExeColumnWindow({ widths: [96] });
assert.equal(JSON.stringify(model), before, 'window calculations leave the full model untouched for Excel and aggregation');

console.log('pivotExeWindow tests passed');
