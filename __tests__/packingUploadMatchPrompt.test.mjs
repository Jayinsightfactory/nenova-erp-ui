import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import XLSX from 'xlsx-js-style';

import {
  PACKING_FARM_MATCH_KEY,
  upsertPackingFarmMatches,
  suggestColombiaPackingDefaults,
  createFarmMatchesHandler,
  resolveInvoiceHeaderWithSavedFarm,
} from '../lib/importPackingFarmMatches.js';
import {
  PACKING_ERP_MATCH_KEY,
  upsertPackingErpMatch,
  packingErpCatalog,
  packingErpAliases,
} from '../lib/importPackingErpMatches.js';
import { readImportTeamRecord, writeImportTeamRecord } from '../lib/importTeamStore.js';
import { buildPackingMatchPreview } from '../lib/importPackingMatchPreview.js';
import { detectCOFarm, genColombia } from '../lib/importPacking.js';
import { bindPackingSourceReviewPolicy } from '../lib/importPackingSourceReview.js';
import {
  collectUploadMatchingNeeds,
  applyUploadQuantityEdits,
} from '../lib/packingUploadMatchPrompt.js';

const MOCK_FARMS = [
  { FarmKey: 301, WarehouseKey: null, FarmName: '네노바 수국농장(신규)', CounName: '콜롬비아', UsageCount: 12, isDeleted: 0 },
  { FarmKey: null, WarehouseKey: 8801, FarmName: 'NUEVA HORTENSIA HIST', CounName: '콜롬비아', UsageCount: 4, isDeleted: 0 },
  { FarmKey: 401, WarehouseKey: null, FarmName: '홀렉스 네덜란드', CounName: '네덜란드', UsageCount: 50, isDeleted: 0 },
];

const MOCK_PRODUCTS = [
  { ProdKey: 5001, ProdCode: 'CO-HYD-ESM', ProdName: 'HYDRANGEA ESMERALDA PREMIUM', DisplayName: '수국 에스메랄다 프리미엄', CounName: '콜롬비아', FlowerName: '수국', country: 'CO', selectable: true, legacyExportSafe: true },
  { ProdKey: 5002, ProdCode: 'CO-HYD-WHT', ProdName: 'HYDRANGEA WHITE SELECT', DisplayName: '수국 화이트 셀렉트', CounName: '콜롬비아', FlowerName: '수국', country: 'CO', selectable: true, legacyExportSafe: true },
  { ProdKey: 6001, ProdCode: 'NL-HYD-ESM', ProdName: 'HYDRANGEA ESMERALDA PREMIUM', DisplayName: '네덜란드 수국', CounName: '네덜란드', FlowerName: '수국', country: 'NL', selectable: true, legacyExportSafe: false },
];

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.payload = data; return this; },
  };
}

test('1. First upload with unknown CO farm, typo product, and pcs*steam_box mismatch triggers all 3 matching prompt sections', () => {
  const sourceHash = 'a'.repeat(64);
  const rawInvoice = {
    supplier: 'CULTIVOS NUEVA HORTENSIA S.A.S',
    invoice: 'NH-901',
    awb: '992-04727833',
    date: '2026/11/24',
    date_kind: 'invoice',
    currency: 'USD',
    freight_total: 0,
    invoice_total: 195,
    pdfReviewRequired: true,
    pdfSourceHash: sourceHash,
    products: [
      {
        description: 'HYDRANGEA ESMERALDA PREMIUN',
        pcs: 30, // OCR swapped stems into pcs!
        steam_box: 30,
        total_stems: 30,
        u_price: 0.65,
        t_price: 19.5,
        review_evidence: { pcs: { page: 1, quote: '1 QB / 30 PCS' } },
      },
      {
        description: 'HYDRANGEA WHITE SELECT',
        pcs: 5,
        steam_box: 60,
        total_stems: 300,
        u_price: 0.585,
        t_price: 175.5,
      },
    ],
  };
  const invoice = bindPackingSourceReviewPolicy(rawInvoice, 'CO', { source: 'ai' });
  const preview = buildPackingMatchPreview({
    invoices: [invoice],
    country: 'CO',
    aliases: {},
    erpMatches: { products: MOCK_PRODUCTS, value: { version: 1, entries: [] } },
  });

  const needs = collectUploadMatchingNeeds({
    country: 'CO',
    invoices: [invoice],
    excels: preview,
    products: MOCK_PRODUCTS,
    farms: MOCK_FARMS,
    farmMatches: null,
  });

  assert.equal(needs.unmatchedFarms.length, 1, 'Unknown CO supplier must be flagged');
  assert.equal(needs.unmatchedFarms[0].supplier, 'CULTIVOS NUEVA HORTENSIA S.A.S');
  assert.equal(needs.unmatchedFarms[0].defaultCoRegion, 'ANTIOQUIA', 'Hydrangea lines auto-suggest ANTIOQUIA template');
  assert.notEqual(needs.unmatchedFarms[0].defaultPackingAbbr, 'UNK');

  assert.equal(needs.unmatchedProducts.length, 1, 'Only typo product needs review; exact match is excluded');
  assert.equal(needs.unmatchedProducts[0].description, 'HYDRANGEA ESMERALDA PREMIUN');
  assert.equal(needs.unmatchedProducts[0].suggestions[0].product.ProdKey, 5001);

  assert.equal(needs.quantityIssues.length, 1, 'pcs(30)*steam_box(30) != total_stems(30) must be flagged');
  assert.equal(needs.quantityIssues[0].kind, 'ROW');
  assert.match(needs.quantityIssues[0].evidenceQuote, /1 QB \/ 30 PCS/);
});

test('2. Saving farm + batch product matches + quantity correction resolves current upload AND auto-matches next upload with 0 prompts', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nw-upload-match-'));
  try {
    const queryFn = async sql => {
      if (/FROM\s+(?:dbo\.)?Farm/i.test(sql)) {
        return { recordset: [
          { FarmKey: 301, WarehouseKey: null, FarmName: '네노바 수국농장(신규)', CounName: '콜롬비아', UsageCount: 12, isDeleted: 0 },
          { FarmKey: null, WarehouseKey: 8801, FarmName: 'NUEVA HORTENSIA HIST', CounName: '콜롬비아', UsageCount: 4, isDeleted: 0 },
        ] };
      }
      return { recordset: [] };
    };

    const farmHandler = createFarmMatchesHandler({ queryFn, root: tmpRoot });
    const getRes = mockRes();
    await farmHandler({ method: 'GET', query: {}, user: { userId: 'ic4', userName: '수입담당', accountActive: true } }, getRes);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.payload.revision, 0);

    // Save farm mapping via API handler
    const postRes = mockRes();
    await farmHandler({
      method: 'POST',
      query: {},
      user: { userId: 'ic4', userName: '수입담당', accountActive: true },
      body: {
        expectedRevision: 0,
        entries: [{
          country: 'CO',
          supplier: 'CULTIVOS NUEVA HORTENSIA S.A.S',
          farmKey: 301,
          packingAbbr: 'NUE',
          packingShort: 'NUEVA HORT',
          coRegion: 'ANTIOQUIA',
        }],
      },
    }, postRes);
    assert.equal(postRes.statusCode, 200);
    assert.equal(postRes.payload.revision, 1);

    // Save batch product mapping in importTeamStore
    const batchErpValue = upsertPackingErpMatch(null, {
      entries: [
        { country: 'CO', description: 'HYDRANGEA ESMERALDA PREMIUN', prodKey: 5001 },
      ],
    }, MOCK_PRODUCTS);
    const savedErp = await writeImportTeamRecord(
      PACKING_ERP_MATCH_KEY,
      { value: batchErpValue, expectedRevision: 0, actor: { userId: 'ic4', userName: '수입담당' } },
      { root: tmpRoot },
    );
    assert.equal(savedErp.revision, 1);

    // Apply quantity fix (pcs: 30 -> 1)
    const sourceHash = 'b'.repeat(64);
    const invoice = bindPackingSourceReviewPolicy({
      supplier: 'CULTIVOS NUEVA HORTENSIA S.A.S',
      invoice: 'NH-901',
      awb: '992-04727833',
      date: '2026/11/24',
      date_kind: 'invoice',
      currency: 'USD',
      freight_total: 0,
      invoice_total: 19.5,
      pdfReviewRequired: true,
      pdfSourceHash: sourceHash,
      products: [{
        description: 'HYDRANGEA ESMERALDA PREMIUN',
        pcs: 30,
        steam_box: 30,
        total_stems: 30,
        u_price: 0.65,
        t_price: 19.5,
      }],
    }, 'CO', { source: 'ai' });

    const fixed = applyUploadQuantityEdits({
      sourceInvoices: [invoice],
      result: { invoices: [invoice] },
      country: 'CO',
      rowEdits: {
        'row:0:0': { pcs: 1, steam_box: 30, total_stems: 30, u_price: 0.65, t_price: 19.5, reason: '원문 1 QB 확인' },
      },
    });
    assert.equal(fixed.changed, true);

    // Generate actual Colombia packing Excel with saved farmMatches + erpMatches
    const farmRecord = await readImportTeamRecord(PACKING_FARM_MATCH_KEY, { root: tmpRoot });
    const detected = detectCOFarm('CULTIVOS NUEVA HORTENSIA S.A.S', farmRecord.value);
    assert.equal(detected.abbr, 'NUE');
    assert.equal(detected.coRegion, 'ANTIOQUIA');

    const excel = genColombia(XLSX, fixed.invoices[0], '48', '02', {
      catalog: packingErpCatalog(MOCK_PRODUCTS),
      aliases: packingErpAliases('CO', {}, savedErp.value, MOCK_PRODUCTS),
      farmMatches: farmRecord.value,
    });
    assert.equal(excel.name, '48-02_CO_NUE_NH-901.xlsx', 'Never generates CO_UNK after farm match');
    assert.equal(excel.pending.length, 0);
    assert.equal(excel.noMatches.length, 0);
    assert.equal(excel.totalMismatch, null);
    const wb = XLSX.read(excel.buf, { type: 'buffer' });
    assert.match(wb.SheetNames[0], /^CO-수국/, 'ANTIOQUIA region uses CO-수국 template sheet');

    // Verify InvoiceReceiptWorkbench auto-fill resolution resolves farmKey=301 automatically!
    const autoResolution = resolveInvoiceHeaderWithSavedFarm({
      orderYear: '2026',
      country: 'CO',
      rawMetadata: { supplier: 'CULTIVOS NUEVA HORTENSIA S.A.S', invoiceUploadDate: '2026-11-25' },
    }, MOCK_FARMS, farmRecord.value);
    assert.equal(autoResolution.farm?.farmKey, 301);
    assert.equal(autoResolution.source?.farmSelection?.rule, 'TEAM_SAVED_FARM_MATCH');

    // Second upload of a new invoice from the same farm & product -> ZERO matching alerts!
    const secondInvoice = bindPackingSourceReviewPolicy({
      supplier: 'CULTIVOS NUEVA HORTENSIA S.A.S',
      invoice: 'NH-905',
      awb: '992-04727833',
      date: '2026/11/28',
      date_kind: 'invoice',
      currency: 'USD',
      freight_total: 0,
      invoice_total: 39,
      pdfReviewRequired: true,
      pdfSourceHash: 'c'.repeat(64),
      products: [{
        description: 'HYDRANGEA ESMERALDA PREMIUN',
        pcs: 2,
        steam_box: 30,
        total_stems: 60,
        u_price: 0.65,
        t_price: 39,
      }],
    }, 'CO', { source: 'ai' });

    const secondPreview = buildPackingMatchPreview({
      invoices: [secondInvoice],
      country: 'CO',
      aliases: {},
      erpMatches: { products: MOCK_PRODUCTS, value: savedErp.value },
    });
    const secondNeeds = collectUploadMatchingNeeds({
      country: 'CO',
      invoices: [secondInvoice],
      excels: secondPreview,
      products: MOCK_PRODUCTS,
      farms: MOCK_FARMS,
      farmMatches: farmRecord.value,
    });
    assert.equal(secondNeeds.totalCount, 0, 'Subsequent upload auto-matches farm & product with 0 alerts');
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('3. Cross-country isolation & deleted-farm fail-closed safety', () => {
  assert.throws(
    () => upsertPackingFarmMatches(null, {
      country: 'CO',
      supplier: 'DUTCH SUPPLIER BV',
      farmKey: 401, // NL farm!
      packingAbbr: 'DUT',
      coRegion: 'BOGOTA',
    }, MOCK_FARMS),
    /현재 국가.*다릅니다/,
  );

  const savedValue = upsertPackingFarmMatches(null, {
    country: 'CO',
    supplier: 'CULTIVOS NUEVA HORTENSIA S.A.S',
    farmKey: 301,
    packingAbbr: 'NUE',
    coRegion: 'ANTIOQUIA',
  }, MOCK_FARMS);

  // If FarmKey 301 is later marked deleted in ERP, resolveInvoiceHeaderWithSavedFarm must fail closed
  const deletedFarms = MOCK_FARMS.map(f => (f.FarmKey === 301 ? { ...f, isDeleted: 1 } : f));
  const resolution = resolveInvoiceHeaderWithSavedFarm(
    { country: 'CO', rawMetadata: { supplier: 'CULTIVOS NUEVA HORTENSIA S.A.S' } },
    deletedFarms,
    savedValue,
  );
  assert.equal(resolution.farm, null, 'Deleted ERP farm must not auto-resolve');
  assert.equal(resolution.issues[0]?.code, 'FARM_MATCH_REQUIRED');

  const defaults = suggestColombiaPackingDefaults('UNK FLOWERS SAS', [{ description: 'ROSE FREEDOM 50CM' }]);
  assert.notEqual(defaults.packingAbbr, 'UNK');
  assert.equal(defaults.coRegion, 'BOGOTA');
});
