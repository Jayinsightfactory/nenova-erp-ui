'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('lib/boxVisionInspector re-exports 100% identical references to extracted lib/boxVision/* modules', async () => {
  const rootMod = await import('../lib/boxVisionInspector.js');
  const palletProfiles = await import('../lib/boxVision/palletProfiles.js');
  const samplePhotos = await import('../lib/boxVision/samplePhotos.js');
  const fallbackLedgers = await import('../lib/boxVision/fallbackLedgers.js');
  const routeAndBill = await import('../lib/boxVision/routeAndBill.js');
  const deductionEngine = await import('../lib/boxVision/deductionEngine.js');
  const canvasSegmentation = await import('../lib/boxVision/canvasSegmentation.js');
  const clientCanvasMeta = await import('../lib/boxVision/clientCanvasMeta.js');

  const expectedExports = [
    'CAMERA_ANGLE_OPTIONS',
    'FALLBACK_DEFECT_DEDUCTIONS',
    'FALLBACK_ERP_SHIPMENTS',
    'FALLBACK_WAREHOUSE_BILLS',
    'FARM_BOX_COLOR_PROFILES',
    'ILSIN_YEONGRIM_PALLET_14_FINGERPRINT',
    'ROUTE_PRESETS',
    'SAMPLE_PHOTOS',
    'SEARCHABLE_PRODUCT_CATALOG',
    'TAERIM_SUYEON_PALLET_8_FINGERPRINT',
    'analyzeBoxVisionPhotos',
    'autoDeduceZigzagBoxes',
    'buildIlsinYeongrimPallet14Boxes',
    'buildTaerimSuyeonPallet8Boxes',
    'buildUnreadableBoxSearchCandidates',
    'buildYeongsinFunza13Boxes',
    'buildZigzagDeductionCandidate',
    'detectBoxesFromImageCanvas',
    'isIlsinYeongrimPallet14Photo',
    'isTaerimSuyeonPallet8Photo',
    'lookupBillOrderWeek',
    'parseKakaoBatchRoute',
    'segmentPalletBoxesFromPixels',
  ].sort();

  assert.deepStrictEqual(Object.keys(rootMod).sort(), expectedExports);

  // Exact reference identity across re-exports
  assert.equal(rootMod.FARM_BOX_COLOR_PROFILES, palletProfiles.FARM_BOX_COLOR_PROFILES);
  assert.equal(rootMod.CAMERA_ANGLE_OPTIONS, palletProfiles.CAMERA_ANGLE_OPTIONS);
  assert.equal(rootMod.buildIlsinYeongrimPallet14Boxes, palletProfiles.buildIlsinYeongrimPallet14Boxes);
  assert.equal(rootMod.buildTaerimSuyeonPallet8Boxes, palletProfiles.buildTaerimSuyeonPallet8Boxes);
  assert.equal(rootMod.buildYeongsinFunza13Boxes, palletProfiles.buildYeongsinFunza13Boxes);
  assert.equal(rootMod.SAMPLE_PHOTOS, samplePhotos.SAMPLE_PHOTOS);
  assert.equal(rootMod.ROUTE_PRESETS, fallbackLedgers.ROUTE_PRESETS);
  assert.equal(rootMod.FALLBACK_WAREHOUSE_BILLS, fallbackLedgers.FALLBACK_WAREHOUSE_BILLS);
  assert.equal(rootMod.FALLBACK_ERP_SHIPMENTS, fallbackLedgers.FALLBACK_ERP_SHIPMENTS);
  assert.equal(rootMod.SEARCHABLE_PRODUCT_CATALOG, fallbackLedgers.SEARCHABLE_PRODUCT_CATALOG);
  assert.equal(rootMod.FALLBACK_DEFECT_DEDUCTIONS, fallbackLedgers.FALLBACK_DEFECT_DEDUCTIONS);
  assert.equal(rootMod.parseKakaoBatchRoute, routeAndBill.parseKakaoBatchRoute);
  assert.equal(rootMod.lookupBillOrderWeek, routeAndBill.lookupBillOrderWeek);
  assert.equal(rootMod.buildUnreadableBoxSearchCandidates, deductionEngine.buildUnreadableBoxSearchCandidates);
  assert.equal(rootMod.buildZigzagDeductionCandidate, deductionEngine.buildZigzagDeductionCandidate);
  assert.equal(rootMod.segmentPalletBoxesFromPixels, canvasSegmentation.segmentPalletBoxesFromPixels);
  assert.equal(rootMod.detectBoxesFromImageCanvas, canvasSegmentation.detectBoxesFromImageCanvas);

  // SSR / Node safe fallback for clientCanvasMeta
  assert.equal(clientCanvasMeta.CUSTOMER_OPTIONS.length, 9);
  assert.equal(clientCanvasMeta.BILL_OPTIONS.length, 11);
  const ssrMeta = await clientCanvasMeta.extractLightweightVisionMeta({ name: 'test.jpg', size: 1234 }, '');
  assert.equal(ssrMeta.name, 'test.jpg');
  assert.equal(ssrMeta.size, 1234);
  assert.equal(ssrMeta.canvasSignature, null);
});

test('extracted pure modules produce deterministic outputs across route, bill, pixel segmentation, and deduction', async () => {
  const { parseKakaoBatchRoute, lookupBillOrderWeek } = await import('../lib/boxVision/routeAndBill.js');
  const { segmentPalletBoxesFromPixels, detectBoxesFromImageCanvas } = await import('../lib/boxVision/canvasSegmentation.js');
  const { buildUnreadableBoxSearchCandidates, buildZigzagDeductionCandidate } = await import('../lib/boxVision/deductionEngine.js');

  // 1) Route parser across all preset patterns
  assert.equal(parseKakaoBatchRoute('영동선 출고입니다').routeName, '영동선 출고');
  assert.equal(parseKakaoBatchRoute('중부선 출고입니다').routeName, '중부선 출고');
  assert.equal(parseKakaoBatchRoute('수도권 직배 출고').routeName, '직배/터미널 출고');
  assert.equal(parseKakaoBatchRoute('11/25(수) 호남선 경부선 동시').routeName, '호남선 · 경부선 통합 출고');
  assert.equal(parseKakaoBatchRoute('11/25(수) 호남선 경부선 동시').shipDateLabel, '11/25(수)');

  // 2) Bill -> OrderWeek lookup (empty query returns full pool; custom ledger row merges cleanly)
  const fullPool = lookupBillOrderWeek('');
  assert.ok(fullPool.length >= 10);
  const customMerged = lookupBillOrderWeek('CUSTOM-INV-999', undefined, [
    {
      invoiceNo: 'CUSTOM-INV-999',
      awbNo: '999-1111-2222',
      orderYear: 2026,
      orderWeek: '48-02',
      farmName: 'TestFarm',
      countryName: '콜롬비아',
      customerNames: ['태림원예'],
    },
  ]);
  assert.equal(customMerged.length, 1);
  assert.equal(customMerged[0].orderWeek, '48-02');
  assert.equal(customMerged[0].farmName, 'TestFarm');

  // 3) Pixel edge projection: tiny/empty input safely returns [] and synthetic layered image segments cleanly
  assert.deepStrictEqual(segmentPalletBoxesFromPixels({}), []);
  assert.deepStrictEqual(segmentPalletBoxesFromPixels({ width: 8, height: 8, data: new Uint8ClampedArray(256) }), []);

  const w = 120;
  const h = 120;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = (y * w + x) * 4;
      const inBand = (y >= 25 && y <= 55) || (y >= 65 && y <= 95);
      const inBox = (x >= 15 && x <= 55) || (x >= 65 && x <= 105);
      const val = inBand && inBox ? 210 : 30;
      rgba[idx] = val;
      rgba[idx + 1] = val;
      rgba[idx + 2] = val;
      rgba[idx + 3] = 255;
    }
  }
  const segs = segmentPalletBoxesFromPixels({ width: w, height: h, data: rgba });
  assert.ok(Array.isArray(segs));

  const detectedFromPixels = detectBoxesFromImageCanvas({
    name: 'synthetic_pallet.jpg',
    size: 555555,
    pixels: { width: w, height: h, data: rgba },
  });
  assert.ok(detectedFromPixels.boxes.length >= 1);
  assert.equal(detectedFromPixels.boxes[0].custKey, 0);

  // 4) Unreadable candidate search & null guard on unknown customer/product zigzag deduction
  assert.deepStrictEqual(buildUnreadableBoxSearchCandidates(null), []);
  assert.equal(buildZigzagDeductionCandidate(null), null);
  assert.equal(
    buildZigzagDeductionCandidate({
      boxId: 'unknown-1',
      custKey: 0,
      prodKey: 0,
      boxFace: 'zigzag_side',
    }),
    null
  );
});

test('Phase 1 modularized files preserve all UI data-testid hooks and keep monolith line counts compact', () => {
  const libLines = fs.readFileSync(path.join(repoRoot, 'lib/boxVisionInspector.js'), 'utf8').split(/\r?\n/).length;
  const pageLines = fs.readFileSync(path.join(repoRoot, 'pages/vision/box-inspector.js'), 'utf8').split(/\r?\n/).length;
  assert.ok(libLines < 900, `lib/boxVisionInspector.js must stay compact (<900 lines), got ${libLines}`);
  assert.ok(pageLines < 1300, `pages/vision/box-inspector.js must stay compact (<1300 lines), got ${pageLines}`);

  const step2Source = fs.readFileSync(path.join(repoRoot, 'components/vision/BoxVisionStep2ReviewPanel.js'), 'utf8');
  const step3Source = fs.readFileSync(path.join(repoRoot, 'components/vision/BoxVisionStep3ResultsPanel.js'), 'utf8');

  assert.match(step2Source, /wizard-step-2-panel/);
  assert.match(step2Source, /box-vision-canvas-panel/);
  assert.match(step2Source, /box-vision-unreadable-queue-panel/);
  assert.match(step3Source, /wizard-step-3-panel/);
  assert.match(step3Source, /box-vision-reconcile-table/);
  assert.match(step3Source, /box-vision-bill-ledger-table/);
  assert.match(step3Source, /box-vision-defect-table/);
});
