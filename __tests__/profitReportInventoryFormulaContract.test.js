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

  console.log('\n=== API 연결 계약 ===');
  const api = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  check('현재 F는 purchaseQty와 ProductStock으로 계산', /computeCategoryAverageInventoryValue\(\{[\s\S]*purchaseQty:[\s\S]*stockQty: Number\(stockEnd\.qtys/.test(api));
  check('기존재고와 신규입고를 층으로 나눠 평가', /computeLayeredInventoryValue\(\{[\s\S]*beginValue: autoE[\s\S]*purchaseValue: incomingPurchaseValue/.test(api));
  check('호주 신규입고는 Q×R (선율과세환율)만 사용', /AUSTRALIA_INVENTORY_CATEGORY[\s\S]*Q\[key\][\s\S]*autoR/.test(api));
  check('E는 현재 E가 아니라 prevMajor의 F 원천을 사용', /getHistoricalClosingInventoryEvidence\(prevOrderYear, prevMajor/.test(api));
  const beginBlock = api.slice(api.indexOf('const resolvedBegin'), api.indexOf('const beginStock'));
  check('기초 E 선택 블록은 현재 차수 workbook F를 사용하지 않음',
    !/getHistoricalClosingInventoryEvidence\(orderYear, major, key\)/.test(beginBlock));

  if (failed) process.exit(1);
}

main().catch((error) => { console.error(error); process.exit(1); });
