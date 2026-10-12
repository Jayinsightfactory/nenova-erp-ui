// 국내운송(월드종합운수) 트럭 자동추천 — 합산 Gross Weight를 용량 단위로 분해한다.
//
// 2026-08-12 재설계(사용자 확정 업무규칙):
//   이전 규칙은 "GW≤1,000→1t / ≤2,500→2.5t / 그 외 5t" 로 항상 **한 대만** 골랐다. 실제 업무는
//   합산 중량을 용량 단위로 분해해 필요한 만큼 차량을 잡는다. 사용자가 확정한 예시:
//     3,000kg → 2.5t 1대 + 1t 1대 (5t 1대로 묶지 않는다 — 비용최저화는 선정 기준이 아니다)
//
//   알고리즘 (2단계)
//     1) 큰 용량부터, 남은 중량이 그 용량을 **꽉 채울 때만** 한 대를 배정하고 차감한다.
//        마지막 잔여 중량은 그것을 한 대로 덮는 **가장 작은 용량** 한 대로 마감한다.
//     2) 뒤쪽 작은 차량 여러 대를 **더 큰 차량 한 대로 바꿔도 총 용량이 늘지 않으면** 바꾼다
//        (대수만 줄고 용량은 늘지 않는 정리 — 필요보다 큰 차를 새로 부르지 않는다).
//   결과 예:
//     3,000  → 2.5t 1대(잔여 500) + 1t 1대. 5t 1대(용량 5,000 > 3,500)로는 묶지 않는다.   = 2.5t + 1t
//     7,020  → 5t 1대(잔여 2,020) + 1t 3대 → 뒤 1t 3대(3,000)를 2.5t 1대(2,500)로 정리    = 5t + 2.5t
//       553  → 꽉 채우는 용량 없음 → 553을 덮는 최소 용량 1t 1대                          = 1t
//
// 중요: 이 함수는 **추천값**만 만든다. 과거 차수(2026 22~27차)처럼 원본에 실제 배차/청구액이 남아
// 있으면 그 실제값이 항상 추천값보다 우선한다(WebColombiaWeekly/WebCustomsWeekly 저장행 →
// lib/profitReportHistoricalCustoms.js 원본 워크북 스냅샷 순). 0kg은 추천하지 않는다.

const n0 = (value) => (value == null || value === '' || Number.isNaN(Number(value)) ? 0 : Number(value));

/** 용량(kg) 큰 순서. 단가 키는 RATE_DEFAULTS/WebCustomsRateConfig 와 1:1 대응한다. */
export const TRUCK_CAPACITIES = [
  { field: 'Truck5t', rateKey: 'Truck5t', capacityKg: 5000, label: '5t' },
  { field: 'Truck2_5t', rateKey: 'Truck2_5t', capacityKg: 2500, label: '2.5t' },
  { field: 'Truck1t', rateKey: 'Truck1t', capacityKg: 1000, label: '1t' },
];

const EMPTY = () => ({ Truck1t: 0, Truck2_5t: 0, Truck5t: 0 });

/**
 * 합산 GW를 용량 단위로 분해한 추천 배차.
 * @returns {{Truck1t:number,Truck2_5t:number,Truck5t:number,grossWeight:number,source:string,plan:Array}}
 */
export function deriveTruckCapacityAllocation(grossWeight) {
  const gw = Math.max(0, n0(grossWeight));
  const counts = EMPTY();
  if (gw <= 0) return { ...counts, grossWeight: gw, source: 'missing', plan: [] };

  const plan = [];
  let remaining = gw;
  // 1) 남은 중량을 꽉 채우는 용량은 큰 것부터 반복 배정한다.
  for (const truck of TRUCK_CAPACITIES) {
    while (remaining >= truck.capacityKg) {
      counts[truck.field] += 1;
      plan.push({ label: truck.label, capacityKg: truck.capacityKg, coveredKg: truck.capacityKg });
      remaining -= truck.capacityKg;
    }
  }
  // 잔여 중량은 그것을 한 대로 덮을 수 있는 가장 작은 용량 한 대로 마감한다.
  if (remaining > 0) {
    const fit = [...TRUCK_CAPACITIES].reverse().find((t) => t.capacityKg >= remaining) || TRUCK_CAPACITIES[0];
    counts[fit.field] += 1;
    plan.push({ label: fit.label, capacityKg: fit.capacityKg, coveredKg: remaining });
    remaining = 0;
  }

  // 2) 뒤쪽 작은 차량 여러 대를 더 큰 차량 한 대로 바꿔도 총 용량이 늘지 않으면 바꾼다.
  //    (대수만 줄이는 정리이고 총 용량은 절대 늘리지 않으므로 "필요보다 큰 차를 부르는" 일이 없다.)
  consolidateTail(counts, plan);
  return { ...counts, grossWeight: gw, source: 'warehouse_gw_auto', plan };
}

function consolidateTail(counts, plan) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const bigger of TRUCK_CAPACITIES) {
      // 뒤에서부터 이어지는 "bigger보다 작은 차량들"의 최대 묶음을 찾는다.
      let tailCapacity = 0;
      let tailCount = 0;
      for (let i = plan.length - 1; i >= 0; i -= 1) {
        if (plan[i].capacityKg >= bigger.capacityKg) break;
        tailCapacity += plan[i].capacityKg;
        tailCount += 1;
      }
      if (tailCount < 2 || bigger.capacityKg > tailCapacity) continue;
      const removed = plan.splice(plan.length - tailCount, tailCount);
      for (const item of removed) {
        const spec = TRUCK_CAPACITIES.find((t) => t.capacityKg === item.capacityKg);
        if (spec) counts[spec.field] -= 1;
      }
      counts[bigger.field] += 1;
      plan.push({
        label: bigger.label,
        capacityKg: bigger.capacityKg,
        coveredKg: removed.reduce((sum, item) => sum + item.coveredKg, 0),
      });
      changed = true;
      break;
    }
  }
}

/** 추천 배차의 원화 금액(부가세 포함 청구 기준 — 엑셀 단가표 그대로). */
export function truckAllocationAmount(allocation, rates) {
  return TRUCK_CAPACITIES.reduce(
    (sum, truck) => sum + n0(allocation?.[truck.field]) * n0(rates?.[truck.rateKey]),
    0,
  );
}

/** 추천 배차를 "5t 1대 + 2.5t 1대" 형태의 사람이 읽는 문자열로. 없으면 빈 문자열. */
export function describeTruckAllocation(allocation) {
  return TRUCK_CAPACITIES
    .filter((truck) => n0(allocation?.[truck.field]) > 0)
    .map((truck) => `${truck.label} ${n0(allocation[truck.field])}대`)
    .join(' + ');
}

/** 하위호환 별칭 — 콜롬비아 4품목 반차수 배차도 같은 용량분해 규칙을 쓴다. */
export function deriveColombiaTruckAllocation(grossWeight) {
  return deriveTruckCapacityAllocation(grossWeight);
}
