const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx-js-style');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const load = Promise.all([
  import('../lib/importPacking.js'), import('../lib/packingExportBunchGuard.js'),
]);
const product = (country, units = {OutUnit: '박스', EstUnit: '단'}) => ({
  ProdKey: 44, ProdName: 'TRAIN FLOWER', CounName: country === 'EC' ? '에콰도르' : '미국', ...units,
});
const fixture = { pcs: 2, total_stems: 400, u_price: 50, description: 'TRAIN FLOWER' };

async function book(country, changes) {
  const [generators] = await load;
  const make = country === 'EC' ? generators.genEcuador : generators.genUS;
  const result = make(XLSX, {
    invoice: 'TRAIN-47', date: '2026/11/17', products: [{ ...fixture, ...changes }],
    ...(country === 'US' && { gross_weight: 1697, vol_weight: 1840 }),
  }, '47', '01');
  return Buffer.from(result.buf);
}

test('generated EC and US workbooks require confirmed bunches only for bunch sales or estimates', async () => {
  const [, { readPackingExport, assertPackingExportBunches }] = await load;
  for (const country of ['EC','US']) {
    for (const counts of [{}, { total_bunch: 0 }, { total_bunch: 50, bunch_st: 10 }]) {
      const rows = await readPackingExport(await book(country, counts), country);
      assert.throws(() => assertPackingExportBunches(rows, [product(country)], country), /6행 TRAIN FLOWER.*단 수량/);
      assert.doesNotThrow(() => assertPackingExportBunches(rows, [product(country, { OutUnit: '박스', EstUnit: '송이' })], country));
    }
    for (const counts of [{ total_bunch: 40 }, { bunch_st: 10 }, { bunches_per_box: 20 }]) {
      const rows = await readPackingExport(await book(country, counts), country);
      assert.equal(rows[0].bunchQuantity, 40);
      assert.doesNotThrow(() => assertPackingExportBunches(rows, [product(country)], country));
      assert.throws(() => assertPackingExportBunches(rows, [product(country === 'US' ? 'EC' : 'US')], country), /품목과 국가/);
    }
  }
});

test('direct export validates posted workbook bytes against current ERP units before returning any file', async () => {
  const [, policy] = await load;
  const route = path.join(__dirname, '../pages/api/import/tools/packing-export.js');
  const babel = require('next/dist/compiled/babel/core');
  const compiled = babel.transformSync(readFileSync(route, 'utf8'), {
    plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')], configFile: false, babelrc: false,
  }).code;
  const out = { exports: {} };
  const mocks = {
    '../../../../lib/auth': { withAuth: handler => handler },
    '../../../../lib/db': { query: async sql => {
      assert.match(sql, /SELECT[^]*OutUnit, EstUnit[^]*FROM dbo\.Product WHERE isDeleted = 0/);
      return { recordset: [product('US')] };
    } },
    '../../../../lib/packingExportBunchGuard.js': policy,
  };
  new Function('require', 'module', 'exports', compiled)(key => mocks[key], out, out.exports);
  const run = async (bytes, country = 'US', confirmations) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; },
      json(value) { this.result = value; }, send(bytes) { this.bytes = bytes; } };
    await out.exports.default({ method: 'POST', body: { country, workbook: bytes.toString('base64'), confirmations }, user: { accountActive: true } }, res);
    return res;
  };
  const rejected = await run(await book('US', {}));
  assert.equal(rejected.code, 422);
  assert.match(rejected.result.error, /원본에서 단 수량/);
  assert.equal(rejected.result.issues[0].row, 6);
  assert.equal(rejected.bytes, undefined);
  const corrected = await book('US', { total_bunch: 40, bunch_st: 10 });
  const mismatch = XLSX.read(corrected);
  mismatch.Sheets['US-HC'].I6.v = 39;
  assert.equal((await run(XLSX.write(mismatch, { type: 'buffer', bookType: 'xlsx' }))).code, 422);
  delete mismatch.Sheets['US-HC'].I6;
  const filled = await run(XLSX.write(mismatch, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(filled.code, 200);
  const filledSheet = XLSX.read(filled.bytes).Sheets['US-HC'];
  assert.equal(filledSheet.I6.v, 40);
  assert.equal(filledSheet.I58.v, 40);
  assert.equal(filledSheet.J58.v, 400);
  const missing = await book('US', {});
  const accepted = await run(missing,'US',{6:{quantity:40,reason:'Printed count verified',snapshot:rejected.result.issues[0].snapshot}});
  assert.equal(accepted.code,200);
  assert.equal(XLSX.read(accepted.bytes).Sheets['US-HC'].G6.v,10);
  assert.equal((await run(corrected, 'EC')).code, 422);
  const passed = await run(corrected);
  assert.equal(passed.code, 200);
  assert.deepEqual(passed.bytes, corrected);
});

test('source agreement fills deterministically and conflicting master values require scoped confirmation', async () => {
  const { resolveReceiptBunch } = await import('../lib/receiptBunchQuantity.js');
  const master = { ProdKey: 44, OutUnit:'박스', EstUnit:'단', SteamOf1Bunch:25, BunchOf1Box:20 };
  const row = { boxQuantity:1, stemQuantity:7500, scopeKey:['2026','47-01',1] };
  const review = resolveReceiptBunch(master,row);
  assert.deepEqual(review.candidates.map(candidate=>candidate.quantity),[300,20]);
  const confirmation = {quantity:300,reason:'Verified printed quantity',snapshot:review.snapshot};
  assert.equal(resolveReceiptBunch(master,{...row,confirmation}).status,'confirmed');
  assert.equal(resolveReceiptBunch(master,{...row,confirmation,scopeKey:['2025','47-01',1]}).status,'review');
  assert.equal(resolveReceiptBunch({...master,BunchOf1Box:21},{...row,confirmation}).status,'review');
  assert.equal(resolveReceiptBunch(master,{...row,stemsPerBunch:1,legacyWorkbook:true}).status,'review');
  assert.equal(resolveReceiptBunch(master,{boxQuantity:2,stemQuantity:400,stemsPerBunch:10,bunchesPerBox:20}).quantity,40);
  assert.equal(resolveReceiptBunch(master,{boxQuantity:2,stemQuantity:400,stemsPerBunch:10,bunchesPerBox:21}).status,'review');
  assert.equal(resolveReceiptBunch(master,{stemQuantity:401,stemsPerBunch:10}).status,'review');
});

test('US source review can supply a verified bunch value when extraction omitted the key', async () => {
  const { makePackingSourceReview, applyPackingSourceReview } = await import('../lib/importPackingSourceReview.js');
  const invoice = { invoice: 'TRAIN-47', pdfSourceHash: 'b'.repeat(64), products: [{ ...fixture, t_price: 100 }] };
  const draft = makePackingSourceReview(invoice, 'US');
  assert(Object.hasOwn(draft.rows[0].values, 'total_bunch'));
  assert.equal(draft.rows[0].values.total_bunch, '');
  draft.rows[0].values.total_bunch = '40';
  draft.rows[0].reason = 'Printed 40 bunches';
  const result = applyPackingSourceReview(invoice, draft, 'US', undefined, { requireConfirmation: false });
  assert.equal(result.products[0].total_bunch, 40);
  assert.equal(invoice.products[0].total_bunch, undefined);
});
