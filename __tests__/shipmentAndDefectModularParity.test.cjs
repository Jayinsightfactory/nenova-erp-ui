'use strict';
// Phase 3 무사고(Zero-Regression) 순수 모듈 분리 회귀 검증:
// 1) lib/shipmentImport.js (17개 export) 및 lib/salesDefectDeductions.js (28개 export) 동일 참조(===) 무결성
// 2) 출고분배(distribute) · 영업수입불량차감(defect-deductions) 분리 헬퍼/컴포넌트 입출력 및 교차연도(OrderYear+OrderWeek) 정합성

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { transformSync } = require('next/dist/build/swc');
const { createImportLoader } = require('./helpers/shipmentImportLoader.cjs');

const ROOT = path.resolve(__dirname, '..');

function compileModule(relPath, customRequire) {
  const filename = path.join(ROOT, relPath);
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = transformSync(source, {
    filename,
    jsc: {
      parser: { syntax: 'ecmascript', jsx: true },
      target: 'es2022',
      transform: { react: { runtime: 'automatic' } },
    },
    module: { type: 'commonjs' },
  });
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const baseRequire = Module.createRequire(filename);
  mod.require = (specifier) => (customRequire ? customRequire(specifier, baseRequire) : baseRequire(specifier));
  mod._compile(code, filename);
  return mod.exports;
}

test('lib/shipmentImport.js preserves all 17 named exports and === reference identity with extracted modules', () => {
  const load = createImportLoader();
  const shipmentImport = load('shipmentImport');
  const matchingEngine = load('shipmentImport/matchingEngine');
  const shipmentImportQty = load('shipmentImportQty');
  const preDistribute = load('shipmentImport/preDistributeOrders');

  const expectedExports = [
    'normText',
    'cleanProductName',
    'matchDutchProductByColor',
    'resolveImportOrderYear',
    'parseAllocationWorkbook',
    'buildImportPreview',
    'applyImportRows',
    'normalizeUploadQtyForProduct',
    'detectQtyWarnings',
    'hasCriticalQtyWarnings',
    'appendPeerQtyWarnings',
    'appendCustomerPeerQtyWarnings',
    'resolveImportOrderSyncPlan',
    'resolveImportWriteIntent',
    'importProductOverrideKey',
    'classifyImportUnmatchedReason',
    'preDistributeImportProductsToOrders',
  ];

  for (const name of expectedExports) {
    assert.equal(typeof shipmentImport[name], 'function', `lib/shipmentImport.js must export function ${name}`);
  }

  // Strict === reference identity with extracted / re-exported modules
  assert.strictEqual(shipmentImport.normText, matchingEngine.normText);
  assert.strictEqual(shipmentImport.matchDutchProductByColor, matchingEngine.matchDutchProductByColor);
  assert.strictEqual(shipmentImport.preDistributeImportProductsToOrders, preDistribute.preDistributeImportProductsToOrders);
  for (const helperName of [
    'normalizeUploadQtyForProduct',
    'detectQtyWarnings',
    'hasCriticalQtyWarnings',
    'appendPeerQtyWarnings',
    'appendCustomerPeerQtyWarnings',
    'resolveImportOrderSyncPlan',
    'resolveImportWriteIntent',
    'importProductOverrideKey',
    'classifyImportUnmatchedReason',
  ]) {
    assert.strictEqual(shipmentImport[helperName], shipmentImportQty[helperName], `${helperName} must be strict === re-export`);
  }
});

test('shipmentImport extracted pure functions preserve normalization, Dutch matching, preview summary, and cross-year OrderYear guards', async () => {
  const load = createImportLoader({
    db: {
      query: async (sqlText) => {
        if (/OrderYear/i.test(sqlText)) return { recordset: [{ OrderYear: 2026 }] };
        return { recordset: [] };
      },
      withTransaction: async (fn) => fn(async () => ({ recordset: [] })),
      sql: { Int: 'Int', NVarChar: 'NVarChar', Float: 'Float' },
    },
  });
  const mod = load('shipmentImport');
  const previewSummary = load('shipmentImport/previewSummary');
  const applyHelpers = load('shipmentImport/applyHelpers');

  assert.equal(mod.normText('  CARNATION  Moon-Light (콜) '), 'carnationmoon-light콜');
  assert.equal(mod.cleanProductName('ROSE / Freedom 50cm'), 'Freedom 50cm');

  // Cross-year OrderYear resolution guard: NN-NN week must NOT fall back to 2025 legacy, and embedded YYYY-NN-NN year is respected when explicitYear is omitted
  assert.equal(mod.resolveImportOrderYear('44-01', 2026), '2026');
  assert.equal(mod.resolveImportOrderYear('44-01', 2025), '2025');
  assert.equal(mod.resolveImportOrderYear('2025-44-01', ''), '2025');
  assert.notEqual(mod.resolveImportOrderYear('28-01', ''), '2025', 'NN-NN upload week must never silently fall back to 2025 legacy');

  // applyHelpers.calcShipDate & orderQtyFromDetail pure checks
  const shipDate = applyHelpers.calcShipDate('15-01', '2026', 1);
  assert.ok(shipDate instanceof Date && shipDate.getUTCFullYear() === 2026);
  assert.equal(applyHelpers.orderQtyFromDetail({ BunchQuantity: 25, BoxQuantity: 1 }, { OutUnit: '단' }), 25);
  assert.equal(applyHelpers.orderQtyFromDetail({ BunchQuantity: 25, BoxQuantity: 2 }, { OutUnit: '박스' }), 2);

  // previewSummary.summarizePreviewByCustomer pure aggregation
  const summary = previewSummary.summarizePreviewByCustomer([
    {
      custName: '청화원예',
      orderQty: 10,
      currentOutQty: 4,
      uploadQty: 10,
      changeQty: 6,
      shipmentDiffQty: 6,
      orderDiffQty: 0,
      needsShipmentApply: true,
      status: '변경',
    },
    {
      custName: '청화원예',
      orderQty: 5,
      currentOutQty: 5,
      uploadQty: 5,
      changeQty: 0,
      shipmentDiffQty: 0,
      orderDiffQty: 0,
      needsShipmentApply: false,
      status: '동일',
    },
  ]);
  assert.equal(summary['청화원예'].orderQty, 15);
  assert.equal(summary['청화원예'].uploadQty, 15);
  assert.equal(summary['청화원예'].shipmentChangedLines, 1);
});

test('distribute page helpers and extracted shipment UI components compile and preserve pure calculations', () => {
  const helpers = compileModule('lib/shipmentDistributionPageHelpers.js', (specifier, baseReq) => {
    if (specifier.startsWith('.')) {
      const target = path.resolve(path.join(ROOT, 'lib'), specifier);
      const found = [target, `${target}.js`].find((c) => fs.existsSync(c));
      if (found) return compileModule(path.relative(ROOT, found));
    }
    return baseReq(specifier);
  });

  assert.equal(helpers.pgLabel('콜롬비아', '카네이션'), '콜롬비아카네이션');
  assert.equal(helpers.countryFlowerFromGroup(`콜롬비아${helpers.PG_SEP}장미`, []), '콜롬비아장미');
  assert.equal(helpers.pairKeyFromGroup(`네덜란드${helpers.PG_SEP}수국`, []), '네덜란드 수국');
  assert.deepEqual(helpers.autoSplitQty(10, 3), [4, 3, 3]);

  const autoPlan = helpers.calculateAutoDistributeInputs(
    [
      { CustKey: 10, 주문수량: 6 },
      { CustKey: 20, 주문수량: 4 },
    ],
    8,
    'ratio'
  );
  assert.equal(autoPlan.emptyOrder, false);
  assert.equal(Number(autoPlan.inputs[10]) + Number(autoPlan.inputs[20]), 8);

  for (const componentRel of [
    'components/shipment/DistributionAddItemModal.js',
    'components/shipment/DistributionStatusModals.js',
    'components/shipment/DistributionFarmCustomerPanel.js',
    'components/shipment/DistributionCustomerWorkspacePanel.js',
    'components/shipment/DistributionScheduleAndPivotTabs.js',
  ]) {
    const exported = compileModule(componentRel, (specifier, baseReq) => {
      if (specifier.startsWith('.')) {
        const absDir = path.dirname(path.join(ROOT, componentRel));
        const target = path.resolve(absDir, specifier);
        const found = [target, `${target}.js`].find((c) => fs.existsSync(c));
        if (found) return compileModule(path.relative(ROOT, found));
      }
      return baseReq(specifier);
    });
    assert.ok(
      typeof exported.default === 'function' || Object.values(exported).some((v) => typeof v === 'function'),
      `${componentRel} must export at least one component function`
    );
  }
});

test('lib/salesDefectDeductions.js preserves all 28 named exports and === reference identity with extracted modules', async () => {
  const importEsm = (relPath) => import(pathToFileURL(path.join(ROOT, relPath)).href);

  const [
    facade,
    lookupAndMatching,
    managerAndCost,
    snapshotAndSummary,
    ledgerAdminAndHold,
    defectSourceRelease,
  ] = await Promise.all([
    importEsm('lib/salesDefectDeductions.js'),
    importEsm('lib/salesDefect/lookupAndMatching.js'),
    importEsm('lib/salesDefect/managerAndCostCandidates.js'),
    importEsm('lib/salesDefect/snapshotAndSummary.js'),
    importEsm('lib/salesDefect/ledgerAdminAndHold.js'),
    importEsm('lib/defectSourceRelease.js'),
  ]);
  const pageHelpers = compileModule('lib/salesDefect/pageHelpers.js', (specifier, baseReq) => {
    if (specifier.startsWith('.')) {
      const absDir = path.dirname(path.join(ROOT, 'lib/salesDefect/pageHelpers.js'));
      const target = path.resolve(absDir, specifier);
      const found = [target, `${target}.js`].find((c) => fs.existsSync(c));
      if (found) return compileModule(path.relative(ROOT, found));
    }
    return baseReq(specifier);
  });

  const expectedFacadeExports = [
    'ensureSalesDefectTables',
    'loadLookupData',
    'loadMatchContext',
    'matchSalesDefectRows',
    'saveManagerOption',
    'loadDefectCostCandidates',
    'resolveEstimateContext',
    'listDeductions',
    'markCarryoverDeductions',
    'saveDraftRows',
    'correctDraftPeriod',
    'syncLinkedEstimate',
    'confirmIncomingDeductions',
    'cancelIncomingDeductions',
    'resolveIncomingReview',
    'markManualProcessingComplete',
    'preflightRegistration',
    'registrationPreview',
    'assertIdempotentApplicationEstimateLive',
    'registerDeductions',
    'deleteDeductions',
    'manageDeductions',
    'permanentlyOmitDeductions',
    'filterPermanentlyOmittedRows',
    'listOmissionHistory',
    'cancelPermanentOmission',
    'setSupportManualHold',
    'releaseReviewedSources',
  ];

  for (const name of expectedFacadeExports) {
    assert.equal(typeof facade[name], 'function', `lib/salesDefectDeductions.js must export function ${name}`);
  }

  // Strict === reference parity checks for re-exported functions
  assert.strictEqual(facade.loadLookupData, lookupAndMatching.loadLookupData);
  assert.strictEqual(facade.loadMatchContext, lookupAndMatching.loadMatchContext);
  assert.strictEqual(facade.matchSalesDefectRows, lookupAndMatching.matchSalesDefectRows);
  assert.strictEqual(facade.saveManagerOption, managerAndCost.saveManagerOption);
  assert.strictEqual(facade.loadDefectCostCandidates, managerAndCost.loadDefectCostCandidates);
  assert.strictEqual(facade.correctDraftPeriod, ledgerAdminAndHold.correctDraftPeriod);
  assert.strictEqual(facade.syncLinkedEstimate, ledgerAdminAndHold.syncLinkedEstimate);
  assert.strictEqual(facade.assertIdempotentApplicationEstimateLive, ledgerAdminAndHold.assertIdempotentApplicationEstimateLive);
  assert.strictEqual(facade.manageDeductions, ledgerAdminAndHold.manageDeductions);
  assert.strictEqual(facade.permanentlyOmitDeductions, ledgerAdminAndHold.permanentlyOmitDeductions);
  assert.strictEqual(facade.filterPermanentlyOmittedRows, ledgerAdminAndHold.filterPermanentlyOmittedRows);
  assert.strictEqual(facade.listOmissionHistory, ledgerAdminAndHold.listOmissionHistory);
  assert.strictEqual(facade.cancelPermanentOmission, ledgerAdminAndHold.cancelPermanentOmission);
  assert.strictEqual(facade.setSupportManualHold, ledgerAdminAndHold.setSupportManualHold);
  assert.equal(typeof facade.releaseReviewedSources, 'function');

  // Pure function behavior verification
  assert.equal(snapshotAndSummary.registrationQuantity({ quantity: 10, estimateQuantity: 4 }), 4);
  assert.equal(snapshotAndSummary.registrationQuantity({ quantity: 10, estimateQuantity: null }), 10);
  assert.equal(
    snapshotAndSummary.changeSummary(
      { custKey: 1, prodKey: 10, quantity: 3, sourceUnit: '단', creditApplied: false, farmName: '', note: '' },
      { custKey: 1, prodKey: 10, quantity: 3, sourceUnit: '단', creditApplied: false, farmName: '', note: '' },
      'UPDATE'
    ),
    'UPDATE: 변경 없음'
  );
  assert.match(
    snapshotAndSummary.changeSummary(
      { custKey: 1, prodKey: 10, quantity: 3, sourceUnit: '단' },
      { custKey: 1, prodKey: 22, quantity: 3, sourceUnit: '단' },
      'UPDATE'
    ),
    /품목 매칭.*#10.*#22/
  );

  // Page helper verification
  assert.match(
    pageHelpers.buildExistingEstimateLabel({
      estimateKey: 9101,
      estimateTypeLabel: '불량차감',
      productName: 'CARNATION Kaori',
      quantity: -5,
      unit: '단',
      cost: 1200,
      amount: -5455,
      orderWeek: '44-01',
    }),
    /#9101 · 불량차감 · CARNATION Kaori · 5단/
  );
  const carryoverGroups = pageHelpers.deriveCarryoverCustomerGroups([
    { custKey: 77, customerName: '청화원예', remainingQuantity: 3 },
    { custKey: 77, customerName: '청화원예', remainingQuantity: 2 },
    { custKey: 88, customerName: '양재화원', remainingQuantity: 5 },
  ]);
  assert.equal(carryoverGroups.length, 2);
  assert.equal(carryoverGroups.find((g) => g.custKey === 77).remaining, 5);
});

test('Phase 3 modularized targets stay within structural line ceilings and extracted sales UI components compile', () => {
  const ceilings = [
    ['lib/shipmentImport.js', 2000],
    ['pages/shipment/distribute.js', 1800],
    ['lib/salesDefectDeductions.js', 1700],
    ['pages/sales/defect-deductions.js', 2300],
  ];
  for (const [relPath, maxLines] of ceilings) {
    const count = fs.readFileSync(path.join(ROOT, relPath), 'utf8').split(/\r?\n/).length;
    assert.ok(count <= maxLines, `${relPath} line count (${count}) must stay <= ${maxLines}`);
  }

  for (const componentRel of [
    'components/sales/DefectOmissionHistoryModal.js',
    'components/sales/DefectHistoryAndPrintSection.js',
    'components/sales/DefectSupportModals.js',
  ]) {
    const exported = compileModule(componentRel, (specifier, baseReq) => {
      if (specifier === '../DefectCostLookup') {
        return { __esModule: true, default: function DefectCostLookupStub() { return null; } };
      }
      if (specifier.startsWith('.')) {
        const absDir = path.dirname(path.join(ROOT, componentRel));
        const target = path.resolve(absDir, specifier);
        const found = [target, `${target}.js`].find((c) => fs.existsSync(c));
        if (found) return compileModule(path.relative(ROOT, found));
      }
      return baseReq(specifier);
    });
    assert.ok(
      typeof exported.default === 'function' || Object.values(exported).some((v) => typeof v === 'function'),
      `${componentRel} must export valid React component functions`
    );
  }
});
