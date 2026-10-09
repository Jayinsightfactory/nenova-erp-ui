const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const XLSX = require('xlsx-js-style');

const ready = import('../lib/importChinaLegacyReview.js');
const integrationReady = Promise.all([
  ready,
  import('../lib/importChinaInvoice.js'),
  import('../lib/importPackingResponse.js'),
]);

function product(overrides = {}) {
  return {
    source_format: 'china_legacy_invoice_xlsx',
    source_sheet: 'Invoice 日报表',
    source_row: 6,
    description: 'Rose-AVALANCHE(WHITE)',
    description_cn: '雪山',
    raw_qty: 20,
    source_unit_spec: '10pcs',
    unitPrice: 16,
    t_price: 320,
    amount_matches: true,
    unit_review_required: true,
    reviewed: false,
    source_cells: {
      raw_qty: { address: 'C6', value: 20 },
      unitPrice: { address: 'D6', value: 16 },
      t_price: { address: 'E6', value: 320, formula: 'C6*D6' },
      source_unit_spec: { address: 'F6', value: '10pcs' },
    },
    ...overrides,
  };
}

function source(overrides = {}) {
  const products = overrides.products || [
    product(),
    product({
      source_row: 7,
      description: 'Limonium-Clear Diamond(WHITE)',
      description_cn: '水晶花',
      raw_qty: 5,
      source_unit_spec: '500g',
      unitPrice: 12,
      t_price: 60,
      source_cells: {
        raw_qty: { address: 'C7', value: 5 },
        unitPrice: { address: 'D7', value: 12 },
        t_price: { address: 'E7', value: 60, formula: 'C7*D7' },
        source_unit_spec: { address: 'F7', value: '500g' },
      },
    }),
  ];
  const additionalCosts = overrides.additional_costs || [{
    source_sheet: 'Invoice 日报表',
    source_row: 9,
    description: 'BOX',
    raw_qty: 1,
    unitPrice: 23,
    amount: 23,
    amount_matches: true,
    source_cells: { amount: { address: 'E9', value: 23, formula: 'C9*D9' } },
  }];
  const itemSubtotal = products.reduce((sum, row) => sum + row.t_price, 0);
  const freight = additionalCosts.reduce((sum, row) => sum + row.amount, 0);
  return {
    source_format: 'china_legacy_invoice_xlsx',
    source_sheet: 'Invoice 日报表',
    invoice: '005',
    supplier: 'Kunming Runhe Flowers Planting Co.Ltd',
    date: '2025/05/13',
    raw_date: '2025-05-13',
    date_kind: 'invoice',
    date_order: 'YMD',
    currency: null,
    products,
    additional_costs: additionalCosts,
    item_subtotal: itemSubtotal,
    freight,
    invoice_total: itemSubtotal + freight,
    total_value: itemSubtotal + freight,
    arithmetic_verified: true,
    independent_totals: {
      products: { printed: itemSubtotal, computed: itemSubtotal, amount_matches: true },
      fees: { printed: freight, computed: freight, amount_matches: true },
      grand: { printed: itemSubtotal + freight, computed: itemSubtotal + freight, amount_matches: true },
    },
    review_required: true,
    review_status: 'LEGACY_CN_REVIEW_REQUIRED',
    review_states: [
      'LEGACY_CN_REVIEW_REQUIRED',
      'UNIT_REVIEW_REQUIRED',
      'CURRENCY_REVIEW_REQUIRED',
      'CL_CONFLICT_REVIEW_REQUIRED',
    ],
    packing_comparison_status: 'CL_CONFLICT_REVIEW_REQUIRED',
    packing_comparisons: [{
      sheet_name: 'Packing list_CL1',
      authority: 'COMPARISON_ONLY',
      range: 'A1:F3',
    }],
    extractionIssues: [{
      code: 'CURRENCY_UNAVAILABLE',
      field: 'currency',
      severity: 'review_required',
      message: 'currency review required',
    }],
    original_rows: [{ row: 6, cells: [{ address: 'C6', value: 20 }] }],
    ...overrides,
  };
}

function resolution(overrides = {}) {
  return {
    currency: { code: 'CNY', reason: 'Invoice 거래 통화를 공급처와 확인함', confirmed: true },
    rows: [
      {
        source_sheet: 'Invoice 日报表',
        source_row: 6,
        raw_qty: 20,
        u_price: 16,
        t_price: 320,
        source_unit_spec: '10pcs',
        raw_unit: '단',
        pcs: 2,
        total_stems: 200,
        reason: '수량 20은 20단임을 원문과 공급처로 확인함',
        confirmed: true,
      },
      {
        source_sheet: 'Invoice 日报表',
        source_row: 7,
        raw_qty: 5,
        u_price: 12,
        t_price: 60,
        source_unit_spec: '500g',
        raw_unit: '단',
        pcs: 1,
        total_stems: 50,
        reason: '500g 표기를 환산하지 않고 원수량 5가 5단임을 별도 확인함',
        confirmed: true,
      },
    ],
    invoiceConfirmed: true,
    comparisonConfirmed: true,
    ...overrides,
  };
}

async function rejectsWith(sourceValue, resolutionValue, code) {
  const { resolveLegacyChinaInvoice } = await ready;
  assert.throws(
    () => resolveLegacyChinaInvoice(sourceValue, resolutionValue),
    error => error instanceof Error && error.message.startsWith(`${code}:`),
  );
}

async function reviewedInvoice() {
  const { resolveLegacyChinaInvoice } = await ready;
  return resolveLegacyChinaInvoice(source(), resolution());
}

async function gateRejects(mutate, code = 'LEGACY_REVIEW_GATE_STALE') {
  const { assertLegacyChinaReviewed } = await ready;
  const reviewed = await reviewedInvoice();
  mutate(reviewed);
  assert.throws(
    () => assertLegacyChinaReviewed(reviewed),
    error => error instanceof Error && error.message.startsWith(`${code}:`),
  );
}

test('promotes only a fully confirmed legacy invoice to reviewed native quantities without mutation', async () => {
  const { resolveLegacyChinaInvoice, CHINA_LEGACY_REVIEWED_SOURCE_FORMAT } = await ready;
  const input = source();
  const review = resolution();
  const inputSnapshot = structuredClone(input);
  const reviewSnapshot = structuredClone(review);

  const result = resolveLegacyChinaInvoice(input, review);

  assert.deepEqual(input, inputSnapshot);
  assert.deepEqual(review, reviewSnapshot);
  assert.equal(result.source_format, CHINA_LEGACY_REVIEWED_SOURCE_FORMAT);
  assert.equal(result.review_status, 'LEGACY_CN_REVIEWED');
  assert.equal(result.review_required, false);
  assert.equal(result.unit_review_required, false);
  assert.deepEqual(result.review_states, []);
  assert.equal(result.currency, 'CNY');
  assert.equal(result.date, '2025/05/13');
  assert.equal(result.raw_date, '2025-05-13');
  assert.equal(result.date_kind, 'invoice');
  assert.equal(result.date_order, 'YMD');
  assert.deepEqual(result.extractionIssues, []);
  assert.equal(result.packing_comparison_status, 'INVOICE_AUTHORITY_CONFIRMED');

  assert.deepEqual(result.products.map(row => ({
    format: row.source_format,
    raw_qty: row.raw_qty,
    source_unit_spec: row.source_unit_spec,
    unitPrice: row.unitPrice,
    u_price: row.u_price,
    t_price: row.t_price,
    pcs: row.pcs,
    total_bunch: row.total_bunch,
    total_stems: row.total_stems,
    bunch_st: row.bunch_st,
    steam_box: row.steam_box,
  })), [
    {
      format: CHINA_LEGACY_REVIEWED_SOURCE_FORMAT,
      raw_qty: 20,
      source_unit_spec: '10pcs',
      unitPrice: 16,
      u_price: 16,
      t_price: 320,
      pcs: 2,
      total_bunch: 20,
      total_stems: 200,
      bunch_st: 10,
      steam_box: 100,
    },
    {
      format: CHINA_LEGACY_REVIEWED_SOURCE_FORMAT,
      raw_qty: 5,
      source_unit_spec: '500g',
      unitPrice: 12,
      u_price: 12,
      t_price: 60,
      pcs: 1,
      total_bunch: 5,
      total_stems: 50,
      bunch_st: 10,
      steam_box: 50,
    },
  ]);
  assert.equal(result.products[0].source_cells.t_price.formula, 'C6*D6');
  assert.deepEqual(
    [result.total_boxes, result.total_bunches, result.total_stems],
    [3, 25, 250],
  );
  assert.equal(result.additional_costs[0].amount, 23);
  assert.equal(result.additional_costs[0].quantity, 1);
  assert.equal(result.additional_costs[0].unitPrice, 23);
  assert.equal(result.additional_costs[0].unit_price, 23);

  assert.deepEqual(result.legacyReview.sourceInvoice, {
    invoice: '005',
    source_sheet: 'Invoice 日报表',
    date: '2025/05/13',
    raw_date: '2025-05-13',
    supplier: 'Kunming Runhe Flowers Planting Co.Ltd',
    source_format: 'china_legacy_invoice_xlsx',
  });
  assert.equal(result.legacyReview.invoiceConfirmed, true);
  assert.equal(result.legacyReview.comparisonConfirmed, true);
  assert.equal(result.legacyReview.comparison.authority, 'INVOICE');
  assert.equal(result.legacyReview.comparison.source_status, 'CL_CONFLICT_REVIEW_REQUIRED');
  assert.deepEqual(result.legacyReview.comparison.sheets, [{
    sheet_name: 'Packing list_CL1',
    authority: 'COMPARISON_ONLY',
    range: 'A1:F3',
  }]);
  assert.equal(result.legacyReview.currency.reason, review.currency.reason);
  assert.equal(result.legacyReview.rows[0].source_snapshot.unitPrice, 16);
  assert.equal(result.legacyReview.rows[1].source_snapshot.source_unit_spec, '500g');
  assert.deepEqual(result.legacyReview.rows[0].derived, {
    total_bunch: 20,
    bunch_st: 10,
    steam_box: 100,
  });
});

test('accepts the deterministic legacy workbook parser output without an adapter', async () => {
  const [reviewer, parser, response] = await integrationReady;
  const rows = [
    ['昆明润和花卉种植有限公司'],
    ['Kunming Runhe Flowers Planting Co.Ltd'],
    ['TO: Nenova'],
    ['DATE:2025-5-13', null, null, null, 'INVOICE NO.005'],
    ['品    名', '英  文  名', '数量Qty', '单价PRICE', '金额AMOUNT', '规格BU/PCS'],
    ['雪山', 'Rose-AVALANCHE(WHITE)', 20, 16, 320, '10pcs'],
    ['花款合计', 'Total Flower amounts', 20, null, 320],
    ['纸箱', 'BOX', 1, 23, 23, '102*42*25'],
    ['总计 Total amounts', null, null, null, 343],
    ['Grand Total: 2boxes 20KG'],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws.E6.f = 'C6*D6';
  ws.C7.f = 'SUM(C6:C6)';
  ws.E7.f = 'SUMPRODUCT(C6:C6,D6:D6)';
  ws.E8.f = 'C8*D8';
  ws.E9.f = 'SUM(E7:E8)';
  XLSX.utils.book_append_sheet(wb, ws, 'Invoice 日报表');
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  const parsed = parser.parseChinaInvoiceWorkbook(XLSX, base64);
  const decoded = response.parsePackingResponse(parsed, 'CN').result.invoices[0];
  const reviewed = reviewer.resolveLegacyChinaInvoice(decoded, {
    currency: { code: 'CNY', reason: '공급처 확인', confirmed: true },
    rows: [{
      source_sheet: decoded.products[0].source_sheet,
      source_row: decoded.products[0].source_row,
      raw_qty: decoded.products[0].raw_qty,
      u_price: decoded.products[0].unitPrice,
      t_price: decoded.products[0].t_price,
      source_unit_spec: decoded.products[0].source_unit_spec,
      raw_unit: '단',
      pcs: 2,
      total_stems: 200,
      reason: '원문 수량이 단 단위임을 확인',
      confirmed: true,
    }],
    invoiceConfirmed: true,
    comparisonConfirmed: true,
  });

  assert.equal(reviewed.source_format, 'china_legacy_invoice_reviewed');
  assert.equal(reviewed.products[0].source_format, 'china_legacy_invoice_reviewed');
  assert.deepEqual(
    [reviewed.products[0].pcs, reviewed.products[0].total_bunch, reviewed.products[0].total_stems],
    [2, 20, 200],
  );
  assert.deepEqual(
    [reviewed.total_boxes, reviewed.total_bunches, reviewed.total_stems],
    [2, 20, 200],
  );
  assert.equal(reviewed.additional_costs[0].amount, 23);
  assert.equal(reviewed.additional_costs[0].quantity, 1);
  assert.equal(reviewed.additional_costs[0].unit_price, 23);
});

test('additional-cost generation fields use nullish quantity fallback and preserve explicit zero', async () => {
  const { resolveLegacyChinaInvoice, assertLegacyChinaReviewed } = await ready;
  const zeroFee = {
    source_sheet: 'Invoice 日报表',
    source_row: 9,
    description: 'BOX',
    raw_qty: 0,
    quantity: 0,
    unitPrice: 23,
    amount: 0,
    amount_matches: true,
  };
  const reviewed = resolveLegacyChinaInvoice(source({ additional_costs: [zeroFee] }), resolution());
  assert.equal(reviewed.additional_costs[0].quantity, 0);
  assert.equal(reviewed.additional_costs[0].unit_price, 23);
  assert.equal(reviewed.additional_costs[0].amount, 0);
  assert.equal(assertLegacyChinaReviewed(reviewed), true);

  const stringQuantity = source();
  stringQuantity.additional_costs[0].quantity = '1';
  await rejectsWith(stringQuantity, resolution(), 'LEGACY_ARITHMETIC_UNVERIFIED');

  const staleZero = source();
  staleZero.additional_costs[0].quantity = 0;
  await rejectsWith(staleZero, resolution(), 'LEGACY_ARITHMETIC_UNVERIFIED');
});

test('shared reviewed gate accepts resolver output and blocks renamed legacy payloads', async () => {
  const { assertLegacyChinaReviewed } = await ready;
  const reviewed = await reviewedInvoice();
  assert.equal(assertLegacyChinaReviewed(reviewed), true);

  const renamed = source({ source_format: 'china_legacy_invoice_reviewed' });
  for (const row of renamed.products) row.source_format = 'china_legacy_invoice_reviewed';
  assert.throws(
    () => assertLegacyChinaReviewed(renamed),
    error => error instanceof Error && error.message.startsWith('LEGACY_REVIEW_GATE_INVALID:'),
  );
  const missingAudit = structuredClone(reviewed);
  delete missingAudit.legacyReview;
  assert.throws(
    () => assertLegacyChinaReviewed(missingAudit),
    error => error instanceof Error && error.message.startsWith('LEGACY_REVIEW_GATE_INVALID:'),
  );
});

test('shared reviewed gate rejects stale native quantities, raw specifications, and prices', async () => {
  for (const [label, mutate] of [
    ['pcs', invoice => { invoice.products[0].pcs += 1; }],
    ['bunches', invoice => { invoice.products[0].total_bunch += 1; }],
    ['stems', invoice => { invoice.products[0].total_stems += 1; }],
    ['raw spec', invoice => { invoice.products[0].source_unit_spec = '20pcs'; }],
    ['unit price', invoice => { invoice.products[0].unitPrice += 1; }],
    ['U price alias', invoice => { invoice.products[0].u_price += 1; }],
    ['T price', invoice => { invoice.products[0].t_price += 1; }],
  ]) {
    await gateRejects(mutate, 'LEGACY_REVIEW_GATE_STALE').catch(error => {
      error.message = `${label}: ${error.message}`;
      throw error;
    });
  }
});

test('shared reviewed gate rejects unresolved review, comparison, currency, and metadata state', async () => {
  await gateRejects(invoice => { invoice.review_required = true; }, 'LEGACY_REVIEW_GATE_INVALID');
  await gateRejects(invoice => { invoice.legacyReview.version = 2; }, 'LEGACY_REVIEW_GATE_INVALID');
  await gateRejects(invoice => { invoice.legacyReview.invoiceConfirmed = false; }, 'LEGACY_REVIEW_GATE_INVALID');
  await gateRejects(invoice => { invoice.legacyReview.comparisonConfirmed = false; }, 'LEGACY_REVIEW_GATE_INVALID');
  await gateRejects(invoice => { invoice.legacyReview.currency.confirmed = false; }, 'LEGACY_REVIEW_GATE_INVALID');
  await gateRejects(invoice => {
    invoice.extractionIssues.push({ code: 'UNIT_REVIEW_REQUIRED', field: 'products' });
  }, 'LEGACY_REVIEW_GATE_INVALID');
  await gateRejects(invoice => { invoice.additional_costs[0].unit_price += 1; }, 'LEGACY_REVIEW_GATE_INVALID');
});

test('requires exact, unique, current row snapshots for every source row', async () => {
  const cases = [
    ['raw_qty', 21],
    ['u_price', 17],
    ['t_price', 321],
    ['source_unit_spec', '20pcs'],
  ];
  for (const [field, value] of cases) {
    const review = resolution();
    review.rows[0][field] = value;
    await rejectsWith(source(), review, 'LEGACY_ROW_STALE');
  }

  const moved = resolution();
  moved.rows[0].source_sheet = 'Packing list_CL1';
  await rejectsWith(source(), moved, 'LEGACY_ROW_STALE');

  const wrongRow = resolution();
  wrongRow.rows[0].source_row = 99;
  await rejectsWith(source(), wrongRow, 'LEGACY_ROW_STALE');

  const duplicate = resolution();
  duplicate.rows[1] = { ...duplicate.rows[0] };
  await rejectsWith(source(), duplicate, 'LEGACY_ROW_CONFIRMATION_DUPLICATE');

  const missing = resolution();
  missing.rows.pop();
  await rejectsWith(source(), missing, 'LEGACY_ROW_CONFIRMATION_MISSING');

  const extra = resolution();
  extra.rows.push({ ...extra.rows[0], source_row: 99 });
  await rejectsWith(source(), extra, 'LEGACY_ROW_STALE');

  const duplicateSource = source();
  duplicateSource.products[1].source_row = duplicateSource.products[0].source_row;
  await rejectsWith(duplicateSource, resolution(), 'LEGACY_SOURCE_INVALID');
});

test('blocks unsupported units, implicit confirmation, missing reasons, and invalid native quantities', async () => {
  for (const rawUnit of ['박스', '송이']) {
    const review = resolution();
    review.rows[0].raw_unit = rawUnit;
    await rejectsWith(source(), review, 'LEGACY_RAW_UNIT_UNSUPPORTED');
  }

  const unconfirmed = resolution();
  unconfirmed.rows[0].confirmed = false;
  await rejectsWith(source(), unconfirmed, 'LEGACY_ROW_CONFIRMATION_REQUIRED');

  const noReason = resolution();
  noReason.rows[0].reason = '   ';
  await rejectsWith(source(), noReason, 'LEGACY_ROW_REASON_REQUIRED');

  for (const [field, value] of [['pcs', 0], ['pcs', 1.5], ['total_stems', -1], ['total_stems', 4.2]]) {
    const review = resolution();
    review.rows[0][field] = value;
    await rejectsWith(source(), review, 'LEGACY_NATIVE_QUANTITY_INVALID');
  }
});

test('requires explicit currency, Invoice authority, and CL comparison acknowledgement', async () => {
  for (const currency of [
    { code: 'CNY', reason: 'confirmed', confirmed: false },
    { code: 'CN', reason: 'confirmed', confirmed: true },
  ]) {
    await rejectsWith(source(), resolution({ currency }), 'LEGACY_CURRENCY_REQUIRED');
  }
  await rejectsWith(source(), resolution({
    currency: { code: 'CNY', reason: ' ', confirmed: true },
  }), 'LEGACY_CURRENCY_REASON_REQUIRED');
  await rejectsWith(source({ currency: 'USD' }), resolution(), 'LEGACY_CURRENCY_CONFLICT');
  await rejectsWith(source(), resolution({ invoiceConfirmed: false }), 'LEGACY_INVOICE_CONFIRMATION_REQUIRED');
  await rejectsWith(source(), resolution({ comparisonConfirmed: false }), 'LEGACY_COMPARISON_CONFIRMATION_REQUIRED');
});

test('fails closed when source arithmetic, identity, or reviewed date metadata changed', async () => {
  await rejectsWith(source({ arithmetic_verified: false }), resolution(), 'LEGACY_ARITHMETIC_UNVERIFIED');
  await rejectsWith(source({ invoice_total: 999, total_value: 999 }), resolution(), 'LEGACY_ARITHMETIC_UNVERIFIED');

  const changedLine = source();
  changedLine.products[0].t_price = 319;
  await rejectsWith(changedLine, resolution(), 'LEGACY_LINE_AMOUNT_MISMATCH');

  await rejectsWith(source({ invoice: '' }), resolution(), 'LEGACY_SOURCE_INVOICE_INVALID');
  await rejectsWith(source({ source_format: 'china_invoice_xlsx' }), resolution(), 'LEGACY_SOURCE_INVALID');
  await rejectsWith(source({ raw_date: '2025-02-30', date: '2025/02/30' }), resolution(), 'LEGACY_DATE_INVALID');

  const unresolved = source({
    extractionIssues: [{
      code: 'SOURCE_ROW_INCOMPLETE',
      field: 'products',
      severity: 'review_required',
      message: 'missing source cell',
    }],
  });
  await rejectsWith(unresolved, resolution(), 'LEGACY_METADATA_UNRESOLVED');
});

test('revalidates existing date issues instead of copying stale metadata warnings', async () => {
  const { resolveLegacyChinaInvoice } = await ready;
  const validWithStaleIssue = source({
    extractionIssues: [
      { code: 'CURRENCY_UNAVAILABLE', field: 'currency', severity: 'review_required' },
      { code: 'DATE_FORMAT_UNSUPPORTED', field: 'raw_date', severity: 'review_required' },
    ],
  });
  const result = resolveLegacyChinaInvoice(validWithStaleIssue, resolution());
  assert.deepEqual(result.extractionIssues, []);
  assert.equal(result.date, '2025/05/13');
});

test('resolution contract rejects omitted and unexpected fields', async () => {
  const missingTopLevel = resolution();
  delete missingTopLevel.comparisonConfirmed;
  await rejectsWith(source(), missingTopLevel, 'LEGACY_RESOLUTION_INVALID');

  const extraTopLevel = { ...resolution(), sourceInvoice: '005' };
  await rejectsWith(source(), extraTopLevel, 'LEGACY_RESOLUTION_INVALID');

  const extraRowField = resolution();
  extraRowField.rows[0].total_bunch = 20;
  await rejectsWith(source(), extraRowField, 'LEGACY_ROW_STALE');
});

test('review helper remains pure and contains no external I/O, API, or database integration', () => {
  const sourceText = fs.readFileSync(path.join(__dirname, '..', 'lib', 'importChinaLegacyReview.js'), 'utf8');
  assert.doesNotMatch(sourceText, /\b(fetch|axios|mssql|PrismaClient|child_process|exec|spawn)\b/);
  assert.doesNotMatch(sourceText, /\b(fs|node:fs|writeFile|readFile|localStorage|sessionStorage)\b/);
});
