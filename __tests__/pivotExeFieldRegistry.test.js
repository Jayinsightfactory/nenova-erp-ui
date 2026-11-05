import assert from 'node:assert/strict';
import { EXE_FIELDS, buildPivotModel, pivotModelToAoA, serializePivotFields, normalizeLayout } from '../lib/pivotExeModel.js';
import { ORDER_HISTORY_FIELDS, ORDER_HISTORY_DEFAULT_LAYOUT } from '../lib/orderHistoryPivotFields.js';
import { normalizePivotExeView } from '../lib/pivotExeViewState.js';
import { buildPivotExePresentation, formatPivotExeNumber } from '../lib/pivotExePresentation.js';
import { calculatePivotResult } from '../lib/pivotExeCalculation.js';

const strip = (m) => JSON.parse(JSON.stringify({ ...m, aoa: undefined }));

// (a) default == explicit EXE
const exeRows = [
  { CounName: 'CO', FlowerName: 'Rose', ProdName: 'Red', OrderYear: 2026, OrderWeek: '23-01', ListType: '02. 주문', CustName: 'A', Quantity: 3 },
  { CounName: 'CO', FlowerName: 'Rose', ProdName: 'Red', OrderYear: 2026, OrderWeek: '23-01', ListType: '02. 주문', CustName: 'B', Quantity: 4 },
];
const m1 = buildPivotModel(exeRows);
const m2 = buildPivotModel(exeRows, { fields: EXE_FIELDS });
assert.deepEqual(strip(m1), strip(m2));
assert.deepEqual(m1.aoa, m2.aoa);

// (b) order history registry
const rows = [
  { CounName: 'CO', FlowerName: 'Rose', ProdName: 'Red', OrderCode: 'N1', ChangeDtm: '2026-06-01', AfterValue: 5, OrderWeek: '23-01', CustName: 'A', OutUnit: '박스' },
  { CounName: 'CO', FlowerName: 'Rose', ProdName: 'Red', OrderCode: 'N1', ChangeDtm: '2026-06-02', AfterValue: 7, OrderWeek: '23-01', CustName: 'A', OutUnit: '박스' },
  { CounName: 'EC', FlowerName: 'Mix', ProdName: 'Blue', OrderCode: 'N2', ChangeDtm: '2026-06-01', AfterValue: 2, OrderWeek: '23-02', CustName: 'B', OutUnit: '단' },
];
const model = buildPivotModel(rows, { fields: ORDER_HISTORY_FIELDS, defaultLayout: ORDER_HISTORY_DEFAULT_LAYOUT });
assert.deepEqual(model.layout, { row: [...ORDER_HISTORY_DEFAULT_LAYOUT.row], column: ['ChangeDtm'], filter: ['OrderWeek', 'CustName', 'OutUnit'], data: ['AfterValue'] });
assert.equal(model.fields.length, 9);
const aoa = pivotModelToAoA(model);
assert.deepEqual(aoa[0].slice(0, 4), ['국가', '품목명(색상)'.length ? '꽃' : '', '품목명(색상)', 'C.N.']);
assert.ok(aoa[0].some((h) => h.startsWith('입력일자: 2026-06-01')));
const grand = model.cells.find((c) => model.rowAxis.find((r) => r.key === c.rowKey)?.isGrandTotal && model.columnAxis.find((k) => k.key === c.columnKey)?.isGrandTotal);
assert.equal(grand.value, 14);
const pres = buildPivotExePresentation(model);
assert.equal(pres.rowWidths[3].label, 'C.N.');
assert.equal(pres.headerRows[0][0].title.startsWith('입력일자'), true);
assert.equal(buildPivotModel(rows, { fields: ORDER_HISTORY_FIELDS }).layout.filter.length, 9);
assert.deepEqual(normalizeLayout(undefined, ORDER_HISTORY_FIELDS).row, []);
// unknown EXE field is ignored in this registry
assert.equal(buildPivotModel(rows, { fields: ORDER_HISTORY_FIELDS, fieldFilters: { Quantity: ['x'] } }).filteredRowCount, 3);

// decimals
assert.equal(formatPivotExeNumber(1.5, 2, true, { id: 'X', decimals: 0 }), '2');
assert.equal(formatPivotExeNumber(1.5, 2, true, 'D', [{ id: 'D', decimals: 1 }]), '1.5');

// (c) view normalization
const view = normalizePivotExeView({ zones: { rows: ['CounName', 'Quantity'], cols: [], filters: [], values: [{ id: 'AfterValue' }] }, hidden: ['Quantity'], sorts: { Quantity: 'asc', CounName: 'desc' } },
  { fields: ORDER_HISTORY_FIELDS, defaultLayout: ORDER_HISTORY_DEFAULT_LAYOUT });
assert.deepEqual(view.zones.rows, ['CounName']);
assert.deepEqual(view.sorts, { CounName: 'desc' });
assert.deepEqual(view.zones.values, [{ id: 'AfterValue', aggregation: 'sum' }]);
const dflt = normalizePivotExeView({}, { fields: ORDER_HISTORY_FIELDS, defaultLayout: ORDER_HISTORY_DEFAULT_LAYOUT });
assert.deepEqual(dflt.zones.rows, ORDER_HISTORY_DEFAULT_LAYOUT.row);
assert.deepEqual(dflt.zones.cols, ['ChangeDtm']);
assert.deepEqual(normalizePivotExeView({}, { fields: ORDER_HISTORY_FIELDS }).zones.rows, []);
assert.deepEqual(normalizePivotExeView({}).zones.rows, ['CounName', 'FlowerName', 'ProdName']);

// (d) worker path serialization
const fields = serializePivotFields(ORDER_HISTORY_FIELDS);
const result = calculatePivotResult(rows, { fields, defaultLayout: ORDER_HISTORY_DEFAULT_LAYOUT });
const cloned = structuredClone({ rows, options: { fields, defaultLayout: ORDER_HISTORY_DEFAULT_LAYOUT } });
const result2 = calculatePivotResult(cloned.rows, cloned.options);
assert.deepEqual(structuredClone(result.model).fields, fields);
assert.deepEqual(result2.model.cells, result.model.cells);
console.log('pivotExeFieldRegistry tests passed');
