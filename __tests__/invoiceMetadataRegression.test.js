import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePackingMetadata } from '../lib/importPackingMetadata.js';

const issueCodes = invoice => invoice.extractionIssues.map(entry => entry.code);
const product = amount => ({ description: 'Synthetic flower row', t_price: amount });

// Provenance: synthetic regression derived from the cached CO audit finding for invoice 274399.
// No private PDF, cached response, or external service is read by this test.
test('274399: two-digit source year is never expanded to match parsed 2017', () => {
  const source = {
    invoice: '274399', raw_date: '17/04/26', date_kind: 'invoice', date_order: 'DMY',
    date: '2017/04/26', currency: 'USD', freight_total: 0, invoice_total: 100,
    products: [product(100)],
  };
  const normalized = normalizePackingMetadata(source, 'CO');
  assert.equal(normalized.date, '2017/04/26', 'helper must not auto-fix or guess the century');
  assert.ok(issueCodes(normalized).includes('DATE_YEAR_AMBIGUOUS'));
  assert.equal(source.date, '2017/04/26', 'pure helper must preserve its source fixture');
});

// Provenance: synthetic regression derived from the cached CO audit finding for invoice EC-5353.
test('EC-5353: four-digit raw date conflicts with parsed 2017 and remains review-required', () => {
  const normalized = normalizePackingMetadata({
    invoice: 'EC-5353', raw_date: '17/04/2026', date_kind: 'invoice', date_order: 'DMY',
    date: '2017/04/26', currency: 'USD', freight_total: 0, invoice_total: 100,
    products: [product(100)],
  }, 'CO');
  assert.equal(normalized.date, '2017/04/26', 'conflicting parsed date stays visible for review, not silently replaced');
  const conflict = normalized.extractionIssues.find(entry => entry.code === 'DATE_CONFLICT');
  assert.equal(conflict?.normalizedRawValue, '2026/04/17');
  assert.equal(conflict?.extractedValue, '2017/04/26');
});

// Provenance: synthetic regression derived from the cached CO audit finding for invoice FGD32189.
test('FGD32189: ambiguous 02/04 order is surfaced without changing the parsed value', () => {
  const normalized = normalizePackingMetadata({
    invoice: 'FGD32189', raw_date: '02/04/2026', date_kind: 'invoice', date_order: null,
    date: '2026/02/04', currency: 'USD', freight_total: 0, invoice_total: 100,
    products: [product(100)],
  }, 'CO');
  assert.equal(normalized.date, '2026/02/04');
  assert.ok(issueCodes(normalized).includes('DATE_ORDER_AMBIGUOUS'));
  assert.ok(!issueCodes(normalized).includes('DATE_CONFLICT'), 'ambiguous raw date must not be forced into either order');
});

// Provenance: synthetic regression derived from the cached CO audit finding for invoice FC01191.
test('FC01191: goods plus explicit 36.34 extras reconcile to the independent grand total', () => {
  const normalized = normalizePackingMetadata({
    invoice: 'FC01191', raw_date: '2026/04/17', date_kind: 'invoice', date_order: 'YMD',
    date: '2026/04/17', currency: 'USD', freight_total: 36.34, invoice_total: 136.34,
    products: [product(60), product(40)],
  }, 'CO');
  assert.ok(!issueCodes(normalized).includes('INVOICE_EXTRAS_UNAVAILABLE'));
  assert.ok(!issueCodes(normalized).includes('AMOUNT_COMPONENTS_UNAVAILABLE'));
  assert.ok(!issueCodes(normalized).includes('INVOICE_TOTAL_MISMATCH'));
  assert.equal(normalized.invoice_total, 136.34, 'grand total remains independent rather than being derived');
});

// Provenance: synthetic regression derived from the cached CO audit finding for invoice 106255.
test('106255: a calendar-valid shipment date is blocked by the Colombia invoice-date contract', () => {
  const normalized = normalizePackingMetadata({
    invoice: '106255', raw_date: '17/04/2026', date_kind: 'shipment', date_order: 'DMY',
    date: '2026/04/17', currency: 'USD', freight_total: 0, invoice_total: 100,
    products: [product(100)],
  }, 'CO');
  assert.equal(normalized.date, '2026/04/17');
  assert.ok(issueCodes(normalized).includes('DATE_KIND_CONTRACT_MISMATCH'));
  assert.ok(!issueCodes(normalized).includes('DATE_INVALID_CALENDAR'));
});

// Provenance: synthetic regression for the deterministic NL Arrivaldate contract seen in cached audits.
test('NL arrival date with a four-digit Dutch named month passes metadata reconciliation', () => {
  const normalized = normalizePackingMetadata({
    invoice: 'NL-ARRIVAL-FIXTURE', raw_date: '03 maart 2025', date_kind: 'arrival', date_order: 'DMY',
    date: '2025/03/03', currency: 'EUR', total_value: 125,
    freight: 20, handling: 5,
    lines: [{ description: 'Synthetic Dutch flower row', stems: 100, price: 1 }],
  }, 'NL');
  assert.equal(normalized.date, '2025/03/03');
  assert.equal(normalized.date_kind, 'arrival');
  assert.deepEqual(normalized.extractionIssues, []);
});
