const assert = require('node:assert/strict');
const test = require('node:test');
const { buildPackingMatchPreview, previewQuantity } = require('../lib/importPackingMatchPreview.js');
const { packingErpProducts, upsertPackingErpMatch } = require('../lib/importPackingErpMatches.js');
const { makePackingSourceReview, applyPackingSourceReview } = require('../lib/importPackingSourceReview.js');

test('applied manual review clears preview warning only for the unchanged source, including year', () => {
  for (const year of [2025, 2026]) {
    const invoice = { invoice: '41-02', invoice_year: year, date: `${year}-10-10`, supplier: 'Cloudland',
      pdfReviewRequired: true, pdfSourceHash: 'a'.repeat(64), products: [
        { description: 'Rose Freedom 60cm', pcs: 1, total_bunch: 10, total_stems: 100, bunch_st: 10, u_price: 0, t_price: 0 },
      ] };
    const draft = makePackingSourceReview(invoice, 'CN');
    draft.pdf = { rendered: true, page: 1 };
    draft.rows.forEach(row => { row.confirmed = true; });
    const applied = applyPackingSourceReview(invoice, draft, 'CN');
    const review = value => buildPackingMatchPreview({ invoices: [value], country: 'CN', erpMatches: { products: [] } })[0].products[0].sourceReview;
    assert.equal(review(invoice).required, true);
    assert.equal(review(applied).required, false);
    assert.equal(review({ ...applied, invoice_year: year + 1 }).required, true);
    assert.equal(review({ ...applied, products: [{ ...applied.products[0], total_bunch: 11 }] }).required, true);
    assert.equal(review({ ...applied, pdfSourceHash: 'b'.repeat(64) }).required, true);
  }
});

const erpMatches = packingErpProducts([
  { ProdKey: 11, ProdCode: 'NL-1', ProdName: 'Tulip / Single Royal Virgen White1', CounName: '네덜란드' },
  { ProdKey: 21, ProdCode: 'CN-1', ProdName: 'ROSE Freedom 60cm', CounName: '중국' },
]);

test('NL preview reads invoice.lines and applies the same built-in NL mapping without deriving absent quantities', () => {
  const invoice = { invoice: 'NL-1', supplier: 'Holex', lines: [
    { cl: 'CL2', description: 'TULIPA ROYAL VIRGIN', stems: 50, price: 3.25 },
    { cl: 'CL1', description: 'TULIPA ROYAL VIRGIN', stems: null, price: null },
  ], products: [{ description: 'must not be used' }] };
  const [preview] = buildPackingMatchPreview({ invoices: [invoice], country: 'NL', erpMatches: { products: erpMatches } });
  assert.equal(preview.products.length, 2);
  assert.deepEqual(preview.products.map(row => row.sourceName), ['TULIPA ROYAL VIRGIN', 'TULIPA ROYAL VIRGIN']);
  assert.deepEqual(preview.products.map(row => row.name), ['Tulip / Single Royal Virgen White1', 'Tulip / Single Royal Virgen White1']);
  assert.deepEqual(preview.products.map(row => row.qty), [50, null]);
  assert.deepEqual(preview.products.map(row => row.stems), [50, null]);
  assert.deepEqual(preview.products.map(row => row.unitPrice), [3.25, null]);
  assert.deepEqual(preview.products.map(row => row.lineAmount), [null, null]);
  assert.ok(preview.products.every(row => row.sourceReview.required === false), 'non-PDF invoice rows are not forced into PDF source review');
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.sourceInvoiceIdentity.sourceInvoiceIndex, 0, 'PDF review can link preview ERP names to the original invoice');
});

test('CN preview preserves bunch quantity and missing price as null and marks only PDF source review issues', () => {
  const workbookInvoice = { source_format: 'china_invoice_xlsx', products: [
    { source_row: 4, description: 'Rose Freedom 60cm', source_description: 'Rose Freedom 60cm', total_bunch: 0, total_stems: 100, u_price: null, t_price: null },
  ] };
  const pdfInvoice = { ...workbookInvoice, pdfReviewRequired: true,
    pdfSourceHash: 'a'.repeat(64) };
  const args = { country: 'CN', erpMatches: { products: erpMatches } };
  const [workbookRow] = buildPackingMatchPreview({ ...args, invoices: [workbookInvoice] })[0].products;
  const [pdfRow] = buildPackingMatchPreview({ ...args, invoices: [pdfInvoice] })[0].products;
  assert.equal(workbookRow.qty, 0, 'explicit zero is retained');
  assert.equal(workbookRow.stems, 100);
  assert.equal(workbookRow.unitPrice, null);
  assert.equal(workbookRow.lineAmount, null);
  assert.equal(workbookRow.sourceReview.required, false, 'an Excel row receives no PDF-only source issue');
  assert.equal(pdfRow.sourceReview.required, true, 'PDF rows with unavailable source-review proof stay actionable');
});

test('quantity preview never invents a bunch or stem multiplier', () => {
  assert.equal(previewQuantity({ total_bunch: null, total_stems: null }, 'CN'), null);
  assert.equal(previewQuantity({ total_bunch: null, total_stems: 35 }, 'CN'), 35);
  assert.equal(previewQuantity({ total_bunch: 0, total_stems: 35 }, 'CN'), 0);
  assert.equal(previewQuantity({ total_stems: null, stems: null, pcs: 7, steam_box: 10 }, 'CO'), null);
  assert.equal(previewQuantity({ total_bunch: null, bunch_st: 20 }, 'NL'), null);
});

test('a persisted team mapping is reapplied as MANUAL, while duplicate ERP names stay unresolved', () => {
  const products = packingErpProducts([
    { ProdKey: 31, ProdName: 'CARNATION Doncel', CounName: '콜롬비아' },
  ]);
  const value = upsertPackingErpMatch(null, { country: 'CO', description: 'DONCEL RAW', prodKey: 31 }, products);
  const invoice = { invoice: 'TEAM-MATCH', products: [{ description: 'DONCEL RAW', total_stems: 20, u_price: 1, t_price: 20 }] };
  const [preview] = buildPackingMatchPreview({ invoices: [invoice], country: 'CO', erpMatches: { products, value } });
  assert.equal(preview.products[0].name, 'CARNATION Doncel');
  assert.equal(preview.products[0].unmatched, false);
  assert.equal(preview.products[0].viaAlias, true);
  assert.deepEqual(preview.products[0].erpMatch, {
    type: 'MANUAL', confirmed: true, prodKey: 31,
    sourceDescription: 'DONCEL RAW', matchedName: 'CARNATION Doncel',
  });
  assert.equal(preview.products[0].matchReview.status, 'MANUAL');

  const ambiguous = packingErpProducts([
    { ProdKey: 41, ProdName: 'CARNATION Doncel', CounName: '콜롬비아' },
    { ProdKey: 42, ProdName: 'CARNATION Doncel', CounName: '콜롬비아' },
  ]);
  assert.ok(ambiguous.every(product => product.selectable === false));
  assert.throws(() => upsertPackingErpMatch(null, { country: 'CO', description: 'DONCEL RAW', prodKey: 41 }, ambiguous), /여러 개/);
  const [ambiguousPreview] = buildPackingMatchPreview({ invoices: [invoice], country: 'CO', erpMatches: { products: ambiguous } });
  assert.equal(ambiguousPreview.products[0].unmatched, true);
  assert.equal(ambiguousPreview.products[0].matchReview.status, 'UNMATCHED');
});
