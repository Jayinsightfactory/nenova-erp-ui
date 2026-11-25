import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import XLSXModule from 'xlsx-js-style';

import { buildPrompt } from '../lib/importPackingPrompt.js';
import { parsePackingResponse } from '../lib/importPackingResponse.js';
import { splitPackingPdf, mergePackingChunks } from '../lib/importPackingPdfChunks.js';
import { genColombia, ALL_SEED_ALIASES } from '../lib/importPacking.js';
import { indexPackingCatalog } from '../lib/importPackingState.js';
import { packingSourceValueIssues } from '../lib/importPackingSourceReview.js';
import { packingAmountIssues, applyPackingAmountReview } from '../lib/packingAmountReview.js';
import { adaptPackingReceipts, packingInvoiceSourceIdentity } from '../lib/importPackingReceiptAdapter.js';
import { validateInvoiceReceiptLines } from '../lib/invoiceReceiptValidation.js';
import { previewInvoiceReceipt } from '../lib/invoiceReceiptWriter.js';

const XLSX = XLSXModule.default || XLSXModule;

const SOURCE_HASH = 'f5600bfffa0e246f20d53993fcfaae230d8beed1574518e2a6246d94dfbca6c6';

const PRODUCTS_CO = [
  { ProdKey: 866, name: 'Hydrangea Blue (블루）', ProdName: 'Hydrangea Blue (블루）', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 869, name: 'Hydrangea Emerald (연그린)', ProdName: 'Hydrangea Emerald (연그린)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 874, name: 'Hydrangea Light Blue (연블루)', ProdName: 'Hydrangea Light Blue (연블루)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 889, name: 'Hydrangea White (화이트)', ProdName: 'Hydrangea White (화이트)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 871, name: 'Hydrangea Lavender (라벤더)', ProdName: 'Hydrangea Lavender (라벤더)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 905, name: 'Hydrangea G/ Esmeral (진그린)', ProdName: 'Hydrangea G/ Esmeral (진그린)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 2112, name: 'Hydrangea Rosewood (BA) (로즈우드)', ProdName: 'Hydrangea Rosewood (BA) (로즈우드)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 2819, name: 'Hydrangea Peach (Florentina) 피치', ProdName: 'Hydrangea Peach (Florentina) 피치', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 3124, name: 'Hydrangea Burgundy (버건디)', ProdName: 'Hydrangea Burgundy (버건디)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 3655, name: 'Hydrangea Albari coque (알바리코케)', ProdName: 'Hydrangea Albari coque (알바리코케)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
  { ProdKey: 4210, name: 'Hydrangea Yellow Lemon Ice (옐로우 레몬 아이스)', ProdName: 'Hydrangea Yellow Lemon Ice (옐로우 레몬 아이스)', country: 'CO', family: 'HYDRANGEA', CountryFlower: '콜롬비아수국', CounName: '콜롬비아', OutUnit: '박스', EstUnit: '송이', SteamOf1Box: 30, SteamOf1Bunch: 1, isDeleted: 0 },
];
const CATALOG_CO = indexPackingCatalog({ items: PRODUCTS_CO });

function rowEvidence(page, desc, pcsQuote, stems, uPrice, tPrice) {
  return {
    description: { page, quote: desc, bbox: null },
    pcs: { page, quote: pcsQuote, bbox: null },
    steam_box: { page, quote: '30', bbox: null },
    total_stems: { page, quote: String(stems), bbox: null },
    u_price: { page, quote: String(uPrice), bbox: null },
    t_price: { page, quote: String(tPrice), bbox: null },
  };
}

function make4802RawPayload({ princessPcs = 7, princessQuote = '7,500 30,00QBx30' } = {}) {
  return {
    master_awb: '992-04727833',
    invoices: [
      {
        invoice: '25605',
        awb: '992-04727833',
        house_awb: 'AFMD00575862',
        raw_date: '24NOV2026',
        date_kind: 'invoice',
        date_order: 'DMY',
        date: '2026/11/24',
        currency: 'USD',
        supplier: 'CI FLORES BALVERDE SAS',
        gross_weight: 560.9,
        vol_weight: null,
        freight_total: 0,
        invoice_total: 1923.00,
        metadata_evidence: {
          date: { page: 1, quote: 'DATE: 24NOV2026', bbox: null },
          currency: { page: 1, quote: 'USD', bbox: null },
          invoice_total: { page: 1, quote: 'TOTAL USD 1.923,00', bbox: null },
        },
        products: [
          { description: 'HYDRANGEA EMERALD', pcs: 4, bunch_st: 1, steam_box: 30, total_stems: 120, u_price: 0.65, t_price: 78.00, review_evidence: rowEvidence(1, 'HYDRANGEA EMERALD', '1,000 4 QBx30', 120, 0.65, 78) },
          { description: 'HYDRANGEA LIGHT BLUE', pcs: 10, bunch_st: 1, steam_box: 30, total_stems: 300, u_price: 0.70, t_price: 210.00, review_evidence: rowEvidence(1, 'HYDRANGEA LIGHT BLUE', '2,500 10 QBx30', 300, 0.70, 210) },
          { description: 'HYDRANGEA TINTED ROSEWOOD', pcs: 26, bunch_st: 1, steam_box: 30, total_stems: 780, u_price: 0.85, t_price: 663.00, review_evidence: rowEvidence(1, 'HYDRANGEA TINTED ROSEWOOD', '6,500 26 QBx30', 780, 0.85, 663) },
          { description: 'HYDRANGEA TINTED LAVANDER', pcs: 3, bunch_st: 1, steam_box: 30, total_stems: 90, u_price: 0.85, t_price: 76.50, review_evidence: rowEvidence(1, 'HYDRANGEA TINTED LAVANDER', '0,750 3 QBx30', 90, 0.85, 76.5) },
          { description: 'HYDRANGEA TINTED ALBARICOQUE', pcs: 35, bunch_st: 1, steam_box: 30, total_stems: 1050, u_price: 0.82, t_price: 861.00, review_evidence: rowEvidence(1, 'HYDRANGEA TINTED ALBARICOQUE', '8,750 35 QBx30', 1050, 0.82, 861) },
          { description: 'HYDRANGEA TINTED BURGUNDY', pcs: 1, bunch_st: 1, steam_box: 30, total_stems: 30, u_price: 1.15, t_price: 34.50, review_evidence: rowEvidence(1, 'HYDRANGEA TINTED BURGUNDY', '0,250 1 QBx30', 30, 1.15, 34.5) },
        ],
      },
      {
        invoice: '5456',
        awb: '992-04727833',
        house_awb: 'AFMD00575864',
        raw_date: '24/11/2026',
        date_kind: 'invoice',
        date_order: 'DMY',
        date: '2026/11/24',
        currency: 'USD',
        supplier: 'GREEN LAND FLOWERS S A S',
        freight_total: 0,
        invoice_total: 1317.60,
        metadata_evidence: {
          date: { page: 2, quote: 'Fecha Factura: 24/11/2026', bbox: null },
          currency: { page: 2, quote: 'USD', bbox: null },
          invoice_total: { page: 2, quote: 'TOTAL USD 1,317.60', bbox: null },
        },
        products: [
          { description: 'HYDRANGEA WHITE', pcs: 50, bunch_st: 1, steam_box: 30, total_stems: 1500, u_price: 0.65, t_price: 975.00, review_evidence: rowEvidence(2, 'HYDRANGEA WHITE', '50 QBx30', 1500, 0.65, 975) },
          { description: 'HYDRANGEA ESMERALDA PREMIUN', pcs: 14, bunch_st: 1, steam_box: 30, total_stems: 420, u_price: 0.68, t_price: 285.60, review_evidence: rowEvidence(2, 'HYDRANGEA ESMERALDA PREMIUN', '14 QBx30', 420, 0.68, 285.6) },
          { description: 'HYDRANGEA TINTED LAVANDER', pcs: 2, bunch_st: 1, steam_box: 30, total_stems: 60, u_price: 0.95, t_price: 57.00, review_evidence: rowEvidence(2, 'HYDRANGEA TINTED LAVANDER', '2 QBx30', 60, 0.95, 57) },
        ],
      },
      {
        invoice: '2936',
        awb: '992-04727833',
        house_awb: 'AFMD00575865',
        raw_date: '2026-11-24',
        date_kind: 'invoice',
        date_order: 'YMD',
        date: '2026/11/24',
        currency: 'USD',
        supplier: 'FLORENTINA EXPORT SAS',
        freight_total: 0,
        invoice_total: 829.80,
        metadata_evidence: {
          date: { page: 3, quote: 'Invoice Date: 2026-11-24', bbox: null },
          currency: { page: 3, quote: 'USD', bbox: null },
          invoice_total: { page: 3, quote: 'TOTAL USD 829.80', bbox: null },
        },
        products: [
          { description: 'HYDRANGEA PREMIUM WHITE COPTA', pcs: 13, bunch_st: 1, steam_box: 30, total_stems: 390, u_price: 0.56, t_price: 218.40, review_evidence: rowEvidence(3, 'HYDRANGEA PREMIUM WHITE COPTA', '13 QBx30', 390, 0.56, 218.4) },
          { description: 'HYDRANGEA PREMIUM PEACH COPTA', pcs: 23, bunch_st: 1, steam_box: 30, total_stems: 690, u_price: 0.78, t_price: 538.20, review_evidence: rowEvidence(3, 'HYDRANGEA PREMIUM PEACH COPTA', '23 QBx30', 690, 0.78, 538.2) },
          { description: 'HYDRANGEA PREMIUM BLUE COPTA', pcs: 1, bunch_st: 1, steam_box: 30, total_stems: 30, u_price: 0.64, t_price: 19.20, review_evidence: rowEvidence(3, 'HYDRANGEA PREMIUM BLUE COPTA', '1 QBx30', 30, 0.64, 19.2) },
          { description: 'HYDRANGEA YELLOW LEMON ICE COPTA', pcs: 2, bunch_st: 1, steam_box: 30, total_stems: 60, u_price: 0.90, t_price: 54.00, review_evidence: rowEvidence(3, 'HYDRANGEA YELLOW LEMON ICE COPTA', '2 QBx30', 60, 0.90, 54) },
        ],
      },
      {
        invoice: '8341',
        awb: '992-04727833',
        house_awb: 'AFMD00575866',
        raw_date: '24/11/2026',
        date_kind: 'invoice',
        date_order: 'DMY',
        date: '2026/11/24',
        currency: 'USD',
        supplier: 'ANTIOQUIA FLORAL S.A.S.',
        freight_total: 0,
        invoice_total: 791.10,
        metadata_evidence: {
          date: { page: 4, quote: 'FECHA: 24/11/2026', bbox: null },
          currency: { page: 4, quote: 'USD', bbox: null },
          invoice_total: { page: 4, quote: 'TOTAL USD 791.10', bbox: null },
        },
        products: [
          { description: 'HYDRANGEA WHITE', pcs: 27, bunch_st: 1, steam_box: 30, total_stems: 810, u_price: 0.60, t_price: 486.00, review_evidence: rowEvidence(4, 'HYDRANGEA WHITE', '27 QB', 810, 0.60, 486) },
          { description: 'HYDRANGEA EMERALD', pcs: 3, bunch_st: 1, steam_box: 30, total_stems: 90, u_price: 0.65, t_price: 58.50, review_evidence: rowEvidence(4, 'HYDRANGEA EMERALD', '3 QB', 90, 0.65, 58.5) },
          { description: 'HYDRANGEA BLUE', pcs: 3, bunch_st: 1, steam_box: 30, total_stems: 90, u_price: 0.68, t_price: 61.20, review_evidence: rowEvidence(4, 'HYDRANGEA BLUE', '3 QB', 90, 0.68, 61.2) },
          { description: 'HYDRANGEA LIGHT BLUE', pcs: 3, bunch_st: 1, steam_box: 30, total_stems: 90, u_price: 0.70, t_price: 63.00, review_evidence: rowEvidence(4, 'HYDRANGEA LIGHT BLUE', '3 QB', 90, 0.70, 63) },
          { description: 'HYDRANGEA TINTED BURGUNDY', pcs: 4, bunch_st: 1, steam_box: 30, total_stems: 120, u_price: 1.02, t_price: 122.40, review_evidence: rowEvidence(4, 'HYDRANGEA TINTED BURGUNDY', '4 QB', 120, 1.02, 122.4) },
        ],
      },
      {
        invoice: '0642',
        awb: '992-04727833',
        house_awb: 'AFMD00575867',
        raw_date: 'NOVIEMBRE 24 DE 2026',
        date_kind: 'invoice',
        date_order: 'MDY',
        date: '2026/11/24',
        currency: 'USD',
        supplier: 'GRUPO VALORES EN ACCION S.A.S',
        freight_total: 0,
        invoice_total: 915.00,
        metadata_evidence: {
          date: { page: 5, quote: 'FECHA: NOVIEMBRE 24 DE 2026', bbox: null },
          currency: { page: 5, quote: 'USD', bbox: null },
          invoice_total: { page: 5, quote: 'TOTAL USD 915,00', bbox: null },
        },
        products: [
          { description: 'HYDRANGEA WHITE', pcs: 50, bunch_st: 1, steam_box: 30, total_stems: 1500, u_price: 0.61, t_price: 915.00, review_evidence: rowEvidence(5, 'HYDRANGEA WHITE', '50QBx30', 1500, 0.61, 915) },
        ],
      },
      {
        invoice: '19121',
        awb: '992-04727833',
        house_awb: 'AFMD00575868',
        raw_date: '25NOV2026',
        date_kind: 'invoice',
        date_order: 'DMY',
        date: '2026/11/25',
        currency: 'USD',
        supplier: 'PRINCESS FARMS SAS',
        gross_weight: 300,
        freight_total: 0,
        invoice_total: 513.00,
        metadata_evidence: {
          date: { page: 6, quote: 'DATE: 25NOV2026', bbox: null },
          currency: { page: 6, quote: 'USD', bbox: null },
          invoice_total: { page: 6, quote: 'TOTAL USD 513.00', bbox: null },
        },
        products: [
          { description: 'HYDRANGEA WHITE', pcs: princessPcs, bunch_st: 1, steam_box: 30, total_stems: 900, u_price: 0.57, t_price: 513.00, review_evidence: rowEvidence(6, 'HYDRANGEA WHITE', princessQuote, 900, 0.57, 513) },
        ],
      },
      {
        invoice: '46793',
        awb: '992-04727833',
        house_awb: 'AFMD00575869',
        raw_date: '2026-11-24',
        date_kind: 'invoice',
        date_order: 'YMD',
        date: '2026/11/24',
        currency: 'USD',
        supplier: 'DAWN FLOWERS S.A.S',
        freight_total: 0,
        invoice_total: 372.00,
        metadata_evidence: {
          date: { page: 7, quote: 'Date: 2026-11-24', bbox: null },
          currency: { page: 7, quote: 'USD', bbox: null },
          invoice_total: { page: 7, quote: 'TOTAL USD 372.00', bbox: null },
        },
        products: [
          { description: 'HYDRANGEA WHITE', pcs: 20, bunch_st: 1, steam_box: 30, total_stems: 600, u_price: 0.62, t_price: 372.00, review_evidence: rowEvidence(7, 'HYDRANGEA WHITE', '20 QBx30', 600, 0.62, 372) },
        ],
      },
    ],
  };
}

test('7-page Colombia Hydrangea PDF splits into 3 chunks and CO prompt covers Dawn Flowers & BXS/PCS rule', async () => {
  const prompt = buildPrompt('CO');
  assert.match(prompt, /Dawn Flowers/);
  assert.match(prompt, /30,00QBx30/);

  const pdf = await PDFDocument.create();
  for (let i = 0; i < 7; i += 1) pdf.addPage([612, 792]);
  const bytes = await pdf.save();
  const base64 = Buffer.from(bytes).toString('base64');
  const chunks = await splitPackingPdf(base64, { pagesPerChunk: 3 });
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map(chunk => chunk.pages), [[1, 2, 3], [4, 5, 6], [7]]);

  const payload = make4802RawPayload({ princessPcs: 30 });
  const merged = mergePackingChunks([
    { pages: [1, 2, 3], result: { master_awb: payload.master_awb, invoices: payload.invoices.slice(0, 3) } },
    { pages: [4, 5, 6], result: { master_awb: payload.master_awb, invoices: payload.invoices.slice(3, 6) } },
    { pages: [7], result: { master_awb: payload.master_awb, invoices: payload.invoices.slice(6, 7) } },
  ], 7, { sourceHash: SOURCE_HASH });
  const parsed = parsePackingResponse(merged, 'CO').result;
  assert.equal(parsed.invoices.length, 7);
});

test('48-02 Hortensias CI Invoice: recovers Princess Farms 30,00QBx30 pcs=30, maps Dawn Flowers to CO_DAW, and generates 7 mismatch-free Excels', () => {
  const raw = make4802RawPayload({ princessPcs: 7, princessQuote: '7,500 30,00QBx30' });
  const { result } = parsePackingResponse({
    content: [{ type: 'text', text: JSON.stringify(raw) }],
    stop_reason: 'end_turn',
  }, 'CO');

  assert.equal(result.invoices.length, 7);
  const princess = result.invoices.find(inv => inv.invoice === '19121');
  assert.equal(princess.products[0].pcs, 30, 'verified printed quote 30,00QBx30 must reconcile BXS truncation 7 -> 30');

  for (const inv of result.invoices) {
    assert.deepEqual(packingSourceValueIssues(inv, 'CO'), [], `invoice ${inv.invoice} must have zero source value issues`);
  }
  assert.deepEqual(packingAmountIssues(result), []);

  const excels = result.invoices.map(inv => genColombia(XLSX, inv, '48', '02', { catalog: CATALOG_CO, aliases: ALL_SEED_ALIASES, masterAwb: result.master_awb }));
  assert.equal(excels.length, 7);
  assert.deepEqual(excels.filter(item => item.totalMismatch), [], 'all 7 hydrangea packing lists must have zero TOTAL_MISMATCH');
  assert.deepEqual(excels.flatMap(item => [...item.pending, ...item.noMatches]), [], 'all 21 product lines including typos/COPTA must match active catalog');

  const dawn = excels.find(item => item.name.includes('46793'));
  assert.equal(dawn.name, '48-02_CO_DAW_46793.xlsx');
  const dawnWb = XLSX.read(dawn.buf, { type: 'array' });
  assert.deepEqual(dawnWb.SheetNames, ['CO-수국 DAWN']);

  const princessExcel = excels.find(item => item.name.includes('19121'));
  assert.equal(princessExcel.name, '48-02_CO_PNS_19121.xlsx');
  const princessWb = XLSX.read(princessExcel.buf, { type: 'array' });
  const princessWs = princessWb.Sheets['CO-수국 PRINCESS'];
  assert.equal(princessWs.F6.v, 30);
  assert.equal(princessWs.J6.v, 900);
  assert.equal(princessWs.L6.v, 513);

  const totalBoxes = result.invoices.reduce((sum, inv) => sum + inv.products.reduce((s, p) => s + p.pcs, 0), 0);
  const totalStems = excels.reduce((sum, item) => sum + item.products.reduce((s, p) => s + p.qty, 0), 0);
  const totalUsd = Math.round(result.invoices.reduce((sum, inv) => sum + inv.invoice_total, 0) * 100) / 100;
  assert.equal(totalBoxes, 324);
  assert.equal(totalStems, 9720);
  assert.equal(totalUsd, 6661.50);
});

test('unverified pcs * steam_box != total_stems is never invented and is caught across source review, Excel summary, and receipt validation', async () => {
  const unverifiedRaw = make4802RawPayload({ princessPcs: 7, princessQuote: '7,500' });
  const { result } = parsePackingResponse({
    content: [{ type: 'text', text: JSON.stringify(unverifiedRaw) }],
    stop_reason: 'end_turn',
  }, 'CO');
  const princess = result.invoices[5];
  assert.equal(princess.products[0].pcs, 7, 'must never invent pcs=30 without an explicit QBx30 quote');

  const sourceIssues = packingSourceValueIssues(princess, 'CO');
  assert.equal(sourceIssues.length, 1);
  assert.match(sourceIssues[0], /박스 수량\(7\)×박스당 송이수\(30\)/);

  const princessExcel = genColombia(XLSX, princess, '48', '02', { catalog: CATALOG_CO, masterAwb: result.master_awb });
  assert.ok(princessExcel.totalMismatch, 'unreconciled pcs=7 must still report totalMismatch on Excel');
  assert.equal(princessExcel.products[0].qty, 210, 'Excel summary stem qty must match Excel J6=210, not mask mismatch with 900');

  const [adaptedXlsxDoc] = await adaptPackingReceipts({
    country: 'CO',
    fileName: '48-2_CO.xlsx',
    sourceHash: SOURCE_HASH,
    matchNextConfirmed: true,
    invoices: [{ ...princess, pdfSourceHash: SOURCE_HASH }],
    excels: [{ ...princessExcel, sourceInvoiceIdentity: packingInvoiceSourceIdentity(princess, 0) }],
  });
  assert.equal(adaptedXlsxDoc.lines[0].sourceEvidence.conversionValidation.status, 'MISMATCH');
  assert.equal(adaptedXlsxDoc.lines[0].reviewed.confirmed, false);

  await assert.rejects(() => adaptPackingReceipts({
    country: 'CO',
    fileName: '48-2 Hortensias CI Invoice.pdf',
    sourceHash: SOURCE_HASH,
    reviewConfirmed: true,
    invoices: [{ ...princess, pdfSourceHash: SOURCE_HASH }],
    excels: [{ ...princessExcel, sourceInvoiceIdentity: packingInvoiceSourceIdentity(princess, 0) }],
  }), /박스 수량\(7\)×박스당 송이수\(30\)/);

  const staleDraft = {
    documentId: '34315846-dc9d-80f2-829b-ee17ff4b0548',
    orderYear: '2026',
    orderWeek: '48-02',
    farmKey: 36,
    invoiceNo: '19121',
    invoiceYear: '2026',
    reviewedMetadata: { country: 'CO', inputDate: '2026-11-25', farmName: 'Princess Farms S.A.S' },
    lines: [{
      lineId: '95b1309f-73b1-8932-89b9-b9b5f3c8a1f0',
      lineNo: 1,
      originalName: 'HYDRANGEA WHITE',
      prodKey: 889,
      boxQuantity: 7,
      bunchQuantity: 900,
      stemQuantity: 900,
      priceUnit: '송이',
      unitPrice: 0.57,
      currency: 'USD',
      lineAmount: 513,
      sourceEvidence: { packing: { stemsPerBunch: 1, stemsPerBox: 30 } },
      reviewed: { confirmed: true },
    }],
  };
  const validationBlocked = validateInvoiceReceiptLines(staleDraft, PRODUCTS_CO);
  assert.ok(validationBlocked.issues.some(i => i.code === 'BOX_STEM_PACKING_MISMATCH'));

  const correctedDraft = structuredClone(staleDraft);
  correctedDraft.lines[0].boxQuantity = 30;
  assert.deepEqual(validateInvoiceReceiptLines(correctedDraft, PRODUCTS_CO).issues, []);

  const priorYearConflict = structuredClone(correctedDraft);
  priorYearConflict.orderYear = '2025';
  assert.ok(validateInvoiceReceiptLines(priorYearConflict, PRODUCTS_CO).issues.some(i => i.code === 'SOURCE_YEAR_CONFLICT'));
});

test('previewInvoiceReceipt surfaces exact blocking week, category, product names, and resolution when PREVIOUS_UNFIXED blocks', async () => {
  const docId = '11fae654-2bd0-8d71-9fe4-17ce4a3b6820';
  const lineId = '22fae654-2bd0-8d71-9fe4-17ce4a3b6820';
  const types = {
    UniqueIdentifier: 'UniqueIdentifier',
    Int: 'Int',
    NVarChar: 'NVarChar',
    Binary: len => `Binary(${len})`,
  };
  const queryFn = async sqlText => {
    if (sqlText.includes('invoice-receipt:get-document')) {
      return {
        recordset: [{
          DocumentId: docId, OrderYear: '2026', OrderWeek: '48-02', Revision: 2,
          RowVersion: Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), FarmKey: 31, InvoiceNo: '25605', InvoiceYear: '2026',
          SourceHash: Buffer.from(SOURCE_HASH, 'hex'), OriginalFileName: '48-2 Hortensias CI Invoice.pdf',
          ReceiptStatus: 'DRAFT', CostStatus: null,
          RawMetadataJson: JSON.stringify({ supplier: 'CI FLORES BALVERDE SAS', currency: 'USD', invoiceTotal: 1923 }),
          ReviewedMetadataJson: JSON.stringify({ country: 'CO', farmName: 'C.I Flores Balverde S.A.S', inputDate: '2026-11-25' }),
          CreatedBy: 'nenovaIC4', CreatedAt: new Date('2026-11-25T04:27:00Z'), UpdatedBy: 'nenovaIC4', UpdatedAt: new Date('2026-11-25T04:27:00Z'),
        }],
      };
    }
    if (sqlText.includes('invoice-receipt:get-lines')) {
      return {
        recordset: [{
          LineId: lineId, LineNo: 1, OriginalName: 'HYDRANGEA EMERALD', LengthText: null, ProdKey: 869,
          BoxQuantity: 4, BunchQuantity: 120, StemQuantity: 120, PriceUnit: '송이', UnitPrice: 0.65,
          Currency: 'USD', LineAmount: 78, SourceEvidenceJson: JSON.stringify({ packing: { stemsPerBox: 30, stemsPerBunch: 1 } }),
          ReviewedJson: JSON.stringify({ confirmed: true }),
        }],
      };
    }
    if (sqlText.includes('invoice-receipt:get-history') || sqlText.includes('invoice-receipt:get-operations')) {
      return { recordset: [] };
    }
    if (sqlText.includes('FROM dbo.StockMaster')) {
      return {
        recordsets: [
          [{ ProdKey: 869, ProdName: 'Hydrangea Emerald (연그린)', CountryFlower: '콜롬비아수국', isDeleted: 0 }],
          [{ CurrentYearWeek: '20264802', PreviousYearWeek: '20264801', NextYearWeek: null }],
          [
            { Phase: 'PREVIOUS_UNFIXED', OrderYearWeek: '20264801', CountryFlower: '콜롬비아수국', ProdKey: 866, ProdName: 'Hydrangea Blue (블루）' },
            { Phase: 'PREVIOUS_UNFIXED', OrderYearWeek: '20264801', CountryFlower: '콜롬비아수국', ProdKey: 889, ProdName: 'Hydrangea White (화이트)' },
            { Phase: 'PREVIOUS_UNFIXED', OrderYearWeek: '20264801', CountryFlower: '콜롬비아수국', ProdKey: 3124, ProdName: 'Hydrangea Burgundy (버건디)' },
          ],
        ],
      };
    }
    if (sqlText.includes('NOT EXISTS')) {
      return { recordset: [] };
    }
    if (sqlText.includes('FROM dbo.ViewOrder')) {
      return { recordsets: [[], []] };
    }
    if (sqlText.includes('FROM dbo.Product')) {
      return { recordset: [PRODUCTS_CO[1]] };
    }
    if (sqlText.includes('FROM dbo.Farm')) {
      return { recordset: [{ FarmKey: 31, FarmName: 'C.I Flores Balverde S.A.S', CounKey: 7, isDeleted: 0 }] };
    }
    if (sqlText.includes('FROM dbo.WarehouseMaster') && sqlText.includes('InvoiceNo=@invoice')) {
      return { recordset: [] };
    }
    throw new Error(`Unexpected SQL in test: ${sqlText}`);
  };

  const preview = await previewInvoiceReceipt({ queryFn, types, documentId: docId, revision: 2 });
  assert.equal(preview.canCommit, false);
  const blocked = preview.issues.find(i => i.code === 'NATIVE_ELIGIBILITY_BLOCKED');
  assert.ok(blocked);
  assert.match(blocked.message, /2026 \/ 48-01/);
  assert.match(blocked.message, /콜롬비아수국/);
  assert.match(blocked.message, /3품목: Hydrangea Blue \(블루）, Hydrangea White \(화이트\), Hydrangea Burgundy \(버건디\)/);
  assert.match(blocked.resolution, /출고확정/);
  assert.match(blocked.resolution, /패킹리스트 엑셀\(\.xlsx\)/);
});
