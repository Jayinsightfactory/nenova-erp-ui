import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPivotModel, pivotAxisKey, pivotCellKey } from '../lib/pivotExeModel.js';
import { ORDER_HISTORY_FIELDS, ORDER_HISTORY_DEFAULT_LAYOUT } from '../lib/orderHistoryPivotFields.js';

// (a) source contract
const panel = readFileSync(new URL('../components/OrderHistoryPivotPanel.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../pages/warehouse.js', import.meta.url), 'utf8');
assert.match(panel, /ORDER_HISTORY_FIELDS/);
assert.match(panel, /ORDER_HISTORY_DEFAULT_LAYOUT/);
assert.match(panel, /fieldAreas=\{fieldAreas\}/);
for (const zone of ['filters', 'rows', 'cols', 'values']) assert.ok(panel.includes(`${zone}:zoneArea('${zone}'`), zone);
assert.match(panel, /onDoubleClick=\{openDrillDown\}/);
assert.match(panel, /closest\?\.\('td\[data-pivot-row-index\]'\)/);
assert.match(panel, /data-pivot-column-index/);
assert.match(panel, /orderHistoryPivotLayout:v1:/);
assert.match(panel, /≡ 발주 목록/);
assert.match(panel, /발주 목록_\$\{successScope\.week\}\.xlsx/);
for (const src of [panel, page]) {
  assert.doesNotMatch(src, /components\/Layout|from '\.\.?\/?Layout'|<Layout[\s>]/);
}
assert.match(page, /warehousePivotMode/);
assert.match(page, /전산 발주 목록/);
assert.match(page, /기존 웹 피벗/);
assert.match(page, /function LegacyWarehousePivot\(/);
assert.match(page, /<OrderHistoryPivotPanel \/>/);

// (b) aggregation + drill-down (CO 아래 꽃이 Rose 하나뿐이라 DevExpress 규칙상 국가 소계는 숨김 → 국가·꽃 소계로 검증)
const base = { FlowerName: 'Rose', OrderWeek: '44-01', OutUnit: '박스', ChangeType: 'I', ColumName: 'OutQuantity', ChangeUser: 'kim' };
const rows = [
  { ...base, CounName: 'CO', ProdName: 'Red', OrderCode: 'A1', CustName: 'X', ChangeDtm: '2026-11-01', AfterValue: 3 },
  { ...base, CounName: 'CO', ProdName: 'Red', OrderCode: 'A1', CustName: 'Y', ChangeDtm: '2026-11-01', AfterValue: 2.5 },
  { ...base, CounName: 'CO', ProdName: 'Pink', OrderCode: 'A2', CustName: 'X', ChangeDtm: '2026-11-02', AfterValue: -1 },
  { ...base, CounName: 'EC', ProdName: 'White', OrderCode: 'B1', CustName: 'Z', ChangeDtm: '2026-11-01', AfterValue: 10 },
  { ...base, CounName: 'EC', ProdName: 'White', OrderCode: 'B1', CustName: 'Z', ChangeDtm: '2026-11-02', AfterValue: 4 },
  { ...base, CounName: 'CO', ProdName: 'Red', OrderCode: 'A1', CustName: 'X', ChangeDtm: '2026-11-02', AfterValue: 1.25 },
];
const model = buildPivotModel(rows, { fields: ORDER_HISTORY_FIELDS, defaultLayout: ORDER_HISTORY_DEFAULT_LAYOUT });
assert.deepEqual(model.layout.row, ['CounName', 'FlowerName', 'ProdName', 'OrderCode']);
assert.deepEqual(model.layout.column, ['ChangeDtm']);
assert.deepEqual(model.layout.data, ['AfterValue']);
const rowAxis = model.rowAxis.find(a => a.isTotal && a.path.length === 2 && a.path[0] === 'CO' && a.path[1] === 'Rose');
const colAxis = model.columnAxis.find(a => a.path.length === 1 && a.path[0] === '2026-11-01');
assert.ok(rowAxis && colAxis);
const cell = model.cellMap[pivotCellKey(rowAxis.key, colAxis.key)];
assert.equal(cell.values['AfterValue:sum'], 5.5);
const grand = model.cellMap[pivotCellKey(model.rowAxis.find(a => a.isGrandTotal).key, model.columnAxis.find(a => a.isGrandTotal).key)];
assert.equal(grand.values['AfterValue:sum'], 19.75);
// same path-matching logic as orderHistoryDrillRows in the panel
const match = (row, fields, path) => !path.length || pivotAxisKey('p', fields.slice(0, path.length).map(f => row[f])) === pivotAxisKey('p', path);
const drill = (r, c) => model.rows.filter(row => match(row, model.layout.row, r.path) && match(row, model.layout.column, c.path));
assert.equal(drill(rowAxis, colAxis).length, 2);
assert.equal(drill(rowAxis, model.columnAxis.find(a => a.isGrandTotal)).length, 4);
const ecDay2 = model.rowAxis.find(a => !a.isTotal && a.path[0] === 'EC');
assert.equal(drill(ecDay2, model.columnAxis.find(a => a.path[0] === '2026-11-02')).length, 1);
assert.ok(panel.includes("pivotAxisKey('p', fields.slice(0, path.length).map((field) => row?.[field])) === pivotAxisKey('p', path)"));
console.log('orderHistoryPivotPanel: ok');
