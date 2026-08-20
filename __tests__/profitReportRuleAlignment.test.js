// 2026-08-19 사용자 확정 규칙(원본 매출원가 양식 28~31차 대조 반영):
//   차량 등급 3.3t→5T / 콜카장알루 기본·콜카장알루수국은 화면 선택 /
//   그외통관비 배분은 항상 무게비율, 항공료만 과금중량≠총중량이면 CBM /
//   기말상품재고액은 그 차수 매입 평균원가 × 기말수량, 매입 없으면 직전 단가 유지(첫 입고 환율 고정).
// 실행: node __tests__/profitReportRuleAlignment.test.js
const RATE_DEFAULTS = {
  BakSangRate: 460, Truck1t: 99000, Truck2_5t: 187000, Truck5t: 275000, QuarantinePerItemRate: 10000,
  BoxWeight_콜롬비아장미: 7, BoxCBM_콜롬비아장미: 10,
  BoxWeight_콜롬비아카네이션: 11, BoxCBM_콜롬비아카네이션: 11,
  BoxWeight_콜롬비아알스트로: 9.7, BoxCBM_콜롬비아알스트로: 7,
  BoxWeight_콜롬비아루스커스: 8, BoxCBM_콜롬비아루스커스: 9.6,
  BoxWeight_콜롬비아수국: 5.6, BoxCBM_콜롬비아수국: 7,
};

let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};
const near = (a, b, tolerance = 0.01) => Math.abs(Number(a) - Number(b)) <= tolerance;

async function main() {
  const { deriveTruckPlan, truckPlanAmount } = await import('../lib/colombiaTruck.js');
  const { computeColombiaAllocation, colombiaUsesWeightRatio, computeColombiaRatios, colombiaRatioMode } = await import('../lib/customsForwardingCalc.js');
  const {
    isColombiaSharedApolloShipment, colombiaAllocCategories, COLOMBIA_HYDRANGEA_CATEGORY,
  } = await import('../lib/colombiaFlowerClassification.js');
  const {
    computeAutoEndingStock, endingStockSourceKind, AUSTRALIA_INVENTORY_CATEGORY,
    reconstructPreviousClosing, resolveInventoryClosing, usesWeeklyAverageInventoryCategory,
    computeProfitRow,
  } = await import('../lib/profitReportCalc.js');

  console.log('=== 차량 등급: 2.5t 초과~5t = 5t ===');
  const p3342 = deriveTruckPlan(3342);
  check('3,342kg → 5t 1대', p3342.Truck5t === 1 && p3342.Truck2_5t === 0 && p3342.Truck1t === 0);
  check('3,342kg 금액 275,000원', truckPlanAmount(p3342, RATE_DEFAULTS) === 275000);
  check('3,000kg → 5t 1대', deriveTruckPlan(3000).Truck5t === 1);
  check('2,500kg → 2.5t 1대', deriveTruckPlan(2500).Truck2_5t === 1 && deriveTruckPlan(2500).Truck5t === 0);
  check('1,000kg → 1t 1대', deriveTruckPlan(1000).Truck1t === 1);
  check('6,000kg → 5t+1t', deriveTruckPlan(6000).Truck5t === 1 && deriveTruckPlan(6000).Truck1t === 1);

  console.log('\n=== 그외통관비는 항상 무게비율, 항공료만 과금중량≠총중량이면 CBM (원본 양식) ===');
  check('과금중량=총중량이면 항공료 무게비율', colombiaUsesWeightRatio(655, 655) === true);
  check('과금중량<총중량이면 항공료 CBM비율', colombiaUsesWeightRatio(670, 655) === false);
  check('과금중량>총중량이면 항공료 CBM비율', colombiaUsesWeightRatio(655, 670) === false);
  check('한쪽이 비면 비교 불가로 무게비율', colombiaUsesWeightRatio(655, 0) === true && colombiaUsesWeightRatio(0, 670) === true);
  check('배지 문구 — 다름', colombiaRatioMode(655, 670).label.includes('과금중량 670 ≠ 총중량 655') && colombiaRatioMode(655, 670).useWeight === false);
  check('배지 문구 — 같음', colombiaRatioMode(655, 655).label.includes('과금중량 655 = 총중량 655') && colombiaRatioMode(655, 655).useWeight === true);
  const boxes = { '콜롬비아 장미': 10, '콜롬비아 카네이션': 10, '콜롬비아 알스트로': 0, '콜롬비아 루스커스': 0 };
  const weightAlloc = computeColombiaAllocation({ GW: 655, CW: 655, CustomsFee: 100000, AirRateUSD: 1000 }, boxes, RATE_DEFAULTS);
  const cbmAlloc = computeColombiaAllocation({ GW: 655, CW: 670, CustomsFee: 100000, AirRateUSD: 1000 }, boxes, RATE_DEFAULTS);
  check('과금중량이 달라도 그외통관비는 무게비율 그대로', near(cbmAlloc['콜롬비아 장미'].H, weightAlloc['콜롬비아 장미'].H, 0.0001));
  check('과금중량이 다르면 항공료만 CBM으로 바뀜', !near(cbmAlloc['콜롬비아 장미'].S, weightAlloc['콜롬비아 장미'].S, 0.0001));
  const ratio = computeColombiaRatios(boxes, RATE_DEFAULTS);
  check('그외통관비 배분 = TOTAL × 무게비율',
    near(weightAlloc['콜롬비아 장미'].H, (655 * 460 + 100000) * ratio.weightRatio['콜롬비아 장미'], 0.01));
  check('항공료 CBM 배분 = 항공료 × CBM비율',
    near(cbmAlloc['콜롬비아 장미'].S, 1000 * ratio.cbmRatio['콜롬비아 장미'], 0.0001));

  console.log('\n=== 콜카장알루가 기본, 콜카장알루수국은 화면에서 켤 때만 ===');
  check('APOLLO 혼적은 힌트용 공유 판별', isColombiaSharedApolloShipment({
    farmName: 'APOLLO', invoiceNo: '콜카장', flowerNames: ['수국', '카네이션'],
  }) === true);
  const defaultRatios = computeColombiaRatios(
    { '콜롬비아 수국': 5, '콜롬비아 장미': 5, '콜롬비아 카네이션': 0, '콜롬비아 알스트로': 0, '콜롬비아 루스커스': 0 },
    RATE_DEFAULTS,
  );
  check('기본 콜카장알루는 수국 박스가 있어도 4키', defaultRatios.categories.length === 4 && !defaultRatios.categories.includes(COLOMBIA_HYDRANGEA_CATEGORY));
  const pooled = computeColombiaRatios(
    { '콜롬비아 수국': 5, '콜롬비아 장미': 5, '콜롬비아 카네이션': 0, '콜롬비아 알스트로': 0, '콜롬비아 루스커스': 0 },
    RATE_DEFAULTS,
    { includeHydrangea: true },
  );
  check('콜카장알루수국을 켠 풀에 수국 포함', pooled.categories.includes(COLOMBIA_HYDRANGEA_CATEGORY));
  check('수국 무게비율 > 0', pooled.weightRatio[COLOMBIA_HYDRANGEA_CATEGORY] > 0);
  const defaultAlloc = computeColombiaAllocation(
    { GW: 1000, CW: 1000, CustomsFee: 200000, AirRateUSD: 500 },
    { '콜롬비아 수국': 5, '콜롬비아 장미': 5, '콜롬비아 카네이션': 0, '콜롬비아 알스트로': 0, '콜롬비아 루스커스': 0 },
    RATE_DEFAULTS,
  );
  check('저장 플래그 없으면 수국 H는 0', (defaultAlloc[COLOMBIA_HYDRANGEA_CATEGORY]?.H || 0) === 0);
  const pooledAlloc = computeColombiaAllocation(
    { GW: 1000, CW: 1000, CustomsFee: 200000, AirRateUSD: 500, IncludeHydrangea: 1 },
    { '콜롬비아 수국': 5, '콜롬비아 장미': 5, '콜롬비아 카네이션': 0, '콜롬비아 알스트로': 0, '콜롬비아 루스커스': 0 },
    RATE_DEFAULTS,
  );
  check('IncludeHydrangea=1이면 수국 H가 배분됨', (pooledAlloc[COLOMBIA_HYDRANGEA_CATEGORY]?.H || 0) > 0);
  check('수국만 있는 풀은 기본 4키가 아님', colombiaAllocCategories({ includeHydrangea: true }).length === 5);

  console.log('\n=== 기말상품재고액 = 그 차수 매입 평균원가 × 기말수량 (원본 양식 공식) ===');
  check('모든 국가·품종이 이 공식 대상', usesWeeklyAverageInventoryCategory('네덜란드')
    && usesWeeklyAverageInventoryCategory('중국') && usesWeeklyAverageInventoryCategory('콜롬비아 장미'));
  const cnClosing = resolveInventoryClosing({
    category: '중국', beginQty: 10, beginValue: 10000,
    purchaseQty: 10, purchaseForeign: 80, forwardingForeign: 20, taxableRate: 10, customsCost: 0, endQty: 12,
  });
  check('매입이 있으면 기말 전량을 그 차수 평균원가로 평가',
    cnClosing?.method === 'weekly_average_cost' && near(cnClosing?.value, (1000 / 10) * 12));
  check('기말수량이 0이면 0', resolveInventoryClosing({
    category: '중국', beginQty: 10, beginValue: 10000, purchaseQty: 10, purchaseForeign: 80, taxableRate: 10, endQty: 0,
  })?.value === 0);

  console.log('\n=== 호주: 첫 입고 환율이 재고로 팔릴 때까지 유지 ===');
  check('호주 카테고리 키', AUSTRALIA_INVENTORY_CATEGORY === '호주');
  const auFirst = resolveInventoryClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY,
    beginQty: 0, beginValue: 0, purchaseQty: 10, purchaseForeign: 100, taxableRate: 1.06823, endQty: 8,
  });
  check('첫 입고 차수는 그 차수 선율과세환율로 평가', near(auFirst?.value, (100 * 1.06823 / 10) * 8));
  const auWeek2 = resolveInventoryClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY, beginQty: 8, beginValue: auFirst.value, purchaseQty: 0, endQty: 5,
  });
  const auWeek3 = resolveInventoryClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY, beginQty: 5, beginValue: auWeek2.value, purchaseQty: 0, endQty: 3,
  });
  const firstUnit = auFirst.value / 8;
  check('다음 차수도 첫 입고 단가 유지', auWeek2?.method === 'carried_unit_cost' && near(auWeek2.value, firstUnit * 5));
  check('그 다음 차수도 계속 유지', auWeek3?.method === 'carried_unit_cost' && near(auWeek3.value, firstUnit * 3));
  const auNewReceipt = resolveInventoryClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY,
    beginQty: 3, beginValue: auWeek3.value, purchaseQty: 5, purchaseForeign: 60, taxableRate: 1.01882, endQty: 4,
  });
  check('새로 입고되면 그때 환율로 재평가',
    auNewReceipt?.method === 'weekly_average_cost' && near(auNewReceipt.value, (60 * 1.01882 / 5) * 4));
  check('매입 차수는 그외통관비(Q54)를 단가에 포함한다', near(resolveInventoryClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY,
    purchaseQty: 2030, purchaseForeign: 500, taxableRate: 1056.39, customsCost: 608410, endQty: 1000,
  })?.value, ((500 * 1056.39 + 608410) / 2030) * 1000));
  check('매입이 있으면 27차 1,068.23을 고정하지 않는다', near(resolveInventoryClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY,
    beginQty: 3, beginValue: auWeek3.value, purchaseQty: 5, purchaseForeign: 60, taxableRate: 1056.39, endQty: 4,
  })?.value, (60 * 1056.39 / 5) * 4));
  check('수량 0이어도 선언 기말상품재고액은 실제 재고', near(resolveInventoryClosing({
    category: '에콰도르', endQty: 0, declaredValue: 3485942,
  })?.value, 3485942));
  const vietnamJ = computeProfitRow({
    category: '베트남',
    auto: { N: 20000000, L: 0, O: 0, Q: 0, R: 1, S: 0, H: 0, E: 1000000, F: 500000 },
    manual: {},
    stock: { endQty: 10, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED_CATEGORY_AVERAGE', evidenceValue: 500000 },
  });
  check('베트남 매출이익은 C−I이며 ±4,576,000원을 이동하지 않음',
    vietnamJ.J === vietnamJ.C - vietnamJ.I && vietnamJ.J !== vietnamJ.C - vietnamJ.I - 4576000);
  const nextOpening = reconstructPreviousClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY,
    prevPrevClosing: { value: auFirst.value },
    prevBeginQty: 8,
    prevPurchaseQty: 0,
    prevEndQty: 5,
  });
  check('다음차수 기초상품재고액 = 이번 기말상품재고액', near(nextOpening?.value, auWeek2?.value));
  const carriedStock = {
    endQty: 5, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED_CARRIED_UNIT_COST', evidenceValue: auWeek2.value,
  };
  check('직전 단가 유지도 자동 기말재고로 채택', near(computeAutoEndingStock(carriedStock), auWeek2.value));
  check('화면 원천 태그', endingStockSourceKind(carriedStock) === 'verified_carried_unit_cost');

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
