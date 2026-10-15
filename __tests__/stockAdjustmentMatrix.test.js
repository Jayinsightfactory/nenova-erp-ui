import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStockAdjustmentMatrix, buildStockAdjustmentFlowerTotals } from '../lib/stockAdjustmentMatrix.js';

const event = (overrides = {}) => ({
  historyKey: 'h1', orderYear: 2026, orderWeek: '41-01', prodKey: 1,
  productName: '장미', displayName: '장미 표시명', country: '중국', flower: 'Rose', unit: '단',
  beforeValue: 0, afterValue: 1.1255, changeType: '재고조정', reason: '=2+2', changedBy: '작업자',
  ...overrides,
});

test('year, product identity and units isolate the matrix; numeric weeks canonicalize', () => {
  const source = [
    event(), event({ historyKey: 'h2', orderWeek: '41-1', beforeValue: 3, afterValue: 1.8745 }),
    event({ historyKey: 'prior-year', orderYear: 2025, afterValue: 900 }),
    event({ historyKey: 'h3', prodKey: 2 }),
    event({ historyKey: 'h4', unit: '박스' }),
    event({ historyKey: 'h5', orderWeek: '41-10', afterValue: -0.123456789 }),
    event({ historyKey: 'h6', orderWeek: '41-2', afterValue: 0 }),
  ];
  const matrix = buildStockAdjustmentMatrix(source, { orderYear: 2026 }, ['41-03', '41-01', '02-01']);
  assert.equal(matrix.orderYear, '2026');
  assert.deepEqual(matrix.weeks.map((w) => w.key), [...Array.from({ length: 41 }, (_, i) => [String(i + 1) + '-1', String(i + 1) + '-2']).flat(), '41-3', '41-10']);
  assert.deepEqual(matrix.availableMajors, ['2', '41']);
  assert.equal(matrix.rows.length, 3);
  assert.equal(matrix.eventCount, 6);
  const row = matrix.rows.find((r) => r.prodKey === '1' && r.unit === '단');
  assert.deepEqual(row.cells['41-1'], { quantity: 0, eventCount: 2, invalidCount: 0 });
  assert.equal(row.cells['41-2'].quantity, 0);
  assert.equal(row.cells['41-3'], undefined);
  assert.equal(row.net, -0.123456789);
  assert.equal(matrix.net, undefined, 'no mixed-unit grand total');
  assert.equal(source[0].orderWeek, '41-01', 'input is not mutated');
});

test('missing and malformed source values remain visible and invalidate totals', () => {
  const matrix = buildStockAdjustmentMatrix([
    event(), event({ historyKey: 'bad', beforeValue: null }),
    event({ historyKey: 'space', orderWeek: '41-2', beforeValue: ' ' }),
    event({ historyKey: 'boolean', orderWeek: '41-3', beforeValue: false }),
    event({ historyKey: 'text', orderWeek: '41-4', beforeValue: '1,000' }),
    event({ historyKey: 'major', orderWeek: '41' }),
    event({ historyKey: 'malformed', orderWeek: '41-bad', afterValue: 'oops' }),
    event({ historyKey: 'missing', orderWeek: null, afterValue: 0 }),
  ], { orderYear: '2026' });
  assert.equal(matrix.invalidCount, 5);
  assert.equal(matrix.rows[0].net, null);
  assert.deepEqual(matrix.rows[0].cells['41-1'], { quantity: null, eventCount: 2, invalidCount: 1 });
  assert.ok(matrix.weeks.find((w) => w.key === 'major:41').label.includes('세부차수 미지정'));
  assert.ok(matrix.weeks.find((w) => w.key === 'invalid:41-bad').label.includes('확인 필요'));
  assert.ok(matrix.weeks.find((w) => w.key === 'invalid:'));
  const raw = matrix.events.find((e) => e.historyKey === 'malformed');
  assert.equal(raw.afterValue, 'oops');
  assert.equal(raw.delta, null);
  assert.equal(raw.changedBy, '작업자');
  assert.equal(raw.rawOrderWeek, '41-bad');
});

test('major and metadata search filter events while retaining all selected-year major choices', () => {
  const source = [event(), event({ orderWeek: '42-1', prodKey: 98 }), event({ orderYear: 2025, orderWeek: '43-1' })];
  for (const search of ['장미', '표시명', '중국', 'rose', '1']) {
    const matrix = buildStockAdjustmentMatrix(source, { orderYear: '2026', major: '41', search }, ['40-1']);
    assert.equal(matrix.eventCount, 1);
    assert.deepEqual(matrix.availableMajors, ['40', '41', '42']);
    assert.equal(matrix.major, '41');
    assert.deepEqual(matrix.weeks.map((w) => w.key), ['41-1', '41-2']);
  }
  assert.equal(buildStockAdjustmentMatrix(source, { orderYear: '2026', search: '없는품목' }).rows.length, 0);
});

test('missing product identities remain separate; empty result keeps catalog metadata', () => {
  const matrix = buildStockAdjustmentMatrix([
    event({ historyKey: 'a', prodKey: null }), event({ historyKey: 'b', prodKey: '' }),
    event({ historyKey: null, prodKey: null }), event({ historyKey: null, prodKey: null }),
  ], { orderYear: 2026 });
  assert.equal(new Set(matrix.rows.map((r) => r.key)).size, 4);
  const empty = buildStockAdjustmentMatrix([], { orderYear: 2026, major: '01' }, ['1-01', '2-1']);
  assert.deepEqual(empty, { orderYear: '2026', major: '1', search: '', weeks: [{ key: '1-1', label: '1-1' }, { key: '1-2', label: '1-2' }], rows: [], flowerTotals: [], events: [], availableMajors: ['1', '2'], eventCount: 0, invalidCount: 0 });
  assert.throws(() => buildStockAdjustmentMatrix([], {}), /연도/);
  assert.throws(() => buildStockAdjustmentMatrix([], { orderYear: '2026', major: '54' }), /차수/);
});

test('flower totals separate units, preserve signed precision, cancellation and absent weeks', () => {
  const matrix = buildStockAdjustmentMatrix([
    event({ prodKey: 1, afterValue: 2.125 }),
    event({ prodKey: 2, orderWeek: '41-2', afterValue: -2.125 }),
    event({ prodKey: 3, unit: '박스', afterValue: 0.0001 }),
    event({ prodKey: 4, flower: '장미', afterValue: -1e-20 }),
  ], { orderYear: 2026, major: '41' }, ['41-3']);
  const rose = matrix.flowerTotals.find((total) => total.flower === 'Rose' && total.unit === '단');
  assert.equal(rose.productCount, 2);
  assert.equal(rose.eventCount, 2);
  assert.equal(rose.invalidCount, 0);
  assert.equal(rose.cells['41-1'].quantity, 2.125);
  assert.equal(rose.cells['41-2'].quantity, -2.125);
  assert.equal(rose.cells['41-3'], undefined);
  assert.equal(rose.net, 0);
  assert.equal(matrix.flowerTotals.find((total) => total.unit === '박스').net, 0.0001);
  assert.equal(matrix.flowerTotals.find((total) => total.flower === '장미').net, -1e-20);
  assert.deepEqual(buildStockAdjustmentFlowerTotals(matrix.rows), matrix.flowerTotals);
});

test('hydrangea exclusion follows flower metadata first and missing metadata falls back to both names', () => {
  const matrix = buildStockAdjustmentMatrix([
    event({ prodKey: 1, flower: '수국', productName: '별명', displayName: '별명' }),
    event({ prodKey: 2, flower: 'HYDRANGEA', productName: '별명', displayName: '별명' }),
    event({ prodKey: 3, flower: '장미', productName: '수국색 장미', displayName: 'Hydrangea rose' }),
    event({ prodKey: 4, flower: null, productName: '수국 원명', displayName: '다른 표시명' }),
    event({ prodKey: 5, flower: '', productName: '원명', displayName: 'hydrangea 표시명' }),
    event({ prodKey: 6, flower: '품종 미확인', productName: '장미 원명', displayName: '장미 표시명' }),
  ], { orderYear: 2026, major: '41' });
  assert.equal(matrix.rows.length, 6, 'product table still includes hydrangea');
  assert.equal(matrix.flowerTotals.reduce((sum, total) => sum + total.productCount, 0), 2);
  assert.equal(matrix.flowerTotals.find((total) => total.flower === '장미').eventCount, 1);
  assert.equal(matrix.rows.find((row) => row.prodKey === '4').originalProductName, '수국 원명');
});

test('flower totals propagate invalid quantities without converting absence into zero', () => {
  const matrix = buildStockAdjustmentMatrix([
    event({ prodKey: 1, afterValue: 2 }),
    event({ prodKey: 2, beforeValue: null }),
    event({ prodKey: 3, orderWeek: '41-2', afterValue: 0 }),
  ], { orderYear: 2026, major: '41' }, ['41-3']);
  const total = matrix.flowerTotals[0];
  assert.equal(total.net, null);
  assert.equal(total.invalidCount, 1);
  assert.deepEqual(total.cells['41-1'], { quantity: null, eventCount: 2, invalidCount: 1 });
  assert.equal(total.cells['41-2'].quantity, 0);
  assert.equal(total.cells['41-3'], undefined);
});

test('unknown units remain separate per product and summary respects the selected scope', () => {
  const source = [event({ prodKey: 1, unit: null }), event({ prodKey: 2, unit: '단위 미확인' }), event({ prodKey: 3, unit: null, orderWeek: '42-1' })];
  const matrix = buildStockAdjustmentMatrix(source, { orderYear: 2026, major: '41' });
  assert.equal(matrix.flowerTotals.length, 2);
  assert.equal(new Set(matrix.flowerTotals.map((total) => total.key)).size, 2);
  for (const total of matrix.flowerTotals) {
    assert.match(total.unit, /단위 미확인 · 품목 [12]/);
    assert.equal(total.productCount, 1);
    assert.equal(total.net, 1.1255);
  }
  const filtered = buildStockAdjustmentMatrix(source, { orderYear: 2026, major: '41', search: '1' });
  assert.equal(filtered.flowerTotals.length, 1);
  assert.equal(filtered.flowerTotals[0].eventCount, 1);
});

test('tiny decimal adjustments and invalid nonfinite differences are not rounded into valid zero', () => {
  const matrix = buildStockAdjustmentMatrix([event({ afterValue: 1e-11 })], { orderYear: 2026 });
  assert.equal(matrix.rows[0].net, 1e-11);
  const invalid = buildStockAdjustmentMatrix([event({ beforeValue: -1e308, afterValue: 1e308 })], { orderYear: 2026 });
  assert.equal(invalid.events[0].delta, null);
  assert.equal(invalid.rows[0].net, null);
  assert.equal(invalid.invalidCount, 1);
});

test('annual columns run from 1 through source maximum independent of search without fabricated events', () => {
 const source = [event({orderWeek:'41-3'}), event({prodKey:2,orderWeek:'42-1'}), event({orderYear:2025,orderWeek:'53-2'})];
 const matrix = buildStockAdjustmentMatrix(source,{orderYear:2026,search:'1'});
 assert.equal(matrix.weeks[0].key,'1-1');
 assert.equal(matrix.weeks.at(-1).key,'42-2');
 assert.equal(matrix.weeks.length,85);
 assert.equal(matrix.eventCount,1);
 assert.equal(matrix.rows[0].cells['1-1'],undefined);
 assert.equal(matrix.rows[0].cells['41-3'].quantity,1.1255);
 assert.equal(matrix.rows[0].net,1.1255);
});
