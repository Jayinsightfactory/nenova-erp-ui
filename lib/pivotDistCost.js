// 분배단가 집계 (순수함수 — DB/번들러 의존 없음, node 단독 테스트 가능)
// 입력: ShipmentDetail 행 [{ prodKey, custName, outQty, cost }]
// 출력: { [prodKey]: { [custName]: 단가 } }
//
// 동일 (prodKey, custName) 에 다중 ShipmentDetail 행이 있으면 OutQuantity 가중 평균을 쓴다.
//   - Cost 는 "단가"(unit price)이므로 출고수량으로 가중해야 실효 평균단가가 된다.
//   - MAX/latest 가 아닌 가중평균을 택한 이유: 분할 출고(차수 내 부분 분배)에서 일부 행만
//     단가가 입력되거나 다른 단가가 들어가도, 출고량 비중에 맞는 대표 단가가 나온다.
//   - 가중 분모(sumOut)가 0이면(이론상 outQty>0 필터로 없음) MAX Cost 로 폴백.
// OutQuantity<=0 행은 무시한다(미분배/빈 레코드 제외, CLAUDE 규칙 — 고스트/빈레코드 패턴).
export function aggregateDistCostOrders(records) {
  const acc = {}; // prodKey -> custName -> { sumOut, sumCostOut, maxCost }
  for (const r of records || []) {
    const outQty = Number(r.outQty || 0);
    if (!(outQty > 0)) continue;
    const custName = r.custName;
    if (custName == null || custName === '') continue;
    const cost = Number(r.cost || 0);
    const pk = r.prodKey;
    if (!acc[pk]) acc[pk] = {};
    if (!acc[pk][custName]) acc[pk][custName] = { sumOut: 0, sumCostOut: 0, maxCost: 0 };
    const a = acc[pk][custName];
    a.sumOut += outQty;
    a.sumCostOut += outQty * cost;
    if (cost > a.maxCost) a.maxCost = cost;
  }
  const out = {};
  for (const pk of Object.keys(acc)) {
    out[pk] = {};
    for (const custName of Object.keys(acc[pk])) {
      const a = acc[pk][custName];
      out[pk][custName] = a.sumOut > 0 ? a.sumCostOut / a.sumOut : a.maxCost;
    }
  }
  return out;
}

// 확정 출고(isFix=1) — 거래처별 출고수량
export function aggregateOutOrders(records) {
  const out = {};
  for (const r of records || []) {
    const outQty = Number(r.outQty || 0);
    if (!(outQty > 0)) continue;
    const custName = r.custName;
    if (custName == null || custName === '') continue;
    const pk = r.prodKey;
    if (!out[pk]) out[pk] = {};
    out[pk][custName] = (out[pk][custName] || 0) + outQty;
  }
  return out;
}
