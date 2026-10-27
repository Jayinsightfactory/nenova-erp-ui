const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const importLocal = async relative => import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(root, relative))).toString('base64')}`);

test('AWB OCR evidence verifies 44-01 number, 65 boxes, and 805 kg GW/CW without inference', async () => {
  const { reviewAirWaybill, buildAwbSourceMetadata } = await importLocal('lib/invoiceAwbEvidence.js');
  const review = reviewAirWaybill({
    awbDocument: {
      awb: '081-63688774', invoice_awb: '08163688774', packages: 65,
      gross_weight_kg: 805, chargeable_weight_kg: 805, currency: 'AUD',
      evidence: {
        awb: { page: 1, quote: 'Air Waybill No. 081-63688774' },
        packages: { page: 1, quote: 'Total No. of Pieces 65' },
        gross_weight_kg: { page: 1, quote: 'Gross Weight 805.0 kg' },
        chargeable_weight_kg: { page: 1, quote: 'Chargeable Weight 805.0 kg' },
      },
    },
    invoices: [{ awb: '08163688774', products: [{ pcs: 40 }, { pcs: 25 }] }],
    packageTotal: 65,
  });
  assert.equal(review.ready, true, review.issues.join('; '));
  assert.deepEqual([review.awb, review.packages, review.grossWeightKg, review.chargeableWeightKg], ['081-63688774', 65, 805, 805]);
  const metadata = buildAwbSourceMetadata(review, {
    fileName: '44-01 호주 AWB - 081-63688774.pdf', sourceHash: 'a'.repeat(64),
    uploadDate: '2026-10-27', confirmed: true,
  });
  assert.equal(metadata.gw, 805);
  assert.equal(metadata.cw, 805);
  assert.equal(metadata.awbReviewed, true);
  assert.equal(metadata.awbAttachment.packageCount, 65);
});

// End of AU AWB flow contract tests.
test('AWB with invoice/package mismatch or unproven OCR remains blocked until corrected and reviewed', async () => {
  const { reviewAirWaybill } = await importLocal('lib/invoiceAwbEvidence.js');
  const source = {
    awbDocument: {
      awb: '081-63688774', packages: 64, gross_weight_kg: 805, chargeable_weight_kg: 805,
      evidence: {
        awb: { page: 1, quote: 'Air Waybill No. 081-63688774' },
        packages: { page: 1, quote: 'Pieces 64' },
        gross_weight_kg: { page: 1, quote: 'Gross Weight 805 kg' },
        chargeable_weight_kg: { page: 1, quote: 'Chargeable Weight 805 kg' },
      },
    },
    invoices: [{ awb: '081-63688774', products: [{ pcs: 65 }] }], packageTotal: 65,
  };
  const mismatch = reviewAirWaybill(source);
  assert.equal(mismatch.ready, false);
  assert.match(mismatch.issues.join(' '), /박스 합계/);
  const corrected = reviewAirWaybill({
    ...source,
    awbDocument: { ...source.awbDocument, packages: 65 },
    manualFields: ['packages'],
  });
  assert.equal(corrected.ready, true, corrected.issues.join('; '));
});

test('AUD/KRW selection uses requested day or the latest preceding market quote only', async () => {
  const { selectAudMarketRate, validExchangeDate } = await importLocal('lib/audMarketExchangeRate.js');
  const timestamps = ['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'].map(date => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000));
  const chart = { chart: { result: [{ timestamp: timestamps, indicators: { quote: [{ close: [928, 930.84, 931.8, 940] }] } }] } };
  assert.equal(validExchangeDate('2026-02-30'), false);
  const sameDay = selectAudMarketRate(chart, '2026-10-27');
  assert.equal(sameDay.rate, 931.8);
  assert.equal(sameDay.rateDate, '2026-10-27');
  assert.equal(sameDay.carriedForward, false);
  const weekend = selectAudMarketRate(chart, '2026-10-25');
  assert.equal(weekend.rateDate, '2026-10-23');
  assert.equal(weekend.carriedForward, true);
});

test('AU analysis prompt distinguishes the second AWB PDF and never pre-seeds the target sample values', async () => {
  const { buildPrompt } = await importLocal('lib/importPackingPrompt.js');
  const prompt = buildPrompt('AU', { awbDocument: true });
  assert.match(prompt, /SECOND SOURCE DOCUMENT — AUSTRALIA AIR WAYBILL/);
  assert.match(prompt, /ONLY from the second PDF/);
  assert.match(prompt, /"gross_weight_kg":null/);
  assert.doesNotMatch(prompt, /805|081-63688774|packages":65/);
});

test('AU browser workflow requires both PDFs and blocks receipt until AWB is reviewed', () => {
  const packing = fs.readFileSync(path.join(root, 'components/import-tools/PackingListTool.js'), 'utf8');
  const workbench = fs.readFileSync(path.join(root, 'components/import-tools/InvoiceReceiptWorkbench.js'), 'utf8');
  const writer = fs.readFileSync(path.join(root, 'lib/invoiceReceiptWriter.js'), 'utf8');
  assert.match(packing, /country === 'AU' && !awbPdfBase64/);
  assert.match(packing, /awbReview\?\.ready \|\| !awbReviewed/);
  assert.match(packing, /invoiceUploadDate/);
  assert.match(workbench, /awbReviewed: Boolean\(awb\?\.confirmed && review\?\.ready\)/);
  assert.match(workbench, /grossWeightKg: review\?\.grossWeightKg/);
  assert.match(writer, /AWB_REVIEW_REQUIRED/);
  assert.match(writer, /AWB_PACKAGE_TOTAL_MISMATCH/);
});
