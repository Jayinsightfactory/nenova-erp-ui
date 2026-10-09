const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx-js-style');
const ready = Promise.all([import('../lib/importChinaInvoice.js'), import('../lib/importPacking.js'),
  import('../lib/importPackingResponse.js'), import('../lib/importPackingState.js')]);

const headers = ['Category\n品类', 'Chinese Name\n中文品名', 'English item name\n英文品名',
  'Image', 'Flower material formula', 'Stem Length\n长度', 'Specification', '装箱率',
  'notes', 'Carton Specification', 'Ctn No', 'Order', 'Total of Flower Material\n花材合计',
  '单价UNIT PRICE(CNY/BH/PCS)', 'Stems', 'weight', '金额合计AMOUNT (CNY)'];
const flower = (name = '리모늄 시네신스 화이트\n(Sinensis white)', length = '70cm',
  price = 0, category = '配花') => [category, '白水晶', name, null, null, length,
  '10-15stem/bunch550克/扎', 20, null, '100*40*20', '1-7', 7, 140, price, 2100, 88.13, 140 * price];
function fixture(products = [flower()], { repeat = true, fees = true } = {}) {
  const subtotal = [];
  for (const column of [11, 12, 14, 16]) subtotal[column] = products.reduce((s, row) => s + row[column], 0);
  const rows = [['昆明鲜集\nKUN MING HUBFRESH SUPPLY CHAIN MANAGEMENT CO.,LTD\nAddress'],
    [], [], [], [], [null, '日期DATE: 4/10/2026'], [null, '发票号INVOICE NO. XJ-2026-NN004'],
    [null, '合同号CONTRACT NO: XJ-2026-NN001'], ['TO: Nenova'], [], [...headers],
    ...products.map(row => [...row]), subtotal];
  if (fees) rows.push([], ['Additional charges'], ['Charges as required'],
    ['No', 'Charge items /费用项目', null, 'Qty.', 'Unit Price', '(CNY)/金额'],
    [1, 'BOXING AND PACKING', null, 7, 27, 189],
    [2, 'Documents', null, 1, 1000, 1000],
    [3, 'Claim deduction', null, 1, -20, -20],
    ...(repeat ? [[4, '花材金额', null, 1, subtotal[16], subtotal[16]]] : []),
    ['Total additional charges/附加费用合计', null, null, null, null, 1169 + (repeat ? subtotal[16] : 0)]);
  return rows;
}
function workbook(rows, edit) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'INVOICE');
  edit?.(wb);
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}
async function parse(rows = fixture(), edit) {
  const [parser, , response] = await ready;
  const envelope = parser.parseChinaInvoiceWorkbook(XLSX, workbook(rows, edit));
  const decoded = response.parsePackingResponse(envelope, 'CN');
  assert.equal(decoded.wasTruncated, false);
  return decoded.result.invoices[0];
}
const catalog = names => ({ byCountry: { CN: names.map((name, i) => ({ name, code: `CN${i}` })) } });
function generate(packing, inv, opts = {}) {
  let book;
  const result = packing.genChina({ ...XLSX, write: wb => { book = wb; return []; } }, inv, '41', '01', opts);
  return { result, book, sheet: book.Sheets[book.SheetNames[0]] };
}

test('response contract, correct Hubfresh invoice/date, independent counts and zero price', async () => {
  const inv = await parse();
  assert.equal(inv.invoice, 'XJ-2026-NN004');
  assert.equal(inv.date, '2026/10/04');
  assert.equal(inv.raw_date, '2026-10-04');
  assert.equal(inv.date_source_raw, '4/10/2026');
  assert.equal(inv.date_kind, 'invoice');
  assert.equal(inv.date_order, 'YMD');
  assert.match(inv.supplier, /HUBFRESH/);
  assert.doesNotMatch(inv.supplier, /Melody|Nenova/i);
  const p = inv.products[0];
  assert.equal(p.pcs, 7); assert.equal(p.total_bunch, 140); assert.equal(p.total_stems, 2100);
  assert.equal(p.bunch_st, 15); assert.equal(p.steam_box, 300);
  assert.equal(p.u_price, 0); assert.equal(p.t_price, 0);
  assert.equal(p.source_row, 12); assert.equal(inv.currency, 'CNY');
  assert.equal(inv.products.length, 1); assert.equal(inv.additional_costs.length, 3);
  assert.equal(inv.item_subtotal, 0); assert.equal(inv.freight, 1169); assert.equal(inv.invoice_total, 1169);
});

test('repeated flowers are not expenses; fee-only subtotal and no-expense layouts work', async () => {
  for (const repeat of [true, false]) {
    const inv = await parse(fixture([flower(undefined, undefined, 18)], { repeat }));
    assert.equal(inv.item_subtotal, 2520); assert.equal(inv.invoice_total, 3689);
    assert.equal(inv.freight, 1169); assert.equal(inv.additional_costs.length, 3);
  }
  const inv = await parse(fixture([flower(undefined, undefined, 18)], { fees: false }));
  assert.equal(inv.invoice_total, 2520); assert.equal(inv.freight, 0);
});

test('China sheet preview keeps boxes, bunches, stems and zero prices distinct', async () => {
  const [, packing] = await ready;
  const inv = await parse(fixture());
  const { result } = generate(packing, inv);
  const row = result.products[0];
  assert.equal(row.qty, 140);
  assert.equal(row.boxes, 7);
  assert.equal(row.stems, 2100);
  assert.equal(row.unitPrice, 0);
  assert.equal(row.lineAmount, 0);
  assert.equal(row.stemLength, '70cm');
  assert.ok(row.sourceName);
});

test('cached XLSX formula numbers are read and uncached formulas fail closed', async () => {
  const edit = wb => { wb.Sheets.INVOICE.Q12 = { t: 'n', v: 2520, f: 'M12*N12' }; };
  assert.equal((await parse(fixture([flower(undefined, undefined, 18)]), edit)).item_subtotal, 2520);
  await assert.rejects(parse(fixture(), wb => { wb.Sheets.INVOICE.N12 = { t: 'n', f: '1-1' }; }), /numeric/);
});

test('bad, blank, negative, infinite and malformed numeric product cells cannot silently become zero', async () => {
  for (const value of ['bad', '', '1,2', 'NaN', '-1', 'Infinity', '1e3', true]) {
    const rows = fixture(); rows[11][13] = value;
    await assert.rejects(parse(rows), /중국 인보이스.*numeric/);
  }
  const rows = fixture(); rows[11][11] = 1.5;
  await assert.rejects(parse(rows), /numeric/);
});

test('missing/duplicate headers, missing supplier, wrong totals and unknown money rows fail closed', async () => {
  for (const column of [2, 5, 6, 11, 12, 13, 14, 16]) {
    const rows = fixture(); rows[10][column] = '';
    await assert.rejects(parse(rows), /headers/);
  }
  const duplicate = fixture(); duplicate[10].push(headers[12]);
  await assert.rejects(parse(duplicate), /headers/);
  const supplier = fixture(); supplier[0] = ['TO: Nenova'];
  await assert.rejects(parse(supplier), /supplier/);
  const product = fixture(); product[12][14] = 2000;
  await assert.rejects(parse(product), /subtotal/);
  const line = fixture([flower(undefined, undefined, 10)]); line[11][16] = 0;
  await assert.rejects(parse(line), /amount mismatch/);
  const total = fixture(); total.at(-1)[5] = 1;
  await assert.rejects(parse(total), /charge subtotal/);
  const fee = fixture(); fee[17][5] = 200;
  await assert.rejects(parse(fee), /charge line/);
  const unknown = fixture(); unknown.push(['Unexplained', null, 123]);
  await assert.rejects(parse(unknown), /unrecognized monetary/);
  const repeated = fixture(); repeated.splice(-1, 0, [5, '花材金额', null, 1, 0, 0]);
  await assert.rejects(parse(repeated), /duplicate/);
});

test('explicit zero grand total, valid thousands strings and invalid DMY dates are handled', async () => {
  const rows = fixture([flower()], { fees: false }); rows.push(['INVOICE TOTAL', 0]);
  assert.equal((await parse(rows)).invoice_total, 0);
  rows.at(-1)[1] = 10; await assert.rejects(parse(rows), /grand total/);
  const badDate = fixture(); badDate[5][1] = 'DATE: 31/2/2026';
  await assert.rejects(parse(badDate), /DATE/);
  const missingDate = fixture(); missingDate[5][1] = 'DATE:';
  await assert.rejects(parse(missingDate), /metadata/);
  const grouped = fixture(); grouped[11][14] = '2,100';
  assert.equal((await parse(grouped)).total_stems, 2100);
});

test('length identity never selects one endpoint of ranges; repeated grades normalize', async () => {
  const [parser] = await ready;
  assert.deepEqual(parser.chinaStemLength('65cm'), { raw: '65cm', key: '65CM', exact: 65, uncertain: false });
  for (const v of ['60-65CM', '65-75cm / 75-80cm', '', 'unknown', '75-65cm']) {
    assert.equal(parser.chinaStemLength(v).uncertain, true);
    assert.equal(parser.chinaStemLength(v).exact, null);
  }
  assert.equal(parser.chinaStemLength('60-65CM / 60-65cm').key, '60-65CM');
});

test('rose ranges and unlabelled defaults require review; length-qualified manual aliases stay isolated', async () => {
  const [, packing, , state] = await ready;
  const rows = fixture([flower('장미 다이아나 (Diana)', '60-65CM', 18, '单头玫瑰'),
    flower('장미 다이아나 (Diana)', '65-75CM', 20, '单头玫瑰')]);
  const inv = await parse(rows);
  const names = ['ROSE CHINA / 다이아나(Diana)', 'ROSE CHINA / 다이아나(Diana) 65-75cm',
    'ROSE CHINA / 다이아나(Diana) 75-80cm'];
  const opts = { catalog: catalog(names), aliases: { DIANA: names[0] } };
  let { result } = generate(packing, inv, opts);
  assert.equal(result.products[0].unmatched, true);
  assert.equal(result.products[1].unmatched, undefined);
  assert.equal(result.pending.length, 1); assert.equal(state.isPackingDownloadBlocked(result), true);
  assert.notEqual(packing.aliasKey(inv.products[0].description), packing.aliasKey(inv.products[1].description));
  opts.aliases[packing.aliasKey(inv.products[0].description)] = names[0];
  const built = generate(packing, inv, opts); result = built.result;
  assert.equal(result.products[0].unmatched, undefined); assert.equal(result.products[1].unmatched, undefined);
  assert.match(built.sheet.B6.v, /Diana.*length: 60-65CM/);
  assert.match(result.products[0].name, /length: 60-65CM/);
  opts.aliases[packing.aliasKey(inv.products[1].description)] = names[1];
  assert.equal(state.isPackingDownloadBlocked(generate(packing, inv, opts).result), false);
});

test('same normalized range can auto-match, but mixed grades or collapsing a range require review', async () => {
  const [, packing] = await ready;
  const inv = await parse(fixture([flower('장미 다이아나 (Diana)', '65-75cm', 18, '单头玫瑰')]));
  const cat = catalog(['ROSE CHINA / 다이아나 (Diana) 65cm-75cm', 'ROSE CHINA / 다이아나 (Diana) 75-80cm']);
  assert.equal(generate(packing, inv, { catalog: cat }).result.products[0].unmatched, undefined);
  assert.equal(generate(packing, inv, { catalog: catalog(['ROSE CHINA / Diana 65cm']) }).result.products[0].unmatched, true);
  const mixed = await parse(fixture([flower('장미 다이아나 (Diana)', '65-75cm / 75-80cm', 18, '单头玫瑰')]));
  assert.equal(generate(packing, mixed, { catalog: cat }).result.products[0].unmatched, true);
  assert.equal(generate(packing, mixed, { catalog: catalog(['ROSE CHINA / Diana 65-75cm / 75-80cm']) }).result.products[0].unmatched, undefined);
});

test('CN XLSX manual alias descriptions include family and never cross ROSE/SPRAY_ROSE', async () => {
  const [, packing] = await ready;
  const inv = await parse(fixture([flower('꽃 (Diana)', '60-65cm', 18, '单头玫瑰'),
    flower('꽃 (Diana)', '60-65cm', 18, '多头玫瑰')]));
  const [rose, spray] = inv.products;
  assert.match(rose.description, /\[family:ROSE\] \[length:60-65CM\]/);
  assert.match(spray.description, /\[family:SPRAY_ROSE\] \[length:60-65CM\]/);
  assert.notEqual(packing.aliasKey(rose.description), packing.aliasKey(spray.description));
  const names = ['ROSE CHINA / Diana', 'SPRAY ROSE CHINA / Diana'];
  const aliases = { [packing.aliasKey(rose.description)]: names[0] };
  for (const products of [[rose, spray], [spray, rose]]) {
    const result = generate(packing, { ...inv, products }, { catalog: catalog(names), aliases }).result;
    const roseRow = result.products.find(p => p.source_row === rose.source_row);
    const sprayRow = result.products.find(p => p.source_row === spray.source_row);
    assert.equal(roseRow.viaAlias, true); assert.equal(roseRow.unmatched, undefined);
    assert.equal(sprayRow.viaAlias, undefined); assert.equal(sprayRow.unmatched, true);
    assert.match(result.pending[0].description, /family:SPRAY_ROSE/);
  }
  aliases[packing.aliasKey(spray.description)] = names[1];
  const result = generate(packing, inv, { catalog: catalog(names), aliases }).result;
  assert.equal(result.products.every(p => p.viaAlias && !p.unmatched), true);
  assert.notEqual(result.products[0].name, result.products[1].name);
});

test('caller-constructed identical CN descriptions are family-qualified before cached auto/manual decisions', async () => {
  const [, packing] = await ready;
  const names = ['ROSE CHINA / Diana 65cm', 'SPRAY ROSE CHINA / Diana 65cm'];
  const products = ['ROSE', 'SPRAY_ROSE'].map(family => ({ description: '꽃 (Diana) [length:65CM]',
    family, stem_length: '65cm', source_format: 'china_invoice_xlsx' }));
  for (const input of [products, [...products].reverse()]) {
    const context = { farm: 'Hubfresh', invoice: 'X', pending: [], noMatches: [] };
    const resolve = packing.makeProductResolver('CN', catalog(names), {}, context);
    const results = input.map(resolve);
    for (let i = 0; i < results.length; i++) {
      assert.equal(results[i].matchedName, names[products.indexOf(input[i])]);
      assert.match(results[i].description, new RegExp('family:' + input[i].family));
    }
    assert.equal(context.pending.length + context.noMatches.length, 0);
    assert.equal(input[0].description, '꽃 (Diana) [length:65CM]', 'caller input remains unchanged');
  }
  const ranges = products.map(p => ({ ...p, description: '꽃 (Diana) [length:60-65CM]', stem_length: '60-65cm' }));
  const context = { farm: 'Hubfresh', invoice: 'X', pending: [], noMatches: [] };
  const aliases = { [packing.aliasKey('꽃 (Diana) [family:ROSE] [length:60-65CM]')]: names[0],
    [packing.aliasKey(ranges[0].description)]: names[0] };
  const resolve = packing.makeProductResolver('CN', catalog(names), aliases, context);
  assert.equal(resolve(ranges[0], 0).viaAlias, true);
  assert.equal(resolve(ranges[1], 1).unmatched, true);
  assert.equal(resolve(ranges[1], 2).unmatched, true);
  assert.equal(context.pending.length, 1, 'same-family repeat still deduplicates');
  assert.match(context.pending[0].description, /family:SPRAY_ROSE/);
});

test('rose exact lengths reject wrong grades and unlabelled catalogs; equal matches stay ambiguous', async () => {
  const [, packing] = await ready;
  const inv = await parse(fixture([flower('장미 다이아나 (Diana)', '65CM', 18, '单头玫瑰')]));
  for (const names of [['ROSE CHINA / Diana'], ['ROSE CHINA / Diana 75cm'],
    ['ROSE CHINA / Diana 65cm', 'ROSE CHINA / Diana 65cm']]) {
    assert.equal(generate(packing, inv, { catalog: catalog(names) }).result.products[0].unmatched, true);
  }
  const built = generate(packing, inv, { catalog: catalog(['ROSE CHINA / Diana 65cm', 'ROSE CHINA / Diana 75cm']) });
  assert.equal(built.result.products[0].unmatched, undefined);
  assert.match(built.sheet.B6.v, /65cm.*length: 65CM/);
});

test('CN non-rose XLSX descriptions use current aliases and exact catalog membership', async () => {
  const [, packing] = await ready;
  const inv = await parse();
  const name = packing.SEED_ALIASES_CN['SINENSIS WHITE'];
  const opts = { catalog: catalog([name]), aliases: packing.ALL_SEED_ALIASES };
  assert.equal(generate(packing, inv, opts).result.products[0].viaAlias, true);
  assert.equal(generate(packing, inv, { ...opts, catalog: catalog(['Different']) }).result.products[0].unmatched, true);
});

test('XLSX output preserves source boxes/bunches/exact stems/zero price and fee formulas without fake quantities', async () => {
  const [, packing] = await ready;
  const inv = await parse();
  const name = packing.SEED_ALIASES_CN['SINENSIS WHITE'];
  const { result, sheet, book } = generate(packing, inv, { catalog: catalog([name]), aliases: packing.ALL_SEED_ALIASES });
  assert.equal(book.SheetNames[0], 'CN-HUB'); assert.match(result.name, /_HUB_XJ-2026-NN004/);
  for (const [cell, value] of Object.entries({ F6: 7, G6: 15, H6: 300, I6: 140, J6: 2100, K6: 0 })) assert.equal(sheet[cell].v, value);
  assert.equal(sheet.J6.f, undefined); assert.equal(sheet.L6.f, 'K6*I6');
  assert.equal(sheet.L7.f, 'K7'); assert.equal(sheet.K7.v, 189);
  for (const c of 'FGHIJ') assert.ok(!sheet[`${c}7`]?.v);
  assert.equal(sheet.L58.f, 'SUM(L6:L57)'); assert.equal(sheet.J58.f, 'SUM(J6:J57)');
  assert.equal(result.totalMismatch, null); assert.equal(result.itemSubtotal, 0);
  assert.equal(result.additionalCostTotal, 1169); assert.equal(result.invoiceTotal, 1169);
  assert.deepEqual(result.sourceTotals, { boxes: 7, bunches: 140, stems: 2100 });
  assert.equal(book.Workbook.CalcPr.fullCalcOnLoad, true);
  const actual = packing.genChina(XLSX, inv, '41', '01', { catalog: catalog([name]), aliases: packing.ALL_SEED_ALIASES });
  const decoded = XLSX.read(actual.buf, { type: 'array', sheetStubs: true }).Sheets['CN-HUB'];
  assert.equal(decoded.J6.v, 2100); assert.equal(decoded.K6.v, 0); assert.equal(decoded.L6.f, 'K6*I6');
});

test('generator rejects corrupted counts and blocks subtotal/fee/grand-total drift', async () => {
  const [, packing, , state] = await ready;
  const inv = await parse();
  for (const field of ['invoice_total', 'item_subtotal', 'freight', 'total_boxes', 'total_bunches', 'total_stems']) {
    const changed = { ...inv, [field]: inv[field] + 10 };
    const result = generate(packing, changed).result;
    assert.ok(result.totalMismatch); assert.equal(state.isPackingDownloadBlocked(result), true);
  }
  const corrupt = structuredClone(inv); corrupt.products[0].bunch_st = 10;
  assert.throws(() => generate(packing, corrupt), /원본 수량/);
});

test('legacy CN PDF and other-country writer formulas/quantities remain unchanged', async () => {
  const [, packing] = await ready;
  const inv = { supplier: 'Yunnan Melody', invoice: 'PDF', total_value: 6, freight: -2,
    products: [{ description: 'CARNATION Doncel', pcs: 5, bunch_st: 20, steam_box: 300,
      total_bunch: 40, total_stems: 800, u_price: 0.2, t_price: 8 }] };
  const { result, sheet } = generate(packing, inv, { catalog: catalog(['CARNATION Doncel']), aliases: { 'CARNATION DONCEL': 'CARNATION Doncel' } });
  assert.equal(sheet.F6.v, 1); assert.equal(sheet.G6.v, 1); assert.equal(sheet.H6.v, 0);
  assert.equal(sheet.J6.f, 'I6*G6'); assert.equal(sheet.L6.f, 'K6*I6');
  assert.equal(result.totalMismatch, null); assert.equal(result.itemSubtotal, undefined);
  const context = { farm: 'CO', invoice: 'PDF', pending: [], noMatches: [] };
  const resolve = packing.makeProductResolver('CO', { byCountry: { CO: [{ name: 'CARNATION Doncel', family: 'CARNATION' }] } }, { 'CARNATION DONCEL': 'CARNATION Doncel' }, context);
  assert.equal(resolve(inv.products[0], 0).viaAlias, true);
});

test('50MiB limit checks decoded bytes before XLSX.read; parser has no network/AI dependencies', async () => {
  const [parser] = await ready;
  assert.equal(parser.CHINA_INVOICE_MAX_BYTES, 50 * 1024 * 1024);
  let called = false;
  const mock = { read() { called = true; throw Error('read'); }, utils: {} };
  const over = 'A'.repeat(Math.ceil(parser.CHINA_INVOICE_MAX_BYTES / 3) * 4);
  assert.throws(() => parser.parseChinaInvoiceWorkbook(mock, over), /50MiB/); assert.equal(called, false);
  for (const bad of ['', 'not a workbook', 'AA=A', 'A']) assert.throws(() => parser.parseChinaInvoiceWorkbook(mock, bad));
  const sample = workbook(fixture());
  const decoderSpy = { ...XLSX, read(data, options) {
    assert.ok(data instanceof Uint8Array); assert.equal(options.type, 'array');
    assert.deepEqual(Buffer.from(data), Buffer.from(sample, 'base64'));
    return XLSX.read(data, options);
  } };
  assert.ok(parser.parseChinaInvoiceWorkbook(decoderSpy, sample).content.length);
  const source = fs.readFileSync(path.join(__dirname, '../lib/importChinaInvoice.js'), 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|axios|anthropic|openai|writeFile|readFile/);
});

// Opt in without checking a 33MB private invoice into the repository:
// $env:CHINA_INVOICE_REAL_FILE='C:/.../41-1 중국 해상 ci1.xlsx'; node __tests__/importChinaInvoice.test.js
// Optional override: CHINA_INVOICE_CATALOG_FILE. Otherwise both local catalog samples are audited.
test('optional real XJ workbook: counts/zero row/costs/output plus actual catalog matching audit',
  { skip: !process.env.CHINA_INVOICE_REAL_FILE }, async () => {
    const [parser, packing, response, state] = await ready;
    const bytes = fs.readFileSync(process.env.CHINA_INVOICE_REAL_FILE);
    const start = performance.now(), memory = process.memoryUsage().rss;
    const inv = response.parsePackingResponse(parser.parseChinaInvoiceWorkbook(XLSX, bytes.toString('base64')), 'CN').result.invoices[0];
    console.log('REAL_PARSE', JSON.stringify({ bytes: bytes.length, elapsedMs: Math.round(performance.now() - start),
      rssDeltaMiB: Math.round((process.memoryUsage().rss - memory) / 1024 / 1024) }));
    assert.equal(inv.invoice, 'XJ-2026-NN004'); assert.equal(inv.date, '2026/10/04');
    assert.equal(inv.raw_date, '2026-10-04'); assert.equal(inv.date_kind, 'invoice');
    assert.equal(inv.date_order, 'YMD'); assert.match(inv.supplier, /HUBFRESH/);
    assert.equal(inv.products.length, 101); assert.equal(inv.total_boxes, 429); assert.equal(inv.total_bunches, 5390);
    assert.equal(inv.total_stems, 68775); assert.equal(inv.item_subtotal, 126325);
    assert.equal(inv.freight, 45825.5); assert.equal(inv.invoice_total, 172150.5); assert.equal(inv.additional_costs.length, 7);
    const zero = inv.products.find(p => p.source_row === 112);
    assert.equal(zero.u_price, 0); assert.equal(zero.t_price, 0); assert.equal(zero.total_stems, 2100);
    const files = process.env.CHINA_INVOICE_CATALOG_FILE ? [process.env.CHINA_INVOICE_CATALOG_FILE]
      : ['Catalog.xlsx', '품목목록_2026-10-02.xlsx'].map(name => path.join(__dirname, '../output/drive-samples', name));
    for (const file of files) {
      assert.ok(fs.existsSync(file), 'Catalog missing: ' + file);
      const parsed = packing.parseCatalog(XLSX, fs.readFileSync(file));
      const items = parsed.items.filter(i => i.country === 'CN');
      const { result, sheet } = generate(packing, inv, { catalog: { byCountry: { CN: items } }, aliases: packing.ALL_SEED_ALIASES });
      const matched = result.products.filter(p => !p.unmatched).length;
      const ambiguous = result.products.filter(p => p.unmatched);
      console.log('REAL_MATCH', JSON.stringify({ catalog: path.basename(file), chinaCatalogItems: items.length,
        matched, total: 101, percent: Number((matched / 101 * 100).toFixed(1)),
        reviewRows: ambiguous.map(p => ({ row: p.source_row, description: p.name, reason: p.matchReason })),
        uniqueReviews: result.pending.length + result.noMatches.length }));
      assert.equal(result.totalMismatch, null); assert.equal(result.invoiceTotal, 172150.5);
      assert.equal(state.isPackingDownloadBlocked(result), ambiguous.length > 0);
      assert.equal(sheet.F106.v, 7); assert.equal(sheet.J106.v, 2100); assert.equal(sheet.K106.v, 0);
      const productTotal = column => inv.products.reduce((s, p, i) => s + sheet[column + (i + 6)].v, 0);
      assert.equal(productTotal('F'), 429); assert.equal(productTotal('I'), 5390); assert.equal(productTotal('J'), 68775);
    }
  });
