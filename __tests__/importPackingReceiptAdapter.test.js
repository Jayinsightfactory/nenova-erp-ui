const assert = require('node:assert/strict');
const test = require('node:test');

const ready = import('../lib/importPackingReceiptAdapter.js');

test('receipt part identity is generated once and reused from the latest committed revision', async () => {
  const adapter = await ready;
  let generated = 0;
  const createId = () => { generated += 1; return 'initial-part'; };
  assert.equal(adapter.receiptPartIdForCommit({ operations: [] }, createId), 'initial-part');
  assert.equal(generated, 1);

  const document = { operations: [
    { status: 'COMMITTED', documentRevision: 1, receiptPartId: 'part-one', createdAt: '2026-10-08T01:00:00Z' },
    { status: 'FAILED', documentRevision: 4, receiptPartId: 'failed-part', createdAt: '2026-10-08T04:00:00Z' },
    { status: 'COMMITTED', documentRevision: 3, receiptPartId: 'part-three', createdAt: '2026-10-08T03:00:00Z' },
  ] };
  assert.equal(adapter.receiptPartIdForCommit(document, createId), 'part-three');
  assert.equal(generated, 1, 'revision commit must not generate a different receipt part');

  assert.throws(() => adapter.receiptPartIdForCommit({ operations: [
    { status: 'COMMITTED', documentRevision: 2, receiptPartId: null },
  ] }, createId), /기존 입고 식별자가 없어/);
  assert.equal(generated, 1);
});

test('commit recovery persists the exact request and clears only verified 4xx rollbacks', async () => {
  const adapter = await ready;
  const pending = adapter.buildReceiptCommitPending({
    document: { documentId: 'doc-id', revision: 7 },
    preview: { baselineDigest: 'baseline-seven' },
    reason: '  reviewed reason  ',
    operationId: 'operation-seven',
    receiptPartId: 'part-seven',
  });
  assert.deepEqual(pending, {
    documentId: 'doc-id',
    operationId: 'operation-seven',
    receiptPartId: 'part-seven',
    requestBody: {
      revision: 7,
      operationId: 'operation-seven',
      receiptPartId: 'part-seven',
      baselineDigest: 'baseline-seven',
      reason: 'reviewed reason',
      allowPendingCost: true,
    },
  });
  assert.equal(adapter.isVerifiedReceiptCommitRejection({ httpStatus: 409, resultUnknown: false }), true);
  assert.equal(adapter.isVerifiedReceiptCommitRejection({ httpStatus: 409 }), false);
  assert.equal(adapter.isVerifiedReceiptCommitRejection({ httpStatus: 503, resultUnknown: true }), false);
  assert.equal(adapter.isVerifiedReceiptCommitRejection(new TypeError('network')), false);
});

test('hashes the original file bytes and creates stable UUIDv8 document and line identities', async () => {
  const adapter = await ready;
  const file = { arrayBuffer: async () => new TextEncoder().encode('original invoice bytes').buffer };
  const sourceHash = await adapter.sha256File(file);
  assert.match(sourceHash, /^[a-f0-9]{64}$/);

  const input = {
    sourceHash,
    fileName: '2026_41-01_CN.xlsx',
    country: 'CN', reviewConfirmed: true,
    invoices: [{ invoice: 'CN-1', date: '2026/10/08', currency: 'CNY', products: [
      { description: '장미 다이아나 [family:ROSE] [length:60CM]', source_description: '장미 다이아나', source_row: 12,
        pcs: 2, total_bunch: 20, total_stems: 200, u_price: 3.5, t_price: 70, stem_length: '60cm' },
    ] }],
    excels: [{ products: [{ sourceName: '장미 다이아나', matchingDescription: '장미 다이아나 [family:ROSE] [length:60CM]', matchedName: 'ROSE CHINA / Diana 60cm', qty: 999 }] }],
    products: [{ ProdKey: 77, ProdName: 'ROSE CHINA / Diana 60cm', country: 'CN', selectable: true }],
  };
  const first = await adapter.adaptPackingReceipts(input);
  const second = await adapter.adaptPackingReceipts(input);
  assert.equal(first[0].documentId, second[0].documentId);
  assert.equal(first[0].lines[0].lineId, second[0].lines[0].lineId);
  assert.match(first[0].documentId, /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(first[0].orderYear, '2026');
  assert.equal(first[0].orderWeek, '41-01');
  assert.equal(first[0].invoiceYear, '2026');
  assert.deepEqual(first[0].lines[0].reviewed, { confirmed: true });
});

test('uses original numeric invoice quantities and generated products only for unique ProdKey resolution', async () => {
  const adapter = await ready;
  const sourceHash = 'a'.repeat(64);
  const [china] = await adapter.adaptPackingReceipts({
    sourceHash, fileName: '41-01.xlsx', country: 'CN',
    invoices: [{ invoice: 'CN', currency: 'CNY', products: [
      { description: 'CN RAW', pcs: 3, total_bunch: 14, total_stems: 140, u_price: 2, t_price: 28 },
    ] }],
    excels: [{ products: [{ sourceName: 'CN RAW', matchingDescription: 'CN RAW', matchedName: 'CN ERP', qty: 777, boxes: 999, stems: 9999 }] }],
    products: [{ ProdKey: 10, ProdName: 'CN ERP', country: 'CN', selectable: true }],
  });
  assert.deepEqual({ box: china.lines[0].boxQuantity, bunch: china.lines[0].bunchQuantity, stem: china.lines[0].stemQuantity },
    { box: 3, bunch: 14, stem: 140 });
  assert.equal(adapter.receiptLineQuantity(china.lines[0], 'CN'), 14, 'China ERP quantity is bunches');
  assert.equal(china.lines[0].prodKey, 10);
  assert.equal(china.lines[0].priceUnit, '단');

  const [other] = await adapter.adaptPackingReceipts({
    sourceHash: 'b'.repeat(64), fileName: '41-01.pdf', country: 'TH',
    invoices: [{ invoice: 'TH', products: [{ description: 'ORCHID', total_bunch: 5, u_price: 1, t_price: 50 }] }],
    excels: [{ products: [{ sourceName: 'ORCHID', matchingDescription: 'ORCHID', name: 'ORCHID ERP', qty: 50 }] }],
    products: [{ ProdKey: 11, ProdName: 'ORCHID ERP', country: 'TH', selectable: true }],
  });
  assert.equal(other.lines[0].bunchQuantity, 5);
  assert.equal(other.lines[0].stemQuantity, null, 'missing non-China stem quantity must not become generated qty or zero');
  assert.equal(adapter.receiptLineQuantity(other.lines[0], 'TH'), null);
  assert.equal(other.lines[0].currency, null, 'country must not imply a currency');
});

test('does not resolve duplicate or non-selectable product names', async () => {
  const adapter = await ready;
  assert.equal(adapter.resolveUniqueProdKey('SAME', [
    { ProdKey: 1, ProdName: 'SAME', country: 'CO', selectable: false },
    { ProdKey: 2, ProdName: 'SAME', country: 'CO', selectable: false },
  ], 'CO'), null);
  assert.equal(adapter.resolveUniqueProdKey('SAME', [{ ProdKey: 3, ProdName: 'SAME', country: 'EC', selectable: true }], 'CO'), null);
  assert.equal(adapter.resolveUniqueProdKey('SAME', [{ ProdKey: 4, ProdName: 'SAME', country: 'CO', selectable: true }], 'CO'), 4);
});

test('keeps explicit zero distinct from missing values in the draft API payload', async () => {
  const adapter = await ready;
  const document = {
    documentId: '11111111-1111-8111-8111-111111111111', revision: 2,
    sourceHash: 'c'.repeat(64), originalFileName: 'invoice.pdf', orderYear: '2026', orderWeek: '41-01',
    farmKey: 9, invoiceNo: ' INV-1 ', invoiceYear: '2026', rawMetadata: {},
    reviewedMetadata: { inputDate: '', country: 'CO', gw: 0, cw: '', freightCurrency: 'USD', freightRate: 0, docFee: '' },
    lines: [{ lineId: '22222222-2222-8222-8222-222222222222', lineNo: 1, originalName: 'ROSE', lengthText: '',
      prodKey: 20, boxQuantity: 0, bunchQuantity: '', stemQuantity: null, priceUnit: '송이', unitPrice: 0,
      currency: '', lineAmount: 0, sourceEvidence: {}, reviewed: false }],
  };
  const payload = adapter.toReceiptDraftPayload(document, '검토 저장');
  assert.equal(payload.expectedRevision, 2);
  assert.equal(payload.reviewedMetadata.gw, 0);
  assert.equal(payload.reviewedMetadata.cw, null);
  assert.equal(payload.reviewedMetadata.freightRate, 0);
  assert.equal(payload.reviewedMetadata.docFee, null);
  assert.equal(payload.lines[0].boxQuantity, 0);
  assert.equal(payload.lines[0].bunchQuantity, null);
  assert.equal(payload.lines[0].unitPrice, 0);
  assert.equal(payload.lines[0].lineAmount, 0);
  assert.equal(payload.lines[0].currency, null);
  assert.deepEqual(payload.lines[0].reviewed, { confirmed: false });
});

test('routes non-USD freight to costInputs and never to ERP header freight fields', async () => {
  const adapter = await ready;
  const [document] = await adapter.adaptPackingReceipts({
    sourceHash: 'e'.repeat(64), fileName: '41-01.xlsx', country: 'CN', reviewConfirmed: true,
    invoices: [{ invoice: 'CN-COST', currency: 'CNY', freight: 125.5, products: [
      { description: 'CN RAW', total_bunch: 2, u_price: 3, t_price: 6 },
    ] }],
    excels: [{ products: [{ sourceName: 'CN RAW', matchingDescription: 'CN RAW', matchedName: 'CN ERP' }] }],
    products: [{ ProdKey: 99, ProdName: 'CN ERP', country: 'CN', selectable: true }],
  });
  assert.equal(document.reviewedMetadata.freightRate, null);
  assert.deepEqual(document.reviewedMetadata.costInputs.freight, { currency: 'CNY', amount: 125.5, source: 'invoice' });
  const payload = adapter.toReceiptDraftPayload(document);
  assert.equal(payload.reviewedMetadata.freightRate, null);
  assert.equal(payload.reviewedMetadata.docFee, null);
  assert.equal(payload.reviewedMetadata.costInputs.freight.amount, 125.5);
});

test('keeps reviewed USD freight total out of the per-kg ERP header and never invents CW from net weight', async () => {
  const adapter = await ready;
  const [document] = await adapter.adaptPackingReceipts({
    sourceHash: 'f'.repeat(64), fileName: '2026_41-01_CO.pdf', country: 'CO', reviewConfirmed: true,
    invoices: [{ invoice: 'CO-USD-TOTAL', currency: 'USD', freight_total: 420, gross_weight: 150, net_weight: 120, products: [
      { description: 'CO RAW', total_stems: 10, u_price: 2, t_price: 20 },
    ] }],
    excels: [{ products: [{ sourceName: 'CO RAW', matchingDescription: 'CO RAW', matchedName: 'CO ERP' }] }],
    products: [{ ProdKey: 100, ProdName: 'CO ERP', country: 'CO', selectable: true }],
  });
  assert.equal(document.reviewedMetadata.freightRate, null, 'invoice freight total is not USD/kg');
  assert.deepEqual(document.reviewedMetadata.costInputs.freight, { currency: 'USD', amount: 420, source: 'invoice' });
  assert.equal(document.reviewedMetadata.cw, null, 'net weight is not chargeable weight');
  assert.equal(document.rawMetadata.chargeableWeight, null);
  const payload = adapter.toReceiptDraftPayload(document);
  assert.equal(payload.reviewedMetadata.freightRate, null);
  assert.equal(payload.reviewedMetadata.costInputs.freight.amount, 420);

  const [explicitCw] = await adapter.adaptPackingReceipts({
    sourceHash: '1'.repeat(64), fileName: '2026_41-01_CO.pdf', country: 'CO',
    invoices: [{ invoice: 'CO-CW', currency: 'USD', chargeable_weight: 135, products: [] }],
    excels: [{ products: [] }], products: [],
  });
  assert.equal(explicitCw.reviewedMetadata.cw, 135);
  assert.equal(explicitCw.rawMetadata.chargeableWeight, 135);
});

test('keeps each original source line separate even when a formatter aggregated its display row', async () => {
  const adapter = await ready;
  const [document] = await adapter.adaptPackingReceipts({
    sourceHash: 'd'.repeat(64), fileName: '41-01.pdf', country: 'NL',
    invoices: [{ invoice: 'NL-1', currency: 'EUR', lines: [
      { cl: 'CL2', description: 'TULIP RAW', stems: 10, price: 1 },
      { cl: 'CL2', description: 'TULIP RAW', stems: 20, price: 1 },
    ] }],
    excels: [{ products: [{ sourceName: 'TULIP RAW', matchingDescription: 'TULIP RAW', name: 'TULIP ERP', qty: 30 }] }],
    products: [{ ProdKey: 50, ProdName: 'TULIP ERP', country: 'NL', selectable: true }],
  });
  assert.equal(document.lines.length, 2);
  assert.notEqual(document.lines[0].lineId, document.lines[1].lineId);
  assert.deepEqual(document.lines.map(line => line.stemQuantity), [10, 20]);
  assert.deepEqual(document.lines.map(line => line.prodKey), [50, 50]);
});
