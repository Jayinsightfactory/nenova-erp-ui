import assert from 'node:assert/strict';
import { EXE_DEFAULT_LAYOUT, EXE_FIELDS } from '../lib/pivotExeModel.js';
import { normalizePivotExeView, parsePivotExeFavoriteView } from '../lib/pivotExeViewState.js';
import { getPivotExeDataColumnId, getPivotExeDataWidth } from '../lib/pivotExePresentation.js';

const defaults = normalizePivotExeView();
assert.equal(defaults.schemaVersion, 1);
assert.deepEqual(defaults.zones.rows, EXE_DEFAULT_LAYOUT.row);
assert.equal(defaults.decimals, 2);
assert.equal(defaults.filterActive, true);
assert.deepEqual(defaults.ast, { kind: 'group', op: 'AND', children: [] });

const precise = normalizePivotExeView({
  zones: { rows: [], cols: [], filters: ['CustName'], values: [{ id: 'OrderYear', aggregation: 'sum' }] },
  decimals: 0, previousNonzeroDecimals: 1, zeroVisible: false, rowHeight: 0,
  filterActive: false, selections: { CustName: [0, false, ''] },
  ast: { kind: 'condition', field: 'Quantity', operator: '>=', value: 0 },
  showRowTotals: false, showColumnTotals: false, showGrandTotals: false,
});
assert.deepEqual(precise.zones.rows, []);
assert.deepEqual(precise.zones.cols, []);
assert.equal(precise.zones.values[0].id, 'OrderYear');
assert.equal(precise.zones.values[0].aggregation, 'count');
assert.equal(precise.decimals, 0);
assert.equal(precise.zeroVisible, false);
assert.equal(precise.filterActive, false);
assert.deepEqual(precise.selections.CustName, [0, false, '']);
assert.equal(precise.ast.value, 0);
assert.equal(precise.showGrandTotals, false);
assert.equal(precise.rowHeight, 18);
assert.equal(normalizePivotExeView({custHeaderHeight:500}).custHeaderHeight,120);
assert.equal(normalizePivotExeView({custHeaderHeight:0}).custHeaderHeight,18);

const numericFallback = normalizePivotExeView({
  zones: { rows: [], cols: [], filters: [], values: [{ id: 'Quantity', aggregation: 'not-valid' }] },
});
assert.deepEqual(numericFallback.zones.values, [{ id: 'Quantity', aggregation: 'sum' }]);

const stale = normalizePivotExeView({
  zones: { rows: ['NotAField'], cols: [], filters: [], values: [] },
  hidden: ['NotAField', 'CustName'], sorts: { NotAField: 'asc', CustName: 'desc' },
  selections: { NotAField: ['old'], CustName: ['kept'] }, widths: { NotAField: 99, CustName: 999, __data: 1 },
});
assert.equal(stale.hidden.includes('NotAField'), false);
assert.equal(stale.zones.rows.includes('NotAField'), false);
assert.equal(stale.zones.filters.includes('CustName'), false);
assert.deepEqual(stale.sorts, { CustName: 'desc' });
assert.deepEqual(stale.selections, { CustName: ['kept'] });
assert.deepEqual(stale.widths, { CustName: 400, __data: 48 });

const privateColumn = { key: JSON.stringify(['column', [['string', '2026'], ['string', 'AWB-SECRET-123']]]) };
const dynamicWidthKey = getPivotExeDataColumnId(privateColumn, {key:'Quantity:sum'});
const dynamicWidths = normalizePivotExeView({ widths: { [dynamicWidthKey]: 250, [`${JSON.stringify(['row', []])}-Quantity:sum`]: 251, 'unknown:sum': 252 } });
assert.deepEqual(dynamicWidths.widths, { [dynamicWidthKey]: 250 });
assert.equal(JSON.stringify(dynamicWidths).includes('AWB-SECRET-123'), false);
assert.equal(getPivotExeDataWidth(privateColumn, {key:'Quantity:sum'}, dynamicWidths.widths),250);
assert.notEqual(dynamicWidthKey,getPivotExeDataColumnId({key:privateColumn.key.replace('2026','2025')},{key:'Quantity:sum'}));
assert.deepEqual(normalizePivotExeView({widths:{[`${privateColumn.key}-Quantity:sum`]:250}}).widths,{});
const tooManyWidths = Object.fromEntries(Array.from({ length: 10001 }, (_, index) => {
  const axisKey = JSON.stringify(['column', [['string', String(index)]]]);
  return [getPivotExeDataColumnId({key:axisKey},{key:'Quantity:sum'}), 100];
}));
assert.equal(Object.keys(normalizePivotExeView({ widths: tooManyWidths }).widths).length, 10000);

assert.throws(() => normalizePivotExeView({ ast: { kind: 'condition', field: 'Unknown', operator: '=' } }), /FAVORITE/);
assert.throws(() => normalizePivotExeView({ ast: { kind: 'group', op: 'AND', children: 'not-array' } }), /FAVORITE/);
assert.throws(() => parsePivotExeFavoriteView(null), /FAVORITE/);
assert.throws(() => parsePivotExeFavoriteView('0'), /FAVORITE/);

const unique = normalizePivotExeView({
  zones: { rows: ['CustName', 'CustName'], cols: ['CustName'], filters: [], values: [{ id: 'Quantity', aggregation: 'avg' }, { id: 'Quantity', aggregation: 'sum' }] },
  hidden: ['CustName'],
});
const placed = [...unique.zones.rows, ...unique.zones.cols, ...unique.zones.filters, ...unique.zones.values.map((value) => value.id)];
assert.equal(new Set(placed).size, placed.length);
assert.equal(placed.includes('CustName'), false);
assert.equal(placed.length, EXE_FIELDS.length - 1);

const noData = normalizePivotExeView({
  rows: [{ CustName: 'ERP customer', Quantity: 99 }], range: { fromYear: 2025, toYear: 2026 },
  response: { rows: ['server row'] }, serverResponse: true, fromYear: 2025, toWeek: '52-1',
  widths: { 'ERP customer-99': 250, CustName: 100 },
});
const persisted = JSON.stringify(noData);
assert.equal(persisted.includes('ERP customer'), false);
assert.equal(persisted.includes('fromYear'), false);
assert.equal(persisted.includes('toWeek'), false);
assert.deepEqual(noData.widths, { CustName: 100 });

console.log('pivotExeViewState: defaults, false/zero values, stale fields, AST guard, cross-year exclusion, uniqueness, and no ERP data persistence passed');
