const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ready = Promise.all([
  import('../lib/packingReceiptMatchState.js'),
  import('../lib/importPackingReceiptAdapter.js'),
]);

const catalog = [
  { ProdKey: 2265, ProdName: 'Rose White Proud 1', country: 'CN', selectable: true },
  { ProdKey: 3190, ProdName: 'Rose White Proud 2', country: 'CN', selectable: true },
];
const hash = 'a'.repeat(64);

async function fixture() {
  const [, adapter] = await ready;
  const file = { name: 'source.xlsx' };
  const invoices = [0, 1].map((index) => ({ invoice: `INV-${index}`, supplier: 'HUBFRESH',
    source_format: 'china_invoice_xlsx', products: [{ description: 'Rose White Proud [75-80cm]', source_description: 'Rose White Proud', source_row: 27 + index }] }));
  const excels = invoices.map((invoice, index) => ({ sourceInvoiceIdentity: adapter.packingInvoiceSourceIdentity(invoice, index), products: [{
    matchingDescription: invoice.products[0].description, sourceName: invoice.products[0].source_description,
    source_row: invoice.products[0].source_row, unmatched: true,
  }] }));
  const records = invoices.map((invoice, index) => ({ document: {
    sourceHash: hash,
    rawMetadata: { sourceInvoiceIdentity: excels[index].sourceInvoiceIdentity },
    lines: [{ lineId: `line-${index}`, lineNo: 1, originalName: 'Rose White Proud', prodKey: null,
      reviewed: { erpMatchConfirmed: false },
      sourceEvidence: { sourceInvoiceIndex: index, sourceLineIndex: 0, sourceRow: 27 + index,
        matchingDescription: invoice.products[0].description } }],
  } }));
  const snapshot = { file, excels, invoices, country: 'CN', sourceHash: hash, records };
  return { file, excels, invoices, country: 'CN', products: catalog, snapshot };
}

test('distinct same-description invoices require per-line confirmed choices and aggregate all records', async () => {
  const [{ packingReceiptMatchState, effectivePackingMatchReview }] = await ready;
  const input = await fixture();
  input.snapshot.records[0].document.lines[0].prodKey = 2265; // untouched fuzzy candidate
  let state = packingReceiptMatchState(input);
  assert.equal(state.documentPending, 2);
  assert.equal(state.byRow.get('0:0').prodKey, null);
  input.snapshot.records[0].document.lines[0].reviewed.erpMatchConfirmed = true;
  input.snapshot.records[1].document.lines[0].prodKey = 3190;
  input.snapshot.records[1].document.lines[0].reviewed.erpMatchConfirmed = true;
  state = packingReceiptMatchState(input);
  assert.equal(state.documentTotal, 2);
  assert.equal(state.documentPending, 0);
  assert.equal(state.byRow.get('0:0').prodKey, 2265);
  assert.equal(state.byRow.get('1:0').prodKey, 3190);
  assert.equal(effectivePackingMatchReview({ needsReview: true }, state.byRow.get('1:0')).status, 'DOCUMENT');
  assert.equal(effectivePackingMatchReview({ needsReview: true }, state.byRow.get('1:0')).label.includes('팀 공용 저장 아님'), true);
});

test('clear, invalid country, deleted or unselectable product become pending', async () => {
  const [{ packingReceiptMatchState }] = await ready;
  const input = await fixture();
  const line = input.snapshot.records[0].document.lines[0];
  line.prodKey = 2265; line.reviewed.erpMatchConfirmed = true;
  assert.equal(packingReceiptMatchState(input).documentPending, 1);
  line.prodKey = null; line.reviewed.erpMatchConfirmed = false;
  assert.equal(packingReceiptMatchState(input).byRow.get('0:0').prodKey, null);
  line.prodKey = 2265; line.reviewed.erpMatchConfirmed = true;
  assert.equal(packingReceiptMatchState({ ...input, products: [{ ...catalog[0], country: 'NL' }] }).documentPending, 2);
  assert.equal(packingReceiptMatchState({ ...input, products: [] }).documentPending, 2);
  assert.equal(packingReceiptMatchState({ ...input, products: [{ ...catalog[0], selectable: false }] }).documentPending, 2);
});

test('stale file, regenerated result, source identity and source-line mismatch cannot overlay', async () => {
  const [{ packingReceiptMatchState }] = await ready;
  const input = await fixture();
  assert.equal(packingReceiptMatchState({ ...input, file: { name: 'new.xlsx' } }).valid, false);
  assert.equal(packingReceiptMatchState({ ...input, excels: input.excels.map(excel => ({ ...excel })) }).valid, false);
  assert.equal(packingReceiptMatchState({ ...input, invoices: input.invoices.map(invoice => ({ ...invoice })) }).valid, false);
  input.excels[0].sourceInvoiceIdentity = { ...input.excels[0].sourceInvoiceIdentity, invoiceNo: 'OTHER' };
  assert.equal(packingReceiptMatchState(input).valid, false);
  input.excels[0].sourceInvoiceIdentity = input.snapshot.records[0].document.rawMetadata.sourceInvoiceIdentity;
  input.snapshot.records[0].document.lines[0].sourceEvidence.sourceRow = 999;
  assert.equal(packingReceiptMatchState(input).valid, false);
});

test('ambiguous or consolidated generated rows keep a truthful document-only summary', async () => {
  const [{ packingReceiptMatchState }] = await ready;
  const input = await fixture();
  input.snapshot.records[0].document.lines[0].prodKey = 2265;
  input.snapshot.records[0].document.lines[0].reviewed.erpMatchConfirmed = true;
  input.excels[0].products = [];
  const state = packingReceiptMatchState(input);
  assert.equal(state.valid, true);
  assert.equal(state.overlayComplete, false);
  assert.equal(state.documentTotal, 2);
  assert.equal(state.documentPending, 1);
  assert.equal(state.byRow.has('0:0'), false);
});

test('UI wiring publishes explicit selection and does not make catalog refresh re-adapt drafts or unlock old buffers', () => {
  const root = path.join(__dirname, '..');
  const workbench = fs.readFileSync(path.join(root, 'components/import-tools/InvoiceReceiptWorkbench.js'), 'utf8');
  const packing = fs.readFileSync(path.join(root, 'components/import-tools/PackingListTool.js'), 'utf8');
  assert.match(workbench, /reviewed:\s*\{\s*\.\.\.\(line\.reviewed\s*\|\|\s*\{\}\),\s*erpMatchConfirmed:\s*Boolean\(product\)/);
  assert.match(workbench, /onMatchStateChange\?\.\(\{\s*\.\.\.scope,\s*sourceHash:/);
  assert.match(packing, /setGeneratedErp\(currentErp\)/);
  assert.doesNotMatch(packing, /setGeneratedErp\(data\)/);
  assert.match(packing, /isPackingDownloadBlocked\(excel,/);
  assert.match(packing, /if \(isBlocked\(excels\.find/);
  assert.match(packing, /이미 생성된 패킹 파일의 다운로드는 기존 검증을 유지/);
});

test('generated-file notice separates current receipt matches from old buffers without hiding errors or active steps', () => {
  const packing = fs.readFileSync(path.join(__dirname, '../components/import-tools/PackingListTool.js'), 'utf8');
  assert.match(packing, /receiptStatus\?\.valid\s*&&\s*status\.type\s*!==\s*'error'\s*&&\s*!processing\s*\?\s*'기존 패킹 파일 생성 결과입니다\. 현재 행별 매칭 상태는 아래에 표시하며, 입고 문서에서 변경한 품목은 기존 패킹 파일에 소급 반영되지 않습니다\.'/);
  assert.match(packing, /:\s*status\.msg\s*\}/);
  assert.match(packing, /steps\.length\s*>\s*0\s*&&\s*\(processing\s*\|\|\s*!receiptStatus\?\.valid\)/);
  assert.match(packing, /data-testid="packing-receipt-match-summary"/);
  assert.doesNotMatch(packing, /생성済/);
});
