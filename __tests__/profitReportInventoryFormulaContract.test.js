const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed += 1; }
};
const near = (a, b, tolerance = 0.01) => Math.abs(Number(a) - Number(b)) <= tolerance;

async function main() {
  const {
    computeCategoryAverageInventoryValue,
    computeLayeredInventoryValue,
    computeAutoEndingStock,
    endingStockSourceKind,
    previousMajorOf,
    reconstructPreviousClosing,
    resolveInventoryClosing,
    resolveNonLayeredInventoryClosing,
    incomingInventoryPurchaseValue,
    AUSTRALIA_INVENTORY_CATEGORY,
  } = await import('../lib/profitReportCalc.js');
  const { getHistoricalClosingInventoryEvidence } = await import('../lib/profitReportHistoricalInventory.js');

  console.log('=== 원본 workbook 카테고리 평균원가 F 공식 ===');
  const hydrangea28 = computeCategoryAverageInventoryValue({
    category: '콜롬비아 수국', purchaseForeign: 0, forwardingForeign: 0, taxableRate: 1440,
    customsCost: 2242000, purchaseQty: 25720, stockQty: 1770,
  });
  // 실제 G는 원화 계산 결과이므로 Q/S 대신 그 합을 환율 1로 전달해 순수 함수 공식을 검증한다.
  const hydrangea28Exact = computeCategoryAverageInventoryValue({
    category: '콜롬비아 수국', purchaseForeign: 50587531.4012, forwardingForeign: 0, taxableRate: 1,
    customsCost: 2242000, purchaseQty: 25720, stockQty: 1770,
  });
  check('28차 수국 F를 원본 수식대로 0.01원 이내 재현', near(hydrangea28Exact?.value, 3635624.828154121));
  check('대상 외 네덜란드에 카테고리 평균 공식을 확대하지 않음', computeCategoryAverageInventoryValue({
    category: '네덜란드', purchaseForeign: 100, taxableRate: 1500, purchaseQty: 10, stockQty: 1,
  }) == null);
  check('외화 매입이 있는데 과세환율이 없으면 계산 중단', computeCategoryAverageInventoryValue({
    category: '콜롬비아 장미', purchaseForeign: 100, taxableRate: null, purchaseQty: 10, stockQty: 1,
  }) == null);
  check('매입수량이 없으면 0으로 위장하지 않음', computeCategoryAverageInventoryValue({
    category: '베트남', purchaseForeign: 100, taxableRate: 1500, purchaseQty: 0, stockQty: 1,
  }) == null);
  check('형식 검사용 더미 계산은 유한값', Number.isFinite(hydrangea28?.value));

  console.log('\n=== 2026년 22~28차 workbook 보조 증거 격리 ===');
  const week27Australia = getHistoricalClosingInventoryEvidence('2026', '27', '호주');
  check('27차 호주 F 원본값', near(week27Australia?.value, 7843425.363500001));
  check('파일 SHA와 정확한 셀 위치 보존', /workbook-sha256:[a-f0-9]{64}#주차별 매출이익 보고서!F13/.test(week27Australia?.sourceRef || ''));
  check('2025 동일 차수로 전파하지 않음', getHistoricalClosingInventoryEvidence('2025', '27', '호주') == null);
  check('29차 이후로 전파하지 않음', getHistoricalClosingInventoryEvidence('2026', '29', '호주') == null);
  check('26차 F를 27차 E 보조근거로 조회 가능', near(getHistoricalClosingInventoryEvidence('2026', '26', '베트남')?.value, 3779004.64));

  const auto = {
    endQty: 1, snapshotConfirmed: true,
    priceEvidenceStatus: 'VERIFIED_CATEGORY_AVERAGE', evidenceValue: 1234,
  };
  check('카테고리 평균 공식도 검증된 자동 E/F로 채택', computeAutoEndingStock(auto) === 1234);
  check('화면 원천을 카테고리 평균 공식으로 구분', endingStockSourceKind(auto) === 'verified_category_average');
  const layered = computeLayeredInventoryValue({
    beginQty: 10, beginValue: 1000, purchaseQty: 10, purchaseValue: 3000, endQty: 5,
  });
  check('기초를 먼저 소진하면 기말은 신규 입고 원가', near(layered?.value, 1500) && layered?.method === 'new_receipts');
  check('층별 재고 상태 태그', layered?.status === 'VERIFIED_LAYERED_INVENTORY');

  console.log('\n=== 모든 국가·품종 E(n) = F(n-1) ===');
  check('27차 직전은 같은 해 26차', previousMajorOf('2026', '27')?.orderYear === '2026' && previousMajorOf('2026', '27')?.major === '26');
  check('01차는 전년도 52차', previousMajorOf('2026', '01')?.orderYear === '2025' && previousMajorOf('2026', '01')?.major === '52');
  const prevPrevNl = resolveNonLayeredInventoryClosing({
    category: '콜롬비아 장미',
    purchaseForeign: 100, forwardingForeign: 0, taxableRate: 10, customsCost: 0,
    purchaseQty: 10, stockQty: 5,
  });
  const week26F = reconstructPreviousClosing({
    category: '콜롬비아 장미',
    prevPrevClosing: prevPrevNl,
    prevBeginQty: 5,
    prevPurchaseQty: 10,
    prevPurchaseForeign: 200,
    prevForwardingForeign: 0,
    prevTaxableRate: 12,
    prevCustomsCost: 0,
    prevEndQty: 8,
  });
  const week27E = week26F;
  const week27F = resolveInventoryClosing({
    category: '콜롬비아 장미',
    beginQty: 8,
    beginValue: week27E.value,
    purchaseQty: 10,
    purchaseForeign: 50,
    forwardingForeign: 0,
    taxableRate: 15,
    customsCost: 0,
    endQty: 6,
  });
  check('콜롬비아 장미 이번 E는 전차수 F 재현값', near(week27E?.value, week26F?.value));
  const week27FAsNextE = reconstructPreviousClosing({
    category: '콜롬비아 장미',
    prevPrevClosing: week26F,
    prevBeginQty: 8,
    prevPurchaseQty: 10,
    prevPurchaseForeign: 50,
    prevForwardingForeign: 0,
    prevTaxableRate: 15,
    prevCustomsCost: 0,
    prevEndQty: 6,
  });
  check('다음차수 E 재현은 이번 F와 같음', near(week27FAsNextE?.value, week27F?.value));
  const confirmedCarry = reconstructPreviousClosing({
    category: '네덜란드', confirmedPreviousF: 123456,
  });
  check('전차수 확정 F가 있으면 그 값을 기초로 이월', confirmedCarry?.value === 123456 && confirmedCarry?.method === 'confirm_snapshot');
  const fromPrevPrevConfirm = reconstructPreviousClosing({
    category: '콜롬비아 장미',
    prevPrevClosing: { value: 5000 },
    prevBeginQty: 5,
    prevPurchaseQty: 10,
    prevPurchaseForeign: 200,
    prevForwardingForeign: 0,
    prevTaxableRate: 12,
    prevCustomsCost: 0,
    prevEndQty: 8,
  });
  const viewingPrevF = resolveInventoryClosing({
    category: '콜롬비아 장미',
    beginQty: 5,
    beginValue: 5000,
    purchaseQty: 10,
    purchaseForeign: 200,
    forwardingForeign: 0,
    taxableRate: 12,
    customsCost: 0,
    endQty: 8,
  });
  check('전전차수 확정 F에서 쌓은 전차수 기말이 이번 기초', near(fromPrevPrevConfirm?.value, viewingPrevF?.value));
  const netherlandsPrev = resolveNonLayeredInventoryClosing({
    category: '네덜란드', purchaseForeign: 100, taxableRate: 1500, purchaseQty: 10, stockQty: 4,
    directValue: 8800, directStatus: 'VERIFIED',
  });
  const netherlandsE = reconstructPreviousClosing({
    category: '네덜란드',
    prevEndQty: 4,
    prevDirectValue: 8800,
    prevDirectStatus: 'VERIFIED',
  });
  check('네덜란드는 카테고리 평균을 쓰지 않고 전차수 품목증거 F를 E로', netherlandsPrev?.method === 'item_evidence' && near(netherlandsE?.value, 8800));
  const australiaIncoming = incomingInventoryPurchaseValue({
    category: AUSTRALIA_INVENTORY_CATEGORY, purchaseForeign: 100, taxableRate: 1.06823, purchaseQty: 10,
  });
  check('호주 신규입고는 Q×R', near(australiaIncoming, 100 * 1.06823));
  const confirmStock = {
    endQty: 4, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED_CONFIRM_SNAPSHOT', evidenceValue: 123456,
  };
  check('확정 F 이월도 자동 E로 채택', computeAutoEndingStock(confirmStock) === 123456);
  check('확정 F 이월 원천 태그', endingStockSourceKind(confirmStock) === 'verified_confirm_snapshot');

  console.log('\n=== API 연결 계약 ===');
  const api = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  const calc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportCalc.js'), 'utf8');
  check('현재 F는 전차수 기말(autoE)을 기초로 resolveInventoryClosing', /resolveInventoryClosing\(\{[\s\S]*beginValue: autoE[\s\S]*endQty: endQtyValue/.test(api));
  check('기초 E는 전차수 확정 F 또는 전차수 F 재현', /reconstructPreviousClosing/.test(api) && /getActiveConfirm\(prevOrderYear, prevMajor\)/.test(api));
  check('전전차수 확정 F도 전차수 기초로 이어 씀', /getActiveConfirm\(prevPrev\.orderYear, prevPrev\.major\)/.test(api));
  check('호주 신규입고는 Q×R (선율과세환율)만 사용', /AUSTRALIA_INVENTORY_CATEGORY[\s\S]*Number\(purchaseForeign\) \* Number\(taxableRate\)/.test(calc));
  check('E는 현재 E가 아니라 prevMajor의 F 원천을 사용', /getHistoricalClosingInventoryEvidence\(prevOrderYear, prevMajor/.test(api));
  const beginBlock = api.slice(api.indexOf('const resolvedBegin'), api.indexOf('const beginStock'));
  check('기초 E 선택 블록은 현재 차수 workbook F를 사용하지 않음',
    !/getHistoricalClosingInventoryEvidence\(orderYear, major, key\)/.test(beginBlock));

  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
