// 국내운송(월드종합운수) 차량 자동 추천 — DB 의존 없는 순수 모듈.
//
// ## 업무 규칙(사용자 확정, 2026-08-19)
// 합산 Gross Weight를 운송비 금액 기준의 차량 등급으로 올린다.
//   1t 이하 → 1t 1대(99,000)
//   2.5t 이하 → 2.5t 1대(187,000)
//   2.5t 초과 ~ 5t → 5t 1대(275,000)
// 5t를 넘는 중량은 5t 묶음을 먼저 빼고 남은 중량에 같은 등급을 적용한다.
//   예) 3,342kg(3.3t) → 5t 1대 275,000원
//       1,371kg → 2.5t 1대
//         800kg → 1t 1대
//       6,000kg → 5t 1대 + 1t 1대
//
// ## 과거 실제값 우선
// 이 함수는 **추천값만** 만든다. 과거 차수에 저장된 실제 차량 대수·비용이 있으면 호출부가 그 값을 우선한다.

const n0 = (value) => (value == null || value === '' || Number.isNaN(Number(value)) ? 0 : Number(value));

/** 차량 종류 — 용량 큰 순서. 키는 WebColombiaWeekly/단가표 컬럼명과 같다. */
export const TRUCK_TYPES = [
  { key: 'Truck5t', label: '5t', capacityKg: 5000, rateKey: 'Truck5t' },
  { key: 'Truck2_5t', label: '2.5t', capacityKg: 2500, rateKey: 'Truck2_5t' },
  { key: 'Truck1t', label: '1t', capacityKg: 1000, rateKey: 'Truck1t' },
];

const EMPTY_PLAN = { Truck1t: 0, Truck2_5t: 0, Truck5t: 0 };

function assignRemainder(plan, remainingKg) {
  if (remainingKg <= 0) return;
  if (remainingKg <= 1000) plan.Truck1t += 1;
  else if (remainingKg <= 2500) plan.Truck2_5t += 1;
  else plan.Truck5t += 1;
}

/**
 * 합산 Gross Weight → 차량 대수 추천(금액 기준 등급).
 * @returns {{Truck1t:number,Truck2_5t:number,Truck5t:number,grossWeight:number,source:string}}
 *   source: 'missing'(중량 없음, 추천하지 않음) | 'warehouse_gw_auto'
 */
export function deriveTruckPlan(grossWeight) {
  const gw = Math.max(0, n0(grossWeight));
  if (gw <= 0) return { ...EMPTY_PLAN, grossWeight: gw, source: 'missing' };

  const plan = { ...EMPTY_PLAN };
  plan.Truck5t = Math.floor(gw / 5000);
  assignRemainder(plan, gw - (plan.Truck5t * 5000));
  return { ...plan, grossWeight: gw, source: 'warehouse_gw_auto' };
}

/** 차량 대수 → 금액. rates는 단가표(Truck1t/Truck2_5t/Truck5t 원). */
export function truckPlanAmount(plan, rates) {
  return TRUCK_TYPES.reduce((sum, type) => sum + n0(plan?.[type.key]) * n0(rates?.[type.rateKey]), 0);
}

const TRUCK_COUNT_KEYS = TRUCK_TYPES.map((type) => type.key);

/** 저장된 실제 차량 대수가 하나라도 있는지 — 있으면 추천값으로 덮지 않는다. */
export function hasExplicitTruckCounts(row) {
  return TRUCK_COUNT_KEYS.some((key) => row?.[key] != null && row[key] !== '' && Number(row[key]) > 0);
}

/** 이전 이름 호환 — 콜롬비아 반차수 트럭 추천. 내부 규칙은 deriveTruckPlan과 동일하다. */
export function deriveColombiaTruckAllocation(grossWeight) {
  return deriveTruckPlan(grossWeight);
}
