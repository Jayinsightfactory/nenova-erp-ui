import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import XLSX from 'xlsx-js-style';
import { PDFDocument } from 'pdf-lib';

import {
  CO_FARMS,
  detectCOFarm,
  findBestMatch,
  genColombia,
  genEcuador,
  makeProductResolver,
} from '../lib/importPacking.js';
import {
  PACKING_CHUNK_VERSION,
  chunkExtractionPrompt,
  mergePackingChunks,
  parsePackingChunk,
  splitPackingPdf,
} from '../lib/importPackingPdfChunks.js';
import { healColombiaInvoiceExtraction } from '../lib/importPackingResponse.js';
import { packingSourceValueIssues } from '../lib/importPackingSourceReview.js';
import { buildPrompt } from '../lib/importPackingPrompt.js';
import { validatePackingPdf } from '../lib/importTeamPdf.js';
import {
  isAirWaybillDocument,
  parseSupportAwbDocument,
} from '../lib/importAwbFields.js';
import {
  invoiceBoxTotal,
  reviewAirWaybill,
} from '../lib/invoiceAwbEvidence.js';
import {
  invoiceSupplierKey,
  resolveInvoiceHeader,
} from '../lib/invoiceReceiptAutoFill.js';
import {
  assertPackingExportBunches,
  readPackingExport,
} from '../lib/packingExportBunchGuard.js';
import {
  canonicalInvoiceNo,
  isMatchingDuplicateWarehouseRow,
  matchExistingWarehouseReceipts,
  partitionPackingInvoicesByDuplicates,
  samePackingSupplier,
} from '../lib/packingDuplicateCheck.js';
import { createExistingReceiptsCheckHandler } from '../lib/packingExistingReceiptsApi.js';

const WM_4802_HYDRANGEAS = [
  { WarehouseKey: 8262, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'C.I Flores Balverde S.A.S', InvoiceNo: '25605', OrderNo: '992-04727833', InputDate: '2026-11-23', FileName: '48-02_CO_BAL_25605.xlsx', isDeleted: 0 },
  { WarehouseKey: 8263, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'Green Land Flowers S.A.S', InvoiceNo: '5456', OrderNo: '992-04727833', InputDate: '2026-11-23', FileName: '48-02_CO_GRL_5456.xlsx', isDeleted: 0 },
  { WarehouseKey: 8264, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'Florentina Export S.A.S', InvoiceNo: '2936', OrderNo: '992-04727833', InputDate: '2026-11-23', FileName: '48-02_CO_FLO_2936.xlsx', isDeleted: 0 },
  { WarehouseKey: 8265, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'Antioquia Floral S.A.S', InvoiceNo: '8341', OrderNo: '992-04727833', InputDate: '2026-11-23', FileName: '48-02_CO_ANT_8341.xlsx', isDeleted: 0 },
  // Excel numeric cell dropped the leading zero: PDF says "0642", DB stores "642"
  { WarehouseKey: 8266, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'Grupo Valores en Accion', InvoiceNo: '642', OrderNo: '992-04727833', InputDate: '2026-11-23', FileName: '48-02_CO_VAL_0642.xlsx', isDeleted: 0 },
  { WarehouseKey: 8267, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'Princess Farms S.A.S', InvoiceNo: '19121', OrderNo: '992-04727833', InputDate: '2026-11-24', FileName: '48-02_CO_PNS_19121.xlsx', isDeleted: 0 },
  { WarehouseKey: 8268, OrderYear: '2026', OrderWeek: '48-02', FarmName: 'DAWN FLOWERS S.A.S', InvoiceNo: '46793', OrderNo: '992-04727833', InputDate: '2026-11-23', FileName: '48-02_CO_DAW_46793.xlsx', isDeleted: 0 },
  // Prior-year same-week fixture (2025 / 48-02): must NEVER block 2026 / 48-02!
  { WarehouseKey: 5001, OrderYear: '2025', OrderWeek: '48-02', FarmName: 'Agroindustrial Don Eusebio', InvoiceNo: '133973', OrderNo: '992-00000000', InputDate: '2025-11-24', FileName: '48-02_CO_EUS_133973.xlsx', isDeleted: 0 },
];

test('duplicate detection matches 7 committed 48-02 hydrangeas (including 0642 vs 642), excludes 17 new Bogota, and isolates prior-year 2025/48-02', () => {
  assert.equal(canonicalInvoiceNo('0642'), '642');
  assert.equal(canonicalInvoiceNo('001077907'), '1077907');
  assert.equal(canonicalInvoiceNo('FK 2936'), 'FK2936');
  assert.notEqual(canonicalInvoiceNo('FK 2936'), canonicalInvoiceNo('2936'));

  assert.equal(samePackingSupplier('Balverde', 'C.I Flores Balverde S.A.S', { country: 'CO' }), true);
  assert.equal(samePackingSupplier('Dawn Flowers', 'DAWN FLOWERS S.A.S', { country: 'CO' }), true);
  assert.equal(samePackingSupplier('FLORA CONCEPT LLC', 'The Elite Flowers', { country: 'CO' }), true);
  assert.equal(samePackingSupplier('COMMERCIAL ZELECTA TRADING GROUP CORP', 'ROSAS AGUACLARA S.A.S', { country: 'CO' }), true);

  const mixed24 = [
    // 17 new Bogota invoices
    { supplier: 'Agroindustrial Don Eusebio S.A.S.', invoice: '133973', date: '2026/11/25' },
    { supplier: 'Flores El Zorro S.A.S.', invoice: '5502', date: '2026/11/25' },
    { supplier: 'AYURA SAS', invoice: '18210', date: '2026/11/25' },
    { supplier: 'Superior Blooms Corp.', invoice: '283735', date: '2026/11/25' },
    { supplier: 'AGRÍCOLA EL CACTUS S.A.', invoice: 'FC68882', date: '2026/11/25' },
    { supplier: 'VARIETTA FARMS SAS', invoice: '2233', date: '2026/11/25' },
    { supplier: 'C I MAXIFLORES S.A.S', invoice: 'VE325268', date: '2026/11/25' },
    { supplier: 'FLORES TIBA SA', invoice: '44256', date: '2026/11/25' },
    { supplier: 'AGRICOLA CIRCASIA SAS', invoice: 'INV-019436', date: '2026/11/25' },
    // Same numeric suffix 2936 as Florentina, but different prefix FK + different supplier!
    { supplier: 'CONSTRUNOTE JAR .SA.S', invoice: 'FK 2936', date: '2026/11/25' },
    { supplier: 'Monika Farms S.A.S', invoice: '47706', date: '2026/11/25' },
    { supplier: 'DAFLOR S.A.S', invoice: '1712', date: '2026/11/25' },
    { supplier: 'C.I. FLORES DE FUNZA SAS', invoice: 'FE204589', date: '2026/11/25' },
    { supplier: 'FLORES DE AGUATA SAS', invoice: 'FE 852', date: '2026/11/25' },
    { supplier: 'EL MILAGRO DE LAS FLORES S.A.S.', invoice: '001077907', date: '2026/11/25' },
    { supplier: 'COMMERCIAL ZELECTA TRADING GROUP CORP', invoice: '80043610', date: '2026/11/25' },
    { supplier: 'FLORA CONCEPT LLC', invoice: '2203865', date: '2026/11/25' },
    // 7 already-committed Antioquia hydrangeas (indices 17..23)
    { supplier: 'C.I FLORES BALVERDE S.A.S', invoice: '25605', date: '2026/11/23' },
    { supplier: 'GREEN LAND FLOWERS S.A.S', invoice: '5456', date: '2026/11/23' },
    { supplier: 'FLORENTINA EXPORT S.A.S', invoice: '2936', date: '2026/11/23' },
    { supplier: 'ANTIOQUIA FLORAL S.A.S', invoice: '8341', date: '2026/11/23' },
    { supplier: 'GRUPO VALORES EN ACCION S.A.S', invoice: '0642', date: '2026/11/23' },
    { supplier: 'PRINCESS FARMS S.A.S', invoice: '19121', date: '2026/11/24' },
    { supplier: 'DAWN FLOWERS S.A.S', invoice: '46793', date: '2026/11/23' },
  ];

  const { matches, matchesByIndex } = matchExistingWarehouseReceipts(mixed24, WM_4802_HYDRANGEAS, {
    country: 'CO',
    orderYear: '2026',
    orderWeek: '48-02',
  });

  assert.equal(matches.length, 7);
  assert.deepEqual(matches.map(m => m.warehouseKey), [8262, 8263, 8264, 8265, 8266, 8267, 8268]);
  assert.equal(matchesByIndex[0], undefined, '2025/48-02 Don Eusebio 133973 must not collide with 2026/48-02');
  assert.equal(matchesByIndex[9], undefined, 'Construnorte FK 2936 must not collide with Florentina 2936');
  assert.equal(matchesByIndex[21]?.warehouseKey, 8266, 'Grupo Valores 0642 must match DB 642');

  const excluded = new Set(matches.map(m => m.index));
  const { activeInvoices, excludedInvoices } = partitionPackingInvoicesByDuplicates(mixed24, excluded);
  assert.equal(activeInvoices.length, 17);
  assert.equal(excludedInvoices.length, 7);

  // Warehouse upload / receipt writer duplicate check catches leading-zero 0642 vs 642 & farm alias
  assert.equal(
    isMatchingDuplicateWarehouseRow(WM_4802_HYDRANGEAS[4], { farmName: 'Grupo Valores en Accion', invoiceNo: '0642' }),
    true,
  );
  assert.equal(
    isMatchingDuplicateWarehouseRow(WM_4802_HYDRANGEAS[0], { farmName: 'Balverde', invoiceNo: '25605' }),
    true,
  );
  assert.equal(
    isMatchingDuplicateWarehouseRow(WM_4802_HYDRANGEAS[2], { farmName: 'Construnorte', invoiceNo: 'FK 2936' }),
    false,
  );
});

test('read-only check-existing-receipts API handler returns matched duplicates and rejects writes/invalid methods', async () => {
  const sqlCalls = [];
  const handler = createExistingReceiptsCheckHandler({
    queryFn: async (q, params) => {
      sqlCalls.push({ q, params });
      return { recordset: WM_4802_HYDRANGEAS };
    },
    types: { NVarChar: () => 'nvarchar' },
  });
  const makeRes = () => {
    const out = { statusCode: 0, headers: {}, body: null };
    return {
      out,
      setHeader(k, v) { out.headers[k] = v; },
      status(code) { out.statusCode = code; return this; },
      json(body) { out.body = body; return this; },
    };
  };

  const getRes = makeRes();
  await handler({ method: 'GET', user: { userId: 'u1' } }, getRes);
  assert.equal(getRes.out.statusCode, 405);

  const postRes = makeRes();
  await handler({
    method: 'POST',
    user: { userId: 'u1' },
    body: {
      country: 'CO',
      orderYear: '2026',
      orderWeek: '48-02',
      invoices: [
        { index: 0, supplier: 'Agroindustrial Don Eusebio S.A.S.', invoice: '133973' },
        { index: 1, supplier: 'GRUPO VALORES EN ACCION S.A.S', invoice: '0642' },
        { index: 2, supplier: 'DAWN FLOWERS S.A.S', invoice: '46793' },
      ],
    },
  }, postRes);

  assert.equal(postRes.out.statusCode, 200);
  assert.equal(postRes.out.body.success, true);
  assert.deepEqual(postRes.out.body.matches.map(m => [m.index, m.warehouseKey]), [[1, 8266], [2, 8268]]);
  assert.equal(sqlCalls.length, 1);
  assert.match(sqlCalls[0].q, /SELECT\s+WarehouseKey/i);
  assert.doesNotMatch(sqlCalls[0].q, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
});

test('cross-chunk 2-page Maxiflores VE325268 continuation (totals-only p10 without invoice number) merges cleanly and fails closed on conflicts', () => {
  assert.equal(PACKING_CHUNK_VERSION, 'co-chunks-v2');
  assert.match(chunkExtractionPrompt([10, 11, 12]), /continuation_from_previous/);

  const maxifloresP9 = {
    supplier: 'C I MAXIFLORES S.A.S',
    invoice: 'VE325268',
    currency: 'USD',
    date: '2026/11/25',
    awb: null,
    invoice_total: null,
    freight_total: null,
    products: [
      { description: 'ROSE PLAYA BLANCA 50 Cm', pcs: 0, steam_box: 0, total_stems: 1000, u_price: 0.42, t_price: 420.00, review_evidence: { description: { page: 9, quote: 'ROSE PLAYA BLANCA' } } },
      { description: 'ROSE MONDIAL 50 Cm', pcs: 0, steam_box: 0, total_stems: 4000, u_price: 0.429, t_price: 1716.00, review_evidence: { description: { page: 9, quote: 'ROSE MONDIAL' } } },
    ],
  };
  const maxifloresP10Continuation = {
    continuation_from_previous: true,
    supplier: 'C I MAXIFLORES S.A.S',
    invoice: null, // Not printed on p10!
    currency: 'USD',
    awb: '992-04727833',
    hawb: 'AFBG00576426',
    invoice_total: 2136.00,
    freight_total: 0,
    products: [],
    metadata_evidence: { invoice_total: { page: 10, quote: 'Total a pagar USD 2,136.00' } },
  };
  const tibaP11 = {
    supplier: 'FLORES TIBA SA',
    invoice: '44256',
    currency: 'USD',
    date: '2026/11/25',
    awb: '992-04727833',
    hawb: 'AFBG00576568',
    invoice_total: 382.00,
    freight_total: 0,
    products: [
      { description: 'ROSES OCEAN SONG 50', pcs: 1, steam_box: 100, total_stems: 100, u_price: 0.38, t_price: 38.00 },
      { description: 'ROSES STAR PLATINUM 50', pcs: 3, steam_box: 100, total_stems: 300, u_price: 0.38, t_price: 114.00 },
      { description: 'SPRAY ROSES SNOWFLAKE 60', pcs: 5, steam_box: 100, total_stems: 500, u_price: 0.46, t_price: 230.00 },
    ],
  };

  const merged = mergePackingChunks([
    { pages: [1, 2], result: { master_awb: '992-04727833', manifest_invoices: [{ invoice: null, supplier: 'CI Maxiflores S.A.S.', hawb: 'AFBG00576426' }, { invoice: null, supplier: 'Flores Tiba S.A.', hawb: 'AFBG00576568' }], invoices: [] } },
    { pages: [3], result: { invoices: [maxifloresP9] } },
    { pages: [4, 5], result: { invoices: [maxifloresP10Continuation, tibaP11] } },
  ], 5);

  const parsed = JSON.parse(merged.content[0].text);
  assert.equal(parsed.invoices.length, 2);
  const maxi = parsed.invoices[0];
  assert.equal(maxi.invoice, 'VE325268');
  assert.equal(maxi.invoice_total, 2136);
  assert.equal(maxi.freight_total, 0);
  assert.equal(maxi.awb, '992-04727833');
  assert.equal(maxi.hawb, 'AFBG00576426');
  assert.equal(maxi.products.length, 2);

  // Orphan continuation from unrelated supplier MUST fail closed
  const badSupplierCont = { ...maxifloresP10Continuation, supplier: 'OTHER FARM SAS' };
  assert.throws(() => mergePackingChunks([
    { pages: [1], result: { invoices: [maxifloresP9] } },
    { pages: [2], result: { invoices: [badSupplierCont] } },
  ], 2), /확인하지 못했습니다/);
});

test('CO_FARMS covers Aguata, Zelecta/Aguaclara, Flora Concept/Elite, and integer Full-Box El Cactus/Varietta + Funza PHYTO $15 heal cleanly', () => {
  assert.equal(detectCOFarm('FLORES DE AGUATA SAS').abbr, 'AGT');
  assert.equal(detectCOFarm('COMMERCIAL ZELECTA TRADING GROUP CORP').abbr, 'ACL');
  assert.equal(detectCOFarm('ROSAS AGUACLARA S.A.S').abbr, 'ACL');
  assert.equal(detectCOFarm('FLORA CONCEPT LLC').abbr, 'ELI');
  assert.equal(detectCOFarm('THE ELITE FLOWER S.A.S. C.I.').abbr, 'ELI');
  assert.ok(CO_FARMS.some(f => f.abbr === 'AGT'));
  assert.ok(CO_FARMS.some(f => f.abbr === 'ACL'));

  // El Cactus integer Full Box (1.00 = 2 HB, 2.00 = 4 HB) & Varietta (1,00 = 4 QB)
  const cactus = healColombiaInvoiceExtraction({
    supplier: 'AGRÍCOLA EL CACTUS S.A.',
    invoice: 'FC68882',
    currency: 'USD',
    invoice_total: 378,
    products: [
      { description: 'CARNATION', pcs: 1, steam_box: 300, total_stems: 600, u_price: 0.21, t_price: 126 },
      { description: 'CARNATION 2', pcs: 2, steam_box: 300, total_stems: 1200, u_price: 0.21, t_price: 252 },
    ],
  });
  assert.deepEqual(cactus.products.map(p => p.pcs), [2, 4]);
  assert.equal(cactus.freight_total, 0);
  assert.equal(packingSourceValueIssues(cactus, 'CO').length, 0);

  const varietta = healColombiaInvoiceExtraction({
    supplier: 'VARIETTA FARMS SAS',
    invoice: '2233',
    currency: 'USD',
    invoice_total: '246,00',
    products: [
      { description: 'CARNATION SL DONCEL', pcs: '1,00', steam_box: 300, total_stems: '1.200', u_price: '0,2050', t_price: '246,00' },
    ],
  });
  assert.equal(varietta.products[0].pcs, 4);
  assert.equal(varietta.products[0].total_stems, 1200);
  assert.equal(varietta.freight_total, 0);
  assert.equal(packingSourceValueIssues(varietta, 'CO').length, 0);

  // Funza FE204589 with PHYTO $15.00
  const funzaExcel = genColombia(XLSX, {
    supplier: 'C.I. FLORES DE FUNZA SAS',
    invoice: 'FE204589',
    awb: '992-04727833',
    date: '2026/11/25',
    freight_total: 15,
    invoice_total: 821.40,
    products: [
      { description: 'ALSTROEMERIA SELECT FIFI', pcs: 28, steam_box: 160, total_stems: 4480, u_price: 0.18, t_price: 806.40 },
    ],
  }, '48', '02', {
    catalog: { items: [{ country: 'CO', name: 'ALSTROMERIA Fifi', family: 'ALSTRO' }], byCountry: { CO: [{ country: 'CO', name: 'ALSTROMERIA Fifi', family: 'ALSTRO' }] } },
  });
  assert.equal(funzaExcel.totalMismatch, null);
});

test('Ecuador La Rosaleda CI (blank/SN AWB, mixed boxes, 9 AS varieties) + paired AWB PDF (006-45558192) resolve end-to-end', async () => {
  // 1. Farm header auto-match: FLORICOLA LA ROSALEDA S.A. -> [54] La Rosaleda
  assert.equal(invoiceSupplierKey('FLORICOLA LA ROSALEDA S.A.'), 'LAROSALEDA');
  const header = resolveInvoiceHeader({
    rawMetadata: { supplier: 'FLORICOLA LA ROSALEDA S.A.', invoiceDate: '2026-11-25', invoiceUploadDate: '2026-11-26' },
    reviewedMetadata: { country: 'EC', farmName: 'La Rosaleda', awb: '' },
  }, [
    { FarmKey: 54, FarmName: 'La Rosaleda', CounName: '에콰도르', UsageCount: 69, isDeleted: 0 },
  ]);
  assert.equal(header.farm?.farmKey, 54);
  assert.equal(header.farm?.farmName, 'La Rosaleda');
  assert.equal(header.issues.length, 0);

  // 2. All 9 Rosaleda varieties rank their exact DB product #1
  const ecProducts = [
    { ProdKey: 1552, ProdName: 'Ecuador Choco Bloom AS73', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1487, ProdName: 'Ecuador Candy X-pression', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1510, ProdName: 'Ecuador Candy X-pression (te)', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1556, ProdName: 'Ecuador Channel  AS154 ', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 2240, ProdName: 'Ecuador Electric MO AS295', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1527, ProdName: 'Ecuador Tinted Light Eucalyptus AS231', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1555, ProdName: 'Ecuador Gala AS 43', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1494, ProdName: 'Ecuador Tinted Dark Whisper AS033', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1496, ProdName: 'Ecuador Tinted Shiny Pearl AS047', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
    { ProdKey: 1524, ProdName: 'Ecuador Tinted Sweet Lavender AS198', CounName: '에콰도르', OutUnit: '송이', EstUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0 },
  ];
  const catItems = ecProducts.map(p => ({ country: 'EC', name: p.ProdName, code: String(p.ProdKey) }));
  const expectedTop = [
    ['AS 73-CHOCOBLOOM-MO', 'Ecuador Choco Bloom AS73'],
    ['CANDY X-PRESSION', 'Ecuador Candy X-pression'],
    ['AS154-CHANNEL-MO', 'Ecuador Channel  AS154 '],
    ['AS 295 ELECTRIC-MO', 'Ecuador Electric MO AS295'],
    ['AS 231-LIGHT EUCALYPTUS-MO', 'Ecuador Tinted Light Eucalyptus AS231'],
    ['AS 43-GALA-EX', 'Ecuador Gala AS 43'],
    ['AS 33-DARK-WHISPER-MO', 'Ecuador Tinted Dark Whisper AS033'],
    ['AS 47-SHINY PEARL-MO', 'Ecuador Tinted Shiny Pearl AS047'],
    ['AS198-SWEET LAVENDER-MO', 'Ecuador Tinted Sweet Lavender AS198'],
  ];
  for (const [desc, target] of expectedTop) {
    const match = findBestMatch(desc, catItems);
    assert.equal(match.item?.name, target, `${desc} should rank ${target} #1 (got ${match.item?.name})`);
  }

  // 3. Mixed boxes (8 boxes, 1,500 stems, $980.00) + paired AWB 006-45558192
  const awbText = [
    '006 UIO 45558192 006-45558192',
    'Shipper\'s Name and Address FLORICOLA LA ROSALEDA S.A',
    'Issuing Carrier\'s Agent APOLLO FREIGHT ECUADOR AFREC SA',
    'PMT: 05520264002039211 PLEASE KEEP REFRIGERATED',
    'FRESH CUT FLOWERS 8 123 K Q 161.0 3.37 542.57',
    'TOTAL FULL BOXES: 3.75 TOTAL PIECES: 8.00',
    'Total Other Charges Due Agent 62.00 Total Other Charges Due Carrier 25.00',
    'Total Prepaid USD 629.57',
    'Executed on (date) 25-Nov-26',
  ].join('\n');
  const awbInput = {
    text: awbText,
    pages: [{
      text: awbText,
      items: [
        { str: '123', x: 50, y: 400, width: 20 },
        { str: '161.0', x: 120, y: 400, width: 30 },
        { str: '3.37', x: 180, y: 400, width: 25 },
      ],
    }],
  };
  assert.equal(isAirWaybillDocument(awbInput), true);
  const awbDoc = parseSupportAwbDocument(awbInput, { currency: 'USD' });
  assert.equal(awbDoc.awb, '006-45558192');
  assert.equal(awbDoc.packages, 8);
  assert.equal(awbDoc.gross_weight_kg, 123);
  assert.equal(awbDoc.chargeable_weight_kg, 161);
  assert.equal(awbDoc.freight_rate, 3.37);
  assert.equal(awbDoc.other_charges, 87);
  assert.equal(awbDoc.total_prepaid, 629.57);
  assert.equal(awbDoc.dae_pmt, '05520264002039211');

  const ecInv = {
    supplier: 'FLORICOLA LA ROSALEDA S.A.',
    invoice: '0000027447',
    awb: '',
    date: '2026/11/25',
    invoice_total: 980.00,
    products: [
      { description: 'AS 73-CHOCOBLOOM-MO', pcs: 1, bunch_st: 10, steam_box: 100, total_bunch: 10, total_stems: 100, u_price: 0.65, t_price: 65.00 },
      { description: 'CANDY X-PRESSION', pcs: 0, bunch_st: 10, steam_box: 100, total_bunch: 10, total_stems: 100, u_price: 0.50, t_price: 50.00 },
      { description: 'AS154-CHANNEL-MO', pcs: 1, bunch_st: 10, steam_box: 200, total_bunch: 20, total_stems: 200, u_price: 0.65, t_price: 130.00 },
      { description: 'AS 295 ELECTRIC-MO', pcs: 2, bunch_st: 10, steam_box: 200, total_bunch: 40, total_stems: 400, u_price: 0.65, t_price: 260.00 },
      { description: 'AS 231-LIGHT EUCALYPTUS-MO', pcs: 1, bunch_st: 10, steam_box: 100, total_bunch: 10, total_stems: 100, u_price: 0.65, t_price: 65.00 },
      { description: 'AS 43-GALA-EX', pcs: 0, bunch_st: 10, steam_box: 100, total_bunch: 10, total_stems: 100, u_price: 0.65, t_price: 65.00 },
      { description: 'AS 33-DARK-WHISPER-MO', pcs: 1, bunch_st: 10, steam_box: 200, total_bunch: 20, total_stems: 200, u_price: 0.65, t_price: 130.00 },
      { description: 'AS 47-SHINY PEARL-MO', pcs: 1, bunch_st: 10, steam_box: 200, total_bunch: 20, total_stems: 200, u_price: 0.75, t_price: 150.00 },
      { description: 'AS198-SWEET LAVENDER-MO', pcs: 1, bunch_st: 10, steam_box: 100, total_bunch: 10, total_stems: 100, u_price: 0.65, t_price: 65.00 },
    ],
  };
  assert.equal(invoiceBoxTotal([ecInv]), 8);
  const awbReview = reviewAirWaybill({ awbDocument: awbDoc, invoices: [ecInv], packageTotal: 8 });
  assert.equal(awbReview.ready, true, awbReview.issues.join('; '));
  assert.equal(awbReview.currency, 'USD');

  // validatePackingPdf accepts EC + awbPdfBase64 and still rejects CO + awbPdfBase64
  const tinyPdf = await PDFDocument.create();
  tinyPdf.addPage([200, 200]);
  const tinyB64 = await tinyPdf.saveAsBase64();
  assert.equal(validatePackingPdf({ country: 'EC', pdfBase64: tinyB64, awbPdfBase64: tinyB64 }).country, 'EC');
  assert.throws(() => validatePackingPdf({ country: 'CO', pdfBase64: tinyB64, awbPdfBase64: tinyB64 }), /호주·에콰도르/);
  assert.match(buildPrompt('EC', { awbDocument: true }), /SECOND SOURCE DOCUMENT — ECUADOR AIR WAYBILL/);

  // genEcuador + packing-export guard with confirmed AWB merged (AWB + GW + CW)
  const aliases = Object.fromEntries(expectedTop.map(([desc, target]) => [desc.toUpperCase(), target]));
  const ecMerged = genEcuador(XLSX, {
    ...ecInv,
    awb: awbReview.awb,
    gross_weight: awbReview.grossWeightKg,
    vol_weight: awbReview.chargeableWeightKg,
  }, '48', '01', { catalog: { items: catItems, byCountry: { EC: catItems } }, aliases });
  assert.equal(ecMerged.totalMismatch, null);
  const expRows = await readPackingExport(Buffer.from(ecMerged.buf), 'EC');
  assert.equal(expRows.filter(r => !r.isWeight).length, 9);
  assert.equal(expRows.filter(r => r.isWeight).length, 2);
  assert.deepEqual(assertPackingExportBunches(expRows, ecProducts, 'EC'), []);
});

test('local 30p Colombia PDF and Ecuador AWB PDF smoke check when present on operator PC', async () => {
  const coPath = 'C:/Users/USER/Documents/카카오톡 받은 파일/48-2 콜카장수국 CI.pdf';
  if (fs.existsSync(coPath)) {
    const chunks = await splitPackingPdf(fs.readFileSync(coPath).toString('base64'));
    assert.equal(chunks.length, 10);
    assert.deepEqual(chunks.flatMap(c => c.pages), Array.from({ length: 30 }, (_, i) => i + 1));
  }
});
