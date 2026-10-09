const test = require('node:test');
const assert = require('node:assert/strict');

const sourceModule = import('../lib/importPackingSourceReview.js');
const reviewModule = import('../lib/importPackingReview.js');

function readyInvoice(overrides = {}) {
  return {
    invoice: '2025-41', invoice_year: 2025, raw_date: '17/04/2025',
    source_format: 'ai_pdf', source_sheet: null,
    pdfSourceHash: 'a'.repeat(64),
    pdfReviewRequired: true,
    products: [{ description: 'ROSE RED', pcs: 0, total_bunch: 2, total_stems: 20, u_price: 1, t_price: 20,
      source_cells: { description: { page: 2, quote: 'ROSE RED' }, t_price: { page: 2, quote: 'USD 20.00' } } }],
    date: '2025/04/17', date_kind: 'invoice', date_order: 'YMD', currency: 'USD',
    freight_total: 0, invoice_total: 20, extractionIssues: [],
    metadataReview: { preservedByMain: true },
    ...overrides,
  };
}

function confirmRows(draft, { page = 2 } = {}) {
  draft.pdf = { rendered: true, page };
  for (const row of draft.rows) {
    row.confirmed = true;
    row.reason = '';
  }
  return draft;
}

test('source review builds country-native raw rows and preserves blank versus explicit zero', async () => {
  const { makePackingSourceReview } = await sourceModule;
  const co = makePackingSourceReview(readyInvoice(), 'CO');
  assert.equal(co.required, true);
  assert.deepEqual(co.rows[0].values, {
    description: 'ROSE RED', pcs: 0, total_bunch: 2, total_stems: 20, u_price: 1, t_price: 20,
  });
  assert.equal(co.rows[0].values.pcs, 0);
  assert.equal(co.rows[0].confirmed, false);
  assert.equal(co.pdf.rendered, false);
  assert.equal(co.pdf.page, null);
  assert.match(co.rows[0].unitSemantics.u_price, /per stem/);
  assert.equal(co.rows[0].evidence.t_price.quote, 'USD 20.00');
  assert.equal(co.sourceHash, 'a'.repeat(64));

  const nl = makePackingSourceReview({ invoice: 'NL-1', pdfSourceHash: 'b'.repeat(64), lines: [{ description: 'TULIP', stems: null, price: 0 }] }, 'NL');
  assert.equal(nl.rowsKey, 'lines');
  assert.equal(nl.rows[0].values.stems, null);
  assert.equal(nl.rows[0].values.price, 0);
  assert.equal(Object.hasOwn(nl.rows[0].values, 'total_bunch'), false);

  const th = makePackingSourceReview({ pdfSourceHash: 'c'.repeat(64), products: [{ description: 'ORCHID', bunch_st: 100, total_bunch: 51, total_stems: 5100, u_price: 2, t_price: 102 }] }, 'TH');
  assert.equal(th.rows[0].values.total_stems, 5100);
  assert.equal(th.rows[0].values.total_bunch, 51);
  assert.match(th.rows[0].unitSemantics.u_price, /native printed unit; no conversion/);

  const withSteamBox = makePackingSourceReview({ ...readyInvoice(), products: [{ ...readyInvoice().products[0], steam_box: 2 }] }, 'CO');
  assert.equal(withSteamBox.rows[0].values.steam_box, 2);
  assert.match(withSteamBox.rows[0].unitSemantics.steam_box, /stems per box/);
  assert.throws(() => makePackingSourceReview({ products: [{ description: 'NO HASH' }] }, 'CO'), /SHA-256/);
});

test('apply requires successful PDF render and every row confirmation', async () => {
  const { makePackingSourceReview, applyPackingSourceReview } = await sourceModule;
  const invoice = readyInvoice();
  const draft = makePackingSourceReview(invoice, 'CO');
  for (const candidate of [draft, { ...draft, pdf: { rendered: true, page: 1 } }]) {
    assert.throws(() => applyPackingSourceReview(invoice, candidate, 'CO'), /PDF 페이지 렌더|개별 확인/);
  }
  const readyDraft = confirmRows(makePackingSourceReview(invoice, 'CO'));
  assert.doesNotThrow(() => applyPackingSourceReview(invoice, readyDraft, 'CO'));
  assert.throws(() => applyPackingSourceReview({ ...invoice, pdfSourceHash: 'b'.repeat(64) }, readyDraft, 'CO'), /SHA-256/);
});

test('apply validates changed values, requires a reason, never derives amount, and writes an auditable snapshot', async () => {
  const { makePackingSourceReview, applyPackingSourceReview, assertPackingSourceReviewed } = await sourceModule;
  const invoice = readyInvoice();
  const draft = confirmRows(makePackingSourceReview(invoice, 'CO'));
  draft.rows[0].values.total_bunch = 3;
  assert.throws(() => applyPackingSourceReview(invoice, draft, 'CO'), /사유를 입력/);
  draft.rows[0].reason = '원문 수량 대조';
  draft.rows[0].values.u_price = 'not-money';
  assert.throws(() => applyPackingSourceReview(invoice, draft, 'CO'), /숫자 형식/);
  draft.rows[0].values.u_price = 1;
  draft.rows[0].values.t_price = 30;
  const applied = applyPackingSourceReview(invoice, draft, 'CO', '2026-10-09T00:00:00.000Z');

  assert.equal(applied.products[0].total_bunch, 3);
  assert.equal(applied.products[0].t_price, 30, 'amount changes only when explicitly edited; it is not derived from quantity × price');
  assert.equal(invoice.products[0].total_bunch, 2, 'source invoice remains immutable');
  assert.equal(applied.packingReview.sourceReview.pdf.page, 2);
  assert.equal(applied.packingReview.sourceReview.sourceHash, 'a'.repeat(64));
  assert.equal(applied.packingReview.sourceReview.confirmedAt, '2026-10-09T00:00:00.000Z');
  assert.equal(applied.packingReview.sourceReview.sourceSnapshot.rows[0].total_bunch, 2);
  assert.equal(applied.packingReview.sourceReview.rows[0].values.total_bunch, 3);
  assert.equal(assertPackingSourceReviewed(applied, 'CO'), true);
  assert.equal(assertPackingSourceReviewed(applied, 'CO', 'a'.repeat(64)), true, 'adapter may bind the audit to its actual file hash explicitly');
  assert.throws(() => assertPackingSourceReviewed(applied, 'CO', 'b'.repeat(64)), /SHA-256/);

  const blankInvoice = readyInvoice({ products: [{ description: 'BLANK', pcs: null, total_bunch: '', total_stems: null, u_price: null, t_price: null }] });
  const blankDraft = makePackingSourceReview(blankInvoice, 'CO');
  assert.equal(blankDraft.rows[0].values.pcs, null);
  assert.equal(blankDraft.rows[0].values.total_bunch, '');
  assert.equal(blankDraft.rows[0].values.t_price, null);
});

test('quantity validation rejects negative original and edited values, and descriptions cannot be blank', async () => {
  const { makePackingSourceReview, applyPackingSourceReview } = await sourceModule;
  const negativeSource = readyInvoice({ products: [{ description: 'ROSE', pcs: 0, total_bunch: -1, total_stems: 20, u_price: 1, t_price: 20 }] });
  const unchangedNegative = confirmRows(makePackingSourceReview(negativeSource, 'CO'));
  assert.throws(() => applyPackingSourceReview(negativeSource, unchangedNegative, 'CO'), /수량은 음수일 수 없습니다/);

  const invoice = readyInvoice();
  const negativeEdit = confirmRows(makePackingSourceReview(invoice, 'CO'));
  negativeEdit.rows[0].values.total_bunch = '-1';
  negativeEdit.rows[0].reason = '원문 대조 수정';
  assert.throws(() => applyPackingSourceReview(invoice, negativeEdit, 'CO'), /수량은 음수일 수 없습니다/);

  const blankDescription = confirmRows(makePackingSourceReview(invoice, 'CO'));
  blankDescription.rows[0].values.description = '   ';
  blankDescription.rows[0].reason = '품목 설명 수정';
  assert.throws(() => applyPackingSourceReview(invoice, blankDescription, 'CO'), /품목 설명을 확인/);
});

test('negative printed or edited stems per box cannot be confirmed', async () => {
  const { makePackingSourceReview, applyPackingSourceReview } = await sourceModule;
  const base = readyInvoice();
  const negative = readyInvoice({ products: [{ ...base.products[0], steam_box: -100 }] });
  assert.throws(() => applyPackingSourceReview(negative, confirmRows(makePackingSourceReview(negative, 'CO')), 'CO'), /수량은 음수일 수 없습니다/);
  const invoice = readyInvoice({ products: [{ ...base.products[0], steam_box: 100 }] });
  const draft = confirmRows(makePackingSourceReview(invoice, 'CO'));
  draft.rows[0].values.steam_box = '-100';
  draft.rows[0].reason = '원문 대조 수정';
  assert.throws(() => applyPackingSourceReview(invoice, draft, 'CO'), /수량은 음수일 수 없습니다/);
});

test('mandatory numeric source fields cannot be blank and all price/amount fields are nonnegative', async () => {
  const { makePackingSourceReview, applyPackingSourceReview } = await sourceModule;
  const invoice = readyInvoice();
  const missingMandatoryPrice = readyInvoice({ products: [{ description: 'ROSE', pcs: 1, total_bunch: 1, total_stems: 10, u_price: '', t_price: 10 }] });
  assert.throws(() => applyPackingSourceReview(missingMandatoryPrice,
    confirmRows(makePackingSourceReview(missingMandatoryPrice, 'CO')), 'CO'), /값이 비어 있습니다/);

  for (const field of ['u_price', 't_price']) {
    const draft = confirmRows(makePackingSourceReview(invoice, 'CO'));
    draft.rows[0].values[field] = -1;
    draft.rows[0].reason = '원문 대조';
    assert.throws(() => applyPackingSourceReview(invoice, draft, 'CO'), /금액은 음수일 수 없습니다/);
  }

  const optionalMissing = readyInvoice();
  const missingDraft = confirmRows(makePackingSourceReview(optionalMissing, 'CO'));
  assert.doesNotThrow(() => applyPackingSourceReview(optionalMissing, missingDraft, 'CO'), 'an absent optional steam_box stays blank');

  const presentBlank = readyInvoice({ products: [{ ...invoice.products[0], steam_box: '' }] });
  const presentDraft = confirmRows(makePackingSourceReview(presentBlank, 'CO'));
  assert.throws(() => applyPackingSourceReview(presentBlank, presentDraft, 'CO'), /steam_box 값이 비어/);
});

test('stale invoice year/identity and post-confirm row changes invalidate the snapshot', async () => {
  const { makePackingSourceReview, applyPackingSourceReview, assertPackingSourceReviewed } = await sourceModule;
  const invoice = readyInvoice();
  const draft = confirmRows(makePackingSourceReview(invoice, 'CO'));
  assert.throws(() => applyPackingSourceReview({ ...invoice, invoice: '2026-41', invoice_year: 2026 }, draft, 'CO'), /스냅샷이 변경/);
  const applied = applyPackingSourceReview(invoice, draft, 'CO');
  assert.throws(() => assertPackingSourceReviewed({ ...applied, products: applied.products.map(row => ({ ...row, t_price: 21 })) }, 'CO'), /스냅샷이 변경/);
  assert.throws(() => assertPackingSourceReviewed({ ...applied, packingReview: { sourceReview: { ...applied.packingReview.sourceReview, pdf: { rendered: false, page: 2 } } } }, 'CO'), /PDF 렌더 성공/);
});

test('packing review opt-in and pdfReviewRequired flag enforce source review; legacy Excel remains compatible', async () => {
  const { makePackingReviewRows, applyPackingReview } = await reviewModule;
  const invoice = readyInvoice();
  const [requiredByOption] = makePackingReviewRows([{ ...invoice, pdfReviewRequired: false }], 'CO', { requireSourceReview: true });
  assert.equal(requiredByOption.sourceReviewRequired, true);
  assert.throws(() => applyPackingReview([{ ...invoice, pdfReviewRequired: false }], [{ ...requiredByOption, sourceReview: undefined, confirmed: true }], 'CO'), /필수 PDF 검토 초안/);

  const [requiredByInvoice] = makePackingReviewRows([invoice], 'CO');
  assert.ok(requiredByInvoice.sourceReview);
  assert.equal(requiredByInvoice.sourceReviewRequired, true);

  const excelInvoice = { invoice: 'XLS-1', products: [{ description: 'A', pcs: 0 }] };
  const [legacyRow] = makePackingReviewRows([excelInvoice], 'CO');
  assert.equal(legacyRow.sourceReview, undefined);
});

test('packing review applies source rows before metadata validation and keeps source audit valid after manual date correction', async () => {
  const { makePackingReviewRows, applyPackingReview } = await reviewModule;
  const { assertPackingSourceReviewed } = await sourceModule;
  const invoice = readyInvoice({ extractionIssues: [{ code: 'DATE_CONFLICT', field: 'date' }] });
  const [draft] = makePackingReviewRows([invoice], 'CO');
  confirmRows(draft.sourceReview);
  draft.sourceReview.rows[0].values.t_price = 25;
  draft.sourceReview.rows[0].reason = '인쇄 금액 대조';
  draft.confirmed = true;
  draft.metadata.values.invoice_total = '25';
  draft.metadata.confirmed.invoice_total = true;
  draft.metadata.reasons.invoice_total = '수정된 상품행 합계와 대조';
  draft.metadata.values.date = '2025-04-18';
  draft.metadata.confirmed.date = true;
  draft.metadata.reasons.date = '원본 PDF 날짜를 재확인';
  const [result] = applyPackingReview([invoice], [draft], 'CO', '2026-10-09T00:00:00.000Z');
  assert.equal(result.products[0].t_price, 25);
  assert.equal(result.invoice_total, 25);
  assert.equal(result.date, '2025/04/18');
  assert.equal(result.metadataReview.preservedByMain, true);
  assert.equal(result.packingReview.sourceReview.rows[0].values.t_price, 25);
  assert.equal(result.packingReview.sourceReview.pdf.rendered, true);
  assert.equal(result.packingReview.sourceReview.sourceMetadata.date, '2025/04/17', 'source audit retains the original date separately from the product-row identity snapshot');
  assert.equal(assertPackingSourceReviewed(result, 'CO'), true, 'metadata date correction does not stale the confirmed product rows');
});
