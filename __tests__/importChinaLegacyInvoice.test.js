const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx-js-style');

const ready = Promise.all([
  import('../lib/importChinaInvoice.js'),
  import('../lib/importChinaLegacyInvoice.js'),
  import('../lib/importPackingResponse.js'),
]);

const legacyHeaders = ['品    名', '英  文  名', '数量Qty', '单价PRICE', '金额AMOUNT', '规格BU/PCS'];

function legacyRows({ products, fees = [], date = '2025-4-27', invoice = '002', currency = null }) {
  const productQty = products.every(row => row[2] != null) ? products.reduce((sum, row) => sum + row[2], 0) : 0;
  const productAmount = products.every(row => row[2] != null && row[3] != null)
    ? products.reduce((sum, row) => sum + row[2] * row[3], 0) : 0;
  const feeAmount = fees.every(row => row[2] != null && row[3] != null)
    ? fees.reduce((sum, row) => sum + row[2] * row[3], 0) : 0;
  return [
    ['昆明润和花卉种植有限公司'],
    ['Kunming Runhe Flowers Planting Co.Ltd'],
    ['TO: Nenova'],
    [`DATE:${date}`, null, null, currency ? `Currency ${currency}` : null, `INVOICE NO.${invoice}`],
    legacyHeaders,
    ...products,
    ['花款合计', 'Total Flower amounts', productQty, null, productAmount],
    ...fees,
    ['总计 Total amounts', null, null, null, productAmount + feeAmount],
    [` Grand Total: 1boxes 1KG`],
  ];
}

function appendLegacySheet(wb, rows, name = 'Invoice 日报表', edit) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const headerRow = rows.findIndex(row => row[0] === legacyHeaders[0]);
  const subtotalRow = rows.findIndex(row => row.some(value => /Total Flower amounts/i.test(String(value ?? ''))));
  const grandRow = rows.findIndex(row => row.some(value => /总计\s*Total amounts/i.test(String(value ?? ''))));
  for (let row = headerRow + 1; row < subtotalRow; row++) {
    if (ws[`E${row + 1}`]) ws[`E${row + 1}`].f = `C${row + 1}*D${row + 1}`;
  }
  ws[`C${subtotalRow + 1}`].f = `SUM(C${headerRow + 2}:C${subtotalRow})`;
  ws[`E${subtotalRow + 1}`].f = `SUMPRODUCT(C${headerRow + 2}:C${subtotalRow},D${headerRow + 2}:D${subtotalRow})`;
  for (let row = subtotalRow + 1; row < grandRow; row++) {
    if (ws[`E${row + 1}`]) ws[`E${row + 1}`].f = `C${row + 1}*D${row + 1}`;
  }
  ws[`E${grandRow + 1}`].f = `SUM(E${subtotalRow + 1}:E${grandRow})`;
  edit?.(ws, { headerRow, subtotalRow, grandRow });
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

function appendComparisonSheet(wb, name, quantity, pcs) {
  const rows = [
    ['箱子 Box', null, '商品 COMM', '数量 QTY', '支数 PCS'],
    [1, null, 'Rose', quantity, pcs],
    ['TOTAL', null, null, quantity, pcs],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws.D3.f = 'SUM(D2:D2)';
  ws.E3.f = 'SUM(E2:E2)';
  XLSX.utils.book_append_sheet(wb, ws, name);
}

function workbookBase64(build) {
  const wb = XLSX.utils.book_new();
  build(wb);
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

async function parseBase64(base64) {
  const [parser, , response] = await ready;
  const decoded = response.parsePackingResponse(parser.parseChinaInvoiceWorkbook(XLSX, base64), 'CN');
  assert.equal(decoded.wasTruncated, false);
  return decoded.result.invoices[0];
}

test('legacy six-column Invoice is review-only and preserves raw quantity, prices, formulas, and 2025 date', async () => {
  const base64 = workbookBase64(wb => appendLegacySheet(wb, legacyRows({
    products: [
      ['雪山', 'Rose-AVALANCHE(WHITE)', 66, 14, 924, '10pcs'],
      ['水晶花', 'Limonium-Clear Diamond(WHITE)', 20, 12, 240, '500g'],
    ],
    fees: [
      ['纸箱', 'BOX', 2, 19, 38, '102*42*25'],
      ['报关费', 'Documents', 1, 400, 400],
      ['空运费', 'Air freight', 100, 8.5, 850],
    ],
  })));
  const invoice = await parseBase64(base64);
  assert.equal(invoice.source_format, 'china_legacy_invoice_xlsx');
  assert.equal(invoice.review_status, 'LEGACY_CN_REVIEW_REQUIRED');
  assert.deepEqual(invoice.review_states,
    ['LEGACY_CN_REVIEW_REQUIRED', 'UNIT_REVIEW_REQUIRED', 'CURRENCY_REVIEW_REQUIRED']);
  assert.equal(invoice.date, '2025/04/27');
  assert.equal(invoice.raw_date, '2025-04-27');
  assert.equal(invoice.date_raw, 'DATE:2025-4-27');
  assert.equal(invoice.date_kind, 'invoice');
  assert.equal(invoice.date_order, 'YMD');
  assert.equal(invoice.currency, null);
  assert.equal(invoice.arithmetic_verified, true);
  assert.equal(invoice.products.length, 2);
  assert.deepEqual(invoice.products.map(row => [row.raw_qty, row.source_unit_spec, row.unitPrice, row.t_price]),
    [[66, '10pcs', 14, 924], [20, '500g', 12, 240]]);
  for (const row of invoice.products) {
    assert.equal(row.unit_review_required, true);
    assert.equal(row.reviewed, false);
    for (const field of ['pcs', 'total_bunch', 'total_stems', 'box_quantity', 'bunch_quantity', 'stem_quantity']) {
      assert.equal(row[field], null, `${field} must never be inferred`);
    }
  }
  assert.equal(invoice.products[0].source_cells.t_price.formula, 'C6*D6');
  assert.equal(invoice.products[0].source_cells.t_price.cached_value, 924);
  assert.equal(invoice.item_subtotal, 1164);
  assert.equal(invoice.freight, 1288);
  assert.equal(invoice.invoice_total, 2452);
  assert.equal(invoice.independent_totals.products.amount_matches, true);
  assert.equal(invoice.independent_totals.grand.amount_matches, true);
  assert.equal(invoice.total_boxes, null);
  assert.equal(invoice.total_bunches, null);
  assert.equal(invoice.total_stems, null);
  assert.equal(invoice.original_rows[5].cells[5].value, '10pcs');
});

test('explicit currency is retained, but legacy and row-unit review remain required', async () => {
  const invoice = await parseBase64(workbookBase64(wb => appendLegacySheet(wb, legacyRows({
    products: [['꽃', 'Flower', 0, 0, 0, '10pcs']],
    currency: 'USD',
  }), 'Invoice')));
  assert.equal(invoice.currency, 'USD');
  assert.equal(invoice.products[0].raw_qty, 0);
  assert.equal(invoice.products[0].unitPrice, 0);
  assert.equal(invoice.products[0].t_price, 0);
  assert.deepEqual(invoice.review_states, ['LEGACY_CN_REVIEW_REQUIRED', 'UNIT_REVIEW_REQUIRED']);
  assert.equal(invoice.arithmetic_verified, true);
});

test('missing product and fee cells remain null and force amount review without becoming zero', async () => {
  const rows = legacyRows({
    products: [
      ['명시적0', 'Explicit zero', 0, 5, 0, null],
      ['미확인', 'Missing quantity', null, 5, null, '500g'],
    ],
    fees: [
      ['서류', 'Documents', 1, 0, 0],
      ['항공', 'Air freight', 1, 10, null],
    ],
  });
  const invoice = await parseBase64(workbookBase64(wb => appendLegacySheet(wb, rows)));
  assert.equal(invoice.products[0].raw_qty, 0);
  assert.equal(invoice.products[0].source_unit_spec, null);
  assert.equal(invoice.products[1].raw_qty, null);
  assert.equal(invoice.products[1].t_price, null);
  assert.equal(invoice.additional_costs[0].amount, 0);
  assert.equal(invoice.additional_costs[1].amount, null);
  assert.equal(invoice.arithmetic_verified, false);
  assert.ok(invoice.review_states.includes('AMOUNT_REVIEW_REQUIRED'));
  assert.equal(invoice.independent_totals.products.raw_qty_sum, null);
  assert.equal(invoice.independent_totals.grand.calculated_amount, null);
  assert.equal(invoice.total_boxes, null);
});

test('CL sheets are preserved independently, never added to invoice totals, and conflicts require review', async () => {
  const invoice = await parseBase64(workbookBase64(wb => {
    appendLegacySheet(wb, legacyRows({ products: [['꽃', 'Flower', 2, 5, 10, '20pcs']] }));
    appendComparisonSheet(wb, 'Packing list_CL1', 20, 200);
    appendComparisonSheet(wb, 'Packing list_CL5', 30, 300);
  }));
  assert.equal(invoice.invoice_total, 10);
  assert.equal(invoice.packing_comparison_status, 'CL_CONFLICT_REVIEW_REQUIRED');
  assert.ok(invoice.review_states.includes('CL_CONFLICT_REVIEW_REQUIRED'));
  assert.deepEqual(invoice.packing_comparisons.map(sheet => sheet.sheet_name),
    ['Packing list_CL1', 'Packing list_CL5']);
  for (const sheet of invoice.packing_comparisons) {
    assert.equal(sheet.authority, 'COMPARISON_ONLY');
    assert.equal(sheet.rows.length, 3);
    assert.equal(sheet.cached_totals.length, 2);
  }
  assert.notEqual(invoice.packing_comparisons[0].aggregate_cached_values.join(','),
    invoice.packing_comparisons[1].aggregate_cached_values.join(','));
});

test('ambiguous legacy sheets or headers and missing six-column signatures fail closed', async () => {
  const rows = legacyRows({ products: [['꽃', 'Flower', 1, 5, 5, '10pcs']] });
  await assert.rejects(parseBase64(workbookBase64(wb => {
    appendLegacySheet(wb, rows, 'Invoice');
    appendLegacySheet(wb, rows, 'Invoice 日报表');
  })), /ambiguous|exactly one/i);

  await assert.rejects(parseBase64(workbookBase64(wb => appendLegacySheet(wb, [
    ...rows.slice(0, 5), legacyHeaders, ...rows.slice(5),
  ]))), /ambiguous.*headers/i);

  const badHeaders = rows.map(row => [...row]);
  badHeaders[4][5] = '规格';
  await assert.rejects(parseBase64(workbookBase64(wb => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(badHeaders), 'Invoice 日报表');
  })), /INVOICE worksheet|product headers/i);
});

test('formula caches and independent subtotal/grand arithmetic fail closed on contradictions', async () => {
  const rows = legacyRows({ products: [['꽃', 'Flower', 2, 5, 10, '10pcs']] });
  const [, legacy] = await ready;
  const uncached = XLSX.utils.book_new();
  appendLegacySheet(uncached, rows, undefined,
    (ws, { headerRow }) => { ws[`E${headerRow + 2}`] = { t: 'n', f: `C${headerRow + 2}*D${headerRow + 2}` }; });
  assert.throws(() => legacy.parseChinaLegacyInvoiceWorkbook(XLSX, uncached), /formula has no cached value/);

  await assert.rejects(parseBase64(workbookBase64(wb => appendLegacySheet(wb, rows, undefined,
    (ws, { subtotalRow }) => { ws[`E${subtotalRow + 1}`].v = 999; }))), /subtotal mismatch/);

  await assert.rejects(parseBase64(workbookBase64(wb => appendLegacySheet(wb, rows, undefined,
    (ws, { grandRow }) => { ws[`E${grandRow + 1}`].v = 999; }))), /grand total mismatch/);
});

test('modern China parser keeps its schema and supplies deterministic date metadata', async () => {
  const modernHeaders = ['Category 品类', 'Chinese Name 中文品名', 'English item name 英文品名',
    'Image', 'Flower material formula', 'Stem Length 长度', 'Specification', '装箱率', 'notes',
    'Carton Specification', 'Ctn No', 'Order', 'Total of Flower Material 花材合计',
    '单价UNIT PRICE(CNY/BH/PCS)', 'Stems', 'weight', '金额合计AMOUNT (CNY)'];
  const product = ['配花', '白水晶', 'Sinensis white', null, null, '70cm', '10stem', 20,
    null, '100*40*20', '1', 1, 10, 2, 100, 1, 20];
  const subtotal = [];
  for (const column of [11, 12, 14, 16]) subtotal[column] = product[column];
  const base64 = workbookBase64(wb => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['KUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT CO.,LTD'], [], [], [], [],
      [null, 'DATE: 4/10/2026'], [null, 'INVOICE NO. XJ-1'], [], [], [], modernHeaders, product, subtotal,
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'INVOICE');
  });
  const invoice = await parseBase64(base64);
  assert.equal(invoice.source_format, 'china_invoice_xlsx');
  assert.equal(invoice.date, '2026/10/04');
  assert.equal(invoice.raw_date, '2026-10-04');
  assert.equal(invoice.date_source_raw, '4/10/2026');
  assert.equal(invoice.date_kind, 'invoice');
  assert.equal(invoice.date_order, 'YMD');
  assert.equal(invoice.currency, 'CNY');
});

test('legacy parser is a pure local reader with no API, DB, AI, or file-write path', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/importChinaLegacyInvoice.js'), 'utf8');
  assert.doesNotMatch(source,
    /\bfetch\s*\(|axios|openai|anthropic|writeFile|Warehouse(?:Master|Detail)|OrderDetail|ShipmentDetail|ProductStock/);
});

// Optional read-only regression against the three audited workbooks. CI has no
// dependency on private/audit artifacts.
test('optional audited legacy workbooks retain all 109 rows',
  { skip: !process.env.CHINA_LEGACY_REAL_DIR }, async () => {
    const directory = process.env.CHINA_LEGACY_REAL_DIR;
    const files = ['muce9y14-d21d55.xlsx', 'muce9gp0-9b4290.xlsx', 'muce92el-d7daf3.xlsx'];
    let rows = 0;
    for (const file of files) {
      const invoice = await parseBase64(fs.readFileSync(path.join(directory, file)).toString('base64'));
      rows += invoice.products.length;
      assert.equal(invoice.arithmetic_verified, true);
      assert.equal(invoice.currency, null);
      assert.equal(invoice.products.every(row => row.pcs === null
        && row.total_bunch === null && row.total_stems === null), true);
    }
    assert.equal(rows, 109);
  });
