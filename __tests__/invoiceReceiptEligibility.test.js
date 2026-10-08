import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateInvoiceReceiptEligibility,
  invoiceReceiptEligibilitySql,
  normalizeInvoiceReceiptScope,
  readInvoiceReceiptEligibility,
} from '../lib/invoiceReceiptEligibility.js';

const validInput = { orderYear: '2026', orderWeek: '41-01', prodKeys: [101] };
const validSnapshot = {
  products: [{ ProdKey: 101, ProdName: 'Orchid A', CountryFlower: 'ORCHID', isDeleted: 0 }],
  bounds: { CurrentYearWeek: '20264101', PreviousYearWeek: '20255201', NextYearWeek: '20270201' },
  blockers: [],
};

function rejectsCode(fn, code) {
  assert.throws(fn, error => error?.code === code, `expected error code ${code}`);
}

test('normalizes explicit scope, deduplicates product keys, and sorts them', () => {
  assert.deepEqual(normalizeInvoiceReceiptScope({
    orderYear: 2026, orderWeek: '41-01', prodKeys: [202, 101, 202],
  }), {
    orderYear: '2026', orderWeek: '41-01', orderYearWeek: '20264101', prodKeys: [101, 202],
  });
});

test('rejects malformed/missing scope and pre-2026 native stock years', () => {
  for (const input of [
    {}, { ...validInput, orderYear: '26' }, { ...validInput, orderWeek: '00-01' },
    { ...validInput, orderWeek: '54-01' }, { ...validInput, orderWeek: '41-00' },
    { ...validInput, orderWeek: '41-100' }, { ...validInput, orderYear: ['2026'] },
    { ...validInput, orderWeek: ['41-01'] },
  ]) rejectsCode(() => normalizeInvoiceReceiptScope(input), 'INVOICE_RECEIPT_SCOPE_INVALID');
  for (const prodKeys of [undefined, [], [0], [-1], [1.5], [2147483648], Array(1), Array(1001).fill(1)]) {
    rejectsCode(() => normalizeInvoiceReceiptScope({ ...validInput, prodKeys }), 'INVOICE_RECEIPT_PRODUCTS_REQUIRED');
  }
  rejectsCode(() => normalizeInvoiceReceiptScope({ ...validInput, orderYear: '2025' }), 'NATIVE_RECEIPT_YEAR_BLOCKED');
});

test('pure evaluation returns a clear read-only result with actual gapped neighbors', () => {
  const result = evaluateInvoiceReceiptEligibility(validInput, validSnapshot);
  assert.equal(result.canProceed, true);
  assert.equal(result.code, 'NATIVE_ELIGIBILITY_CLEAR');
  assert.equal(result.orderYearWeek, '20264101');
  assert.equal(result.previousYearWeek, '20255201');
  assert.equal(result.nextYearWeek, '20270201');
  assert.deepEqual(result.countryFlowers, ['ORCHID']);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.erpWritePerformed, false);
});

test('pure evaluation reports all blocker phases in stable order', () => {
  const result = evaluateInvoiceReceiptEligibility(validInput, {
    ...validSnapshot,
    blockers: [
      { Phase: 'NEXT_FIXED', OrderYearWeek: '20270201', CountryFlower: 'ORCHID', ProdKey: 102, ProdName: 'Orchid B' },
      { Phase: 'CURRENT_FIXED', OrderYearWeek: '20264101', CountryFlower: 'ORCHID', ProdKey: 101, ProdName: 'Orchid A' },
      { Phase: 'PREVIOUS_UNFIXED', OrderYearWeek: '20255201', CountryFlower: 'ORCHID', ProdKey: 103, ProdName: 'Orchid C' },
    ],
  });
  assert.equal(result.canProceed, false);
  assert.equal(result.code, 'NATIVE_ELIGIBILITY_BLOCKED');
  assert.deepEqual(result.blockers.map(blocker => blocker.phase), [
    'CURRENT_FIXED', 'PREVIOUS_UNFIXED', 'NEXT_FIXED',
  ]);
  assert.equal(result.message, result.blockers[0].message);
  assert.equal(result.erpWritePerformed, false);
});

test('deleted, null-deletion, blank-cultivar and missing products are unresolved, not eligible', () => {
  for (const product of [
    { ProdKey: 101, ProdName: 'Deleted', CountryFlower: 'ORCHID', isDeleted: 1 },
    { ProdKey: 101, ProdName: 'Unknown deletion', CountryFlower: 'ORCHID', isDeleted: null },
    { ProdKey: 101, ProdName: 'Blank cultivar', CountryFlower: '  ', isDeleted: 0 },
  ]) {
    const result = evaluateInvoiceReceiptEligibility(validInput, { ...validSnapshot, products: [product] });
    assert.equal(result.canProceed, false);
    assert.equal(result.code, 'INVOICE_RECEIPT_PRODUCT_SCOPE_INVALID');
    assert.deepEqual(result.unresolvedProducts, [101]);
    assert.deepEqual(result.blockers, []);
  }
  const missing = evaluateInvoiceReceiptEligibility(validInput, { ...validSnapshot, products: [] });
  assert.deepEqual(missing.unresolvedProducts, [101]);
});

test('rejects incomplete, contradictory, duplicate, or out-of-scope snapshots', () => {
  for (const snapshot of [
    null,
    { products: validSnapshot.products, bounds: null, blockers: [] },
    { ...validSnapshot, bounds: { ...validSnapshot.bounds, CurrentYearWeek: '20255201' } },
    { ...validSnapshot, bounds: { ...validSnapshot.bounds, PreviousYearWeek: '20264101' } },
    { ...validSnapshot, bounds: { ...validSnapshot.bounds, NextYearWeek: '20264101' } },
    { ...validSnapshot, products: [validSnapshot.products[0], validSnapshot.products[0]] },
    { ...validSnapshot, products: [{ ...validSnapshot.products[0], ProdKey: 999 }] },
    { ...validSnapshot, blockers: [{ Phase: 'CURRENT_FIXED', OrderYearWeek: '20255201', CountryFlower: 'ORCHID', ProdKey: 101, ProdName: 'Orchid A' }] },
    { ...validSnapshot, blockers: [{ Phase: 'UNKNOWN', OrderYearWeek: '20264101', CountryFlower: 'ORCHID', ProdKey: 101, ProdName: 'Orchid A' }] },
  ]) rejectsCode(() => evaluateInvoiceReceiptEligibility(validInput, snapshot), 'INVOICE_RECEIPT_SNAPSHOT_INVALID');
});

test('SQL builder binds only the explicit requested product list', () => {
  const statement = invoiceReceiptEligibilitySql(2);
  assert.match(statement, /VALUES \(@p0\),\(@p1\)/);
  assert.match(statement, /OrderYearWeek<@current/);
  assert.match(statement, /OrderYearWeek>@current/);
  assert.match(statement, /vs\.OrderYearWeek2=s\.OrderYearWeek/);
  assert.match(statement, /ISNULL\(vs\.DetailFix,0\)=s\.FixValue/);
  assert.throws(() => invoiceReceiptEligibilitySql(0), TypeError);
  assert.throws(() => invoiceReceiptEligibilitySql(1001), TypeError);
});

test('async adapter binds normalized parameters and consumes exactly three recordsets', async () => {
  let call;
  const result = await readInvoiceReceiptEligibility({
    ...validInput,
    prodKeys: [101, 101],
    types: { Int: 'INT', NVarChar: 'NVARCHAR' },
    queryFn: async (statement, params) => {
      call = { statement, params };
      return { recordsets: [[...validSnapshot.products], [validSnapshot.bounds], []] };
    },
  });
  assert.equal(result.canProceed, true);
  assert.equal(call.params.year.value, '2026');
  assert.equal(call.params.week.value, '41-01');
  assert.deepEqual(Object.keys(call.params), ['year', 'week', 'p0']);
  assert.equal(call.params.p0.value, 101);
  assert.match(call.statement, /@p0/);
});

test('adapter rejects null/missing/incomplete query results instead of treating them as clear', async () => {
  for (const value of [
    null, undefined, {}, { recordsets: null }, { recordsets: [] },
    { recordsets: [[], []] }, { recordsets: [[], [], []] },
    { recordsets: [[], [], [], []] }, { recordsets: [[], null, []] },
  ]) {
    await assert.rejects(readInvoiceReceiptEligibility({
      ...validInput, types: { Int: 'INT', NVarChar: 'NVARCHAR' }, queryFn: async () => value,
    }), error => error?.code === 'INVOICE_RECEIPT_SNAPSHOT_INVALID');
  }
});

test('adapter propagates SQL query failures and validates missing adapter dependencies', async () => {
  const sqlFailure = Object.assign(new Error('fixture SQL failure'), { number: 208 });
  await assert.rejects(readInvoiceReceiptEligibility({
    ...validInput, types: { Int: 'INT', NVarChar: 'NVARCHAR' }, queryFn: async () => { throw sqlFailure; },
  }), error => error === sqlFailure);
  await assert.rejects(readInvoiceReceiptEligibility({ ...validInput, types: { Int: 'INT', NVarChar: 'NVARCHAR' } }), TypeError);
  await assert.rejects(readInvoiceReceiptEligibility({ ...validInput, queryFn: async () => ({ recordsets: [] }) }), TypeError);
});
