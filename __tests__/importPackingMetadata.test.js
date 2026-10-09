import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCurrency,
  normalizePackingDate,
  normalizePackingMetadata,
  PACKING_DATE_KIND_CONTRACT,
} from '../lib/importPackingMetadata.js';
import { parsePackingResponse } from '../lib/importPackingResponse.js';
import { buildPrompt, PACKING_COUNTRIES } from '../lib/importPackingPrompt.js';

const codes = invoice => invoice.extractionIssues.map(item => item.code);
const envelope = value => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(value) }],
});
const row = { description: 'Fixture flower', pcs: 1, t_price: 100 };

test('all country prompts request explicit metadata and correct the Colombia grand-total check', () => {
  for (const country of PACKING_COUNTRIES) {
    const prompt = buildPrompt(country);
    for (const field of ['raw_date', 'date_kind', 'date_order', 'date_year_evidence', 'currency', 'invoice_total']) {
      assert.match(prompt, new RegExp(`- ${field}:`));
    }
    assert.match(prompt, /never infer currency from country or supplier/i);
  }
  const colombiaPrompt = buildPrompt('CO');
  assert.match(colombiaPrompt, /goods \+ extras = grand total/);
  assert.match(colombiaPrompt, /add freight_total/);
  assert.doesNotMatch(colombiaPrompt, /Sum the t_price values of all your products\. Does it equal invoice_total\?/);
  for (const country of ['AU', 'US', 'VN']) assert.match(buildPrompt(country), /invoice_total is still mandatory independent source evidence/);
});

test('currency accepts only an explicit three-letter string or object code', () => {
  assert.equal(normalizeCurrency('usd'), 'USD');
  assert.equal(normalizeCurrency({ code: 'eur', unit: '€' }), 'EUR');
  for (const value of ['AUD$', '$', '', null, { unit: 'AUD$' }, { value: 'CNY' }, true]) {
    assert.equal(normalizeCurrency(value), null);
  }
  assert.equal(normalizePackingMetadata({ currency: null }, 'AU').currency, null, 'country must not supply a currency default');
});

test('numeric dates normalize only with unambiguous or source-declared order and strict calendar validation', () => {
  assert.equal(normalizePackingDate('2026-04-17'), '2026/04/17');
  assert.equal(normalizePackingDate('17/04/2026'), '2026/04/17');
  assert.equal(normalizePackingDate('04/17/2026'), '2026/04/17');
  assert.equal(normalizePackingDate('02/04/2026'), null);
  assert.equal(normalizePackingDate('02/04/2026', { dateOrder: 'DMY' }), '2026/04/02');
  assert.equal(normalizePackingDate('02/04/2026', { dateOrder: 'MDY' }), '2026/02/04');
  assert.equal(normalizePackingDate('4/17', { dateOrder: 'MDY', yearEvidence: 2026 }), '2026/04/17');
  assert.equal(normalizePackingDate('4/6', { dateOrder: 'MDY' }), null);
  assert.equal(normalizePackingDate('03 maart 2025', { dateOrder: 'DMY' }), '2025/03/03');
  assert.equal(normalizePackingDate('03-maart-2025', { dateOrder: 'DMY' }), '2025/03/03');
  assert.equal(normalizePackingDate('03 maart 25', { dateOrder: 'DMY' }), null, 'named months never expand a two-digit year');
  assert.equal(normalizePackingDate('03 maart 2025', { dateOrder: 'MDY' }), null);
  assert.equal(normalizePackingDate('31/02/2026', { dateOrder: 'DMY' }), null);
  assert.equal(normalizePackingDate('29/02/2024', { dateOrder: 'DMY' }), '2024/02/29');
});

test('two-digit years require matching four-digit source evidence', () => {
  assert.equal(normalizePackingDate('17/04/26', { dateOrder: 'DMY' }), null);
  assert.equal(normalizePackingDate('17/04/26', { dateOrder: 'DMY', fourDigitYear: 2026 }), '2026/04/17');
  assert.equal(normalizePackingDate('17/04/26', { dateOrder: 'DMY', fourDigitYear: 2025 }), null);
  const metadata = normalizePackingMetadata({ raw_date: '17/04/26', date_order: 'DMY', date: '2017/04/26' }, 'CO');
  assert.equal(metadata.date, '2017/04/26', 'unverified AI date remains visible instead of being silently rewritten');
  assert.ok(codes(metadata).includes('DATE_YEAR_AMBIGUOUS'));
});

test('raw date conflicts and missing source evidence become review issues without crashing', () => {
  const conflict = normalizePackingMetadata({
    raw_date: '17/04/2026', date_order: 'DMY', date_kind: 'invoice', date: '2017/04/26',
    currency: 'USD', invoice_total: 100, products: [row],
  }, 'CO');
  assert.equal(conflict.date, '2017/04/26');
  assert.ok(codes(conflict).includes('DATE_CONFLICT'));
  assert.equal(conflict.extractionIssues.find(item => item.code === 'DATE_CONFLICT').normalizedRawValue, '2026/04/17');

  const unavailable = normalizePackingMetadata({ date: '2026/04/17', currency: 'USD', invoice_total: 100, products: [row] }, 'US');
  assert.equal(unavailable.date, '2026/04/17');
  assert.ok(codes(unavailable).includes('DATE_SOURCE_UNAVAILABLE'));
  assert.ok(codes(unavailable).includes('DATE_KIND_UNAVAILABLE'));
});

test('country date-kind contracts preserve arrival/shipment semantics and flag Colombia shipment dates', () => {
  assert.deepEqual(PACKING_DATE_KIND_CONTRACT, {
    CO: 'invoice', NL: 'arrival', CN: 'invoice', EC: 'shipment',
    TH: 'shipment', AU: 'invoice', US: 'invoice', VN: 'invoice',
  });
  for (const [country, dateKind] of [['NL', 'arrival'], ['TH', 'shipment'], ['EC', 'Shipment']]) {
    const metadata = normalizePackingMetadata({
      raw_date: '2026/04/17', date_order: 'YMD', date_kind: dateKind, date: '2026/04/17',
      currency: 'USD', invoice_total: 100, products: [row],
      ...(country === 'NL' ? { lines: [{ description: 'Fixture flower', stems: 10, price: 10 }], freight: 0, handling: 0 } : {}),
    }, country);
    assert.equal(metadata.date_kind, country === 'NL' ? 'arrival' : 'shipment');
    assert.ok(!codes(metadata).includes('DATE_KIND_CONTRACT_MISMATCH'), country);
  }
  const colombia = normalizePackingMetadata({
    raw_date: '2026/04/17', date_order: 'YMD', date_kind: 'shipment', date: '2026/04/17',
    currency: 'USD', freight_total: 0, invoice_total: 100, products: [row],
  }, 'CO');
  assert.ok(codes(colombia).includes('DATE_KIND_CONTRACT_MISMATCH'));
});

test('grand total stays independent and Colombia validates goods plus extras', () => {
  const source = {
    raw_date: '2026/04/17', date_kind: 'invoice', date_order: 'YMD', date: '2026/04/17',
    currency: 'USD', freight_total: 15, invoice_total: 115, products: [row],
  };
  const before = JSON.stringify(source);
  const colombia = normalizePackingMetadata(source, 'CO');
  assert.equal(JSON.stringify(source), before, 'pure metadata normalization must not mutate its source');
  assert.ok(!codes(colombia).includes('INVOICE_TOTAL_MISMATCH'));
  const wrong = normalizePackingMetadata({ ...colombia, invoice_total: 100, extractionIssues: [] }, 'CO');
  assert.ok(codes(wrong).includes('INVOICE_TOTAL_MISMATCH'));
  assert.equal(wrong.extractionIssues.find(item => item.code === 'INVOICE_TOTAL_MISMATCH').expected, 115);

  const missingExtras = normalizePackingMetadata({
    raw_date: '2026/04/17', date_kind: 'invoice', date_order: 'YMD', date: '2026/04/17',
    currency: 'USD', invoice_total: 100, products: [row],
  }, 'CO');
  assert.ok(codes(missingExtras).includes('INVOICE_EXTRAS_UNAVAILABLE'));
  assert.ok(!codes(missingExtras).includes('AMOUNT_COMPONENTS_UNAVAILABLE'), 'CO missing extras already has a dedicated issue');
  assert.ok(!codes(missingExtras).includes('INVOICE_TOTAL_MISMATCH'), 'unknown extras must not be treated as zero');

  const missingColombiaProductAmount = normalizePackingMetadata({
    ...missingExtras, freight_total: 0, products: [{ description: 'Unknown amount' }], extractionIssues: [],
  }, 'CO');
  assert.ok(codes(missingColombiaProductAmount).includes('AMOUNT_COMPONENTS_UNAVAILABLE'));

  const australia = normalizePackingMetadata({
    raw_date: '2026/04/17', date_kind: 'invoice', date_order: 'YMD', date: '2026/04/17',
    currency: 'AUD', products: [row],
  }, 'AU');
  assert.equal(Object.prototype.hasOwnProperty.call(australia, 'invoice_total'), false, 'row sum must not be promoted to invoice_total');
  assert.ok(codes(australia).includes('INVOICE_TOTAL_UNAVAILABLE'));
});

test('known grand totals expose unresolved product or CN/NL charge components instead of assuming zero', () => {
  const base = {
    raw_date: '2026/04/17', date_order: 'YMD', date: '2026/04/17',
    currency: 'USD', invoice_total: 100,
  };
  const missingProductAmount = normalizePackingMetadata({
    ...base, date_kind: 'invoice', products: [{ description: 'Unknown amount' }],
  }, 'AU');
  assert.ok(codes(missingProductAmount).includes('AMOUNT_COMPONENTS_UNAVAILABLE'));

  const missingChinaExtras = normalizePackingMetadata({
    ...base, date_kind: 'invoice', products: [row],
  }, 'CN');
  assert.ok(codes(missingChinaExtras).includes('AMOUNT_COMPONENTS_UNAVAILABLE'));
  assert.ok(!codes(missingChinaExtras).includes('INVOICE_TOTAL_MISMATCH'));

  const missingNlHandling = normalizePackingMetadata({
    ...base, date_kind: 'arrival', currency: 'EUR',
    lines: [{ description: 'Fixture flower', stems: 10, price: 10 }], freight: 0,
  }, 'NL');
  assert.ok(codes(missingNlHandling).includes('AMOUNT_COMPONENTS_UNAVAILABLE'));
  assert.ok(!codes(missingNlHandling).includes('INVOICE_TOTAL_MISMATCH'));

  const explicitNlZero = normalizePackingMetadata({ ...missingNlHandling, handling: 0, extractionIssues: [] }, 'NL');
  assert.ok(!codes(explicitNlZero).includes('AMOUNT_COMPONENTS_UNAVAILABLE'));
  assert.ok(!codes(explicitNlZero).includes('INVOICE_TOTAL_MISMATCH'));
});

test('packing response adds metadata issues without changing row contracts', () => {
  const source = {
    invoice: 123,
    raw_date: '02/04/2026', date_kind: 'shipment', date_order: null, date: '2026/04/02',
    currency: { code: 'usd' }, invoice_total: 100,
    products: [row],
  };
  const parsed = parsePackingResponse(envelope({ invoices: [source] }), 'US').result.invoices[0];
  assert.equal(parsed.invoice, '123');
  assert.deepEqual(parsed.products, source.products);
  assert.equal(parsed.currency, 'USD');
  assert.ok(codes(parsed).includes('DATE_ORDER_AMBIGUOUS'));
});

test('packing response rejects present boolean or blank numeric values while retaining null-safe fields', () => {
  for (const bad of [
    { ...row, pcs: true },
    { ...row, pcs: '   ' },
  ]) {
    assert.throws(() => parsePackingResponse(envelope({ invoices: [{ products: [bad] }] }), 'AU'), /Invalid invoice number: pcs/);
  }
  assert.throws(() => parsePackingResponse(envelope({ invoices: [{ invoice_total: false, products: [row] }] }), 'AU'), /Invalid invoice number: invoice_total/);
  const nullable = parsePackingResponse(envelope({ invoices: [{ invoice_total: null, products: [{ ...row, pcs: null }] }] }), 'AU');
  assert.equal(nullable.result.invoices[0].products[0].pcs, null);
});
