import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStockAdjustmentMatrix } from '../lib/stockAdjustmentMatrix.js';

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
  assert.deepEqual(matrix.weeks.map((w) => w.key), ['2-1', '41-1', '41-2', '41-3', '41-10']);
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
    assert.deepEqual(matrix.weeks.map((w) => w.key), ['41-1']);
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
  assert.deepEqual(empty, { orderYear: '2026', major: '1', search: '', weeks: [{ key: '1-1', label: '1-1' }], rows: [], events: [], availableMajors: ['1', '2'], eventCount: 0, invalidCount: 0 });
  assert.throws(() => buildStockAdjustmentMatrix([], {}), /연도/);
  assert.throws(() => buildStockAdjustmentMatrix([], { orderYear: '2026', major: '54' }), /차수/);
});

test('tiny decimal adjustments and invalid nonfinite differences are not rounded into valid zero', () => {
  const matrix = buildStockAdjustmentMatrix([event({ afterValue: 1e-11 })], { orderYear: 2026 });
  assert.equal(matrix.rows[0].net, 1e-11);
  const invalid = buildStockAdjustmentMatrix([event({ beforeValue: -1e308, afterValue: 1e308 })], { orderYear: 2026 });
  assert.equal(invalid.events[0].delta, null);
  assert.equal(invalid.rows[0].net, null);
  assert.equal(invalid.invalidCount, 1);
});
