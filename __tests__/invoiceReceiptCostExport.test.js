import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import JSZip from 'jszip';
import { createInvoiceCostWorkbook, exportCurrentInvoiceCost } from '../lib/invoiceReceiptCostExport.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost } from '../lib/invoiceReceiptCost.js';
import { INVOICE_COST_EXPORT_PROFILES, supportsInvoiceCostExport } from '../lib/invoiceCostExportProfiles.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const template = require('../lib/invoiceCostTemplates/china-air-v1.json');
const DOC = '11111111-1111-8111-8111-111111111111';
const OP = '22222222-2222-8222-8222-222222222222';
const COST = '33333333-3333-8333-8333-333333333333';
const FORMULA = INVOICE_COST_FORMULAS.CN_AIR_WEIGHT_CBM_V1;

function assertFormatOnlyStyleClones(actual, original) {
  const pattern = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/;
  const old = original.match(pattern), next = actual.match(pattern);
  assert.ok(next[1].startsWith(old[1]), 'all original styles must remain byte-for-byte unchanged');
  const oldXfs = [...old[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0]);
  const normalize = xf => xf.replace(/\s+(?:numFmtId|applyNumberFormat)="[^"]*"/g, '');
  for (const match of next[1].slice(old[1].length).matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    assert.match(match[0], /numFmtId="4"/);
    assert.ok(oldXfs.some(xf => normalize(xf) === normalize(match[0])), 'clone may change only numeric formatting');
  }
  assert.equal(actual.replace(next[0], old[0]), original, 'fonts/colors/width-independent style parts stay exact');
}

export function invoiceCostExportFixture(count = 28, formulaId = 'CN_AIR_WEIGHT_CBM_V1') {
  const formula = INVOICE_COST_FORMULAS[formulaId];
  const additional = Boolean(formula.priceBasis), currency = additional ? 'USD' : formulaId === 'NL_AMOUNT_V1' ? 'EUR' : 'CNY';
  const nl = formulaId === 'NL_AMOUNT_V1', sea = formulaId === 'CN_SEA_ACTUAL_V1';
  const document = { documentId: DOC, revision: 2, sourceHash: 'ab'.repeat(32), orderYear: '2026', orderWeek: '41-02',
    invoiceYear: '2026', invoiceNo: 'CURRENT-EXPORT', receiptStatus: 'COMMITTED', costStatus: 'APPROVED', history: [],
    reviewedMetadata: { country: additional ? formula.country : nl ? 'NL' : 'CN', transportMode: sea ? 'SEA' : 'AIR', inputDate: '2026-10-12', gw: count * 2, cw: count * 3, farmName: 'Current Farm' },
    lines: Array.from({ length: count }, (_, i) => ({ lineId: `aaaaaaaa-aaaa-8aaa-8aaa-${(i + 1).toString(16).padStart(12, '0')}`,
      lineNo: i + 1, originalName: `CURRENT FLOWER ${i + 1}`, prodKey: i + 1, lineAmount: 100 + i, unitPrice: 10,
      currency, priceUnit: additional ? formula.priceBasis : nl ? 'STEM' : 'BUNCH' })) };
  if (nl) document.lines.forEach((line, i) => {
    line.stemQuantity = (10 + i) * (i % 2 === 0 ? 5 : 1); line.lineAmount = line.unitPrice * line.stemQuantity;
  });
  const input = { ...formula, formulaApplicabilityConfirmed: true, formulaEffectiveDate: '2026-10-12', nativeCurrency: currency, freightCurrency: currency,
    exchangeRateKRW: 201.25, exchangeRateType: 'PURCHASE', exchangeRateDate: '2026-10-12', freightAmount: 817.25,
    customsTotalKRW: 7345, costSourceId: 'current-bill', allocationScope: 'SINGLE_INVOICE', allocationShareNumerator: 1, allocationShareDenominator: 1,
    lineInputs: document.lines.map(line => ({ lineId: line.lineId, grossWeightKg: 2, volumeWeightKg: 3, tariffRate: 0.214, otherCostPerUnitKRW: additional ? 0 : 12, stemsPerBunch: 5, bunchesPerBox: 20 })) };
  const receipt = document.lines.map((line, i) => ({ ...line, wdetailKey: 1000 + i, outQuantity: 10 + i,
    outUnit: sea ? '단' : nl ? ['단', '송이'][i % 2] : ['단', '송이', '박스'][i % 3] }));
  if (additional) {
    if (formula.freightIncluded) input.freightAmount = 0;
    receipt.forEach((line, i) => {
      const unit = ['BUNCH', 'STEM', 'BOX'][i % 3];
      const factor = formula.priceBasis === unit ? 1 : formula.priceBasis === 'BOX' ? (unit === 'BUNCH' ? 1 / 20 : 1 / 100)
        : formula.priceBasis === 'STEM' ? (unit === 'BUNCH' ? 5 : 100) : (unit === 'STEM' ? 1 / 5 : 20);
      line.lineAmount = line.unitPrice * line.outQuantity * factor;
      document.lines[i].lineAmount = line.lineAmount;
    });
  }
  if (formula.groupIds) {
    const groups = new Map();
    input.lineInputs.forEach((line, i) => {
      delete line.grossWeightKg; delete line.volumeWeightKg;
      line.groupId = formula.groupIds[i % formula.groupIds.length];
      line.tariffRate = formula.country === 'CO' ? 0 : 0.05;
      receipt[i].boxQuantity = receipt[i].lineAmount / receipt[i].unitPrice / 100;
      document.lines[i].boxQuantity = receipt[i].boxQuantity;
      groups.set(line.groupId, (groups.get(line.groupId) || 0) + receipt[i].lineAmount / receipt[i].unitPrice);
    });
    input.costGroups = [...groups].map(([groupId, quantity]) => ({ groupId, quantity,
      boxQuantity: receipt.reduce((sum, row, i) => sum + (input.lineInputs[i].groupId === groupId ? row.boxQuantity : 0), 0),
      ...(formula.country === 'CO' ? { grossWeightKg: document.reviewedMetadata.gw / groups.size, volumeWeightKg: document.reviewedMetadata.cw / groups.size } : {}) }));
    input.lossTreatmentConfirmed = true;
  }
  const computed = previewInvoiceCost({ ...document, costInput: input }, receipt);
  assert.equal(computed.status, 'APPROVED');
  const revision = { costRevisionId: COST, documentId: DOC, documentRevision: 2, warehouseKey: 901, operationId: OP, revisionNo: 3,
    basis: 'ACTUAL', status: 'APPROVED', storedStatus: 'APPROVED', liveReceiptStatus: 'MATCH',
    formulaId: formula.formulaId, formulaVersion: formula.formulaVersion, formulaSourceHash: formula.formulaSourceHash,
    lines: computed.lines.map((line, i) => ({ ...line, wdetailKey: receipt[i].wdetailKey })), totalCostKRW: computed.totals.totalCostKRW };
  document.operations = [{ operationId: OP, status: 'COMMITTED', documentRevision: 2, warehouseKey: 901,
    result: { receiptDigest: 'cd'.repeat(32), lineMappings: receipt.map(line => ({ lineId: line.lineId, wdetailKey: line.wdetailKey,
      prodKey: line.prodKey, outQuantity: line.outQuantity, unit: line.outUnit })) } }];
  const snapshot = { schemaVersion: 1, basis: 'ACTUAL', saveFingerprint: 'ef'.repeat(32), invoiceSourceHash: document.sourceHash,
    receiptDigest: 'cd'.repeat(32), formula: { id: formula.formulaId, version: formula.formulaVersion, sourceHash: formula.formulaSourceHash,
      sheet: formula.formulaSourceSheet, cells: formula.formulaSourceCells, applicabilityConfirmed: true }, input,
    receiptSnapshot: { warehouseKey: 901, details: receipt.map(line => ({ lineId: line.lineId, wdetailKey: line.wdetailKey, prodKey: line.prodKey,
      outQuantity: line.outQuantity, boxQuantity: line.boxQuantity, stemQuantity: line.stemQuantity, unitPrice: line.unitPrice, lineAmount: line.lineAmount })) } };
  return { document, revision, snapshot };
}

test('28 rows preserve OOXML style/theme/width/height/merges and exact approved unit/total values', async () => {
  const f = invoiceCostExportFixture(); const bytes = await createInvoiceCostWorkbook(f);
  const zip = await JSZip.loadAsync(bytes);
  assert.equal(await zip.file('xl/styles.xml').async('string'), template.styles);
  assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), template.theme);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  for (const part of [template.cols, template.sheetFormatPr, template.sheetViews, template.print]) assert.ok(sheet.includes(part));
  for (const merge of template.merges.filter(ref => ref !== 'B5:B6' && ref !== 'C5:C6')) assert.ok(sheet.includes(`ref="${merge}"`));
  assert.ok(sheet.includes('ref="C5:D5"'));
  assert.ok(!sheet.includes('ref="B5:B6"') && !sheet.includes('ref="C5:C6"'));
  assert.ok(sheet.includes('ref="B51:D51"'));
  const rowRefs = [...sheet.matchAll(/<row\s+r="(\d+)"/g)].map(m => m[1]);
  assert.equal(rowRefs.length, 51); assert.equal(new Set(rowRefs).size, 51);
  assert.ok(sheet.includes(template.rows[23].attrs.replace('r="24"', 'r="51"')));
  assert.ok(sheet.includes('<c r="M24" s="114">'));
  assert.ok(sheet.includes('<c r="M51" s="114">'));
  const workbook = XLSX.read(bytes, { cellStyles: true });
  assert.deepEqual(workbook.SheetNames, ['2026 41-02']); const s = workbook.Sheets['2026 41-02'];
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

test('CN air header anchors are separate and no merged range contains populated non-anchor cells', async () => {
  const f = invoiceCostExportFixture(28);
  const bytes = await createInvoiceCostWorkbook(f);
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const cells = new Set([...sheet.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*><(?:v|is)>/g)]
    .map(([, ref]) => ref));
  const merges = [...sheet.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"\/>/g)]
    .map(([, first, last]) => [first, last]);
  const point = ref => {
    const [, letters, row] = ref.match(/^([A-Z]+)(\d+)$/);
    return [Number(row), [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)];
  };
  for (const [first, last] of merges) {
    const [top, left] = point(first), [bottom, right] = point(last);
    for (const ref of cells) {
      const [row, col] = point(ref);
      if (row >= top && row <= bottom && col >= left && col <= right) {
        assert.equal(ref, first, `${ref} is populated inside ${first}:${last}`);
      }
    }
  }
  const s = XLSX.read(bytes).Sheets['2026 41-02'];
  assert.equal(s.B5.v, '차수');
  assert.equal(s.C5.v, '2026/41-02');
  assert.equal(s.J5.v, '승인 입력·합계');
  assert.equal(s.O5.v, '승인값 스냅샷 · 재계산 수식 없음');
  assert.ok(merges.some(([first, last]) => first === 'C5' && last === 'D5'));
  assert.ok(merges.some(([first, last]) => first === 'J5' && last === 'M5'));
  assert.ok(merges.some(([first, last]) => first === 'O5' && last === 'U5'));
  assert.doesNotMatch(await zip.file('xl/styles.xml').async('string'), /shrinkToFit/);
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
  const s = XLSX.read(await zip.generateAsync({ type: 'nodebuffer' })).Sheets['2026 41-02'];
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
  const sheet = XLSX.read(await createInvoiceCostWorkbook(f)).Sheets['2026 41-02'];
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
  const f = invoiceCostExportFixture(); f.revision.formulaId = 'UNVERIFIED_FORMULA';
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

for (const [profileId, filename, count] of [
  ['NL_ORIGINAL_V1', 'muwamf7z-fc9448.xlsx', 60], ['CN_SEA_ORIGINAL_V1', 'muw7yf7b-5e9241.xlsx', 105],
]) {
  test(`${profileId} committed asset formatting, expanded rows, approved values and no historical payload`, async () => {
    const profile = INVOICE_COST_EXPORT_PROFILES[profileId], nl = profileId === 'NL_ORIGINAL_V1';
    const asset = require(`../lib/invoiceCostTemplates/${nl ? 'netherlands' : 'china-sea'}-v1.json`);
    const f = invoiceCostExportFixture(count, profile.formulaId);
    // Saved allocation share is already applied: export must not multiply it again.
    const bytes = await createInvoiceCostWorkbook(f), zip = await JSZip.loadAsync(bytes);
    assert.equal(await zip.file('xl/styles.xml').async('string'), asset.styles);
    assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), asset.theme);
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    for (const part of [asset.cols, asset.sheetViews, asset.sheetFormatPr, asset.print]) assert.ok(sheet.includes(part));
    for (const row of asset.rows) assert.ok(sheet.includes(`<row ${row.attrs}>`));
    for (const merge of asset.merges) assert.ok(sheet.includes(`ref="${merge}"`));
    const last = profile.detailStartRow + count - 1;
    assert.ok(sheet.includes(`ref="B${last}:D${last}"`));
    const refs = [...sheet.matchAll(/<row\s+r="(\d+)"/g)].map(m => m[1]);
    assert.equal(new Set(refs).size, refs.length); assert.equal(refs.at(-1), String(last));
    const output = XLSX.read(bytes, { cellNF: true }), s = output.Sheets['2026 41-02'];
    assert.deepEqual(output.SheetNames, ['2026 41-02']); assert.equal(s.C10.v, f.revision.totalCostKRW);
    f.revision.lines.forEach((cost, i) => {
      const r = profile.detailStartRow + i;
      assert.equal(s[`B${r}`].v, f.document.lines[i].originalName);
      assert.equal(s[`${nl ? 'O' : 'N'}${r}`].v, cost.costPerUnitKRW);
      assert.equal(s[`${nl ? 'T' : 'P'}${r}`].v, cost.totalCostKRW);
      assert.equal(s[`${nl ? 'R' : 'O'}${r}`].v, cost.unit);
      assert.equal(s[`${nl ? 'S' : 'E'}${r}`].v, cost.quantity);
      assert.doesNotMatch(s[`${nl ? 'S' : 'E'}${r}`].z || '', /[$₩€%]|\[\$/);
      if (nl) {
        assert.equal(s[`M${r}`].v, cost.componentAmounts.arrivalPerStemKRW);
        assert.equal(s[`P${r}`].v, cost.componentAmounts.vatIncludedCostPerUnitKRW);
        assert.equal(s[`N${r}`].v, i % 2 === 0 ? 5 : 1);
      } else assert.equal(s[`M${r}`].v, cost.componentAmounts.otherKRW / cost.quantity);
      for (const col of nl ? ['Q', 'U', 'V', 'W'] : ['G', 'Q', 'R', 'S', 'T', 'U', 'V', 'W']) assert.equal(s[`${col}${r}`]?.v, undefined);
    });
    assert.doesNotMatch(sheet, /<f\b|t="e"|95% 선적시|Eryngium|Ammi CHINA|SERVER_ONLY/);
    for (const row of asset.rows) for (const cell of row.cells) assert.deepEqual(Object.keys(cell).sort(), ['ref', 'style']);
    for (const mutate of [
      f => { delete f.revision.lines[0].componentAmounts.freightKRW; },
      f => { f.revision.lines[0].componentAmounts.fabricated = 0; },
      f => { f.revision.lines[0].componentAmounts[nl ? 'amountShare' : 'otherKRW']++; },
      f => { f.document.reviewedMetadata.country = 'US'; },
      f => { f.document.reviewedMetadata.transportMode = nl ? 'SEA' : 'AIR'; },
    ]) {
      const bad = structuredClone(f); mutate(bad); await assert.rejects(createInvoiceCostWorkbook(bad));
    }
  });
  test(`${profileId} private wrapper retains current approval and second live check`, async () => {
    const h = harness(); Object.assign(h.f, invoiceCostExportFixture(2, INVOICE_COST_EXPORT_PROFILES[profileId].formulaId));
    assert.ok((await exportCurrentInvoiceCost(h.args)).buffer); assert.equal(h.reads(), 2);
    h.f.revision.liveReceiptStatus = 'STALE'; await assert.rejects(exportCurrentInvoiceCost(h.args));
  });
}

test('browser-safe export profile registry supports only explicitly mapped formulas', async () => {
  for (const id of ['CN_AIR_WEIGHT_CBM_V1', 'NL_AMOUNT_V1', 'CN_SEA_ACTUAL_V1']) assert.equal(supportsInvoiceCostExport(id), true);
  for (const id of ['US', 'VN', 'US_AMOUNT_V1', 'VN_AMOUNT_V1', '', null]) {
    assert.equal(supportsInvoiceCostExport(id), false);
    const f = invoiceCostExportFixture(2); f.revision.formulaId = id;
    await assert.rejects(createInvoiceCostWorkbook(f), e => e.code === 'EXPORT_TEMPLATE_UNSUPPORTED');
  }
  const source = readFileSync(new URL('../lib/invoiceCostExportProfiles.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b|\brequire\s*\(|node:|\.json/);
});

for (const [id, assetName, filename] of [
  ['US_ORIGINAL_V1', 'us', 'mv4lixlm-49d523'], ['VN_ORIGINAL_V1', 'vietnam', 'mubybcd0-81123f'],
  ['AU_ORIGINAL_V1', 'australia', 'muwcdvon-7cb66c'], ['NZ_ORIGINAL_V1', 'new-zealand', 'mv4zc4up-c58848'],
  ['EC_ORIGINAL_V1', 'ecuador', 'muuscu1e-9f8890'],
]) {
  test(`${id} committed asset fidelity, explicit price/ERP units, numeric and boolean components, safe quantity format`, async () => {
    const p = INVOICE_COST_EXPORT_PROFILES[id], f = invoiceCostExportFixture(28, p.formulaId);
    const asset = require(`../lib/invoiceCostTemplates/${assetName}-v1.json`);
    const buffer = await createInvoiceCostWorkbook(f), output = await JSZip.loadAsync(buffer);
    assertFormatOnlyStyleClones(await output.file('xl/styles.xml').async('string'), asset.styles);
    assert.equal(await output.file('xl/theme/theme1.xml').async('string'), asset.theme);
    const xml = await output.file('xl/worksheets/sheet1.xml').async('string');
    for (const part of [asset.cols, asset.sheetViews, asset.sheetFormatPr, asset.print]) assert.ok(xml.includes(part));
    for (const row of asset.rows) assert.ok(xml.includes(`<row ${row.attrs}>`));
    for (const merge of asset.merges) assert.ok(xml.includes(`ref="${merge}"`));
    const book = XLSX.read(buffer, { cellNF: true }), s = book.Sheets['2026 41-02'];
    assert.deepEqual(book.SheetNames, ['2026 41-02']);
    const us = id === 'US_ORIGINAL_V1', ec = id === 'EC_ORIGINAL_V1';
    f.revision.lines.forEach((line, i) => {
      const r = p.detailStartRow + i, unit = s[`${us ? 'N' : ec ? 'Q' : 'O'}${r}`], qty = s[`${us ? 'O' : ec ? 'R' : 'P'}${r}`];
      assert.equal(unit.v, line.unit); assert.equal(qty.v, line.quantity); assert.doesNotMatch(qty.z || '', /[$₩€%]|\[\$/);
      assert.equal(s[`${us ? 'L' : ec ? 'O' : 'M'}${r}`].v, line.costPerUnitKRW);
      assert.equal(s[`${us ? 'M' : ec ? 'P' : 'N'}${r}`].v, line.totalCostKRW);
      assert.equal(s[`${us ? 'M' : ec ? 'P' : 'N'}${r}`].z, '#,##0.00');
      assert.equal(s[`${us ? 'L' : ec ? 'O' : 'M'}${r}`].z, '#,##0.00');
      const c = line.componentAmounts;
      assert.equal(c.freightIncluded, !ec);
      if (!ec) { assert.ok(!('goodsNative' in c)); assert.equal(s[`${us ? 'F' : 'G'}${r}`].v, c.cnfNative); }
      for (const col of us ? ['P', 'Q'] : ec ? ['S', 'T', 'U', 'V'] : ['Q', 'R', 'S', 'T']) assert.equal(s[`${col}${r}`]?.v, undefined);
    });
    const header = p.headerRow;
    assert.equal(s[`${us ? 'E' : 'F'}${header}`].v, `${ec ? 'FOB' : 'CNF'} USD`);
    if (id === 'AU_ORIGINAL_V1') {
      assert.equal(s[`E${header}`].v, '단 수량'); assert.equal(s[`I${header}`].v, '관세/단'); assert.equal(s[`J${header}`].v, '통관/단');
    }
    for (const cell of Object.entries(s).filter(([ref]) => new RegExp(`^[A-Z]+${header}$`).test(ref)).map(([, cell]) => cell)) {
      assert.doesNotMatch(String(cell.v), /BUNCH|STEM|BOX/);
    }
    assert.doesNotMatch(xml, /<f\b|t="e"|Hood|Salal|Hydrangea|Banker Bush|ORCHID VIETNAM/);
    const h = harness(); Object.assign(h.f, f); assert.ok((await exportCurrentInvoiceCost(h.args)).buffer); assert.equal(h.reads(), 2);
    for (const mutate of [
      f => { f.revision.lines[0].componentAmounts.freightIncluded = ec; },
      f => { delete f.revision.lines[0].componentAmounts[ec ? 'goodsNative' : 'cnfNative']; },
      f => { f.revision.lines[0].componentAmounts.customsKRW++; },
      f => { f.document.reviewedMetadata.country = 'XX'; },
      f => { f.snapshot.input.lineInputs.forEach(line => { line.stemsPerBunch = null; line.bunchesPerBox = null; }); },
      f => { f.revision.liveReceiptStatus = 'STALE'; },
    ]) { const bad = structuredClone(f); mutate(bad); await assert.rejects(createInvoiceCostWorkbook(bad)); }
  });
}

for (const [id, assetName, filename] of [
  ['CO_ORIGINAL_V1', 'colombia', 'muki3lfy-23d4f8'], ['TH_ORIGINAL_V1', 'thailand', 'muulcr7t-dcbb0b'],
]) {
  test(`${id} source-bound grouped approved values, dynamic layout, and explicit TH first-row correction`, async () => {
    const p = INVOICE_COST_EXPORT_PROFILES[id], th = id === 'TH_ORIGINAL_V1', f = invoiceCostExportFixture(28, p.formulaId);
    const asset = require(`../lib/invoiceCostTemplates/${assetName}-v1.json`);
    const buffer = await createInvoiceCostWorkbook(f), zip = await JSZip.loadAsync(buffer);
    assert.equal(await zip.file('xl/styles.xml').async('string'), asset.styles);
    assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), asset.theme);
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    for (const part of [asset.cols, asset.sheetViews, asset.sheetFormatPr, asset.print]) assert.ok(sheet.includes(part));
    for (const row of asset.rows) assert.ok(sheet.includes(`<row ${row.attrs}>`));
    for (const merge of asset.merges) assert.ok(sheet.includes(`ref="${merge}"`));
    assert.ok(sheet.includes(`ref="${th ? 'C42:E42' : 'B42:D42'}"`));
    const s = XLSX.read(buffer, { cellNF: true }).Sheets['2026 41-02'];
    assert.equal(s.C10.v, f.revision.totalCostKRW);
    f.revision.lines.forEach((cost, i) => {
      const r = 15 + i;
      assert.equal(s[`${th ? 'C' : 'B'}${r}`].v, f.document.lines[i].originalName);
      assert.equal(s[`${th ? 'P' : 'O'}${r}`].v, cost.costPerUnitKRW);
      assert.equal(s[`${th ? 'Q' : 'P'}${r}`].v, cost.totalCostKRW);
      assert.equal(s[`${th ? 'R' : 'Q'}${r}`].v, cost.unit);
      assert.equal(s[`${th ? 'S' : 'R'}${r}`].v, cost.quantity);
      assert.doesNotMatch(s[`${th ? 'S' : 'R'}${r}`].z || '', /[$₩€%]|\[\$/);
      assert.equal(s[`${th ? 'T' : 'S'}${r}`].v, f.snapshot.input.lineInputs[i].groupId);
      for (const col of th ? ['U', 'V', 'W', 'X'] : ['T', 'U', 'V']) assert.equal(s[`${col}${r}`]?.v, undefined);
    });
    if (th) {
      assert.match(s.B1.v, /원본 첫행 단 원가 오류 교정/);
      const style = asset.rows.find(row => /r="16"/.test(row.attrs)).cells.find(cell => cell.ref === 'P16').style;
      assert.match(sheet, new RegExp(`<c r="P15" s="${style}">`));
      assert.doesNotMatch(s.P15.z || '', /%/);
    }
    assert.doesNotMatch(sheet, /<f\b|t="e"|Den\. Big White|ALSTROMERIA Whistler/);
    const h = harness(); Object.assign(h.f, f); assert.ok((await exportCurrentInvoiceCost(h.args)).buffer);
    for (const mutate of [
      f => { f.snapshot.input.costGroups[0].quantity++; },
      f => { f.snapshot.input.lineInputs[0].groupId = 'UNKNOWN'; },
      f => { delete f.revision.lines[0].componentAmounts.customsKRW; },
      f => { f.revision.lines[0].componentAmounts.freightNative++; },
      f => { f.revision.liveReceiptStatus = 'STALE'; },
      f => { if (th) f.snapshot.input.lossTreatmentConfirmed = false; else f.document.reviewedMetadata.cw++; },
    ]) { const bad = structuredClone(f); mutate(bad); await assert.rejects(createInvoiceCostWorkbook(bad)); }
  });
}

test('every enabled profile preserves explicit cancelled rows without allocation or invented per-unit cost', async () => {
  for (const p of Object.values(INVOICE_COST_EXPORT_PROFILES)) {
    const f = invoiceCostExportFixture(10, p.formulaId), source = f.document.lines[0], detail = f.snapshot.receiptSnapshot.details[0];
    const originalStems = source.lineAmount / source.unitPrice;
    source.lineAmount = 0; detail.lineAmount = 0; detail.outQuantity = 0; detail.stemQuantity = 0;
    f.document.operations[0].result.lineMappings[0].outQuantity = 0;
    const settings = f.snapshot.input.lineInputs[0]; settings.grossWeightKg = 0; settings.volumeWeightKg = 0;
    if (p.formulaId === 'CN_AIR_WEIGHT_CBM_V1') { f.document.reviewedMetadata.gw -= 2; f.document.reviewedMetadata.cw -= 3; }
    if (p.grouped) {
      const group = f.snapshot.input.costGroups.find(group => group.groupId === settings.groupId);
      group.quantity -= originalStems; group.boxQuantity -= detail.boxQuantity;
      source.boxQuantity = 0; detail.boxQuantity = 0;
      delete settings.grossWeightKg; delete settings.volumeWeightKg;
    }
    const computed = previewInvoiceCost({ ...f.document, costInput: f.snapshot.input }, f.document.lines.map((line, i) => ({
      ...line, ...f.snapshot.receiptSnapshot.details[i], outUnit: f.revision.lines[i].unit,
    })));
    assert.equal(computed.status, 'APPROVED', `${p.id}: ${JSON.stringify(computed.issues)}`);
    f.revision.lines = computed.lines.map((line, i) => ({ ...line, wdetailKey: f.snapshot.receiptSnapshot.details[i].wdetailKey }));
    f.revision.totalCostKRW = computed.totals.totalCostKRW;
    const buffer = await createInvoiceCostWorkbook(f), sheet = XLSX.read(buffer).Sheets['2026 41-02'];
    const cost = f.revision.lines[0]; assert.equal(cost.quantity, 0); assert.equal(cost.costPerUnitKRW, null); assert.equal(cost.totalCostKRW, 0);
    const unitCostCol = p.id === 'CN_AIR_ORIGINAL_V1' ? 'M' : p.id === 'CN_SEA_ORIGINAL_V1' ? 'N'
      : p.id === 'US_ORIGINAL_V1' ? 'L' : p.id === 'TH_ORIGINAL_V1' ? 'P' : ['NL_ORIGINAL_V1', 'EC_ORIGINAL_V1', 'CO_ORIGINAL_V1'].includes(p.id) ? 'O' : 'M';
    assert.equal(sheet[`${unitCostCol}${p.detailStartRow}`]?.v, undefined);
  }
});

test('export detail bound remains 1000 rows and rejects an oversized approved-looking scope', async () => {
  const f = invoiceCostExportFixture(1000, 'US_CNF_BOX_V1');
  const s = XLSX.read(await createInvoiceCostWorkbook(f)).Sheets['2026 41-02'];
  assert.equal(s.B1012.v, 'CURRENT FLOWER 1000');
  f.document.lines.push(f.document.lines[0]); f.revision.lines.push(f.revision.lines[0]);
  f.snapshot.receiptSnapshot.details.push(f.snapshot.receiptSnapshot.details[0]);
  f.document.operations[0].result.lineMappings.push(f.document.operations[0].result.lineMappings[0]);
  await assert.rejects(createInvoiceCostWorkbook(f), e => e.code === 'COST_EXPORT_LINES_REQUIRED');
});

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

const privateSourcesDisabled = process.env.INVOICE_COST_EXPORT_NO_PRIVATE_SOURCES === '1';
const privateAssets = [
  ['NL_ORIGINAL_V1', 'netherlands', 'muwamf7z-fc9448'], ['CN_SEA_ORIGINAL_V1', 'china-sea', 'muw7yf7b-5e9241'],
  ['US_ORIGINAL_V1', 'us', 'mv4lixlm-49d523'], ['VN_ORIGINAL_V1', 'vietnam', 'mubybcd0-81123f'],
  ['AU_ORIGINAL_V1', 'australia', 'muwcdvon-7cb66c'], ['NZ_ORIGINAL_V1', 'new-zealand', 'mv4zc4up-c58848'],
  ['EC_ORIGINAL_V1', 'ecuador', 'muuscu1e-9f8890'], ['CO_ORIGINAL_V1', 'colombia', 'muki3lfy-23d4f8'],
  ['TH_ORIGINAL_V1', 'thailand', 'muulcr7t-dcbb0b'],
];

test('all committed sanitized assets have pinned hashes, source identities and format-only cells without private XLSX', () => {
  for (const [id, name] of [['CN_AIR_ORIGINAL_V1', 'china-air'], ...privateAssets]) {
    const asset = require(`../lib/invoiceCostTemplates/${name}-v1.json`), p = INVOICE_COST_EXPORT_PROFILES[id];
    const { assetHash, ...format } = asset;
    assert.equal(createHash('sha256').update(JSON.stringify(format)).digest('hex'), p.assetHash);
    assert.equal(assetHash, p.assetHash); assert.equal(asset.sourceHash, p.sourceHash);
    assert.equal(asset.sourceSheet, p.sourceSheet); assert.equal(asset.profileId, id);
    assert.equal(asset.profileVersion, p.version);
    assert.ok(asset.styles && asset.theme && asset.cols && asset.sheetViews && asset.sheetFormatPr && asset.rows.length);
    for (const row of asset.rows) for (const cell of row.cells) assert.deepEqual(Object.keys(cell).sort(), ['ref', 'style']);
  }
});

// Optional local evidence parity only. All calculation/layout/security tests above
// use committed sanitized assets and are mandatory even when private files are absent.
for (const [id, name, filename] of privateAssets) {
  const path = process.env.INVOICE_COST_PRIVATE_SOURCE_DIR
    ? join(process.env.INVOICE_COST_PRIVATE_SOURCE_DIR, `${filename}.xlsx`)
    : new URL(`../outputs/drive-pair-discovery/sources/${filename}.xlsx`, import.meta.url);
  test(`optional private-original parity ${id}`, { skip: privateSourcesDisabled || !existsSync(path) }, async () => {
    const p = INVOICE_COST_EXPORT_PROFILES[id], asset = require(`../lib/invoiceCostTemplates/${name}-v1.json`);
    const bytes = readFileSync(path); assert.equal(createHash('sha256').update(bytes).digest('hex'), p.sourceHash);
    const zip = await JSZip.loadAsync(bytes), wb = await zip.file('xl/workbook.xml').async('string');
    const sheetTag = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]).find(s => s.includes(`name="${p.sourceSheet}"`));
    const rid = sheetTag.match(/r:id="([^"]+)"/)[1], rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const rel = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map(m => m[0]).find(s => s.includes(`Id="${rid}"`));
    const target = rel.match(/Target="([^"]+)"/)[1];
    const sheet = await zip.file(target.startsWith('/') ? target.slice(1) : `xl/${target}`).async('string');
    assert.equal(await zip.file('xl/styles.xml').async('string'), asset.styles);
    assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), asset.theme);
    for (const part of [asset.cols, asset.sheetViews, asset.sheetFormatPr, asset.print]) {
      assert.ok(sheet.replace(/\s+r:id="[^"]*"/g, '').includes(part));
    }
    for (const merge of asset.merges) assert.ok(sheet.includes(`ref="${merge}"`));
    for (const row of asset.rows) {
      const r = row.attrs.match(/\br="(\d+)"/)[1];
      const original = sheet.match(new RegExp(`<row\\b([^>]*\\br="${r}"[^>]*)>([\\s\\S]*?)</row>`));
      assert.ok(original); assert.equal(original[1].replace(/\s(?:spans|xr:uid)="[^"]*"/g, ''), row.attrs);
      for (const cell of row.cells) {
        const source = original[2].match(new RegExp(`<c\\b([^>]*\\br="${cell.ref}"[^>]*)`));
        assert.ok(source); assert.equal(source[1].match(/\bs="(\d+)"/)?.[1] || '0', cell.style);
      }
    }
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), p.sourceHash);
  });
}

const referencePath = process.env.INVOICE_COST_AIR_PRIVATE_SOURCE || 'C:/Users/USER/Downloads/CHINA 중국 원가자료 (8).xlsx';
test('optional private-original CN air parity and unchanged file', { skip: privateSourcesDisabled || !existsSync(referencePath) }, async () => {
  const bytes = readFileSync(referencePath); assert.equal(createHash('sha256').update(bytes).digest('hex'), FORMULA.formulaSourceHash);
  const zip = await JSZip.loadAsync(bytes);
  assert.equal(await zip.file('xl/styles.xml').async('string'), template.styles);
  assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), template.theme);
  const original = await zip.file('xl/worksheets/sheet28.xml').async('string');
  for (const part of [template.cols, template.sheetViews, template.sheetFormatPr, template.print]) assert.ok(original.includes(part));
  await createInvoiceCostWorkbook(invoiceCostExportFixture());
  assert.equal(createHash('sha256').update(readFileSync(referencePath)).digest('hex'), FORMULA.formulaSourceHash);
});
