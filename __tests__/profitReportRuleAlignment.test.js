// 2026-08-19 사용자 확정 규칙: 차량 등급 3.3t→5T, CW>GW면 H도 CBM,
// 콜카장알루가 기본·콜카장알루수국은 화면 선택, 기존재고는 기존 환율·신규입고는 새 환율, 호주는 입고시점 선율.
// 실행: node __tests__/profitReportRuleAlignment.test.js
const RATE_DEFAULTS = {
  BakSangRate: 460, Truck1t: 99000, Truck2_5t: 187000, Truck5t: 275000, QuarantinePerItemRate: 10000,
  BoxWeight_콜롬비아장미: 7, BoxCBM_콜롬비아장미: 10,
  BoxWeight_콜롬비아카네이션: 11, BoxCBM_콜롬비아카네이션: 11,
  BoxWeight_콜롬비아알스트로: 9.7, BoxCBM_콜롬비아알스트로: 7,
  BoxWeight_콜롬비아루스커스: 8, BoxCBM_콜롬비아루스커스: 9.6,
  BoxWeight_콜롬비아수국: 10, BoxCBM_콜롬비아수국: 12,
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
    computeLayeredInventoryValue, computeAutoEndingStock, endingStockSourceKind,
    AUSTRALIA_INVENTORY_CATEGORY, reconstructPreviousClosing,
  } = await import('../lib/profitReportCalc.js');

  console.log('=== 차량 등급: 2.5t 초과~5t = 5t ===');
  const p3342 = deriveTruckPlan(3342);
  check('3,342kg → 5t 1대', p3342.Truck5t === 1 && p3342.Truck2_5t === 0 && p3342.Truck1t === 0);
  check('3,342kg 금액 275,000원', truckPlanAmount(p3342, RATE_DEFAULTS) === 275000);
  check('3,000kg → 5t 1대', deriveTruckPlan(3000).Truck5t === 1);
  check('2,500kg → 2.5t 1대', deriveTruckPlan(2500).Truck2_5t === 1 && deriveTruckPlan(2500).Truck5t === 0);
  check('1,000kg → 1t 1대', deriveTruckPlan(1000).Truck1t === 1);
  check('6,000kg → 5t+1t', deriveTruckPlan(6000).Truck5t === 1 && deriveTruckPlan(6000).Truck1t === 1);

  console.log('\n=== CW>GW 이면 H와 S 모두 CBM ===');
  check('CW=GW는 무게비율', colombiaUsesWeightRatio(655, 655) === true);
  check('CW<GW는 무게비율', colombiaUsesWeightRatio(670, 655) === true);
  check('CW>GW는 CBM비율', colombiaUsesWeightRatio(655, 670) === false);
  check('CW>GW 배지 문구', colombiaRatioMode(655, 670).label.includes('CW 670 > GW 655') && colombiaRatioMode(655, 670).useWeight === false);
  check('CW=GW 배지 문구', colombiaRatioMode(655, 655).label.includes('=') && colombiaRatioMode(655, 655).useWeight === true);
  const weightAlloc = computeColombiaAllocation(
    { GW: 655, CW: 655, CustomsFee: 100000, AirRateUSD: 1000 },
    { '콜롬비아 장미': 10, '콜롬비아 카네이션': 10, '콜롬비아 알스트로': 0, '콜롬비아 루스커스': 0 },
    RATE_DEFAULTS,
  );
  const cbmAlloc = computeColombiaAllocation(
    { GW: 655, CW: 670, CustomsFee: 100000, AirRateUSD: 1000 },
    { '콜롬비아 장미': 10, '콜롬비아 카네이션': 10, '콜롬비아 알스트로': 0, '콜롬비아 루스커스': 0 },
    RATE_DEFAULTS,
  );
  check('CW>GW이면 장미 H가 무게비율과 다름', !near(cbmAlloc['콜롬비아 장미'].H, weightAlloc['콜롬비아 장미'].H, 0.5));
  check('CW>GW이면 장미 S도 CBM', !near(cbmAlloc['콜롬비아 장미'].S, weightAlloc['콜롬비아 장미'].S, 0.0001));

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

  console.log('\n=== 기존재고는 기존 환율, 신규입고는 새 환율 (FIFO) ===');
  const mixed = computeLayeredInventoryValue({
    beginQty: 10, beginValue: 10000, purchaseQty: 10, purchaseValue: 20000, endQty: 12,
  });
  check('판매 8 = 기초 10 중 8, 기말 12 = 기초잔 2 + 신규 10', mixed?.method === 'mixed');
  check('기말금액 = 2×1000 + 10×2000', near(mixed?.value, 22000));
  const carried = computeLayeredInventoryValue({
    beginQty: 10, beginValue: 10000, purchaseQty: 0, purchaseValue: 0, endQty: 4,
  });
  check('입고 없이 판매하면 기존 단가 유지', carried?.method === 'carried_only' && near(carried.value, 4000));
  const fresh = computeLayeredInventoryValue({
    beginQty: 0, beginValue: 0, purchaseQty: 10, purchaseValue: 15000, endQty: 3,
  });
  check('신규만 남으면 새 원가', fresh?.method === 'new_receipts' && near(fresh.value, 4500));

  console.log('\n=== 호주: 입고시점 구매단가×수량×선율, 재고 판매 시 그 환율 유지 ===');
  const australiaIncoming = 100 * 1.06823;
  check('호주 카테고리 키', AUSTRALIA_INVENTORY_CATEGORY === '호주');
  const auKeptOpening = computeLayeredInventoryValue({
    beginQty: 5, beginValue: 4000, purchaseQty: 10, purchaseValue: australiaIncoming, endQty: 12,
  });
  check('호주는 기초를 먼저 팔고 남은 신규는 입고 환율', auKeptOpening?.method === 'mixed');
  check('호주 기말 혼합 = 기초잔 2×800 + 신규 10×(Q×R/10)', near(auKeptOpening?.value, 2 * 800 + australiaIncoming));
  const au = computeLayeredInventoryValue({
    beginQty: 5, beginValue: 4000, purchaseQty: 10, purchaseValue: australiaIncoming, endQty: 8,
  });
  check('호주 기초를 다 팔면 기말은 입고 환율만', au?.method === 'new_receipts');
  check('호주 기말 = 신규 8 × (Q×R/10)', near(au?.value, 8 * (australiaIncoming / 10)));
  const auSoldLater = computeLayeredInventoryValue({
    beginQty: 8, beginValue: au.value, purchaseQty: 0, purchaseValue: 0, endQty: 3,
  });
  check('다음 차수 판매도 입고 당시 환율 유지', near(auSoldLater?.value, 3 * (australiaIncoming / 10)));
  const nextOpening = reconstructPreviousClosing({
    category: AUSTRALIA_INVENTORY_CATEGORY,
    prevPrevClosing: { value: au.value },
    prevBeginQty: 8,
    prevPurchaseQty: 0,
    prevPurchaseForeign: 0,
    prevTaxableRate: 1,
    prevEndQty: 3,
  });
  check('호주 다음차수 기초 E는 이번 기말 F', near(nextOpening?.value, auSoldLater?.value));
  const layeredStock = {
    endQty: 8, snapshotConfirmed: true, priceEvidenceStatus: 'VERIFIED_LAYERED_INVENTORY', evidenceValue: au.value,
  };
  check('층별 재고는 자동 F로 채택', near(computeAutoEndingStock(layeredStock), au.value));
  check('화면 원천 태그', endingStockSourceKind(layeredStock) === 'verified_layered_inventory');

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
