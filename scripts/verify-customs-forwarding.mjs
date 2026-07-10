// 그외통관비/콜롬비아 배분 계산 검증 — 22차/23차 완성본 실제 셀값과 순수함수 결과를 대조 (읽기전용, DB 미사용)
// 사용: node scripts/verify-customs-forwarding.mjs
import { computeCountryCustomsTotal, computeColombiaCustomsTotal, computeColombiaAllocation } from '../lib/customsForwarding.js';

const rates = {
  BakSangRate: 460, Truck1t: 99000, Truck2_5t: 187000, Truck5t: 275000, QuarantinePerItemRate: 10000,
  BoxWeight_콜롬비아장미: 7, BoxWeight_콜롬비아카네이션: 11, BoxWeight_콜롬비아알스트로: 9.7, BoxWeight_콜롬비아루스커스: 8,
  BoxCBM_콜롬비아장미: 10, BoxCBM_콜롬비아카네이션: 11, BoxCBM_콜롬비아알스트로: 7, BoxCBM_콜롬비아루스커스: 9.6,
};

let pass = 0, fail = 0;
const check = (label, actual, expected, tol = 2) => {
  const ok = Math.abs(actual - expected) <= tol;
  console.log(`${ok ? '✅' : '❌'} ${label}: ${actual.toFixed(2)} vs ${expected} ${ok ? '' : '(diff ' + (actual - expected).toFixed(2) + ')'}`);
  ok ? pass++ : fail++;
};

console.log('=== 23차 그외통관비(국가레벨) — 그외통관비!I35/I36/I40 ===');
check('I35 수국', computeCountryCustomsTotal({
  GW1: 2539, GW2: 1130, Customs1: 0, Customs2: 0,
  SunYul1: 69300, SunYul2: 0, WorldFreight1: 275000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0,
}, rates), 2000740);

check('I36 네덜란드', computeCountryCustomsTotal({
  GW1: 149, GW2: 571, Customs1: 156990, Customs2: 79680,
  SunYul1: 207900, SunYul2: 0, WorldFreight1: 99000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0,
}, rates), 846870);

check('I40 중국', computeCountryCustomsTotal({
  GW1: 819, GW2: 163, Customs1: 1235560, Customs2: 393010,
  SunYul1: 207900, SunYul2: 0, WorldFreight1: 187000, WorldFreight2: 0, Quarantine1: 0, Quarantine2: 0,
}, rates), 2439290);

console.log('\n=== 23차 "콜롬비아 1차" 탭 (GW=CW=6404, 트럭5t×1, 박스 135/431/24/73) ===');
const boxQty1 = { '콜롬비아 장미': 135, '콜롬비아 카네이션': 431, '콜롬비아 알스트로': 24, '콜롬비아 루스커스': 73 };
const colRow1 = { GW: 6404, CW: 6404, HandlingFee: 33000, ItemCount: 4, Truck1t: 0, Truck2_5t: 0, Truck5t: 1, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, AirRateUSD: 17698 };
check('TOTAL(C17)', computeColombiaCustomsTotal(colRow1, rates), 3293840);
const alloc1 = computeColombiaAllocation(colRow1, boxQty1, rates);
check('H21 장미', alloc1['콜롬비아 장미'].H, 478667.47, 5);
check('H22 카네이션', alloc1['콜롬비아 카네이션'].H, 2401441.75, 5);
check('H23 알스트로', alloc1['콜롬비아 알스트로'].H, 117919.35, 5);
check('H24 루스커스', alloc1['콜롬비아 루스커스'].H, 295811.43, 5);
check('F21 장미 항공료(USD, GW=CW→무게비율)', alloc1['콜롬비아 장미'].S, 2571.91, 1);
check('F22 카네이션 항공료(USD)', alloc1['콜롬비아 카네이션'].S, 12903.09, 1);

console.log('\n=== 23차 "콜롬비아 2차" 탭 (GW=237≠CW=265, 트럭1t×1, 박스 12/10/6/0) ===');
const boxQty2 = { '콜롬비아 장미': 12, '콜롬비아 카네이션': 10, '콜롬비아 알스트로': 6, '콜롬비아 루스커스': 0 };
const colRow2 = { GW: 237, CW: 265, HandlingFee: 33000, ItemCount: 4, Truck1t: 1, Truck2_5t: 0, Truck5t: 0, CustomsFee: 0, DisinfectFee: 0, QuarantineDeductFee: 0, AirRateUSD: 811.1 };
check('TOTAL(C17)', computeColombiaCustomsTotal(colRow2, rates), 281020);
const alloc2 = computeColombiaAllocation(colRow2, boxQty2, rates);
check('H21 장미(항상 무게비율, GW≠CW 무관)', alloc2['콜롬비아 장미'].H, 93599.05, 5);
check('H22 카네이션', alloc2['콜롬비아 카네이션'].H, 122570.18, 5);
check('H23 알스트로', alloc2['콜롬비아 알스트로'].H, 64850.77, 5);
check('F21 장미(GW≠CW → CBM비율 전환)', alloc2['콜롬비아 장미'].S, 357.84, 1);
check('F22 카네이션(CBM비율)', alloc2['콜롬비아 카네이션'].S, 328.02, 1);

console.log('\n=== 대차수 합산: 콜롬비아 카네이션 H(1차+2차) — 주차별보고서 H9 ===');
check('H9 = H22(1차)+H22(2차)', alloc1['콜롬비아 카네이션'].H + alloc2['콜롬비아 카네이션'].H, 2524011.94, 10);

console.log(`\n총 ${pass + fail}건 중 성공 ${pass} · 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
