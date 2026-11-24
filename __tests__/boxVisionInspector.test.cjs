'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('5 sample warehouse photos exist in public/samples/box-vision/', () => {
  const expectedFiles = [
    'sample-1-silla.jpg',
    'sample-2-neulbom-a.jpg',
    'sample-3-neulbom-b.jpg',
    'sample-4-jukwang.jpg',
    'sample-5-holex-mint.jpg',
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
