import assert from 'node:assert/strict';
import test from 'node:test';
import {appendCostInputDifferentialStyle} from '../lib/invoiceCostCellPresentation.js';
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

test('AU original template restores defaults, formulas, full range and preserves approved snapshot',async()=>{
  const f=invoiceCostExportFixture(11,'AU_CNF_BUNCH_V1'), before=JSON.stringify(f);
  const bytes=await createInvoiceCostWorkbook(f),book=XLSX.read(bytes,{cellFormula:true}),s=book.Sheets['41-2'];
  assert.deepEqual(book.SheetNames,['41-2']);
  assert.equal(JSON.stringify(f),before);
  assert.equal(s.N6.v,33000);assert.equal(s.N8.v,90000);assert.equal(s.W14.v,460);assert.equal(s.W15.v,10000);
  assert.equal(s.D5.f,'SUM(G13:G23)');assert.equal(s.D9.f,'SUM(E13:E23)');
  assert.match(s.N5.f,/D7\*W14/);assert.match(s.N7.f,/D8\*W15/);
  assert.match(s.N23.f,/O23\/1.1/);assert.match(s.P23.f,/M23\/0.77/);assert.match(s.R23.f,/N23=0/);
  assert.equal(s.O23.v,s.P23.v);assert.equal(s.N23.v,s.O23.v/1.1);
  for(const [ref,label] of Object.entries({N12:'판매(부가세 별도)',Q12:'이익',R12:'이익률',S12:'총판매가',T12:'총이익',R10:'총이익률',S10:'총판매가',T10:'총이익'}))assert.equal(s[ref].v,label);
  assert.match(s.O12.v,/매주 확인/);assert.match(s.R11.f,/T11\/S11/);assert.match(s.S11.f,/SUM\(S13:S23\)/);assert.match(s.T11.f,/SUM\(T13:T23\)/);
  assert.match(s.V2.v,/38-1.*참고 판매가/);
  assert.equal(s.W18.v,f.snapshot.input.customsTotalKRW);
  assert.ok(Math.abs(s.W22.v)<0.01);
  assert.match(await (await JSZip.loadAsync(bytes)).file('xl/workbook.xml').async('string'),/activeTab="0"/);
});

test('CO 42-1 restores original labels, defaults and live formulas without changing approval or copying old transactions', async () => {
  const f = invoiceCostExportFixture(7, 'CO_GROUP_42_1_V1');
  const before = JSON.stringify(f);
  const bytes = await createInvoiceCostWorkbook(f), book = XLSX.read(bytes, { cellFormula: true });
  assert.deepEqual(book.SheetNames, ['41-2']);
  const s = book.Sheets['41-2'];
  assert.equal(JSON.stringify(f), before);
  assert.equal(s.B1.v, 'COLOMBIA                                    콜카장 + 수국');
  assert.equal(s.C5.v, '41-2');
  assert.equal(s.C7.v, f.snapshot.input.exchangeRateKRW);
  assert.equal(s.P7.v, 33000); assert.equal(s.P9.v, 99000); assert.equal(s.R6.v, 40000);
  assert.equal(s.O5.v, '그외에 통관비');
  assert.equal(s.P6.f, 'C8*460'); assert.equal(s.P10.f, 'SUM(P6:P9)+R6+R7');
  assert.equal(s.D9.v, 'Rate'); assert.equal(typeof s.E9.v, 'number');
  assert.equal(s.D11.v, '서류'); assert.equal(s.E11.v, 0);
  assert.equal(s.F11.v, '운송비'); assert.equal(s.G11.f, 'E9*E8'); assert.equal(s.C11.f, 'E11+G11');
  assert.equal(s.C10.f, 'SUM(E15:E21)');
  assert.equal(s.AL4.v, f.revision.totalCostKRW);
  assert.equal(s.B2?.v, undefined);
  assert.equal(s.B3?.v, undefined);
  assert.equal(s.A14.v, '농장');
  assert.equal(s.B14.v, '품종');
  assert.equal(s.C14.v, 'Color\r\nGrade');
  assert.equal(s.W14, undefined);
  for (let i=0; i<7; i++) {
    const r=15+i;
    assert.ok(['장미', '카네이션', '알스트로', '루스커스', '수국'].includes(s[`B${r}`].v));
    assert.equal(s[`C${r}`].v,f.document.lines[i].originalName);
    assert.equal(s[`W${r}`], undefined);
    assert.equal(s[`M${r}`].f,`J${r}+K${r}+L${r}`);
    assert.equal(s[`Q${r}`]?.v,s[`R${r}`].v,'unmatched item uses live recommendation, not another item price');
    assert.equal(s[`P${r}`].v,s[`Q${r}`].v/1.1);
  }
  assert.ok(Math.abs(s.AL12.v - Array.from({length:7},(_,i)=>s[`E${15+i}`].v*s[`M${15+i}`].v).reduce((a,b)=>a+b,0))<0.01);
  assert.equal(s.B22,undefined,'historical source rows must not leak');
  assert.equal(s.C22,undefined,'historical source rows must not leak');
  const zip=await JSZip.loadAsync(bytes);
  assert.match(await zip.file('xl/workbook.xml').async('string'), /activeTab="0"/);
  const coXml = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.match(coXml, /<pane xSplit="4" ySplit="14" topLeftCell="E15" activePane="bottomRight" state="frozen"\/>/);
  assert.match(coXml, /activeCell="E15"/);
  assert.match(coXml, /<autoFilter ref="A14:V21"\/>/);
});

test('CO original calculation keeps prior-year scope and explicit zero freight, and escapes names as text', async () => {
  const f = invoiceCostExportFixture(2, 'CO_GROUP_42_1_V1');
  f.document.orderYear='2025';
  f.document.lines[0].originalName='=HYPERLINK("https://example.invalid") & <flower>\u0001';
  f.snapshot.input.freightAmount=0;
  const computed=previewInvoiceCost({...f.document,costInput:f.snapshot.input}, f.snapshot.receiptSnapshot.details.map((detail,i)=>({
    ...f.document.lines[i],...detail,outUnit:f.revision.lines[i].unit,
  })));
  assert.equal(computed.status,'APPROVED');
  f.revision.lines=computed.lines.map((line,i)=>({...line,wdetailKey:f.snapshot.receiptSnapshot.details[i].wdetailKey}));
  f.revision.totalCostKRW=computed.totals.totalCostKRW;
  const bytes=await createInvoiceCostWorkbook(f), s=XLSX.read(bytes).Sheets['41-2'];
  assert.equal(s.C5.v,'41-2'); assert.equal(s.C11.v,0); assert.equal(s.G15.v,0);
  assert.equal(s.C15.f,undefined); assert.match(s.C15.v,/HYPERLINK/);
  assert.ok(!s.C15.v.includes('\u0001'));
});

test('all ten exports output single week sheet with self-contained formulas and honest missing CBM', async () => {
  for (const profile of Object.values(INVOICE_COST_EXPORT_PROFILES).filter(profile=>!profile.generated)) {
    const f = invoiceCostExportFixture(3, profile.formulaId), before = JSON.stringify(f);
    const book = XLSX.read(await createInvoiceCostWorkbook(f), { cellFormula: true });
    assert.deepEqual(book.SheetNames, ['41-2'], `${profile.id}: must be single week sheet`);
    const sheet = book.Sheets['41-2'];
    assert.equal(JSON.stringify(f), before, `${profile.id}: input mutation`);
    for (const cell of Object.values(sheet)) if (cell?.f) assert.doesNotMatch(cell.f, /!|#REF!/, `${profile.id}: cross-sheet or #REF!`);
    if (profile.id === 'CO_42_1_ORIGINAL_V1') {
      assert.equal(sheet.C7.v, f.snapshot.input.exchangeRateKRW);
      assert.equal(sheet.AL4.v, f.revision.totalCostKRW);
      assert.ok(Math.abs(sheet.AL13.v - (sheet.AL12.v - sheet.AL4.v)) < 0.01);
    } else if (profile.id === 'AU_ORIGINAL_V1') {
      assert.equal(sheet.D6.v, f.snapshot.input.exchangeRateKRW);
      assert.equal(sheet.W20.v, f.revision.totalCostKRW);
      assert.ok(Math.abs(sheet.W22.v) < 0.01);
    } else if (profile.id === 'CN_SEA_ORIGINAL_V1') {
      assert.equal(sheet.C7.v, f.snapshot.input.exchangeRateKRW);
      assert.equal(sheet.AB6.v, f.revision.totalCostKRW);
      assert.equal(sheet.AB7.v, '입력 필요');
      assert.equal(sheet.AB8.v, '입력 필요');
      assert.equal(sheet.AK44?.v, undefined);
    } else {
      assert.equal(sheet.AB6.v, f.revision.totalCostKRW);
      assert.ok(Number.isFinite(sheet.AB7.v), profile.id);
      assert.ok(Math.abs(sheet.AB8.v) < 0.01, profile.id);
    }
    assert.ok(Object.values(sheet).filter(cell => cell?.f).length > 20, profile.id);
  }
});

test('China sea CBM formula exposes unequal volume allocations on single sheet instead of copying stored quantity allocation', async () => {
  const f = invoiceCostExportFixture(2, 'CN_SEA_ACTUAL_V1');
  f.snapshot.input.lineInputs.forEach((line, i) => { line.boxCbm = i ? 0.2 : 0.1; line.bunchesPerBox = 10; });
  const sheet = XLSX.read(await createInvoiceCostWorkbook(f), { cellFormula: true }).Sheets['41-2'];
  const v1 = 10 * 0.1 / 10, v2 = 11 * 0.2 / 10;
  assert.ok(Math.abs(sheet.AP44.v - v1 / (v1 + v2)) < 1e-12);
  assert.ok(Math.abs(sheet.P44.v - f.revision.lines[0].costPerUnitKRW) > 1);
  assert.match(sheet.AM44.f, /E44\*AK44\/AL44/);
  assert.equal(sheet.AB6.v, f.revision.totalCostKRW);
  delete f.snapshot.input.lineInputs[1].boxCbm;
  const missing = XLSX.read(await createInvoiceCostWorkbook(f)).Sheets['41-2'];
  assert.equal(missing.AW44.v, '입력 필요', 'one missing CBM must block the whole freight allocation');
  assert.equal(missing.AB7.v, '입력 필요');
});

function assertFormatOnlyStyleClones(actual, original, allowPackingRatio = false) {
  // The only non-cellXfs addition is the reviewed missing-selling-input cue.
  original = appendCostInputDifferentialStyle(original).styles;
  const pattern = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/;
  const old = original.match(pattern), next = actual.match(pattern);
  assert.ok(next[1].startsWith(old[1]), 'all original styles must remain byte-for-byte unchanged');
  const oldXfs = [...old[1].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(m => m[0]);
  const normalize = xf => xf.replace(/\s+(?:numFmtId|applyNumberFormat)="[^"]*"/g, '');
  for (const match of next[1].slice(old[1].length).matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    assert.match(match[0], allowPackingRatio ? /numFmtId="(?:4|3|0|9)"/ : /numFmtId="(?:4|3|0)"/);
    const numericOnly=oldXfs.some(xf => normalize(xf) === normalize(match[0]));
    const thaiWrapOnly=allowPackingRatio&&/wrapText="1"/.test(match[0])&&oldXfs.some(xf=>xf===match[0].replace(/ wrapText="1"/,''));
    assert.ok(numericOnly||thaiWrapOnly, 'clone may change only numeric formatting or Thai header wrapping');
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

test('CN existing receipt exports by bunch even when preserved native stems differ',async()=>{
 const f=invoiceCostExportFixture(2,'CN_SEA_ACTUAL_V1');
 const op=f.document.operations[0];op.action='LINK_EXISTING_COST';op.result.linkMode='EXISTING_CN';
 f.snapshot.receiptSnapshot.linkMode='EXISTING_CN';
 for(let i=0;i<2;i++){
  const native=f.snapshot.receiptSnapshot.details[i],mapping=op.result.lineMappings[i];
  Object.assign(mapping,{bunchQuantity:native.outQuantity,stemQuantity:native.outQuantity*10,unitPrice:native.unitPrice,lineAmount:native.lineAmount});
  native.bunchQuantity=native.outQuantity;native.stemQuantity=native.outQuantity;
 }
 const before=JSON.stringify(f),bytes=await createInvoiceCostWorkbook(f);
 assert.ok(bytes.length>0);assert.equal(JSON.stringify(f),before);
 f.snapshot.receiptSnapshot.details[0].bunchQuantity+=1;
 await assert.rejects(()=>createInvoiceCostWorkbook(f),{code:'COST_EXPORT_LINE_MISMATCH'});
});

test('TH existing zero-box receipt exports invoice prices and packing-group calculations',async()=>{
 const f=invoiceCostExportFixture(19,'TH_GROUP_BOX_SHARE_V1');
 const op=f.document.operations[0];op.action='LINK_EXISTING_COST';op.result.linkMode='EXISTING_TH';
 f.snapshot.receiptSnapshot.linkMode='EXISTING_TH';
 f.snapshot.input.groupBoxBasis='PACKING_GROUP';
 f.snapshot.input.packingBoxTotal=f.snapshot.input.costGroups.reduce((s,g)=>s+g.boxQuantity,0);
 const receipt=f.snapshot.receiptSnapshot.details.map((d,i)=>{
  const stems=d.lineAmount/d.unitPrice;f.document.lines[i].stemQuantity=stems;
  d.stemQuantity=stems;d.boxQuantity=0;d.bunchQuantity=stems/5;
  const mapping={...d,outQuantity:stems/5,unit:'단',boxQuantity:null};op.result.lineMappings[i]=mapping;
  return {...f.document.lines[i],...mapping,outUnit:'단'};
 });
 const calculated=previewInvoiceCost({...f.document,costInput:f.snapshot.input},receipt);
 assert.equal(calculated.status,'APPROVED');
 f.revision.lines=calculated.lines.map((l,i)=>({...l,wdetailKey:receipt[i].wdetailKey}));
 f.revision.totalCostKRW=calculated.totals.totalCostKRW;
 const before=JSON.stringify(f), bytes=await createInvoiceCostWorkbook(f);
 assert.equal(JSON.stringify(f),before);
 const workbook=XLSX.read(bytes), sheet=workbook.Sheets['41-2'];
 assert.deepEqual(workbook.SheetNames,['41-2']);
 assert.equal(XLSX.utils.format_cell({...sheet.G15,v:0.045,w:undefined}),'0.045');
 for(let i=0;i<19;i++){assert.equal(sheet[`G${15+i}`].v,f.document.lines[i].unitPrice);assert.ok(Math.abs(sheet[`AD${15+i}`].v-calculated.lines[i].totalCostKRW)<.01);}
 f.snapshot.input.packingBoxTotal++;
 await assert.rejects(()=>createInvoiceCostWorkbook(f),{code:'COST_EXPORT_INPUT_INVALID'});
});

test('28 rows preserve OOXML style/theme/width/height/merges and exact approved unit/total values on single sheet', async () => {
  const f = invoiceCostExportFixture(); const bytes = await createInvoiceCostWorkbook(f);
  const zip = await JSZip.loadAsync(bytes);
  assertFormatOnlyStyleClones(await zip.file('xl/styles.xml').async('string'), template.styles);
  assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), template.theme);
  assert.equal(zip.file('xl/worksheets/sheet2.xml'), null);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  for (const part of [template.sheetFormatPr, template.print]) assert.ok(sheet.includes(part));
  assert.ok(sheet.includes('ref="C51:D51"'));
  const rowRefs = [...sheet.matchAll(/<row\s+r="(\d+)"/g)].map(m => m[1]);
  assert.equal(new Set(rowRefs).size, rowRefs.length);
  const workbook = XLSX.read(bytes, { cellStyles: true });
  assert.deepEqual(workbook.SheetNames, ['41-2']); const s = workbook.Sheets['41-2'];
  assert.equal(s.B23.v, '품종'); assert.equal(s.C23.v, '원문 품목');
  assert.equal(s.O23.v, '원가(단위)'); assert.equal(s.AD23.v, '품목 원가 합계'); assert.equal(s.Y23.v, '전산 단위');
  const koUnit = { BUNCH: '단', STEM: '송이', BOX: '박스' };
  f.revision.lines.forEach((line, i) => {
    assert.equal(s[`C${24 + i}`].v, f.document.lines[i].originalName);
    assert.ok(Math.abs(s[`O${24 + i}`].v - line.costPerUnitKRW) < 0.01);
    assert.ok(Math.abs(s[`AD${24 + i}`].v - line.totalCostKRW) < 0.01);
    assert.equal(s[`Y${24 + i}`].v, koUnit[line.unit]);
    assert.equal(s[`AG${24 + i}`].v, line.quantity);
  });
  assert.equal(s.AB6.v, f.revision.totalCostKRW);
  assert.equal(s.AB5.v, f.snapshot.input.customsTotalKRW);
  assert.equal(s.C8.v, 56); assert.equal(s.E8.v, 84);
});

test('CN air header anchors are separate and no merged range contains populated non-anchor cells', async () => {
  const f = invoiceCostExportFixture(28);
  const bytes = await createInvoiceCostWorkbook(f);
  const zip = await JSZip.loadAsync(bytes);
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const cells = new Set([...sheet.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*>(?:<f>[\s\S]*?<\/f>)?<(?:v|is)>/g)]
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
  const s = XLSX.read(bytes).Sheets['41-2'];
  assert.equal(s.B5.v, '차수');
  assert.equal(s.C5.v, '2026/41-02');
  assert.doesNotMatch(await zip.file('xl/styles.xml').async('string'), /shrinkToFit/);
});

test('format-only template and generated package contain no historical rows, literal formula injection, or raw snapshots', async () => {
  const f = invoiceCostExportFixture(2);
  f.document.lines[0].originalName = '=HYPERLINK("https://example.invalid","not a formula")';
  f.snapshot.privateField = 'SERVER_ONLY_PRIVATE';
  const zip = await JSZip.loadAsync(await createInvoiceCostWorkbook(f));
  const parts = Object.keys(zip.files).filter(name => !zip.files[name].dir);
  assert.equal(parts.filter(name => /^xl\/worksheets\//.test(name)).length, 1);
  assert.ok(!parts.some(name => /sharedStrings|externalLinks|comments|calcChain|drawings|vba/i.test(name)));
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  assert.doesNotMatch(sheet, /t="e"|#REF!|SERVER_ONLY_PRIVATE|ROSE|Gypsophila|372660|4706\.597090/);
  const s = XLSX.read(await zip.generateAsync({ type: 'nodebuffer' })).Sheets['41-2'];
  assert.equal(s.C24.t, 's'); assert.equal(s.C24.f, undefined);
  for (const row of template.rows) for (const cell of row.cells) assert.deepEqual(Object.keys(cell).sort(), ['ref', 'style']);
});

test('normalized cost snapshot accepts native ERP unit aliases without quantity conversion and rejects different or unknown units', async () => {
  const f = invoiceCostExportFixture(3);
  assert.deepEqual(f.document.operations[0].result.lineMappings.map(line => line.unit), ['단', '송이', '박스']);
  assert.deepEqual(f.revision.lines.map(line => line.unit), ['BUNCH', 'STEM', 'BOX']);
  // committedReceiptSnapshot stores normalized numeric detail fields, not unit labels.
  assert.ok(f.snapshot.receiptSnapshot.details.every(line => !('unit' in line)));
  const sheet = XLSX.read(await createInvoiceCostWorkbook(f)).Sheets['41-2'];
  const koUnit = { BUNCH: '단', STEM: '송이', BOX: '박스' };
  f.revision.lines.forEach((line, i) => {
    assert.equal(sheet[`Y${24 + i}`].v, koUnit[line.unit]);
    assert.equal(sheet[`AG${24 + i}`].v, line.quantity);
    assert.ok(Math.abs(sheet[`O${24 + i}`].v - line.costPerUnitKRW) < 0.01);
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
    const styleXml = await zip.file('xl/styles.xml').async('string');
    if (nl) assertFormatOnlyStyleClones(styleXml, asset.styles);
    else assert.ok(styleXml.includes(asset.styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)[1]), 'source styles retained before readable clones');
    assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), asset.theme);
    assert.equal(zip.file('xl/worksheets/sheet2.xml'), null);
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    const last = profile.detailStartRow + count - 1;
    assert.ok(sheet.includes(`ref="C${last}:D${last}"`));
    const refs = [...sheet.matchAll(/<row\s+r="(\d+)"/g)].map(m => m[1]);
    assert.equal(new Set(refs).size, refs.length);
    const output = XLSX.read(bytes, { cellNF: true }), s = output.Sheets['41-2'];
    assert.deepEqual(output.SheetNames, ['41-2']); assert.equal(s.AB6.v, f.revision.totalCostKRW);
    const koUnit = { BUNCH: '단', STEM: '송이', BOX: '박스' };
    f.revision.lines.forEach((cost, i) => {
      const r = profile.detailStartRow + i;
      assert.equal(s[`C${r}`].v, f.document.lines[i].originalName);
      assert.equal(s[`Y${r}`].v, koUnit[cost.unit]);
      if (nl) {
        assert.ok(Math.abs(s[`O${r}`].v - cost.costPerUnitKRW) < 0.01);
        assert.ok(Math.abs(s[`AD${r}`].v - cost.totalCostKRW) < 0.01);
        assert.ok(Math.abs(s[`M${r}`].v - cost.componentAmounts.arrivalPerStemKRW) < 0.01);
        assert.ok(Math.abs(s[`P${r}`].v - cost.componentAmounts.vatIncludedCostPerUnitKRW) < 0.01);
        assert.equal(s[`N${r}`].v, i % 2 === 0 ? 5 : 1);
      } else {
        assert.equal(s[`AG${r}`].v, cost.quantity);
      }
    });
    assert.doesNotMatch(sheet, /t="e"|#REF!|95% 선적시|Ammi CHINA|SERVER_ONLY/);
    if(nl)assert.equal(s.J6.v,'Eryngium','static reference label is restored, never a historical detail row');
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
    if(profileId==='NL_ORIGINAL_V1'){
      h.args.types.NVarChar=n=>n;
      const original=h.args.queryFn;
      h.args.queryFn=async(sql,params)=>sql.includes('nl-cost:readonly-customer-comparison')?{recordsets:[[{CustKey:533,OrderCode:'YCL2'}],[],h.f.revision.lines.map((cost,i)=>({OrderYear:h.f.document.orderYear,OrderWeek:h.f.document.orderWeek,WarehouseKey:Number(h.args.warehouseKey),WdetailKey:1000+i,ProdKey:h.f.document.lines[i].prodKey,ProdName:h.f.document.lines[i].originalName,SteamQuantity:cost.quantity*(cost.unit==='BUNCH'?5:1)}))]}:original(sql,params);
    }
    assert.ok((await exportCurrentInvoiceCost(h.args)).buffer); assert.equal(h.reads(), 2);
    if(profileId==='NL_ORIGINAL_V1'){
      h.f.document.lines.forEach(line=>{line.sourceEvidence={invoiceCustomerCode:'CL2'};});
      const generate=h.args.generate;
      h.args.generate=async value=>{
        const bytes=generate?await generate(value):await createInvoiceCostWorkbook(value);
        h.f.document.lines[0].sourceEvidence.invoiceCustomerCode='CL21';
        return bytes;
      };
      await assert.rejects(exportCurrentInvoiceCost(h.args),e=>e.code==='COST_EXPORT_CHANGED'&&/주광/.test(e.message));
    }
    h.f.revision.liveReceiptStatus = 'STALE'; await assert.rejects(exportCurrentInvoiceCost(h.args));
  });
}

test('China sea restores summary labels/current totals, preserves inputs, and never hides values under merges on single sheet', async () => {
  for (const year of ['2025', '2026']) {
    const f = invoiceCostExportFixture(64, 'CN_SEA_ACTUAL_V1');
    f.document.orderYear = year;
    const before = JSON.stringify(f);
    const bytes = await createInvoiceCostWorkbook(f);
    assert.equal(JSON.stringify(f), before, 'export cannot mutate approved data');
    const book = XLSX.read(bytes, { cellNF: true, cellStyles: true });
    assert.deepEqual(book.SheetNames, ['41-2']);
    const s = book.Sheets['41-2'];
    assert.equal(s.B1.v, `중국 해상 도착원가 · ${year}/41-02`);
    assert.equal(s.B20.v, '창고료');
    assert.equal(s.B27.v, 'Do charge');
    assert.equal(s.AB6.v, f.revision.totalCostKRW);
    assert.equal(s.C10.v, f.revision.lines.reduce((n, line) => n + line.quantity, 0));
    for (const merge of s['!merges']) {
      for (let r = merge.s.r; r <= merge.e.r; r++) for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r !== merge.s.r || c !== merge.s.c) assert.equal(s[XLSX.utils.encode_cell({ r, c })]?.v, undefined, 'no hidden value in merge child');
      }
    }
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    assert.doesNotMatch(xml, /t="e"|#REF!/);
    assert.ok((await zip.file('xl/workbook.xml').async('string')).includes('$B$1:$P$107'));
  }
});

test('China sea summary displays explicit zero and full estimate evidence without inventing breakdowns', async () => {
  const f = invoiceCostExportFixture(2, 'CN_SEA_ACTUAL_V1');
  f.snapshot.input.lineInputs.forEach(line => { line.otherCostPerUnitKRW = 0; line.tariffRate = 0; });
  const computed = previewInvoiceCost({ ...f.document, costInput: f.snapshot.input }, f.snapshot.receiptSnapshot.details.map((detail, i) => ({ ...f.document.lines[i], ...detail, outUnit: '단' })));
  assert.equal(computed.status, 'APPROVED');
  f.revision.lines = computed.lines.map((line, i) => ({ ...line, wdetailKey: 1000 + i }));
  f.revision.totalCostKRW = computed.totals.totalCostKRW;
  const sheet = XLSX.read(await createInvoiceCostWorkbook(f)).Sheets['41-2'];
  assert.equal(sheet.AI44.v, 0); assert.equal(sheet.AJ44.v, 0); assert.equal(sheet.AB7.v, '입력 필요');
});

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
    const expectedStyles = id === 'AU_ORIGINAL_V1' ? asset.styles.replace(/<fonts\b[\s\S]*?<\/fonts>/, fonts => fonts.replace(/<sz val="(?:8|9)"\s*\/>/g, '<sz val="11"/>').replace(/<name val="Calibri"\s*\/>/g, '<name val="맑은 고딕"/>')) : asset.styles;
    assertFormatOnlyStyleClones(await output.file('xl/styles.xml').async('string'), expectedStyles);
    assert.equal(await output.file('xl/theme/theme1.xml').async('string'), asset.theme);
    assert.equal(output.file('xl/worksheets/sheet2.xml'), null);
    const xml = await output.file('xl/worksheets/sheet1.xml').async('string');
    for (const part of [asset.sheetFormatPr, asset.print]) assert.ok(xml.includes(part));
    const book = XLSX.read(buffer, { cellNF: true }), s = book.Sheets['41-2'];
    assert.deepEqual(book.SheetNames, ['41-2']);
    const us = id === 'US_ORIGINAL_V1', ec = id === 'EC_ORIGINAL_V1', au = id === 'AU_ORIGINAL_V1';
    const koUnit = { BUNCH: '단', STEM: '송이', BOX: '박스' };
    f.revision.lines.forEach((line, i) => {
      const r = p.detailStartRow + i;
      const unitCostCol = us ? 'L' : ec ? 'O' : 'M';
      const expectedUnitCost = au ? line.totalCostKRW / s[`E${r}`].v : line.costPerUnitKRW;
      assert.ok(Math.abs(s[`${unitCostCol}${r}`].v - expectedUnitCost) < 0.01);
      if (!au) {
        assert.equal(s[`Y${r}`].v, koUnit[line.unit]);
        assert.equal(s[`AG${r}`].v, line.quantity);
        assert.ok(Math.abs(s[`AD${r}`].v - line.totalCostKRW) < 0.01);
      }
      const c = line.componentAmounts;
      assert.equal(c.freightIncluded, !ec);
      if (!ec) assert.ok(!('goodsNative' in c));
    });
    const header = p.headerRow;
    for (const cell of Object.entries(s).filter(([ref]) => new RegExp(`^[A-Z]+${header}$`).test(ref)).map(([, cell]) => cell)) {
      assert.doesNotMatch(String(cell.v), /BUNCH|STEM|BOX/);
    }
    assert.doesNotMatch(xml, /t="e"|#REF!|Hood|Salal|Hydrangea|ORCHID VIETNAM/);
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
  ['CO_42_1_ORIGINAL_V1', 'colombia-42-1', '42-1'],
  ['CO_ORIGINAL_V1', 'colombia', 'muki3lfy-23d4f8'], ['TH_ORIGINAL_V1', 'thailand', 'muulcr7t-dcbb0b'],
]) {
  test(`${id} source-bound grouped approved values, dynamic layout, and explicit TH first-row correction`, async () => {
    const p = INVOICE_COST_EXPORT_PROFILES[id], th = id === 'TH_ORIGINAL_V1', f = invoiceCostExportFixture(28, p.formulaId);
    const asset = require(`../lib/invoiceCostTemplates/${assetName}-v1.json`);
    const buffer = await createInvoiceCostWorkbook(f), zip = await JSZip.loadAsync(buffer);
    assertFormatOnlyStyleClones(await zip.file('xl/styles.xml').async('string'), asset.styles, th);
    assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), asset.theme);
    assert.equal(zip.file('xl/worksheets/sheet2.xml'), null);
    const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
    for (const part of [asset.sheetFormatPr, asset.print]) assert.ok(sheet.includes(part));
    assert.ok(sheet.includes(`ref="${th ? 'D42:E42' : 'C42:D42'}"`));
    const book = XLSX.read(buffer, { cellNF: true });
    assert.deepEqual(book.SheetNames, ['41-2']);
    const s = book.Sheets['41-2'];
    assert.equal(s[id === 'CO_42_1_ORIGINAL_V1' ? 'AL4' : 'AB6'].v, f.revision.totalCostKRW);
    const coGroupKo = { ROSE: '장미', CARNATION: '카네이션', ALSTROMERIA: '알스트로', RUSCUS: '루스커스', HYDRANGEA: '수국' };
    f.revision.lines.forEach((cost, i) => {
      const r = 15 + i;
      assert.equal(s[`${th ? 'D' : 'C'}${r}`].v, f.document.lines[i].originalName);
      if (id === 'CO_42_1_ORIGINAL_V1') {
        assert.ok(Math.abs(s[`O${r}`].v - s[`M${r}`].v * s[`N${r}`].v) < 0.01);
        assert.equal(s[`B${r}`].v, coGroupKo[f.snapshot.input.lineInputs[i].groupId]);
        assert.equal(s[`W${r}`], undefined);
      } else {
        assert.ok(Math.abs(s[`${th ? 'P' : 'O'}${r}`].v - cost.costPerUnitKRW) < 0.01);
        assert.equal(s[`AC${r}`].v, f.snapshot.input.lineInputs[i].groupId);
      }
    });
    if (th) assert.doesNotMatch(s.P15.z || '', /%/);
    assert.doesNotMatch(sheet, /t="e"|#REF!|Den\. Big White|ALSTROMERIA Whistler/);
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
  for (const p of Object.values(INVOICE_COST_EXPORT_PROFILES).filter(profile=>!profile.generated)) {
    const f = invoiceCostExportFixture(10, p.formulaId), source = f.document.lines[0], detail = f.snapshot.receiptSnapshot.details[0];
    const originalStems = source.lineAmount / source.unitPrice;
    source.lineAmount = 0; detail.lineAmount = 0; detail.outQuantity = 0; detail.stemQuantity = 0;
    f.document.operations[0].result.lineMappings[0].outQuantity = 0;
    const settings = f.snapshot.input.lineInputs[0]; settings.grossWeightKg = 0; settings.volumeWeightKg = 0;
    if(p.id==='EC_ORIGINAL_V1')delete settings.stemsPerBunch; // valid cancelled row: never contaminate live allocation with 0*undefined
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
    const buffer = await createInvoiceCostWorkbook(f), book = XLSX.read(buffer);
    assert.deepEqual(book.SheetNames, ['41-2']);
    const sheet = book.Sheets['41-2'];
    if(p.id==='EC_ORIGINAL_V1'){
      assert.equal(sheet.G14.v,0);assert.ok(sheet.G15.v>0);assert.ok(Number.isFinite(sheet.AB7.v));
    }
    const cost = f.revision.lines[0]; assert.equal(cost.quantity, 0); assert.equal(cost.costPerUnitKRW, null); assert.equal(cost.totalCostKRW, 0);
    const qtyCol = p.id === 'US_ORIGINAL_V1' ? 'D' : p.id === 'TH_ORIGINAL_V1' ? 'F' : 'E';
    assert.equal(sheet[`${qtyCol}${p.detailStartRow}`].v, 0);
    if (!['CO_42_1_ORIGINAL_V1', 'AU_ORIGINAL_V1', 'CN_SEA_ORIGINAL_V1'].includes(p.id)) {
      assert.equal(sheet[`AD${p.detailStartRow}`].v, 0);
    }
  }
});

test('every country export outputs a clean title without system disclaimers even under TEST_ONLY input', async () => {
  for (const profile of Object.values(INVOICE_COST_EXPORT_PROFILES).filter(profile=>!profile.generated)) {
    const f = invoiceCostExportFixture(1, profile.formulaId);
    f.snapshot.input.exchangeRateType = 'TEST_ONLY';
    const before = JSON.stringify(f);
    const bytes = await createInvoiceCostWorkbook(f);
    const book = XLSX.read(bytes);
    assert.deepEqual(book.SheetNames, ['41-2']);
    assert.doesNotMatch(book.Sheets['41-2'].B1.v, /미승인 계산본|운영 DB 변경 없음|실제 청구액 아님|TEST_ONLY/);
    assert.equal(JSON.stringify(f), before);
  }
});

test('export detail bound remains 1000 rows and rejects an oversized approved-looking scope', async () => {
  const f = invoiceCostExportFixture(1000, 'US_CNF_BOX_V1');
  const s = XLSX.read(await createInvoiceCostWorkbook(f)).Sheets['41-2'];
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
  assert.doesNotMatch(route, /preserveHistory:\s*exportWithCostHistory/);
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
