import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createInvoiceCostWorkbook, exportCurrentInvoiceCost } from '../lib/invoiceReceiptCostExport.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from '../lib/invoiceReceiptCost.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const template = require('../lib/invoiceCostTemplates/china-air-v1.json');
const DOC = '11111111-1111-8111-8111-111111111111';
const OP = '22222222-2222-8222-8222-222222222222';
const COST = '33333333-3333-8333-8333-333333333333';
const FORMULA = INVOICE_COST_FORMULAS.CN_AIR_WEIGHT_CBM_V1;

export function invoiceCostExportFixture(count = 28) {
  const document = { documentId: DOC, revision: 2, sourceHash: 'ab'.repeat(32), orderYear: '2026', orderWeek: '41-02',
    invoiceYear: '2026', invoiceNo: 'CURRENT-EXPORT', receiptStatus: 'COMMITTED', costStatus: 'APPROVED', history: [],
    reviewedMetadata: { country: 'CN', transportMode: 'AIR', inputDate: '2026-10-12', gw: count * 2, cw: count * 3, farmName: 'Current Farm' },
    lines: Array.from({ length: count }, (_, i) => ({ lineId: `aaaaaaaa-aaaa-8aaa-8aaa-${(i + 1).toString(16).padStart(12, '0')}`,
      lineNo: i + 1, originalName: `CURRENT FLOWER ${i + 1}`, prodKey: i + 1, lineAmount: 100 + i, unitPrice: 10,
      currency: 'CNY', priceUnit: 'BUNCH' })) };
  const input = { ...FORMULA, formulaApplicabilityConfirmed: true, formulaEffectiveDate: '2026-10-12', nativeCurrency: 'CNY', freightCurrency: 'CNY',
    exchangeRateKRW: 201.25, exchangeRateType: 'PURCHASE', exchangeRateDate: '2026-10-12', freightAmount: 817.25,
    customsTotalKRW: 7345, costSourceId: 'current-bill', allocationScope: 'SINGLE_INVOICE', allocationShareNumerator: 1, allocationShareDenominator: 1,
    lineInputs: document.lines.map(line => ({ lineId: line.lineId, grossWeightKg: 2, volumeWeightKg: 3, tariffRate: 0.214, otherCostPerUnitKRW: 12 })) };
  const receipt = document.lines.map((line, i) => ({ ...line, wdetailKey: 1000 + i, outQuantity: 10 + i,
    outUnit: ['단', '송이', '박스'][i % 3] }));
  const computed = previewInvoiceCost({ ...document, costInput: input }, receipt);
  assert.equal(computed.status, 'APPROVED');
  const revision = { costRevisionId: COST, documentId: DOC, documentRevision: 2, warehouseKey: 901, operationId: OP, revisionNo: 3,
    basis: 'ACTUAL', status: 'APPROVED', storedStatus: 'APPROVED', liveReceiptStatus: 'MATCH',
    formulaId: FORMULA.formulaId, formulaVersion: FORMULA.formulaVersion, formulaSourceHash: FORMULA.formulaSourceHash,
    lines: computed.lines.map((line, i) => ({ ...line, wdetailKey: receipt[i].wdetailKey })), totalCostKRW: computed.totals.totalCostKRW };
  document.operations = [{ operationId: OP, status: 'COMMITTED', documentRevision: 2, warehouseKey: 901,
    result: { receiptDigest: 'cd'.repeat(32), lineMappings: receipt.map(line => ({ lineId: line.lineId, wdetailKey: line.wdetailKey,
      prodKey: line.prodKey, outQuantity: line.outQuantity, unit: line.outUnit })) } }];
  const snapshot = { schemaVersion: 1, basis: 'ACTUAL', saveFingerprint: 'ef'.repeat(32), invoiceSourceHash: document.sourceHash,
    receiptDigest: 'cd'.repeat(32), formula: { id: FORMULA.formulaId, version: FORMULA.formulaVersion, sourceHash: FORMULA.formulaSourceHash,
      sheet: FORMULA.formulaSourceSheet, cells: FORMULA.formulaSourceCells, applicabilityConfirmed: true }, input,
    receiptSnapshot: { warehouseKey: 901, details: receipt.map(line => ({ lineId: line.lineId, wdetailKey: line.wdetailKey, prodKey: line.prodKey,
      outQuantity: line.outQuantity, unitPrice: line.unitPrice, lineAmount: line.lineAmount })) } };
  return { document, revision, snapshot };
}

test('28 rows preserve OOXML style/theme/width/height/merges and exact approved unit/total values', async () => {
  const f = invoiceCostExportFixture(); const bytes = await createInvoiceCostWorkbook(f);
  const zip = await JSZip.loadAsync(bytes);
  assert.equal(await zip.file('xl/styles.xml').async('string'), template.styles);
  assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), template.theme);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  for (const part of [template.cols, template.sheetFormatPr, template.sheetViews, template.print]) assert.ok(sheet.includes(part));
  for (const merge of template.merges) assert.ok(sheet.includes(`ref="${merge}"`));
  assert.ok(sheet.includes('ref="B51:D51"'));
  const rowRefs = [...sheet.matchAll(/<row\s+r="(\d+)"/g)].map(m => m[1]);
  assert.equal(rowRefs.length, 51); assert.equal(new Set(rowRefs).size, 51);
  assert.ok(sheet.includes(template.rows[23].attrs.replace('r="24"', 'r="51"')));
  assert.ok(sheet.includes('<c r="M24" s="114">'));
  assert.ok(sheet.includes('<c r="M51" s="114">'));
  const workbook = XLSX.read(bytes, { cellStyles: true });
  assert.deepEqual(workbook.SheetNames, ['승인 원가']); const s = workbook.Sheets['승인 원가'];
  assert.equal(s.M23.v, '도착원가(단위)'); assert.equal(s.O23.v, '총 도착원가'); assert.equal(s.N23.v, 'ERP 단위');
  f.revision.lines.forEach((line, i) => {
    assert.equal(s[`B${24 + i}`].v, f.document.lines[i].originalName);
    assert.equal(s[`M${24 + i}`].v, line.costPerUnitKRW); assert.equal(s[`O${24 + i}`].v, line.totalCostKRW);
    assert.equal(s[`N${24 + i}`].v, line.unit); assert.equal(s[`E${24 + i}`].v, line.quantity);
    assert.equal(s[`P${24 + i}`].v, line.componentAmounts.otherKRW / line.quantity);
  });
  assert.equal(s.C10.v, f.revision.totalCostKRW);
  assert.equal(s.J6.v, '항목'); assert.equal(s.K6.v, '승인값'); assert.equal(s.K6.t, 's');
  assert.equal(s.K9.v, String(f.document.revision)); assert.equal(s.K9.t, 's');
  assert.equal(s.K10.v, String(f.revision.revisionNo)); assert.equal(s.K10.t, 's');
  assert.equal(s.P10.v, f.snapshot.input.customsTotalKRW);
  for (const ref of ['P6', 'P7', 'P8', 'P9', 'R6', 'R7']) assert.equal(s[ref]?.v, undefined);
  assert.equal(s.C8.v, 56); assert.equal(s.E8.v, 84);
});

test('format-only template and generated package contain no historical rows, formulas, selling/profit, or raw snapshots', async () => {
  const f = invoiceCostExportFixture(2);
  f.document.lines[0].originalName = '=HYPERLINK("https://example.invalid","not a formula")';
  f.snapshot.privateField = 'SERVER_ONLY_PRIVATE';
  const zip = await JSZip.loadAsync(await createInvoiceCostWorkbook(f));
  const parts = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  assert.equal(parts.filter(name => /^xl\/worksheets\//.test(name)).length, 1);
  assert.ok(!parts.some(name => /sharedStrings|externalLinks|comments|calcChain|drawings|vba/i.test(name)));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.doesNotMatch(sheet, /<f\b|t="e"|SERVER_ONLY_PRIVATE|ROSE|Gypsophila|372660|4706\.597090|판매|이익/);
  const s = XLSX.read(await zip.generateAsync({ type: 'nodebuffer' })).Sheets['승인 원가'];
  assert.equal(s.B24.t, 's'); assert.equal(s.B24.f, undefined);
  for (const col of ['Q', 'R', 'S', 'T', 'U', 'V']) assert.equal(s[`${col}24`]?.v, undefined);
  for (const row of template.rows) for (const cell of row.cells) assert.deepEqual(Object.keys(cell).sort(), ['ref', 'style']);
});

test('normalized cost snapshot accepts native ERP unit aliases without quantity conversion and rejects different or unknown units', async () => {
  const f = invoiceCostExportFixture(3);
  assert.deepEqual(f.document.operations[0].result.lineMappings.map(line => line.unit), ['단', '송이', '박스']);
  assert.deepEqual(f.revision.lines.map(line => line.unit), ['BUNCH', 'STEM', 'BOX']);
  // committedReceiptSnapshot stores normalized numeric detail fields, not unit labels.
  assert.ok(f.snapshot.receiptSnapshot.details.every(line => !('unit' in line)));
  const sheet = XLSX.read(await createInvoiceCostWorkbook(f)).Sheets['승인 원가'];
  f.revision.lines.forEach((line, i) => {
    assert.equal(sheet[`N${24 + i}`].v, line.unit);
    assert.equal(sheet[`E${24 + i}`].v, line.quantity);
    assert.equal(sheet[`M${24 + i}`].v, line.costPerUnitKRW);
  });
  for (const unit of ['박스', 'KG', '', null]) {
    const bad = structuredClone(f); bad.document.operations[0].result.lineMappings[0].unit = unit;
    await assert.rejects(createInvoiceCostWorkbook(bad), error => error.code === 'COST_EXPORT_LINE_MISMATCH');
  }
});

test('generator fails closed for stale, unsupported, source/revision/operation/unit/amount drift and missing source', async () => {
  const cases = [
    f => { f.revision.status = 'STALE'; }, f => { f.document.revision++; }, f => { f.snapshot.invoiceSourceHash = '00'.repeat(32); },
    f => { f.document.operations = []; }, f => { f.document.lines[0].originalName = ''; }, f => { f.revision.lines[0].unit = 'KG'; },
    f => { f.revision.lines[0].unit = 'BOX'; },
    f => { f.revision.lines[0].costPerUnitKRW++; }, f => { f.revision.lines[0].componentAmounts.otherKRW++; },
    f => { f.snapshot.input.exchangeRateKRW = null; }, f => { f.snapshot.receiptSnapshot.details.pop(); },
  ];
  for (const mutate of cases) { const f = invoiceCostExportFixture(2); mutate(f); await assert.rejects(createInvoiceCostWorkbook(f)); }
  const f = invoiceCostExportFixture(); f.revision.formulaId = 'NL_AMOUNT_V1';
  await assert.rejects(createInvoiceCostWorkbook(f), error => error.code === 'EXPORT_TEMPLATE_UNSUPPORTED');
});

function harness() {
  const f = invoiceCostExportFixture(2); let reads = 0; const queries = [];
  const types = { UniqueIdentifier: 'UUID', Int: 'INT' };
  const costs = () => ({ status: 'APPROVED', documentCostStatus: 'APPROVED', documentId: DOC, documentRevision: f.document.revision,
    operationId: OP, warehouseKey: 901, currentActual: f.revision });
  const args = { queryFn: async (sql, params) => { queries.push({ sql, params }); return { recordset: [{ InputSnapshotJson: JSON.stringify(f.snapshot) }] }; },
    types, documentId: DOC, costRevisionId: COST, warehouseKey: '901', readDocument: async () => structuredClone(f.document),
    readCosts: async () => { reads++; return structuredClone(costs()); } };
  return { f, args, queries, reads: () => reads };
}

test('export wrapper selects the exact private snapshot and rechecks current state after generation', async () => {
  const h = harness(); const result = await exportCurrentInvoiceCost(h.args);
  assert.ok(Buffer.isBuffer(result.buffer)); assert.equal(result.filename, 'invoice-cost-2026-41-02-r2-11111111.xlsx'); assert.equal(h.reads(), 2);
  assert.equal(h.queries.length, 2);
  for (const { sql, params } of h.queries) {
    assert.match(sql, /DocumentRevision=@documentRevision AND OperationId=@operationId AND WarehouseKey=@warehouseKey/);
    assert.equal(params.documentId.value, DOC); assert.equal(params.costRevisionId.value, COST);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
  }
});

test('export wrapper blocks stale/mixed scope and generation races but ignores append-only history', async () => {
  for (const field of ['costRevisionId', 'documentId', 'operationId', 'warehouseKey']) {
    const h = harness(); h.f.revision[field] = field === 'warehouseKey' ? 902 : '99999999-9999-8999-8999-999999999999';
    await assert.rejects(exportCurrentInvoiceCost(h.args));
  }
  for (const change of ['history', 'price', 'revision', 'status']) {
    const h = harness();
    h.args.generate = async data => { const bytes = await createInvoiceCostWorkbook(data);
      if (change === 'history') { h.f.document.history.push({ action: 'STAGE_LOG' }); h.f.document.updatedAt = new Date(); }
      if (change === 'price') h.f.snapshot.input.freightAmount++;
      if (change === 'revision') h.f.document.revision++;
      if (change === 'status') h.f.revision.status = 'STALE';
      return bytes;
    };
    if (change === 'history') assert.ok((await exportCurrentInvoiceCost(h.args)).buffer);
    else await assert.rejects(exportCurrentInvoiceCost(h.args));
  }
  const h = harness(); h.args.warehouseKey = ['901']; await assert.rejects(exportCurrentInvoiceCost(h.args), e => e.statusCode === 400);
});

test('route enforces GET, real receipt role policy, no-store, binary response, and safe errors', async () => {
  const accessSource = readFileSync(new URL('../lib/invoiceReceiptAccess.js', import.meta.url), 'utf8');
  const canManageInvoiceReceipt = new Function('hasFullWebAccess', 'isAdminUser', accessSource.replace(/^import .*;\r?$/gm, '').replace('export function', 'function') + '\nreturn canManageInvoiceReceipt;')(() => false, () => false);
  const route = readFileSync(new URL('../pages/api/import/receipts/[id]/cost-export.js', import.meta.url), 'utf8');
  assert.match(route, /export default withAuth\(createInvoiceCostExportHandler\(\)\)/);
  require('next/dist/compiled/babel/core').transformSync(route, { filename: 'cost-export.js', presets: ['next/babel'] });
  const factory = new Function('canManageInvoiceReceipt', route.replace(/^import .*;\r?$/gm, '')
    .replace('export function', 'function').replace(/export default withAuth[\s\S]*$/, '') + '\nreturn createInvoiceCostExportHandler;')(canManageInvoiceReceipt);
  const response = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } });
  let calls = 0; const handler = factory({ queryFn: () => {}, types: {}, exportFn: async () => { calls++; return { buffer: Buffer.from('xlsx'), filename: 'cost.xlsx' }; } });
  const req = { method: 'GET', query: { id: DOC, warehouseKey: '901', costRevisionId: COST }, user: { userId: 'import-user', deptName: '수입부' } };
  let res = response(); await handler({ ...req, method: 'POST' }, res); assert.equal(res.code, 405);
  res = response(); await handler({ ...req, user: {} }, res); assert.equal(res.code, 403); assert.equal(calls, 0);
  res = response(); await handler(req, res); assert.equal(res.code, 200); assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  const failing = factory({ queryFn: () => {}, types: {}, exportFn: async () => { throw new Error('private SQL detail'); } });
  res = response(); await failing(req, res); assert.equal(res.code, 503); assert.doesNotMatch(JSON.stringify(res.body), /private SQL detail/);
});

const referencePath = 'C:/Users/USER/Downloads/CHINA 중국 원가자료 (8).xlsx';
test('template formatting matches the verified original and original file is not changed', { skip: !existsSync(referencePath) }, async () => {
  const bytes = readFileSync(referencePath); assert.equal(createHash('sha256').update(bytes).digest('hex'), FORMULA.formulaSourceHash);
  const zip = await JSZip.loadAsync(bytes);
  assert.equal(await zip.file('xl/styles.xml').async('string'), template.styles);
  assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), template.theme);
  const original = await zip.file('xl/worksheets/sheet28.xml').async('string');
  for (const part of [template.cols, template.sheetViews, template.sheetFormatPr, template.print]) assert.ok(original.includes(part));
  await createInvoiceCostWorkbook(invoiceCostExportFixture());
  assert.equal(createHash('sha256').update(readFileSync(referencePath)).digest('hex'), FORMULA.formulaSourceHash);
});
