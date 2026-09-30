import assert from 'node:assert/strict';
import { filterWeekdayCompareRows, normalizeWeekdayCompareRequest, normalizeWeekdayUnit, WEEKDAY_ORDER_OUT_QUANTITY_SQL } from '../lib/weekdayEstimateCompare.js';

const scope = normalizeWeekdayCompareRequest({ year: '2026', custKey: '7', orderWeeks: ['38-02', '38-02'], prodKeys: [101, '101'] });
for (const value of ['박스','BOX','Box',' box ']) assert.equal(normalizeWeekdayUnit(value), '박스');
for (const value of ['단','BUNCH','Bunch']) assert.equal(normalizeWeekdayUnit(value), '단');
for (const value of ['송이','STEAM','STEM']) assert.equal(normalizeWeekdayUnit(value), '송이');
for (const value of ['',null,'kg','unknown']) assert.equal(normalizeWeekdayUnit(value), null);
assert.match(WEEKDAY_ORDER_OUT_QUANTITY_SQL, /N'BOX'\) THEN ISNULL\(od.BoxQuantity,0\)/);
assert.match(WEEKDAY_ORDER_OUT_QUANTITY_SQL, /N'BUNCH'\) THEN ISNULL\(od.BunchQuantity,0\)/);
assert.match(WEEKDAY_ORDER_OUT_QUANTITY_SQL, /ELSE NULL END$/);
assert.deepEqual(scope, { year: 2026, custKey: 7, weeks: ['38-02'], prodKeys: [101] });
assert.throws(() => normalizeWeekdayCompareRequest({ custKey: 7, orderWeeks: ['38-02'], prodKeys: [101] }), /연도/);
assert.throws(() => normalizeWeekdayCompareRequest({ year: 2026, custKey: 0, orderWeeks: ['38-02'], prodKeys: [101] }), /거래처/);
assert.throws(() => normalizeWeekdayCompareRequest({ year: 2026, custKey: 7, orderWeeks: ['38'], prodKeys: [101] }), /세부차수/);
assert.throws(() => normalizeWeekdayCompareRequest({ year: 2026, custKey: 7, orderWeeks: ['38-02'], prodKeys: [0] }), /품목/);

const fixture = [
  { OrderYear: 2026, OrderWeek: '38-02', CustKey: 7, ProdKey: 101, value: 'positive' },
  { OrderYear: 2025, OrderWeek: '38-02', CustKey: 7, ProdKey: 101, value: 'prior-year near-miss' },
  { OrderYear: 2026, OrderWeek: '38-02', CustKey: 8, ProdKey: 101, value: 'other-customer near-miss' },
  { OrderYear: 2026, OrderWeek: '38-01', CustKey: 7, ProdKey: 101, value: 'other-week near-miss' },
  { OrderYear: 2026, OrderWeek: '38-02', CustKey: 7, ProdKey: 102, value: 'other-product near-miss' },
];
assert.deepEqual(filterWeekdayCompareRows(fixture, scope).map((row) => row.value), ['positive']);
console.log('weekdayEstimateCompare tests passed');
