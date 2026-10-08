const assert = require('node:assert/strict');
const test = require('node:test');

const ready = import('../lib/importPackingReceiptAdapter.js');

function identifiedExcels(adapter, invoices, excels) {
  return excels.map((excel, index) => ({
    ...excel,
    sourceInvoiceIdentity: adapter.packingInvoiceSourceIdentity(invoices[index], index),
  }));
}

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
    excels: [{ products: [{ sourceName: '장미 다이아나', matchingDescription: '장미 다이아나 [family:ROSE] [length:60CM]', matchedName: 'ROSE CHINA / Diana 60cm', qty: 20 }] }],
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
  assert.deepEqual(document.lines.map(line => line.lineAmount), [10, 20]);
  assert.deepEqual(document.lines.map(line => line.sourceEvidence.derivedFields.lineAmount.formula), ['stems × price', 'stems × price']);
  assert.deepEqual(document.lines.map(line => line.prodKey), [50, 50]);
});

test('country source contracts preserve explicit quantities and record only deterministic derivations', async () => {
  const adapter = await ready;
  const fixtures = [
    { country: 'CN', currency: 'CNY', line: { description: 'CN RAW', pcs: 2, total_bunch: 20, total_stems: 200, u_price: 3.5, t_price: 70 },
      expected: { box: 2, bunch: 20, stem: 200, unitPrice: 3.5, amount: 70, priceUnit: '단', display: 20 } },
    { country: 'NL', currency: 'EUR', lines: true, line: { cl: 'CL2', description: 'NL RAW', stems: 10, price: 1.25 },
      expected: { box: null, bunch: null, stem: 10, unitPrice: 1.25, amount: 12.5, priceUnit: '송이', display: 10, derived: 'lineAmount' } },
    { country: 'CO', currency: 'USD', line: { description: 'CO RAW', pcs: 2, total_stems: 500, u_price: 0.4, t_price: 200 },
      expected: { box: 2, bunch: null, stem: 500, unitPrice: 0.4, amount: 200, priceUnit: '송이', display: 500 } },
    { country: 'EC', currency: 'USD', line: { description: 'EC RAW', total_stems: 300, u_price: 0.65, t_price: 195 },
      expected: { box: null, bunch: null, stem: 300, unitPrice: 0.65, amount: 195, priceUnit: '송이', display: 300 } },
    { country: 'TH', currency: 'USD', line: { description: 'TH RAW', bunch_st: 5, total_bunch: 20, u_price: 1, t_price: 100 },
      expected: { box: null, bunch: 20, stem: 100, unitPrice: 1, amount: 100, priceUnit: '송이', display: 100, derived: 'stemQuantity' } },
    { country: 'AU', currency: 'AUD', line: { description: 'AU RAW', pcs: 2, bunch_st: 5, total_bunch: 20, u_price: 2, t_price: 40 },
      expected: { box: 2, bunch: 20, stem: 100, unitPrice: 2, amount: 40, priceUnit: '단', display: 20, derived: 'stemQuantity' } },
    { country: 'US', currency: 'USD', line: { description: 'US RAW', pcs: 2, total_stems: 50, u_price: 12, t_price: 24 },
      expected: { box: 2, bunch: null, stem: 50, unitPrice: 12, amount: 24, priceUnit: '박스', display: 2 } },
    { country: 'VN', currency: 'USD', line: { description: 'VN RAW', total_stems: 32, u_price: 1, t_price: 32 },
      expected: { box: null, bunch: null, stem: 32, unitPrice: 1, amount: 32, priceUnit: '송이', display: 32 } },
  ];

  for (const [index, fixture] of fixtures.entries()) {
    const sourceHash = (index + 1).toString(16).repeat(64);
    const invoice = { invoice: `${fixture.country}-1`, supplier: `${fixture.country} supplier`, date: '2026/10/08', currency: fixture.currency,
      [fixture.lines ? 'lines' : 'products']: [fixture.line] };
    const targetName = `${fixture.country} ERP`;
    const generatedQuantity = fixture.country === 'CN' ? fixture.expected.bunch : fixture.expected.stem;
    const excel = { products: [{ sourceName: fixture.line.description, matchingDescription: fixture.line.description,
      matchedName: targetName, qty: generatedQuantity }] };
    const [document] = await adapter.adaptPackingReceipts({
      sourceHash, fileName: `2026_41-01_${fixture.country}.pdf`, country: fixture.country, reviewConfirmed: true,
      invoices: [invoice], excels: identifiedExcels(adapter, [invoice], [excel]),
      products: [{ ProdKey: index + 1, ProdName: targetName, country: fixture.country, selectable: true }],
    });
    const line = document.lines[0];
    assert.deepEqual({ box: line.boxQuantity, bunch: line.bunchQuantity, stem: line.stemQuantity,
      unitPrice: line.unitPrice, amount: line.lineAmount, priceUnit: line.priceUnit }, {
      box: fixture.expected.box, bunch: fixture.expected.bunch, stem: fixture.expected.stem,
      unitPrice: fixture.expected.unitPrice, amount: fixture.expected.amount, priceUnit: fixture.expected.priceUnit,
    }, fixture.country);
    assert.equal(adapter.receiptLineQuantity(line, fixture.country), fixture.expected.display, `${fixture.country} display quantity`);
    assert.equal(line.sourceEvidence.conversionValidation.status, 'MATCH', fixture.country);
    assert.equal(line.reviewed.confirmed, true, fixture.country);
    assert.deepEqual(document.sourceWarnings, [], fixture.country);
    if (fixture.expected.derived) assert.ok(line.sourceEvidence.derivedFields[fixture.expected.derived], fixture.country);
    else assert.deepEqual(line.sourceEvidence.derivedFields, {}, fixture.country);
  }
});

test('conversion quantity differences preserve source values and block automatic review confirmation', async () => {
  const adapter = await ready;
  const invoice = { invoice: 'CO-DELTA', supplier: 'Teucali', currency: 'USD', products: [
    { description: 'CARNATION RAW', pcs: 2, total_stems: 500, u_price: 0.4, t_price: 200 },
  ] };
  const excel = { products: [{ sourceName: 'CARNATION RAW', matchingDescription: 'CARNATION RAW', matchedName: 'CARNATION ERP', qty: 600 }] };
  const [document] = await adapter.adaptPackingReceipts({
    sourceHash: 'f'.repeat(64), fileName: '2026_41-01_CO.pdf', country: 'CO', reviewConfirmed: true,
    invoices: [invoice], excels: identifiedExcels(adapter, [invoice], [excel]),
    products: [{ ProdKey: 90, ProdName: 'CARNATION ERP', country: 'CO', selectable: true }],
  });
  const line = document.lines[0];
  assert.equal(line.stemQuantity, 500, 'generated 600 must never replace source 500');
  assert.equal(line.sourceEvidence.conversionValidation.status, 'MISMATCH');
  assert.deepEqual(line.sourceEvidence.conversionValidation.differences, [
    { field: 'stemQuantity', sourceValue: 500, generatedValue: 600 },
  ]);
  assert.equal(line.reviewed.confirmed, false);
  assert.deepEqual(document.sourceWarnings, [], 'resolvable conversion review must not become a permanent document warning');
});

test('invalid explicit numeric fields are preserved as review evidence and never replaced by derivation', async () => {
  const adapter = await ready;
  const fixtures = [
    {
      country: 'AU',
      invoice: { invoice: 'AU-INVALID-STEM', currency: 'AUD', products: [
        { description: 'AU RAW', pcs: 2, total_bunch: 20, bunch_st: 5, total_stems: 'not-a-number', u_price: 2, t_price: 40 },
      ] },
      excel: { products: [{ sourceName: 'AU RAW', matchingDescription: 'AU RAW', matchedName: 'AU ERP', qty: 100 }] },
      targetField: 'stemQuantity', sourceField: 'total_stems', rawValue: 'not-a-number', expectedQuantity: null,
    },
    {
      country: 'NL',
      invoice: { invoice: 'NL-INVALID-AMOUNT', currency: 'EUR', lines: [
        { description: 'NL RAW', stems: 10, price: 1.25, t_price: 'invalid-amount' },
      ] },
      excel: { products: [{ sourceName: 'NL RAW', matchingDescription: 'NL RAW', matchedName: 'NL ERP', qty: 10 }] },
      targetField: 'lineAmount', sourceField: 't_price', rawValue: 'invalid-amount', expectedQuantity: null,
    },
  ];

  for (const [index, fixture] of fixtures.entries()) {
    const [document] = await adapter.adaptPackingReceipts({
      sourceHash: (index + 10).toString(16).repeat(64), fileName: `2026_41-01_${fixture.country}.pdf`,
      country: fixture.country, reviewConfirmed: true, invoices: [fixture.invoice],
      excels: identifiedExcels(adapter, [fixture.invoice], [fixture.excel]),
      products: [{ ProdKey: index + 1, ProdName: `${fixture.country} ERP`, country: fixture.country, selectable: true }],
    });
    const line = document.lines[0];
    assert.equal(line[fixture.targetField], fixture.expectedQuantity, fixture.country);
    assert.deepEqual(line.sourceEvidence.sourceFieldStates[fixture.targetField], {
      field: fixture.sourceField,
      status: 'INVALID',
      rawValue: fixture.rawValue,
    });
    assert.deepEqual(line.sourceEvidence.invalidFields, [{
      targetField: fixture.targetField,
      sourceField: fixture.sourceField,
      status: 'INVALID_NUMBER',
      rawValue: fixture.rawValue,
    }]);
    assert.equal(line.sourceEvidence.derivedFields[fixture.targetField], undefined,
      `${fixture.country} invalid explicit value must not be replaced by a derived value`);
    assert.equal(line.reviewed.confirmed, false);
  }

  const blankInvoice = { invoice: 'NL-BLANK-AMOUNT', currency: 'EUR', lines: [
    { description: 'NL BLANK RAW', stems: 10, price: 1.25, t_price: '  ' },
  ] };
  const [blankDocument] = await adapter.adaptPackingReceipts({
    sourceHash: 'c'.repeat(64), fileName: '2026_41-01_NL.pdf', country: 'NL', reviewConfirmed: true,
    invoices: [blankInvoice],
    excels: identifiedExcels(adapter, [blankInvoice], [{ products: [
      { sourceName: 'NL BLANK RAW', matchingDescription: 'NL BLANK RAW', matchedName: 'NL ERP', qty: 10 },
    ] }]),
    products: [{ ProdKey: 3, ProdName: 'NL ERP', country: 'NL', selectable: true }],
  });
  assert.equal(blankDocument.lines[0].lineAmount, 12.5);
  assert.equal(blankDocument.lines[0].sourceEvidence.sourceFieldStates.lineAmount.status, 'BLANK');
  assert.equal(blankDocument.lines[0].sourceEvidence.derivedFields.lineAmount.trigger.status, 'BLANK');
  assert.deepEqual(blankDocument.lines[0].sourceEvidence.invalidFields, []);
  assert.equal(blankDocument.lines[0].reviewed.confirmed, true);
});

test('generated invoice identities support reordered results and reject missing or stale mappings', async () => {
  const adapter = await ready;
  const invoices = [
    { invoice: 'US-A', supplier: 'Hood Canal', date: '2026/10/08', currency: 'USD', products: [
      { description: 'A RAW', pcs: 1, total_stems: 20, u_price: 10, t_price: 10 },
    ] },
    { invoice: 'US-B', supplier: 'Hood Canal', date: '2026/10/09', currency: 'USD', products: [
      { description: 'B RAW', pcs: 2, total_stems: 40, u_price: 10, t_price: 20 },
    ] },
  ];
  const excels = identifiedExcels(adapter, invoices, [
    { products: [{ sourceName: 'A RAW', matchingDescription: 'A RAW', matchedName: 'A ERP', qty: 20 }] },
    { products: [{ sourceName: 'B RAW', matchingDescription: 'B RAW', matchedName: 'B ERP', qty: 40 }] },
  ]);
  const input = {
    sourceHash: '9'.repeat(64), fileName: '2026_41-01_US.pdf', country: 'US', invoices,
    products: [
      { ProdKey: 1, ProdName: 'A ERP', country: 'US', selectable: true },
      { ProdKey: 2, ProdName: 'B ERP', country: 'US', selectable: true },
    ],
  };
  const documents = await adapter.adaptPackingReceipts({ ...input, excels: [...excels].reverse() });
  assert.deepEqual(documents.map(document => document.lines[0].prodKey), [1, 2]);
  assert.deepEqual(documents.map(document => document.rawMetadata.sourceInvoiceIdentity.sourceInvoiceIndex), [0, 1]);

  await assert.rejects(adapter.adaptPackingReceipts({ ...input, excels: excels.map(excel => ({ ...excel, sourceInvoiceIdentity: null })) }), /번호가 누락되었거나 중복/);
  const stale = structuredClone(excels);
  stale[0].sourceInvoiceIdentity.invoiceNo = 'WRONG';
  await assert.rejects(adapter.adaptPackingReceipts({ ...input, excels: stale }), /식별자가 다릅니다/);
});

test('ambiguous generated targets never fall back to source line position', async () => {
  const adapter = await ready;
  const invoice = { invoice: 'US-AMB', currency: 'USD', products: [
    { description: 'SAME RAW', pcs: 1, total_stems: 20, u_price: 10, t_price: 10 },
  ] };
  const excel = { products: [
    { sourceName: 'SAME RAW', matchingDescription: 'SAME RAW', matchedName: 'TARGET A', qty: 20 },
    { sourceName: 'SAME RAW', matchingDescription: 'SAME RAW', matchedName: 'TARGET B', qty: 20 },
  ] };
  const [document] = await adapter.adaptPackingReceipts({
    sourceHash: '8'.repeat(64), fileName: '2026_41-01_US.pdf', country: 'US', reviewConfirmed: true,
    invoices: [invoice], excels: identifiedExcels(adapter, [invoice], [excel]),
    products: [
      { ProdKey: 1, ProdName: 'TARGET A', country: 'US', selectable: true },
      { ProdKey: 2, ProdName: 'TARGET B', country: 'US', selectable: true },
    ],
  });
  assert.equal(document.lines[0].prodKey, null);
  assert.equal(document.lines[0].sourceEvidence.generatedMatchedName, null);
  assert.equal(document.lines[0].reviewed.confirmed, false);
});
