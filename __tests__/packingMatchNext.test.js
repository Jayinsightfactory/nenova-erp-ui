const test = require('node:test');
const assert = require('node:assert/strict');
const { assertPackingSourceValues, packingSourceValueIssues } = require('../lib/importPackingSourceReview.js');
const { makePackingReviewRows, applyPackingReview } = require('../lib/importPackingReview.js');
const { adaptPackingReceipts } = require('../lib/importPackingReceiptAdapter.js');
const hash = 'a'.repeat(64);
const invoice = year => ({ invoice: '42-02', invoice_year: year, date: `${year}-10-20`,
  pdfSourceHash: hash, pdfReviewRequired: true, currency: 'CNY', products: [
    { description: 'Fairy Kiss', total_bunch: 10, u_price: 32, t_price: 320 },
  ] });

test('2025/2026 PDF values pass without human audit; missing/invalid numbers and wrong hash still fail', () => {
  for (const year of [2025, 2026]) {
    const source = invoice(year);
    assert.equal(assertPackingSourceValues(source, 'CN'), true);
    assert.equal(source.packingReview, undefined, 'never synthesizes human review');
    for (const [field, value] of [['u_price', null], ['t_price', 'bad'], ['total_bunch', -1], ['u_price', -1], ['u_price', false]]) {
      assert.throws(() => assertPackingSourceValues({ ...source, products: [{ ...source.products[0], [field]: value }] }, 'CN'));
    }
    assert.equal(assertPackingSourceValues({ ...source, products: [{ ...source.products[0], u_price: 0, t_price: 0 }] }, 'CN'), true);
    assert.throws(() => assertPackingSourceValues(source, 'CN', 'b'.repeat(64)), /SHA-256/);
    assert.throws(() => assertPackingSourceValues({ ...source, extractionIssues: [{ code: 'BAD_TOTAL' }] }, 'CN'), /인식 오류/);
    assert.ok(packingSourceValueIssues({ ...source, products: [{ description: 'Rose', u_price: 1, t_price: 1 }] }, 'CN').some(issue => issue.includes('수량')));
  }
});

test('explicit numeric edit is preserved with reason, no check or PDF render, and stale year is rejected', () => {
  const source = invoice(2026);
  const drafts = makePackingReviewRows([source], 'CN');
  drafts[0].applyValues = true;
  drafts[0].sourceReview.rows[0].values.total_bunch = 20;
  drafts[0].sourceReview.rows[0].values.t_price = 640;
  assert.throws(() => applyPackingReview([source], drafts, 'CN', undefined, { requireConfirmation: false }), /사유/);
  drafts[0].sourceReview.rows[0].reason = '원본 숫자 정정';
  const [applied] = applyPackingReview([source], drafts, 'CN', undefined, { requireConfirmation: false });
  assert.equal(applied.products[0].total_bunch, 20);
  assert.equal(applied.packingReview.sourceReview.rows[0].confirmed, false);
  assert.equal(applied.packingReview.sourceReview.rows[0].method, 'VALUES_APPLIED');
  assert.equal(applied.packingReview.sourceReview.rows[0].originalValues.total_bunch, 10);
  assert.equal(applied.packingReview.sourceReview.confirmedAt, null);
  assert.equal(assertPackingSourceValues(applied, 'CN'), true);
  assert.throws(() => assertPackingSourceValues({ ...applied, invoice_year: 2025 }, 'CN'), /스냅샷/);
});

test('matched PDF reaches receipt draft with no human check; fuzzy/unknown ERP match is not promoted', async () => {
  const source = invoice(2026);
  const base = { country: 'CN', sourceHash: hash, fileName: '2026_42-02_CN.pdf', reviewConfirmed: true,
    invoices: [source], products: [{ ProdKey: 1, ProdName: 'Fairy Kiss', country: 'CN', selectable: true }],
    excels: [{ products: [{ sourceName: 'Fairy Kiss', matchingDescription: 'Fairy Kiss', matchedName: 'Fairy Kiss' }] }] };
  const [doc] = await adaptPackingReceipts(base);
  assert.equal(doc.lines[0].prodKey, 1);
  assert.equal(doc.lines[0].reviewed.confirmed, true);
  assert.equal(doc.lines[0].reviewed.sourceConfirmed, false);
  assert.equal(doc.lines[0].reviewed.sourceMethod, 'VALUE_VALIDATED');
  const [unmatched] = await adaptPackingReceipts({ ...base, products: [] });
  assert.equal(unmatched.lines[0].reviewed.confirmed, false);
  assert.throws(() => assertPackingSourceValues({ ...source, products: [{ ...source.products[0], u_price: '' }] }, 'CN'));
});
