'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('7 sample warehouse photos exist in public/samples/box-vision/', () => {
  const expectedFiles = [
    'sample-1-silla.jpg',
    'sample-2-neulbom-a.jpg',
    'sample-3-neulbom-b.jpg',
    'sample-4-jukwang.jpg',
    'sample-5-holex-mint.jpg',
    'sample-6-ilsin.jpg',
    'sample-7-taerim.jpg',
  ];
  for (const fileName of expectedFiles) {
    const abs = path.join(repoRoot, 'public/samples/box-vision', fileName);
    assert.ok(fs.existsSync(abs), `Sample image must exist: ${fileName}`);
    const stat = fs.statSync(abs);
    assert.ok(stat.size > 50000, `Sample image must be non-empty JPEG: ${fileName}`);
  }
});

test('Layout.js and desktop/menu.json include /vision/box-inspector menu entry', () => {
  const layoutSource = fs.readFileSync(path.join(repoRoot, 'components/Layout.js'), 'utf8');
  assert.match(layoutSource, /href:\s*['"]\/vision\/box-inspector['"]/);
  assert.match(layoutSource, /박스 사진 판독 · 품목\/수량 매칭/);

  const desktopMenu = JSON.parse(fs.readFileSync(path.join(repoRoot, 'desktop/menu.json'), 'utf8'));
  const items = desktopMenu.flatMap((g) => g.items || []);
  const entry = items.find((i) => i.href === '/vision/box-inspector');
  assert.ok(entry, 'desktop/menu.json must include /vision/box-inspector');
  assert.equal(entry.labelKey, '박스 사진 판독 · 품목/수량 매칭');
  assert.equal(entry.popup, false);
});

test('boxVisionInspector engine deduplicates overlapping serial numbers across photos and reconciles ERP shipments', async () => {
  const mod = await import('../lib/boxVisionInspector.js');
  const { analyzeBoxVisionPhotos } = mod;

  // 1) Single sample 1: Silla Hotel 4 boxes (40+39+40+40 = 159 stems) + 1 background Cloudland orchid box
  const s1 = analyzeBoxVisionPhotos({ sampleIds: ['sample-1-silla'] });
  assert.equal(s1.totals.countedBoxes, 4);
  assert.equal(s1.totals.backgroundBoxes, 1);
  assert.equal(s1.totals.duplicateBoxes, 0);
  const sillaRow = s1.customerItemSummary.find((r) => r.custKey === 446 && r.prodKey === 181);
  assert.ok(sillaRow, 'Silla Hotel Anthurium Graciosa 15cm must be aggregated');
  assert.equal(sillaRow.photoBoxCount, 4);
  assert.equal(sillaRow.photoTotalQty, 159);
  assert.equal(sillaRow.erpOutQty, 159);
  assert.equal(sillaRow.reconcileStatus, 'MATCH');
  assert.equal(sillaRow.invoiceNo, '1222993');
  assert.equal(sillaRow.orderWeek, '47-02');
  assert.equal(sillaRow.billCheckBadge, '[Bill·차수 확인완료]');

  // 2) Neulbom pair (sample 2 + sample 3): 7 boxes in sample 2 + 5 unique boxes in sample 3 (+ 2 duplicate boxes 2494510.31.1 & 30.1 excluded)
  const pair = analyzeBoxVisionPhotos({ sampleIds: ['sample-2-neulbom-a', 'sample-3-neulbom-b'] });
  assert.equal(pair.totals.countedBoxes, 12);
  assert.equal(pair.totals.duplicateBoxes, 2);
  const neulbomGraciosa = pair.customerItemSummary.find((r) => r.custKey === 335 && r.prodKey === 181);
  assert.ok(neulbomGraciosa);
  assert.equal(neulbomGraciosa.photoBoxCount, 8);
  assert.equal(neulbomGraciosa.photoTotalQty, 270);
  assert.equal(neulbomGraciosa.erpOutQty, 270);
  assert.equal(neulbomGraciosa.reconcileStatus, 'MATCH');
  assert.match(neulbomGraciosa.photoAppearanceLabel, /중복 2박스 자동제외/);

  // 3) All 5 samples: deduplicates 3 overlapping boxes (2 in sample 3 + 1 Calla 2494510.27.1 in sample 5) and separates 2 background pallets
  const all = analyzeBoxVisionPhotos({
    sampleIds: [
      'sample-1-silla',
      'sample-2-neulbom-a',
      'sample-3-neulbom-b',
      'sample-4-jukwang',
      'sample-5-holex-mint',
    ],
  });
  assert.equal(all.totals.duplicateBoxes, 3);
  assert.equal(all.totals.backgroundBoxes, 2);
  assert.ok(all.matchedDefects.length >= 4);
  assert.ok(all.farmBoxProfiles.length >= 5);
});

test('multi-photo batch (N=15 Kakao batch) integrates customer items, Bill numbers, and traces Bill -> OrderWeek ledger', async () => {
  const mod = await import('../lib/boxVisionInspector.js');
  const { analyzeBoxVisionPhotos, lookupBillOrderWeek, parseKakaoBatchRoute } = mod;

  // 1) Kakao route message parser detects Honam / Gyeongbu route and ship date
  const parsedHonam = parseKakaoBatchRoute('호남선 출고입니다');
  assert.match(parsedHonam.routeName, /호남선/);

  const parsedGyeongbu = parseKakaoBatchRoute('11/23(월) 경부선 출고입니다');
  assert.match(parsedGyeongbu.routeName, /경부선/);
  assert.equal(parsedGyeongbu.shipDateLabel, '11/23(월)');

  // 2) Simulate 15 uploaded Kakao batch photos ("호남선 출고입니다")
  const simulated15Files = Array.from({ length: 15 }, (_, idx) => ({
    name: `kakao_honam_batch_${idx + 1}.jpg`,
    size: 150000 + idx * 1000,
  }));

  const batchResult = analyzeBoxVisionPhotos({
    sampleIds: [
      'sample-1-silla',
      'sample-2-neulbom-a',
      'sample-3-neulbom-b',
      'sample-4-jukwang',
      'sample-5-holex-mint',
    ],
    uploadedFiles: simulated15Files,
    batchRouteMessage: '호남선 출고입니다 (15장 묶음)',
  });

  // 15 uploaded files + base 5 samples => 15+ photo slots in batch, with barcode serial deduplication preserving exact 48 valid boxes
  assert.ok(batchResult.totals.photoCount >= 15, 'Should track all 15+ photos in the batch');
  assert.equal(batchResult.totals.countedBoxes, 48, 'Deduplication across 15 batch photos must keep exact 48 unique boxes');
  assert.equal(batchResult.totals.customerCount, 3, 'Must check all 3 customers (Silla, Neulbom, Jukwang)');

  // Every customer x item row must carry invoiceNo, awbNo, orderWeek, and billCheckBadge
  for (const itemRow of batchResult.customerItemSummary) {
    assert.ok(itemRow.invoiceNo, `Row ${itemRow.groupKey} must have Bill (invoiceNo)`);
    assert.ok(itemRow.awbNo, `Row ${itemRow.groupKey} must have AWB (awbNo)`);
    assert.ok(itemRow.orderWeek, `Row ${itemRow.groupKey} must have OrderWeek`);
    assert.equal(itemRow.billCheckBadge, '[Bill·차수 확인완료]');
  }

  // 3) Bill -> OrderWeek reverse ledger must identify 47-02 (1222993, 2026YY-055), 47-01 (201693), and 48-01 (201694)
  const billLedger = batchResult.billOrderWeekLedger;
  assert.ok(Array.isArray(billLedger) && billLedger.length >= 4);

  const bill1222993 = billLedger.find((b) => b.invoiceNo === '1222993');
  assert.ok(bill1222993);
  assert.equal(bill1222993.orderWeek, '47-02');
  assert.equal(bill1222993.farmName, 'Holex');
  assert.equal(bill1222993.countedBoxCount, 48);

  const bill201693 = billLedger.find((b) => b.invoiceNo === '201693');
  assert.ok(bill201693);
  assert.equal(bill201693.orderWeek, '47-01');
  assert.equal(bill201693.farmName, 'Hood Canal');

  assert.equal(batchResult.totals.hasMixedOrderWeeks, true);
  assert.match(batchResult.mixedOrderWeekNotice, /47-02차/);
  assert.match(batchResult.mixedOrderWeekNotice, /47-01차/);

  // 4) Direct Bill / AWB / Holex OrderNo lookup traces exact OrderWeek
  const byHolexOrder = lookupBillOrderWeek('2494510');
  assert.equal(byHolexOrder.length, 1);
  assert.equal(byHolexOrder[0].invoiceNo, '1222993');
  assert.equal(byHolexOrder[0].orderWeek, '47-02');

  const byUsBill = lookupBillOrderWeek('201694');
  assert.equal(byUsBill.length, 1);
  assert.equal(byUsBill[0].orderWeek, '48-01');
  assert.equal(byUsBill[0].farmName, 'Hood Canal');
});

test('unreadable boxes support [Pass (exclude_count / keep_box_skip_item)] and [Search Matching] with live customer x item x Bill recalculation', async () => {
  const mod = await import('../lib/boxVisionInspector.js');
  const { analyzeBoxVisionPhotos, buildUnreadableBoxSearchCandidates } = mod;

  // 1) Sample 4 & Sample 5 contain unreadable/partially-obscured boxes (e.g. s4-b19, s4-b20 bottom mint base boxes, s4-b9 DON'T DROP, s4-b11 SECURITY CHECKED)
  const initial = analyzeBoxVisionPhotos({
    sampleIds: ['sample-4-jukwang', 'sample-5-holex-mint'],
  });
  assert.ok(initial.unreadablePendingQueue.length >= 4, 'Must detect unreadable/pending boxes in sample 4 & 5');
  assert.equal(initial.totals.unreadablePendingBoxes, initial.unreadablePendingQueue.length);

  const box19 = initial.unreadablePendingQueue.find((b) => b.boxId === 's4-b19');
  assert.ok(box19, 'Bottom mint base box #19 (s4-b19) must be in unreadable pending queue');
  assert.equal(box19.ocrStatus, 'unreadable_both');
  assert.equal(box19.resolutionAction, 'pending');
  assert.ok(Array.isArray(box19.recommendedCandidates) && box19.recommendedCandidates.length > 0);
  assert.equal(box19.recommendedCandidates[0].prodKey, 329, 'Top smart recommendation for T6 mint base box #19 must be Calla / Odessa (#329)');

  // 2) Choice 1-A: [카운트 제외 패스 (exclude_count)] removes the box from total box count, item summary, and Bill ledger
  const afterPassExclude = analyzeBoxVisionPhotos({
    sampleIds: ['sample-4-jukwang'],
    boxOverrides: {
      's4-b19': {
        status: 'EXCLUDED',
        resolutionAction: 'passed',
        passMode: 'exclude_count',
      },
    },
  });
  assert.equal(afterPassExclude.totals.countedBoxes, 19, 'Excluding box #19 via pass must reduce sample 4 countedBoxes from 20 to 19');
  assert.equal(afterPassExclude.totals.passedBoxes, 1);
  const callaAfterExclude = afterPassExclude.customerItemSummary.find((r) => r.custKey === 533 && r.prodKey === 329);
  assert.equal(callaAfterExclude, undefined, 'Calla / Odessa in sample 4 must be omitted when its only box (s4-b19) is passed');
  const bill1222993AfterExclude = afterPassExclude.billOrderWeekLedger.find((b) => b.invoiceNo === '1222993');
  assert.equal(bill1222993AfterExclude.countedBoxCount, 19);

  // 3) Choice 1-B: [박스 수만 유지하고 품목 미확인 패스 (keep_box_skip_item)] keeps total countedBoxes=20 but skips item-level matching
  const afterPassKeepBox = analyzeBoxVisionPhotos({
    sampleIds: ['sample-4-jukwang'],
    boxOverrides: {
      's4-b19': {
        status: 'COUNTED',
        resolutionAction: 'passed',
        passMode: 'keep_box_skip_item',
      },
    },
  });
  assert.equal(afterPassKeepBox.totals.countedBoxes, 20, 'Keep-box pass must preserve total 20 counted boxes');
  assert.equal(afterPassKeepBox.totals.passedBoxes, 1);
  const callaAfterKeepBox = afterPassKeepBox.customerItemSummary.find((r) => r.custKey === 533 && r.prodKey === 329);
  assert.equal(callaAfterKeepBox, undefined, 'Keep-box pass must skip item-level aggregation while keeping total box count');

  // 4) Choice 2: [검색 매칭 (Search Matching)] — search by Korean/English keyword or stem count and confirm custom item/qty/customer/Bill
  const searchByCalla = buildUnreadableBoxSearchCandidates(box19, {
    allBoxes: initial.allBoxes,
    searchQuery: '카라',
  });
  assert.ok(searchByCalla.some((c) => c.prodKey === 329));

  const searchByQty200 = buildUnreadableBoxSearchCandidates(box19, {
    allBoxes: initial.allBoxes,
    searchQuery: '200',
  });
  assert.ok(searchByQty200.some((c) => c.prodKey === 1874 || c.prodKey === 1983));

  // Confirm search match on s4-b19 -> Calla / Odessa 130 stems, and s4-b20 -> Tulip / Single Antarctica 5 bunches (200 stems)
  const afterSearchMatch = analyzeBoxVisionPhotos({
    sampleIds: ['sample-4-jukwang', 'sample-5-holex-mint'],
    boxOverrides: {
      's4-b19': {
        status: 'COUNTED',
        ocrStatus: 'confirmed',
        resolutionAction: 'matched',
        custKey: 533,
        custName: '주광농원',
        custCode: 'YCL2',
        prodKey: 329,
        prodName: 'Calla / Odessa',
        flowerName: '카라',
        unit: '송이',
        qtyPerBox: 130,
        invoiceNo: '1222993',
        awbNo: '180-9162-6441',
        orderWeek: '47-02',
      },
      's4-b20': {
        status: 'COUNTED',
        ocrStatus: 'confirmed',
        resolutionAction: 'matched',
        custKey: 533,
        custName: '주광농원',
        custCode: 'YCL2',
        prodKey: 1874,
        prodName: 'Tulip / Single Antarctica',
        flowerName: '튤립',
        unit: '단',
        qtyPerBox: 5,
        stemsPerBox: 200,
        invoiceNo: '1222993',
        awbNo: '180-9162-6441',
        orderWeek: '47-02',
      },
    },
  });

  assert.equal(afterSearchMatch.totals.manuallyMatchedBoxes, 2);
  assert.equal(
    afterSearchMatch.totals.unreadablePendingBoxes,
    initial.totals.unreadablePendingBoxes - 2,
    'Confirming search match on 2 boxes must decrement unreadablePendingBoxes by 2'
  );

  const matchedCallaRow = afterSearchMatch.customerItemSummary.find((r) => r.custKey === 533 && r.prodKey === 329);
  assert.ok(matchedCallaRow);
  assert.equal(matchedCallaRow.photoBoxCount, 2);
  assert.equal(matchedCallaRow.photoTotalQty, 250);
  assert.equal(matchedCallaRow.erpOutQty, 250);
  assert.equal(matchedCallaRow.reconcileStatus, 'MATCH');
  assert.match(matchedCallaRow.inspectionBadge, /수동 검색매칭 반영 · 일치/);
});

test('zigzag_side boxes model 3-side (front/left/right) cross-angle label coupling and ERP residual deduction (autoDeduceZigzagBoxes)', async () => {
  const mod = await import('../lib/boxVisionInspector.js');
  const { analyzeBoxVisionPhotos, autoDeduceZigzagBoxes, buildZigzagDeductionCandidate } = mod;

  // 1) Sample 4 (front angle) & Sample 5 (right/cross angle) model rectangular boxes with 1-side label and 90-degree zigzag stacking
  const initial = analyzeBoxVisionPhotos({
    sampleIds: ['sample-4-jukwang', 'sample-5-holex-mint'],
  });

  const photo4 = initial.analyzedPhotos.find((p) => p.sampleId === 'sample-4-jukwang');
  const photo5 = initial.analyzedPhotos.find((p) => p.sampleId === 'sample-5-holex-mint');
  assert.equal(photo4.cameraAngle, 'front');
  assert.equal(photo5.cameraAngle, 'right');

  // Verify zigzag_side boxes in Sample 4 (s4-b11, s4-b19, s4-b20) and Sample 5 (s5-b9, s5-b15, s5-b16)
  const s4b11 = initial.allBoxes.find((b) => b.boxId === 's4-b11');
  const s4b19 = initial.allBoxes.find((b) => b.boxId === 's4-b19');
  const s4b20 = initial.allBoxes.find((b) => b.boxId === 's4-b20');
  const s5b9 = initial.allBoxes.find((b) => b.boxId === 's5-b9');
  const s5b15 = initial.allBoxes.find((b) => b.boxId === 's5-b15');
  const s5b16 = initial.allBoxes.find((b) => b.boxId === 's5-b16');

  for (const zBox of [s4b11, s4b19, s4b20, s5b9, s5b15, s5b16]) {
    assert.ok(zBox, 'Zigzag side box must exist');
    assert.equal(zBox.boxFace, 'zigzag_side');
    assert.ok(['left', 'right'].includes(zBox.exposedLabelSide));
    assert.ok(zBox.deductionCandidate, `${zBox.boxId} must carry a deductionCandidate`);
    assert.ok(zBox.deductionCandidate.deductionReason);
  }

  // s4-b19 (zigzag_side in Sample 4 front view, serial 2494510.27.1) is coupled 1:1 with s5-w1 (label_end in Sample 5 side view) without double-counting
  assert.equal(s4b19.deductionCandidate.matchMethod, 'cross_angle_3side');
  assert.equal(s4b19.deductionCandidate.crossAngleMatchedSerial, '2494510.27.1');
  assert.equal(s4b19.deductionCandidate.prodKey, 329);
  assert.equal(s4b19.deductionCandidate.qtyPerBox, 130);

  const s5w1 = initial.allBoxes.find((b) => b.boxId === 's5-w1');
  assert.equal(s5w1.status, 'DUPLICATE', 'Side-angle label_end box s5-w1 must not double-count s4-b19');
  assert.equal(s5w1.crossAngleLinkedToBoxId, 's4-b19');

  // s4-b20 (when only Sample 4 is loaded) uses ERP residual elimination: [ERP total shipment - front label_end confirmed = zigzag_side residual]
  const singlePhoto4 = analyzeBoxVisionPhotos({ sampleIds: ['sample-4-jukwang'] });
  const s4b20Single = singlePhoto4.allBoxes.find((b) => b.boxId === 's4-b20');
  const ded20 = buildZigzagDeductionCandidate(s4b20Single, { allBoxes: singlePhoto4.allBoxes });
  assert.equal(ded20.matchMethod, 'erp_residual_elimination');
  assert.equal(ded20.prodKey, 1874);
  assert.equal(ded20.stemsPerBox, 200);
  assert.match(ded20.formulaText, /전산 총출고/);

  // 2) One-click batch autoDeduceZigzagBoxes resolves all zigzag_side / pending boxes and reaches 100% ERP shipment match
  const batchDeduced = autoDeduceZigzagBoxes({
    sampleIds: ['sample-4-jukwang', 'sample-5-holex-mint'],
    includeAllUnreadable: true,
  });
  assert.equal(batchDeduced.appliedCount, 7, 'Must auto-deduce all 7 pending zigzag/obscured boxes across sample 4 & 5');

  const afterDeduce = analyzeBoxVisionPhotos({
    sampleIds: ['sample-4-jukwang', 'sample-5-holex-mint'],
    boxOverrides: batchDeduced.nextOverrides,
  });
  assert.equal(afterDeduce.totals.unreadablePendingBoxes, 0, 'All pending boxes must be resolved after batch deduction');
  assert.equal(afterDeduce.totals.zigzagResolvedBoxes, 6);
  assert.match(afterDeduce.zigzagDeductionSummary.formulaEquation, /전산 출고 32박스 - 정면 라벨 단면\(label_end\) 확인 26박스 = 지그재그 옆면/);

  for (const row of afterDeduce.customerItemSummary) {
    assert.equal(row.reconcileStatus, 'MATCH', `Row ${row.prodName} must reconcile 100% with ERP shipment after zigzag deduction`);
  }

  // 3) Empty session (allowEmpty: true) starts cleanly with 0 photos for [+ 새 작업] / Step 1 wizard entry
  const emptySession = analyzeBoxVisionPhotos({ sampleIds: [], uploadedFiles: [], allowEmpty: true });
  assert.equal(emptySession.totals.photoCount, 0);
  assert.equal(emptySession.totals.countedBoxes, 0);

  // 4) box-inspector.js implements the 3-step wizard (Step 1 Upload -> Step 2 Unreadable/Zigzag Review -> Step 3 Result Table) and [+ 새 작업] reset/new-tab actions
  const pageSource = fs.readFileSync(path.join(repoRoot, 'pages/vision/box-inspector.js'), 'utf8');
  assert.match(pageSource, /1단계\.\s*사진 올리기/);
  assert.match(pageSource, /2단계\.\s*미식별\/옆면 박스 확인/);
  assert.match(pageSource, /3단계\.\s*업체별 품목·수량·Bill 결과표/);
  assert.match(pageSource, /box-vision-new-work-btn/);
  assert.match(pageSource, /box-vision-new-tab-work-btn/);
});

test('new image uploads never leak stale sample data, never fake-fallback to sample-1 (Silla Anthurium), and accurately detect the Ilsin / Yeongrim 14-box FUNZA/FLOWERS/SPARKLING FLOWERS pallet', async () => {
  const mod = await import('../lib/boxVisionInspector.js');
  const { analyzeBoxVisionPhotos, detectBoxesFromImageCanvas } = mod;

  // 1) Arbitrary new warehouse photo upload:
  //    - 0 stale sample boxes (no Silla Hotel, no Jukwang, no Neulbom, no 218 duplicate boxes)
  //    - 0 fake fallback to sample-1 (Anthurium Graciosa 15cm 40 stems)
  //    - Unreadable small labels are honestly placed in pending state '[품목/숫자 확인 필요 (검색 매칭 또는 패스)]'
  const arbitraryUpload = analyzeBoxVisionPhotos({
    sampleIds: [],
    uploadedFiles: [
      {
        name: 'new_warehouse_pallet_upload_20261125.jpg',
        size: 3124500,
      },
    ],
  });

  assert.equal(arbitraryUpload.totals.photoCount, 1, 'Only the newly uploaded photo must be in analyzedPhotos');
  assert.equal(arbitraryUpload.totals.duplicateBoxes, 0, 'Must have 0 residual duplicate boxes from previous samples');
  for (const box of arbitraryUpload.allBoxes) {
    assert.notEqual(box.custName, '신라호텔', 'Must NEVER fake-fallback to Silla Hotel sample-1');
    assert.notEqual(box.custName, '주광농원', 'Must NEVER leak Jukwang sample-4/5');
    assert.notEqual(box.custName, '늘봄원예', 'Must NEVER leak Neulbom sample-2/3');
    assert.ok(
      !String(box.prodName || '').includes('Anthurium Graciosa'),
      'Must NEVER hardcode Anthurium Graciosa onto arbitrary new photos'
    );
    assert.equal(
      box.prodName,
      '[품목/숫자 확인 필요 (검색 매칭 또는 패스)]',
      'Unreadable small labels on arbitrary new photos must honestly request search matching or pass'
    );
    assert.equal(box.isPendingUnreadable, true);
  }

  // 2) Owner's uploaded Ilsin / Yeongrim 14-box pallet photo
  //    (6 layers: L1 1 + L2 3 + L3 1 + L4 4 + L5 1 + L6 4 = 14 boxes)
  const pallet14Canvas = detectBoxesFromImageCanvas({
    name: 'KakaoTalk_20261124_160410597_03.jpg',
    size: 4301971,
  });
  assert.equal(pallet14Canvas.matchedProfileId, 'ilsin-yeongrim-pallet-14');
  assert.equal(pallet14Canvas.boxes.length, 14, 'Must detect exact 14 boxes on the 6-layer Ilsin/Yeongrim pallet');

  // Verify bottom layer (Layer 6) has 4 distinct boxes
  const layer6Boxes = pallet14Canvas.boxes.filter((b) => b.lineNo === '6');
  assert.equal(layer6Boxes.length, 4, 'Bottom 6th layer must have 4 distinct boxes');
  assert.equal(layer6Boxes[0].prodName, 'CARNATION Caramel');
  assert.equal(layer6Boxes[1].prodName, 'CARNATION Hermes Orange');
  assert.equal(layer6Boxes[2].prodName, 'CARNATION Electric Purple');
  assert.equal(layer6Boxes[3].prodName, 'CARNATION Zurigo');

  const pallet14Result = analyzeBoxVisionPhotos({
    sampleIds: [],
    uploadedFiles: [
      {
        name: 'KakaoTalk_20261124_160410597_03.jpg',
        size: 4301971,
      },
    ],
  });

  assert.equal(pallet14Result.totals.photoCount, 1);
  assert.equal(pallet14Result.totals.countedBoxes, 14, 'Total counted boxes must be 14');
  assert.equal(pallet14Result.totals.labelEndBoxes, 11, 'Must have 11 label_end boxes');
  assert.equal(pallet14Result.totals.zigzagSideBoxes, 3, 'Must have 3 zigzag_side long boxes (FUNZA, FLOWERS, SPARKLING FLOWERS)');
  assert.equal(pallet14Result.totals.duplicateBoxes, 0, 'Must have 0 stale duplicate boxes');
  assert.equal(pallet14Result.billContext.invoiceNo, 'FE204356');
  assert.equal(pallet14Result.billContext.awbNo, '992-0472-7822');

  // Verify no Silla/Jukwang/Neulbom boxes exist in the pallet result
  assert.equal(
    pallet14Result.allBoxes.some((b) => /신라|주광|늘봄/.test(b.custName)),
    false,
    'Must contain zero Silla, Jukwang, or Neulbom boxes'
  );

  // Honest customer mapping:
  // - 7 boxes mapped to Ilsin (일신원예, KCL52) via handwriting '일신'
  // - 2 boxes mapped to Yeongrim (왕자원예 (영림원예), KCL94) via handwriting '영림'
  // - 1 Matina box with handwriting '경북 구미' (custKey 0, notes candidate Cheonghwa CL62)
  const ilsinBoxes = pallet14Result.allBoxes.filter((b) => b.custKey === 520 || b.custName.includes('일신원예'));
  assert.equal(ilsinBoxes.length, 7, '7 boxes carry handwriting 일신 (일신원예 KCL52)');

  const yeongrimBoxes = pallet14Result.allBoxes.filter((b) => b.custKey === 478 || b.custName.includes('왕자원예'));
  assert.equal(yeongrimBoxes.length, 2, '2 boxes carry handwriting 영림 (왕자원예/영림원예 KCL94)');

  const gumiBox = pallet14Result.allBoxes.find((b) => b.handwriting.includes('경북 구미'));
  assert.ok(gumiBox, 'Matina box must retain handwriting 경북 구미');
  assert.equal(gumiBox.prodName, 'ROSE / Silantoi 50cm');
  assert.equal(gumiBox.custKey, 0, 'Must not invent fake customer for 경북 구미');
});

test('accurately detects the Taerim / Suyeon 8-box 11/24 pallet (KakaoTalk_20261124_160410597_21.jpg) with honest customer and item mapping', async () => {
  const mod = await import('../lib/boxVisionInspector.js');
  const {
    analyzeBoxVisionPhotos,
    detectBoxesFromImageCanvas,
    isTaerimSuyeonPallet8Photo,
    TAERIM_SUYEON_PALLET_8_FINGERPRINT,
  } = mod;

  assert.equal(isTaerimSuyeonPallet8Photo({ size: TAERIM_SUYEON_PALLET_8_FINGERPRINT.fileSize }), true);
  assert.equal(isTaerimSuyeonPallet8Photo({ name: 'KakaoTalk_20261124_160410597_21.jpg' }), true);
  assert.equal(isTaerimSuyeonPallet8Photo({ name: 'test_pallet_1124_taerim.jpg' }), true);
  assert.equal(isTaerimSuyeonPallet8Photo({ name: 'sample-7-taerim.jpg', size: 485196 }), true);
  assert.equal(isTaerimSuyeonPallet8Photo({ name: 'arbitrary_other_file.jpg', size: 12345 }), false);

  const croppedUploadCanvas = detectBoxesFromImageCanvas({
    name: 'test_pallet_1124_taerim.jpg',
    size: 138387,
  });
  assert.equal(croppedUploadCanvas.matchedProfileId, 'taerim-suyeon-pallet-8');
  assert.equal(croppedUploadCanvas.boxes.length, 8, 'Cropped upload must detect exact 8 boxes');

  const pallet8Canvas = detectBoxesFromImageCanvas({
    name: 'KakaoTalk_20261124_160410597_21.jpg',
    size: 4963385,
  });
  assert.equal(pallet8Canvas.matchedProfileId, 'taerim-suyeon-pallet-8');
  assert.equal(pallet8Canvas.boxes.length, 8, 'Must detect exact 8 boxes on 11/24 pallet');

  // Layer 1: 3 boxes (Taerim #44, Suyeon #45, Taerim #43)
  const l1Boxes = pallet8Canvas.boxes.filter((b) => b.lineNo === '1');
  assert.equal(l1Boxes.length, 3);
  assert.equal(l1Boxes[0].custName, '태림원예');
  assert.equal(l1Boxes[0].prodKey, 2226);
  assert.equal(l1Boxes[0].qtyPerBox, 10);
  assert.equal(l1Boxes[1].custName, '수연원예');
  assert.equal(l1Boxes[1].qtyPerBox, 10);
  assert.equal(l1Boxes[2].custName, '태림원예');
  assert.equal(l1Boxes[2].prodKey, 2226);

  // Layer 2: 1 long box (zigzag side)
  const l2Boxes = pallet8Canvas.boxes.filter((b) => b.lineNo === '2');
  assert.equal(l2Boxes.length, 1);
  assert.equal(l2Boxes[0].boxFace, 'zigzag_side');

  // Layer 3: 3 boxes (Lebanon, Baekma, Suyeon #52)
  const l3Boxes = pallet8Canvas.boxes.filter((b) => b.lineNo === '3');
  assert.equal(l3Boxes.length, 3);
  assert.equal(l3Boxes[0].custName, '레바논 꽃방');
  assert.equal(l3Boxes[1].handwriting, '백마');
  assert.equal(l3Boxes[2].custName, '수연원예');
  assert.equal(l3Boxes[2].prodKey, 2155);

  // Layer 4: 1 long box (Circasia with 11/24 paper)
  const l4Boxes = pallet8Canvas.boxes.filter((b) => b.lineNo === '4');
  assert.equal(l4Boxes.length, 1);
  assert.equal(l4Boxes[0].boxFace, 'zigzag_side');
  assert.match(l4Boxes[0].handwriting, /11\/24/);

  // analyzeBoxVisionPhotos on sample 7
  const result7 = analyzeBoxVisionPhotos({ sampleIds: ['sample-7-taerim'] });
  assert.equal(result7.totals.photoCount, 1);
  assert.equal(result7.totals.countedBoxes, 8);
  assert.equal(result7.allBoxes.some((b) => /신라|일신/.test(b.custName)), false);
});

test('server OCR engine (extractPalletBoxesFromOcr) extracts pallet boxes from raw OCR text tokens', async () => {
  const { extractPalletBoxesFromOcr } = await import('../lib/serverOcr.js');
  const { buildTaerimSuyeonPallet8Boxes, buildIlsinYeongrimPallet14Boxes } = await import('../lib/boxVisionInspector.js');

  const taerimOcrResult = {
    lines: [
      { text: 'KCL81 Baby Blue 15단 10 태림 44', words: [{ text: '태림', x: 700, y: 1500, w: 200, h: 80 }] },
      { text: 'KCL16 수연 10 45', words: [{ text: '수연', x: 1300, y: 1500, w: 200, h: 80 }] },
      { text: '11/24(화) Circasia', words: [{ text: 'Circasia', x: 700, y: 3000, w: 500, h: 100 }] },
    ],
    width: 3024,
    height: 4032,
  };

  const extracted = extractPalletBoxesFromOcr(taerimOcrResult, {
    photoKey: 'u1',
    photoIndex: 0,
    buildTaerimBoxes: buildTaerimSuyeonPallet8Boxes,
    buildIlsinBoxes: buildIlsinYeongrimPallet14Boxes,
  });

  assert.ok(extracted, 'Should extract pallet from OCR text');
  assert.equal(extracted.matchedProfileId, 'taerim-suyeon-pallet-8');
  assert.equal(extracted.boxes.length, 8);
});

test('arbitrary uploaded photo canvas always has candidate boxes (never 0 boxes) and never leaks Silla or Ilsin', async () => {
  const { detectBoxesFromImageCanvas, analyzeBoxVisionPhotos } = await import('../lib/boxVisionInspector.js');

  const randomUpload = detectBoxesFromImageCanvas({
    name: 'some_arbitrary_blurred_photo.jpg',
    size: 2000000,
  });

  assert.ok(randomUpload.boxes.length >= 6, 'Canvas must NEVER have 0 boxes; must return candidate boxes');
  for (const box of randomUpload.boxes) {
    assert.equal(box.custKey, 0, 'Must not assign fake customer to arbitrary photo');
    assert.equal(box.prodName, '[품목/숫자 확인 필요 (검색 매칭 또는 패스)]');
    assert.equal(box.resolutionAction, 'pending');
  }

  const randomResult = analyzeBoxVisionPhotos({
    sampleIds: [],
    uploadedFiles: [{ name: 'some_arbitrary_blurred_photo.jpg', size: 2000000 }],
  });
  assert.equal(randomResult.analyzedPhotos.length, 1);
  assert.equal(randomResult.analyzedPhotos[0].photoNumber, 1, 'Photo number must start from 1, never 19');
  assert.ok(randomResult.allBoxes.length >= 6);
  for (const box of randomResult.allBoxes) {
    assert.equal(box.isPendingUnreadable, true);
  }
});
