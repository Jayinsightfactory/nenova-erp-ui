// 콜롬비아 국내운송 트럭 등급 자동선정 — 매출원가 Excel의 1t/2.5t/5t 입력값 재현.
//
// 22~27차 원본 시트에서 확인된 운영 규칙:
//   GW  <= 1,000kg              → 1t 1대
//   GW  > 1,000kg && <= 2,500kg → 2.5t 1대
//   GW  > 2,500kg               → 5t 1대
// 이 값은 실제 적재용량의 물리적 한도가 아니라, 원본 Excel에서 사용한
// 운송료 등급(대수) 선택 규칙이다. 0kg은 자동선정하지 않는다.

const n0 = (value) => (value == null || value === '' || Number.isNaN(Number(value)) ? 0 : Number(value));

export function deriveColombiaTruckAllocation(grossWeight) {
  const gw = Math.max(0, n0(grossWeight));
  if (gw <= 0) {
    return { Truck1t: 0, Truck2_5t: 0, Truck5t: 0, grossWeight: gw, source: 'missing' };
  }
  if (gw <= 1000) {
    return { Truck1t: 1, Truck2_5t: 0, Truck5t: 0, grossWeight: gw, source: 'warehouse_gw_auto' };
  }
  if (gw <= 2500) {
    return { Truck1t: 0, Truck2_5t: 1, Truck5t: 0, grossWeight: gw, source: 'warehouse_gw_auto' };
  }
  return { Truck1t: 0, Truck2_5t: 0, Truck5t: 1, grossWeight: gw, source: 'warehouse_gw_auto' };
}
