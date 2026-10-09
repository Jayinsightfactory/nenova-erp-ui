const test = require('node:test');
const assert = require('node:assert/strict');

test('model-supplied year without a matching four-digit source quote cannot resolve a two-digit date', async () => {
  const { normalizePackingMetadata } = await import('../lib/importPackingMetadata.js');
  const base = { raw_date: '17/04/26', date_order: 'DMY', date_kind: 'invoice', date: '2026/04/17',
    currency: 'USD', invoice_total: 10, freight_total: 0, products: [{ t_price: 10 }] };
  for (const evidence of [2026, '2026', { year: 2026, quote: 'Invoice date 17/04/26' },
    { year: 2026, quote: 'Number 120260' }]) {
    const result = normalizePackingMetadata({ ...base, date_year_evidence: evidence }, 'CO');
    assert.ok(result.extractionIssues.some(issue => issue.code === 'DATE_YEAR_AMBIGUOUS'));
  }
  const verified = normalizePackingMetadata({ ...base,
    date_year_evidence: { year: 2026, quote: 'Printed invoice year: 2026' } }, 'CO');
  assert.deepEqual(verified.extractionIssues, []);
});

test('unresolved metadata cannot become receipt inputs even when generic review is checked', async () => {
  const { adaptPackingReceipts } = await import('../lib/importPackingReceiptAdapter.js');
  for (const year of [2025, 2026]) {
    await assert.rejects(adaptPackingReceipts({
      sourceHash: 'a'.repeat(64), country: 'CO', fileName: `${year}_33-01.pdf`, reviewConfirmed: true,
      invoices: [{ date: `${year}/04/17`, products: [], extractionIssues: [{ code: 'DATE_CONFLICT' }] }],
    }), /날짜·통화·총액 확인/);
  }
});

test('legacy CN raw units cannot bypass confirmation through generator or receipt adapter', async () => {
  const { genChina } = await import('../lib/importPacking.js');
  const { adaptPackingReceipts } = await import('../lib/importPackingReceiptAdapter.js');
  const invoice = { source_format: 'china_legacy_invoice_xlsx', products: [{ description: '500g flower', raw_qty: 20 }] };
  assert.throws(() => genChina({}, invoice, '33', '01'), /단위·통화 확인/);
  await assert.rejects(adaptPackingReceipts({
    sourceHash: 'b'.repeat(64), country: 'CN', reviewConfirmed: true, invoices: [invoice],
  }), /수량 단위·통화 검토/);
});

test('review-only and unresolved results cannot download using amount override', async () => {
  const { isPackingDownloadBlocked } = await import('../lib/importPackingState.js');
  assert.equal(isPackingDownloadBlocked({ reviewOnly: true, products: [] }), true);
  assert.equal(isPackingDownloadBlocked({ extractionIssues: [{ code: 'CURRENCY_UNAVAILABLE' }], products: [] }), true);
});

test('legacy source -> explicit units -> native packing -> receipt draft preserves quantities and mixed fees', async () => {
  const XLSX = require('xlsx-js-style');
  const { parseChinaInvoiceWorkbook } = await import('../lib/importChinaInvoice.js');
  const { parsePackingResponse } = await import('../lib/importPackingResponse.js');
  const { resolveLegacyChinaInvoice } = await import('../lib/importChinaLegacyReview.js');
  const { genChina } = await import('../lib/importPacking.js');
  const { indexPackingCatalog } = await import('../lib/importPackingState.js');
  const { adaptPackingReceipts } = await import('../lib/importPackingReceiptAdapter.js');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['昆明润和花卉种植有限公司'], ['Kunming Runhe Flowers Planting Co.Ltd'], ['TO: Nenova'],
    ['DATE:2025-4-27', null, null, null, 'INVOICE NO.TEST-ONLY'],
    ['品    名', '英  文  名', '数量Qty', '单价PRICE', '金额AMOUNT', '规格BU/PCS'],
    ['测试', 'CARNATION Test', 20, 2, 40, '500g'],
    ['花款合计', 'Total Flower amounts', 20, null, 40],
    ['', 'BOX', 2, 5, 10],
    ['总计 Total amounts', null, null, null, 50],
  ]), 'Invoice');
  const [source] = parsePackingResponse(parseChinaInvoiceWorkbook(XLSX,
    XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })), 'CN').result.invoices;
  const inv = resolveLegacyChinaInvoice(source, {
    currency: { code: 'CNY', reason: 'synthetic explicit currency confirmation', confirmed: true },
    invoiceConfirmed: true, comparisonConfirmed: true,
    rows: source.products.map(p => ({ source_sheet: p.source_sheet, source_row: p.source_row,
      raw_qty: p.raw_qty, u_price: p.unitPrice, t_price: p.t_price, source_unit_spec: p.source_unit_spec,
      raw_unit: '단', pcs: 2, total_stems: 100, reason: 'explicit fixture quantity, not derived from 500g', confirmed: true })),
  });
  const excel = genChina(XLSX, inv, '18', '01', {
    catalog: indexPackingCatalog({ items: [{ name: 'CARNATION Test', country: 'CN' }] }),
  });
  assert.equal(excel.totalMismatch, null);
  assert.equal(excel.products[0].qty, 20);
  assert.equal(excel.products[0].boxes, 2);
  assert.equal(excel.products[0].stems, 100);
  assert.equal(excel.invoiceTotal, 50);
  const [draft] = await adaptPackingReceipts({ sourceHash: 'c'.repeat(64), country: 'CN',
    fileName: '2025_18-01.xlsx', invoices: [inv], excels: [excel], reviewConfirmed: true,
    products: [{ ProdKey: 1, ProdName: 'CARNATION Test', country: 'CN', selectable: true }],
  });
  assert.equal(draft.lines[0].bunchQuantity, 20);
  assert.equal(draft.lines[0].stemQuantity, 100);
  assert.equal(draft.lines[0].unitPrice, 2);
  assert.equal(draft.lines[0].lineAmount, 40);
  assert.equal(draft.reviewedMetadata.costInputs.freight, undefined);
  assert.equal(draft.reviewedMetadata.unclassifiedAdditionalCharges.amount, 10);
  assert.ok(draft.rawMetadata.legacyReview);
});

test('explicit AI action makes one request; failure never automatically fans out or retries', async () => {
  const { extractPackingDocument } = await import('../lib/importPackingExtractClient.js');
  for (const status of [429, 502, 504]) {
    let calls = 0;
    await assert.rejects(extractPackingDocument({ country: 'CO', pdfBase64: 'fixture', allowAI: true,
      fetchImpl: async () => { calls++; return new Response(JSON.stringify({ error: 'fixture failure' }), { status }); },
    }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await extractPackingDocument({ country: 'CO', pdfBase64: 'fixture', allowAI: false,
    fetchImpl: async () => { calls++; throw new Error('must not call'); },
  });
  assert.equal(calls, 0, 'no paid request without explicit action');
});
