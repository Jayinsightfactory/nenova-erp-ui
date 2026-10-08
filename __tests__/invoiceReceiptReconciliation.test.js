import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileInvoiceReceipt } from '../lib/invoiceReceiptReconciliation.js';

const row = (patch = {}) => ({
  orderYear: 2026,
  orderWeek: '41-01',
  prodKey: 101,
  unit: '단',
  quantity: 10,
  ...patch,
});

test('normalizes the selected week and excludes valid rows from another year or week', () => {
  const result = reconcileInvoiceReceipt({
    orderYear: '2026',
    orderWeek: '41-1',
    orders: [row({ quantity: 20 }), row({ orderYear: 2025, quantity: 900 }), row({ orderWeek: '42-01', quantity: 800 })],
    receipts: [row({ warehouseKey: 1, quantity: 5 }), row({ orderYear: 2025, warehouseKey: 2, quantity: 700 })],
    draft: [row({ quantity: 4 })],
  });

  assert.equal(result.orderWeek, '41-01');
  assert.deepEqual(result.rows.map(({ orderedQty, existingQty, draftQty, afterQty, difference, status }) => (
    { orderedQty, existingQty, draftQty, afterQty, difference, status }
  )), [{ orderedQty: 20, existingQty: 5, draftQty: 4, afterQty: 9, difference: -11, status: 'SHORTAGE' }]);
});

test('pads both the main week and subweek to two digits', () => {
  const result = reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '1-1',
    orders: [row({ orderWeek: '01-01', quantity: 1 })],
    receipts: [],
    draft: [],
  });

  assert.equal(result.orderWeek, '01-01');
  assert.equal(result.rows[0].orderWeek, '01-01');
});

test('aggregates duplicate split receipts and draft rows at six-decimal precision', () => {
  const result = reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ quantity: '0.3' })],
    receipts: [row({ warehouseKey: 1001, quantity: 0.1 }), row({ warehouseKey: 1002, quantity: '0.2' })],
    draft: [row({ quantity: '0.1000004' }), row({ quantity: 0.2000004 })],
  });

  assert.deepEqual(result.rows[0], {
    orderYear: 2026,
    orderWeek: '41-01',
    prodKey: 101,
    unit: '단',
    orderedQty: 0.3,
    existingQty: 0.3,
    replacedQty: 0,
    draftQty: 0.3,
    afterQty: 0.6,
    difference: 0.3,
    status: 'SURPLUS',
    comparable: true,
    sameProductUnitConflict: false,
  });
});

test('editing removes every target receipt row before applying the replacement draft', () => {
  const result = reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ quantity: 12 }), row({ prodKey: 202, unit: '송이', quantity: 4 })],
    receipts: [
      row({ warehouseKey: 7001, quantity: 3 }),
      row({ warehouseKey: 7001, quantity: 2 }),
      row({ warehouseKey: 7002, quantity: 5 }),
      row({ warehouseKey: 7001, prodKey: 202, unit: '송이', quantity: 4 }),
    ],
    draft: [row({ quantity: 7 })],
    editingWarehouseKey: 7001,
  });

  assert.equal(result.editingWarehouseKey, '7001');
  assert.deepEqual(result.rows.map((item) => [
    item.prodKey, item.existingQty, item.replacedQty, item.draftQty, item.afterQty, item.difference,
  ]), [
    [101, 10, 5, 7, 12, 0],
    [202, 4, 4, 0, 0, -4],
  ]);
  assert.equal(result.rows[1].status, 'SHORTAGE', 'no-draft target rows remain as explicit replacement cancellations');
});

test('includes order-only and receipt/draft-only identities and groups totals by unit', () => {
  const result = reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ prodKey: 1, unit: '박스', quantity: 2 })],
    receipts: [row({ prodKey: 2, unit: '단', quantity: 3, warehouseKey: 9 })],
    draft: [row({ prodKey: 3, unit: '송이', quantity: 4 })],
  });

  assert.deepEqual(result.rows.map((item) => [item.prodKey, item.afterQty, item.difference, item.status]), [
    [1, 0, -2, 'SHORTAGE'],
    [2, 3, 3, 'SURPLUS'],
    [3, 4, 4, 'SURPLUS'],
  ]);
  assert.deepEqual(Object.keys(result.totalsByUnit), ['박스', '단', '송이']);
  assert.equal(result.totalsByUnit.박스.orderedQty, 2);
  assert.equal(result.totalsByUnit.단.existingQty, 3);
  assert.equal(result.totalsByUnit.송이.draftQty, 4);
});

test('keeps mixed units separate and flags every row for that product', () => {
  const result = reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ prodKey: 7, unit: '박스', quantity: 1 }), row({ prodKey: 7, unit: '단', quantity: 10 })],
    receipts: [row({ prodKey: 7, unit: '박스', quantity: 1, warehouseKey: 8 })],
    draft: [row({ prodKey: 7, unit: '송이', quantity: 100 })],
  });

  assert.deepEqual(result.rows.map((item) => [item.unit, item.afterQty, item.status, item.comparable, item.sameProductUnitConflict]), [
    ['박스', 1, 'UNIT_CONFLICT', false, true],
    ['단', 0, 'UNIT_CONFLICT', false, true],
    ['송이', 100, 'UNIT_CONFLICT', false, true],
  ]);
  for (const total of Object.values(result.totalsByUnit)) {
    assert.equal(total.status, 'UNIT_CONFLICT');
    assert.equal(total.comparable, false);
    assert.equal(total.sameProductUnitConflict, true);
    assert.deepEqual(total.unitConflictProductKeys, [7]);
  }
});

test('requires collections, accepts explicit zero, and rejects invalid selected data', () => {
  assert.throws(() => reconcileInvoiceReceipt({ orderYear: 2026, orderWeek: '41-01', orders: [], draft: [] }), /receipts collection is required/);
  assert.doesNotThrow(() => reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ quantity: 0 })],
    receipts: [],
    draft: [],
  }));

  assert.equal(reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ quantity: '1e3' })],
    receipts: [],
    draft: [],
  }).rows[0].orderedQty, 1000, 'finite scientific notation is a valid numeric string');

  for (const quantity of [null, '', ' ', true, false, NaN, Infinity, -1, '0x10', '1_000', '1;DROP TABLE', {}, []]) {
    assert.throws(() => reconcileInvoiceReceipt({
      orderYear: 2026,
      orderWeek: '41-01',
      orders: [row({ quantity })],
      receipts: [],
      draft: [],
    }), /quantity/);
  }
  assert.throws(() => reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ prodKey: 0 })],
    receipts: [],
    draft: [],
  }), /positive integer/);
  assert.throws(() => reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ unit: '묶음' })],
    receipts: [],
    draft: [],
  }), /one of 박스, 단, 송이/);

  for (const warehouseKey of [0, -1, NaN, Infinity, 'A', '1.5', '', true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => reconcileInvoiceReceipt({
      orderYear: 2026,
      orderWeek: '41-01',
      orders: [],
      receipts: [row({ warehouseKey })],
      draft: [],
    }), /warehouseKey must be a positive integer/);
  }
});

test('rejects malformed scope rows instead of silently treating them as foreign or zero', () => {
  const valid = { orderYear: 2026, orderWeek: '41-01', orders: [], receipts: [], draft: [] };
  for (const orderYear of [26, '26', null, '20260']) {
    assert.throws(() => reconcileInvoiceReceipt({ ...valid, orderYear }), /four-digit year/);
  }
  for (const orderWeek of ['0-01', '54-01', '41-00', '41-100', 'week-1', null]) {
    assert.throws(() => reconcileInvoiceReceipt({ ...valid, orderWeek }), /orderWeek/);
  }
  assert.throws(() => reconcileInvoiceReceipt({
    ...valid,
    orders: [row({ orderYear: 2025, orderWeek: 'bad', quantity: 999 })],
  }), /orders\[0\]\.orderWeek/);
  assert.throws(() => reconcileInvoiceReceipt({
    ...valid,
    draft: [{ prodKey: 1, unit: '단', quantity: 1 }],
  }), /draft\[0\]\.orderYear/);
  assert.throws(() => reconcileInvoiceReceipt({
    ...valid,
    draft: [row({ orderYear: 2025, quantity: 1 })],
  }), /draft\[0\] must match the selected year\/week scope/);
  assert.throws(() => reconcileInvoiceReceipt({
    ...valid,
    draft: [row({ orderWeek: '42-01', quantity: 1 })],
  }), /draft\[0\] must match the selected year\/week scope/);
});

test('editing target must exist in selected scope', () => {
  assert.throws(() => reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [],
    receipts: [row({ orderYear: 2025, warehouseKey: 8001 })],
    draft: [],
    editingWarehouseKey: 8001,
  }), /not found in the selected year\/week scope/);
});

test('guards individual and aggregate six-decimal overflow', () => {
  const tooLarge = (Number.MAX_SAFE_INTEGER / 1_000_000) + 1;
  assert.throws(() => reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ quantity: tooLarge })],
    receipts: [],
    draft: [],
  }), /safe six-decimal quantity range/);

  const nearLimit = Math.floor(Number.MAX_SAFE_INTEGER / 2) / 1_000_000;
  assert.throws(() => reconcileInvoiceReceipt({
    orderYear: 2026,
    orderWeek: '41-01',
    orders: [row({ quantity: nearLimit }), row({ quantity: nearLimit }), row({ quantity: 2 })],
    receipts: [],
    draft: [],
  }), /aggregate exceeds/);
});

test('does not mutate any input object or array', () => {
  const input = {
    orderYear: '2026',
    orderWeek: '41-1',
    orders: [row({ quantity: '1.25' })],
    receipts: [row({ warehouseKey: 4, quantity: '0.25' })],
    draft: [row({ quantity: '1' })],
    editingWarehouseKey: 4,
  };
  const before = structuredClone(input);
  reconcileInvoiceReceipt(input);
  assert.deepEqual(input, before);
});
