import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeWeekPivotProductSearch,
  filterWeekPivotProductKeys,
  isWeekPivotRowInSelectedScope,
  getWeekPivotCustomerHighlightProdKeys,
} from '../lib/weekPivotReadability.js';

const page = fs.readFileSync(new URL('../pages/shipment/week-pivot.js', import.meta.url), 'utf8');

// Product search is deliberately independent from the customer/quantity aggregate.
assert.equal(normalizeWeekPivotProductSearch('  Rose   White  '), 'rosewhite');
assert.equal(normalizeWeekPivotProductSearch(null), '');
assert.deepEqual(
  filterWeekPivotProductKeys([11, 12, 13], {
    11: { ProdName: '  White Rose ', DisplayName: 'WR-01' },
    12: { ProdName: 'Tulip', DisplayName: '  Premium White  ' },
    13: { ProdName: 'Carnation', DisplayName: 'Red' },
  }, '  WHITE '),
  [11, 12],
  '품명 검색은 ProdName·DisplayName을 trim/case-normalize하고 품목키 순서는 보존해야 한다',
);
assert.deepEqual(filterWeekPivotProductKeys([11, 12], {}, ''), [11, 12], '빈 검색은 전체 품목을 유지해야 한다');
assert.deepEqual(filterWeekPivotProductKeys([11, 12], { 11: null, 12: {} }, 'x'), [], '상품명 데이터가 없으면 고객명 등으로 추정하지 않아야 한다');
const productKeys = Object.freeze([12, 11, 13]);
const productMap = Object.freeze({
  11: Object.freeze({ name: 'Hydrangea White', displayName: '수국 화이트' }),
  12: Object.freeze({ name: 'ROSE Pink Mondial 50cm', displayName: '장미 핑크몬디알 50cm' }),
  13: Object.freeze({ name: 'Tulip', displayName: '', CustName: '화이트업체' }),
});
assert.deepEqual(filterWeekPivotProductKeys(productKeys, productMap, ' 수국화이트 '), [11]);
assert.deepEqual(filterWeekPivotProductKeys(productKeys, productMap, ' pink MONDIAL '), [12]);
assert.deepEqual(filterWeekPivotProductKeys(productKeys, productMap, '화이트업체'), []);
assert.deepEqual(filterWeekPivotProductKeys(productKeys, productMap, null), [12, 11, 13]);
assert.notEqual(filterWeekPivotProductKeys(productKeys, productMap, ''), productKeys);

const scope = { selectedYear: 2026, weekFrom: '24-01', weekTo: '24-03' };
assert.equal(isWeekPivotRowInSelectedScope({ OrderYear: 2026, OrderWeek: '24-01' }, scope), true);
assert.equal(isWeekPivotRowInSelectedScope({ OrderYear: 2026, OrderWeek: '24-03' }, scope), true);
assert.equal(isWeekPivotRowInSelectedScope({ OrderYear: 2026, OrderWeek: '24-04' }, scope), false);
assert.equal(isWeekPivotRowInSelectedScope({ OrderYear: 2025, OrderWeek: '24-01' }, scope), false, '동일 차수라도 연도가 다르면 제외해야 한다');
assert.equal(isWeekPivotRowInSelectedScope({ OrderWeek: '24-02' }, scope), true, '연도 없는 레거시 행은 선택 연도로 fallback해야 한다');
assert.equal(isWeekPivotRowInSelectedScope({ OrderYear: 2026, OrderWeek: '24-01' }, { ...scope, weekFrom: '24-03', weekTo: '24-01' }), false);
assert.equal(isWeekPivotRowInSelectedScope({ OrderWeek: '2025-24-01' }, scope), false);
assert.equal(isWeekPivotRowInSelectedScope({ OrderWeek: '2026-24-02' }, scope), true);
assert.equal(isWeekPivotRowInSelectedScope({ OrderYear: 2026, OrderWeek: '2025-24-01' }, scope), false);
assert.equal(isWeekPivotRowInSelectedScope({ OrderWeek: '24-1' }, { selectedYear: '2026', weekFrom: '2026-24-01', weekTo: '2026-24-03' }), true);
assert.equal(isWeekPivotRowInSelectedScope(null, scope), false);
assert.equal(isWeekPivotRowInSelectedScope({ OrderWeek: '' }, scope), false);

const rows = [
  { OrderYear: 2026, OrderWeek: '24-01', CustKey: 7, ProdKey: 101, custOrderQty: 3, outQty: 0 },
  { OrderYear: 2026, OrderWeek: '24-02', CustKey: 7, ProdKey: 102, custOrderQty: 0, outQty: 4 },
  { OrderYear: 2026, OrderWeek: '24-02', CustKey: 7, ProdKey: 103, custOrderQty: 0, outQty: 0, outDescr: '취소' },
  { OrderYear: 2026, OrderWeek: '24-02', CustKey: 8, ProdKey: 104, custOrderQty: 9, outQty: 9 },
  { OrderYear: 2025, OrderWeek: '24-01', CustKey: 7, ProdKey: 105, custOrderQty: 99, outQty: 99 },
  { OrderYear: 2026, OrderWeek: '24-04', CustKey: 7, ProdKey: 106, custOrderQty: 9, outQty: 9 },
  { OrderYear: 2026, OrderWeek: '24-01', CustKey: 7, ProdKey: 107, custOrderQty: 'not-numeric', outQty: 'bad' },
  { OrderYear: 2026, OrderWeek: '24-01', CustKey: 7, ProdKey: 108, custOrderQty: -5, outQty: 0 },
];
const originalRows = structuredClone(rows);
assert.deepEqual(
  [...getWeekPivotCustomerHighlightProdKeys(rows, { custKey: 7, ...scope })].sort((a, b) => a - b),
  [101, 102],
  '선택 범위 내 선택 업체의 주문 또는 분배 양수 품목만 강조하고 0행/취소 비고는 제외해야 한다',
);
assert.deepEqual(rows, originalRows, '강조 계산은 원시 행을 변경하지 않아야 한다');
assert.deepEqual(
  [...getWeekPivotCustomerHighlightProdKeys(rows, { custKey: 7, selectedYear: 2025, weekFrom: '24-01', weekTo: '24-03' })],
  [105],
  '2025·2026 동일 차수는 서로 섞이지 않아야 한다',
);
assert.deepEqual(
  [...getWeekPivotCustomerHighlightProdKeys(rows, { custKey: 8, ...scope })],
  [104],
  '강조 대상은 selected CustKey로 제한해야 한다',
);
assert.deepEqual([...getWeekPivotCustomerHighlightProdKeys(rows, { custKey: null, ...scope })], []);
assert.deepEqual([...getWeekPivotCustomerHighlightProdKeys([{ OrderWeek: '24-01', CustKey: '7', ProdKey: '109', custOrderQty: '0', outQty: '0.001' }], { custKey: '7', ...scope })], [109]);

// Integration guards: filtering must only affect visible rows; export input remains prodKeys.
assert.match(page, /visibleProdKeys/);
assert.match(page, /data-pivot-prod-key/);
assert.match(page, /data-pivot-customer-key/);
assert.match(page, /data-customer-highlighted/);
const exportSource = page.slice(page.indexOf('const downloadPivotExcel'), page.indexOf('{/* 필터 영역'));
assert.match(exportSource, /prodKeys/);
assert.doesNotMatch(exportSource, /visibleProdKeys|productSearch|highlightedCustKey/);
assert.match(page, /visibleProdKeys\.map/);
assert.match(page, /\[highlightedCustKey,\s*setHighlightedCustKey\]\s*=\s*useState\(null\)/);
assert.match(page, /\[productSearch,\s*setProductSearch\]\s*=\s*useState\(''\)/);
assert.match(page, /aria-label=[^>]*품목 강조/);
assert.match(page, /className="pv-notes-scroll"/);
assert.match(page, /className="pv-note-item"/);
assert.match(page, /pv-notes-scroll[^}]*overflow-x:\s*auto|overflow-x:\s*auto[^}]*pv-notes-scroll/);
assert.match(page, /white-space:\s*nowrap/);

console.log('week-pivot readability behavior and integration guards passed');
