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
import { parsePackingResponse, healColombiaInvoiceExtraction } from '../lib/importPackingResponse.js';
import { filterProductsByDetectedFamily, rankProductSuggestions } from '../lib/invoiceMatchAssist.js';
import {
  collectUploadMatchingNeeds,
  applyUploadQuantityEdits,
  analyzeRowQuantitySuggestion,
  extractLineEvidenceBadges,
  sanitizeIssueMessageForOperator,
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

test('4. Colombia 25605 ($1,923 null freight) and 19121 (7,500 BXS vs 30 QB) self-heal cleanly across fresh & cached/restored state', () => {
  const rawPayload = {
    invoices: [
      {
        supplier: 'CI FLORES BALVERDE SAS',
        invoice: '25605',
        awb: '992-04727833',
        date: '24NOV2026',
        currency: 'USD',
        freight_total: null,
        invoice_total: '1.923,00',
        products: [
          { description: 'HYDRANGEA WHITE', pcs: 27, steam_box: 40, total_stems: 1080, u_price: '0,57', t_price: '615,60' },
          { description: 'HYDRANGEA BLUE', pcs: 18, steam_box: 40, total_stems: 720, u_price: '0,62', t_price: '446,40' },
          { description: 'HYDRANGEA ESMERALDA PREMIUN', pcs: 8, steam_box: 30, total_stems: 240, u_price: '0,87', t_price: '208,80' },
          { description: 'HYDRANGEA TINTED LAVANDER', pcs: 4, steam_box: 40, total_stems: 160, u_price: '0,77', t_price: '123,20' },
          { description: 'HYDRANGEA TINTED LIGHT PINK', pcs: 10, steam_box: 40, total_stems: 400, u_price: '0,77', t_price: '308,00' },
          { description: 'HYDRANGEA DARK PINK', pcs: 10, steam_box: 34, total_stems: 340, u_price: '0,65', t_price: '221,00' },
        ],
      },
      {
        supplier: 'PRINCESS FARMS SAS',
        invoice: '19121',
        awb: '992-04727833',
        date: '24/11/2026',
        currency: 'USD',
        freight_total: null,
        invoice_total: '513,00',
        products: [
          {
            description: 'HYDRANGEA WHITE SELECT',
            pcs: 7500, // OCR misread 7,500 BXS as 7500!
            steam_box: 30,
            total_stems: 900,
            u_price: '0,57',
            t_price: '513,00',
            source_cells: { pcs: { page: 6, quote: '7,500 30,00QBx30' } },
          },
        ],
      },
    ],
  };

  const { result: parsed } = parsePackingResponse({
    content: [{ type: 'text', text: JSON.stringify(rawPayload) }],
    stop_reason: 'end_turn',
  }, 'CO');
  assert.equal(parsed.invoices[0].invoice_total, 1923);
  assert.equal(parsed.invoices[0].freight_total, 0, 'When goods sum equals invoice_total, freight_total resolves to 0');
  const inv0Issues = parsed.invoices[0].metadataIssues || parsed.invoices[0].metadata_issues || [];
  assert.equal(inv0Issues.filter(i => i.code === 'INVOICE_EXTRAS_UNAVAILABLE' || i.code === 'INVOICE_TOTAL_MISMATCH').length, 0);

  assert.equal(parsed.invoices[1].products[0].pcs, 30, '19121 7,500 BXS reconciles to 30 physical QB boxes');
  assert.equal(parsed.invoices[1].freight_total, 0);

  // Also test stale cached/saved state where 25605 already had INVOICE_EXTRAS_UNAVAILABLE and 19121 had pcs=7500 or 7.5 without QB quote
  const stale25605 = bindPackingSourceReviewPolicy({
    supplier: 'CI FLORES BALVERDE SAS',
    invoice: '25605',
    freight_total: null,
    invoice_total: 1923,
    metadataIssues: [{ code: 'INVOICE_EXTRAS_UNAVAILABLE', field: 'invoice_total', message: '콜롬비아 상품 외 부대비가 미확인이라 최종 송장 총액을 검증할 수 없습니다.' }],
    products: [{ description: 'HYDRANGEA WHITE', pcs: 1, steam_box: 1, total_stems: 1, u_price: 1923, t_price: 1923 }],
  }, 'CO', { source: 'cache' });
  const healed25605 = healColombiaInvoiceExtraction(stale25605);
  assert.equal(healed25605.freight_total, 0);
  assert.equal((healed25605.metadataIssues || []).some(i => i.code === 'INVOICE_EXTRAS_UNAVAILABLE'), false);

  const stale19121Scaled = {
    supplier: 'PRINCESS FARMS SAS',
    invoice: '19121',
    freight_total: 0,
    invoice_total: 513,
    products: [{ description: 'HYDRANGEA WHITE SELECT', pcs: 7500, steam_box: 30, total_stems: 900, u_price: 0.57, t_price: 513 }],
  };
  assert.equal(healColombiaInvoiceExtraction(stale19121Scaled).products[0].pcs, 30, 'x1000 BXS 7500 vs 30 QB auto-reconciles when 900*0.57=513');

  const stale19121Fractional = {
    supplier: 'PRINCESS FARMS SAS',
    invoice: '19121',
    freight_total: 0,
    invoice_total: 513,
    products: [{ description: 'HYDRANGEA WHITE SELECT', pcs: 7.5, steam_box: 30, total_stems: 900, u_price: 0.57, t_price: 513 }],
  };
  assert.equal(healColombiaInvoiceExtraction(stale19121Fractional).products[0].pcs, 30, 'Fractional BXS 7.5 vs 30 QB auto-reconciles when 900*0.57=513');
});

test('5. Flower-family default filter & supplier-aware color ranking (Hydrangea P.PK BA #1, Carnation excluded)', () => {
  const catalog = [
    { ProdKey: 9991, ProdCode: 'CO-CAR-LPK', ProdName: 'CARNATION Light Pink Candy', DisplayName: 'CARNATION Light Pink Candy', CounName: '콜롬비아', FlowerName: '카네이션', country: 'CO', selectable: true },
    { ProdKey: 878, ProdCode: 'CO-HYD-PPK-BA', ProdName: 'Hydrangea P.PK (BA) (연핑크)', DisplayName: 'Hydrangea P.PK (BA) (연핑크)', CounName: '콜롬비아', FlowerName: '수국', country: 'CO', selectable: true },
    { ProdKey: 3498, ProdCode: 'CO-HYD-LPK', ProdName: 'Hydrangea light pink (연핑크)', DisplayName: 'Hydrangea light pink (연핑크)', CounName: '콜롬비아', FlowerName: '수국', country: 'CO', selectable: true },
    { ProdKey: 880, ProdCode: 'CO-HYD-SLPK-BA', ProdName: 'Hydrangea Super light pink (연연핑크) (BA)', DisplayName: 'Hydrangea Super light pink (연연핑크) (BA)', CounName: '콜롬비아', FlowerName: '수국', country: 'CO', selectable: true },
    { ProdKey: 871, ProdCode: 'CO-HYD-LAV', ProdName: 'Hydrangea Lavender (라벤더)', DisplayName: 'Hydrangea Lavender (라벤더)', CounName: '콜롬비아', FlowerName: '수국', country: 'CO', selectable: true },
  ];

  const scoped = filterProductsByDetectedFamily('HYDRANGEA TINTED LIGHT PINK', catalog, { includeAll: false });
  assert.equal(scoped.family?.code, 'HYDRANGEA');
  assert.equal(scoped.family?.label, '수국');
  assert.equal(scoped.filtered.some(p => p.ProdKey === 9991), false, 'CARNATION must be excluded when HYDRANGEA family filter is active');

  const lightPinkRanked = rankProductSuggestions('HYDRANGEA TINTED LIGHT PINK', catalog, {
    country: 'CO',
    supplier: 'CI FLORES BALVERDE SAS',
    limit: 5,
  });
  assert.equal(lightPinkRanked.items.some(item => item.product.ProdKey === 9991), false, 'Cross-family Carnation must never appear in Hydrangea suggestions');
  assert.equal(lightPinkRanked.items[0]?.product.ProdKey, 878, 'Balverde Hydrangea P.PK (BA) (연핑크) must rank #1 for Balverde Tinted Light Pink');

  const lavRanked = rankProductSuggestions('HYDRANGEA TINTED LAVANDER', catalog, {
    country: 'CO',
    supplier: 'CI FLORES BALVERDE SAS',
    limit: 5,
  });
  assert.equal(lavRanked.items[0]?.product.ProdKey, 871, 'Hydrangea Lavender (라벤더) must rank #1 for HYDRANGEA TINTED LAVANDER');
});

test('6. Plain Korean evidence badges, 1-click auto-backcalculation, and zero developer jargon', () => {
  const suggestion = analyzeRowQuantitySuggestion({
    country: 'CO',
    pcs: 7,
    steam_box: 30,
    total_stems: 900,
    u_price: 0.57,
    t_price: 513,
  });
  assert.ok(suggestion, 'Must diagnose box*steam_box != total_stems');
  assert.match(suggestion.diagnosis, /총송이\(900\).*단가\(0\.57\).*513/);
  assert.equal(suggestion.primaryAction?.patch?.pcs, 30);
  assert.match(suggestion.primaryAction?.label || '', /박스 수를 30으로 맞춤/);

  const badges = extractLineEvidenceBadges({
    review_evidence: {
      pcs: { page: 6, quote: '30 QB' },
      steam_box: { page: 6, quote: '30 STEMS/QB' },
      total_stems: { page: 6, quote: '900' },
      u_price: { page: 6, quote: '0,57' },
      t_price: { page: 6, quote: '513,00' },
    },
  });
  assert.deepEqual(badges.map(b => b.label), ['원문 박스칸', '원문 입수칸', '원문 총송이', '원문 단가', '원문 금액']);

  const cleaned = sanitizeIssueMessageForOperator('pcs(7) * steam_box(30) != total_stems(900) tabular-nums');
  assert.doesNotMatch(cleaned, /tabular-nums|steam_box|\bpcs\b|total_stems/i);
});
