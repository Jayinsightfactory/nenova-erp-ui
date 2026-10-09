const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ready = import('../lib/importPackingReview.js');
const component = fs.readFileSync(path.join(__dirname, '../components/import-tools/PackingEvidenceReview.js'), 'utf8');

function sourceInvoice(overrides = {}, country = 'CO') {
  const base = {
    invoice: 'META-1', supplier: 'Example',
    raw_date: '17/04/2026', date_order: 'DMY', date: '2017/04/26', date_kind: 'shipment',
    currency: 'usdollar', invoice_total: 999, freight_total: 15,
    products: [{ t_price: 100 }],
    metadata_evidence: {
      date: { page: 1, quote: 'Invoice date: 17/04/2026' },
      date_kind: { page: 1, quote: 'Invoice date' },
      currency: { page: 2, quote: 'USD' },
      invoice_total: { page: 2, quote: 'Total 115.00' },
    },
    review_evidence: { freight_total: { value: 15, quote: 'Freight USD 15' } },
  };
  return import('../lib/importPackingMetadata.js').then(({ normalizePackingMetadata }) =>
    normalizePackingMetadata({ ...base, ...overrides }, country));
}

function resolveAllMetadata(row, { total = '115', kind = 'invoice', date = '2026-04-17', currency = 'USD' } = {}) {
  Object.assign(row.metadata.values, { date, date_kind: kind, currency, invoice_total: total });
  for (const field of ['date', 'date_kind', 'currency', 'invoice_total']) {
    row.metadata.confirmed[field] = true;
    row.metadata.reasons[field] = `원문 ${field} 대조`;
  }
  row.confirmed = true;
}

test('legacy fixtures without extractionIssues keep the existing review contract', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = { invoice: 'legacy', freight: 0, gross_weight: 7, vol_weight: 5 };
  const [row] = makePackingReviewRows([source], 'CN');
  assert.equal(row.metadata.enabled, false);
  row.confirmed = true;
  const [result] = applyPackingReview([source], [row], 'CN');
  assert.equal(Object.hasOwn(result, 'extractionIssues'), false);
  assert.equal(Object.hasOwn(result.packingReview, 'metadata'), false);
});

test('valid normalized metadata is not treated as edited merely because date input uses YYYY-MM-DD', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = await sourceInvoice({
    raw_date: '17/04/2026', date_order: 'DMY', date: '2026/04/17', date_kind: 'invoice',
    currency: 'USD', invoice_total: 115, freight_total: 15,
  });
  assert.deepEqual(source.extractionIssues, []);
  const [row] = makePackingReviewRows([source], 'CO');
  row.confirmed = true;
  const [result] = applyPackingReview([source], [row], 'CO');
  assert.deepEqual(result.extractionIssues, []);
  assert.equal(Object.hasOwn(result, 'metadataReview'), true);
  assert.deepEqual(result.metadataReview.confirmations, { date: false, date_kind: false, currency: false, invoice_total: false });
});

test('manual full date, contract date kind, ISO currency and recomputed total resolve only their metadata issues', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = await sourceInvoice();
  const preservedRaw = JSON.parse(JSON.stringify({ raw_date: source.raw_date, evidence: source.metadata_evidence }));
  const [row] = makePackingReviewRows([source], 'CO');
  resolveAllMetadata(row);
  const [result] = applyPackingReview([source], [row], 'CO', '2026-10-09T00:00:00.000Z');

  assert.equal(result.date, '2026/04/17');
  assert.equal(result.date_kind, 'invoice');
  assert.equal(result.currency, 'USD');
  assert.equal(result.invoice_total, 115);
  assert.deepEqual(result.extractionIssues, []);
  assert.equal(result.raw_date, preservedRaw.raw_date);
  assert.deepEqual(result.metadata_evidence, preservedRaw.evidence);
  assert.deepEqual(result.metadataReview.issuesAfter, []);
  assert.equal(result.metadataReview.confirmations.invoice_total, true);
  assert.equal(result.metadataReview.reasons.invoice_total, '원문 invoice_total 대조');
});

test('date kind choices are validated against the country contract (NL Arrivaldate)', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = await sourceInvoice({
    raw_date: '17/04/2026', date_order: 'DMY', date: '2026/04/17', date_kind: 'invoice',
    currency: 'EUR', invoice_total: 100, freight: 0, handling: 0,
    lines: [{ t_price: 100 }], products: undefined,
  }, 'NL');
  const [row] = makePackingReviewRows([source], 'NL');
  row.confirmed = true;
  row.metadata.values.date_kind = 'arrival';
  row.metadata.confirmed.date_kind = true;
  row.metadata.reasons.date_kind = 'Arrivaldate 원문 확인';
  const [result] = applyPackingReview([source], [row], 'NL');
  assert.equal(result.date_kind, 'arrival');
  assert.equal(result.extractionIssues.length, 0);
});

test('malformed date/currency, missing per-field confirmation or reason cannot be applied', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = await sourceInvoice();
  const [row] = makePackingReviewRows([source], 'CO');
  resolveAllMetadata(row, { date: '2026-02-30', currency: 'US', kind: 'arrival' });
  assert.throws(() => applyPackingReview([source], [row], 'CO'), /실제로 존재하는 날짜/);

  resolveAllMetadata(row, { date: '2026-04-17', currency: 'USD', kind: 'invoice' });
  row.metadata.confirmed.currency = false;
  assert.throws(() => applyPackingReview([source], [row], 'CO'), /ISO 통화 항목을 각각 확인/);
  row.metadata.confirmed.currency = true;
  row.metadata.reasons.currency = '';
  assert.throws(() => applyPackingReview([source], [row], 'CO'), /ISO 통화 확인 사유/);
});

test('whole-invoice checkbox cannot bypass unresolved amount or arithmetic mismatch', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = await sourceInvoice();
  const [row] = makePackingReviewRows([source], 'CO');
  row.confirmed = true;
  for (const field of ['date', 'date_kind', 'currency']) {
    row.metadata.values[field] = field === 'date' ? '2026-04-17' : field === 'date_kind' ? 'invoice' : 'USD';
    row.metadata.confirmed[field] = true;
    row.metadata.reasons[field] = `원문 ${field} 대조`;
  }
  assert.throws(() => applyPackingReview([source], [row], 'CO'), /인보이스 총액 항목을 각각 확인/);

  resolveAllMetadata(row, { total: '999' });
  assert.throws(() => applyPackingReview([source], [row], 'CO'), /총액을 다시 검산/);
});

test('unresolved non-metadata source issues remain blocking after metadata is corrected', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const normalized = await sourceInvoice({
    extractionIssues: [{ code: 'PRODUCT_SOURCE_UNVERIFIED', field: 'products', severity: 'review_required' }],
  });
  const [row] = makePackingReviewRows([normalized], 'CO');
  resolveAllMetadata(row);
  assert.throws(() => applyPackingReview([normalized], [row], 'CO'), /미해결 원문 추출 문제/);
});

test('known financial issues clear only after explicit amount confirmation and successful recomputation', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = await sourceInvoice({
    raw_date: '17/04/2026', date_order: 'DMY', date: '2026/04/17', date_kind: 'invoice',
    currency: 'USD', invoice_total: 115, freight_total: null,
  });
  assert.ok(source.extractionIssues.some(issue => issue.code === 'INVOICE_EXTRAS_UNAVAILABLE'));
  const [row] = makePackingReviewRows([source], 'CO');
  row.confirmed = true;
  row.values.freight = '15';
  row.reason = '인쇄된 운임 항목 대조';
  row.metadata.values.invoice_total = '115';
  row.metadata.confirmed.invoice_total = true;
  row.metadata.reasons.invoice_total = '인쇄 총액 및 재계산 확인';
  const [result] = applyPackingReview([source], [row], 'CO');
  assert.equal(result.freight_total, 15);
  assert.deepEqual(result.extractionIssues, []);

  const nl = await sourceInvoice({
    raw_date: '17/04/2026', date_order: 'DMY', date: '2026/04/17', date_kind: 'arrival',
    currency: 'EUR', invoice_total: 100, freight: 0, handling: null,
    lines: [{ t_price: 100 }], products: undefined,
  }, 'NL');
  const [nlRow] = makePackingReviewRows([nl], 'NL');
  nlRow.confirmed = true;
  nlRow.metadata.confirmed.invoice_total = true;
  nlRow.metadata.reasons.invoice_total = '원문 총액 대조';
  assert.throws(() => applyPackingReview([nl], [nlRow], 'NL'), /총액을 다시 검산/);
});

test('China legacy reviewed invoices share the reviewed additional-cost adjustment branch', async () => {
  const { makePackingReviewRows, applyPackingReview } = await ready;
  const source = {
    source_format: 'china_legacy_invoice_reviewed', freight: 12, currency: 'USD',
    additional_costs: [{ description: 'Fee', quantity: 1, unit_price: 10, amount: 10 }],
    products: [{ description: 'Flower', t_price: 50 }],
  };
  const [row] = makePackingReviewRows([source], 'CN');
  row.confirmed = true;
  row.values.freight = '12';
  row.reason = '확인';
  const [result] = applyPackingReview([source], [row], 'CN');
  assert.deepEqual(result.additional_costs.map(cost => cost.amount), [10, 2]);
  assert.equal(result.additional_costs[1].reviewAdjustment, true);
});

test('component presents accessible per-field metadata confirmation and reason controls', () => {
  for (const field of ['date', 'date_kind', 'currency', 'invoice_total']) {
    assert.ok(component.includes('metadata-confirm-${field}'));
    assert.ok(component.includes('metadata-reason-${field}'));
  }
  assert.match(component, /원문 값과 근거는 보존됩니다/);
  assert.match(component, /type="date"/);
  assert.match(component, /aria-invalid=\{Boolean\(fieldError\)\}/);
});

test('metadata issues move their editable section ahead of the three numeric review cards', () => {
  assert.match(component, /selectedRow\.metadata\.issues\.length > 0/);
  const metadataFirst = component.indexOf('{showMetadataFirst && metadataSection}');
  const numericCards = component.indexOf('<div className={styles.fields}>', metadataFirst);
  assert.ok(metadataFirst >= 0 && numericCards > metadataFirst, 'issue metadata is rendered before GW/CW/freight inputs');
  assert.match(component, /\{!showMetadataFirst && metadataSection\}/, 'metadata without issues keeps the existing later position');
});
