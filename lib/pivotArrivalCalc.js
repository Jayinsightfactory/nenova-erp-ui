// lib/pivotArrivalCalc.js — 도착원가 집계 순수함수 (DB/번들러 의존 없음, node 단독 테스트 가능)
//
// 입력: WarehouseDetail + FreightCostDetail / computeFreightCost 결과에서 추출한 레코드 배열
// 출력: { [prodKey]: { arrivalCost, arrivalPerStem, arrivalPerBunch, displayUnit, source } }
//
// 동일 prodKey 에 다중 행이 있으면 WarehouseDetail.OutQuantity(inQty) 가중평균을 사용한다.
//   - arrivalCost 는 "단가(displayUnit 당)"이므로 입고수량으로 가중해야 실효 평균단가가 된다.
//   - inQty=0 행은 무시(고스트/빈레코드 — CLAUDE 패턴 1·2).
//   - 가중 분모(sumQty)=0 이면 maxArrival 로 폴백(이론상 없음).
//
// displayUnit 승격 규칙:
//   - live 계산 행이 있으면 source='live' 로 승격
//   - source='live' 행의 displayUnit 이 다르면 live 쪽을 우선 적용
//   - 박스(live) 품목은 스냅샷보다 신뢰도가 높으므로 항상 live 유지

/** 부가세 포함 도착원가 — freight 판매가(부가세포함) 와 동일 배율 */
export const ARRIVAL_VAT_MULTIPLIER = 1.1;

export function arrivalCostWithVat(arrivalCost) {
  const v = Number(arrivalCost || 0);
  return v > 0 ? v * ARRIVAL_VAT_MULTIPLIER : 0;
}

/**
 * @param {Array<{
 *   prodKey: number,
 *   inQty: number,
 *   displayArrivalKRW: number,
 *   arrivalPerStem?: number,
 *   arrivalPerBunch?: number|null,
 *   displayUnit: string,
 *   source: 'snapshot'|'live'
 * }>} records
 *
 * @returns {{ [prodKey: number]: {
 *   arrivalCost: number,
 *   arrivalPerStem: number,
 *   arrivalPerBunch: number|null,
 *   displayUnit: string,
 *   source: 'snapshot'|'live'
 * }}}
 */
export function aggregateArrivalCosts(records) {
  if (!records || records.length === 0) return {};

  const acc = {}; // prodKey → { sumQty, sumArrivalOut, sumStemOut, maxArrival, displayUnit, source, bunchList }

  for (const r of records) {
    const inQty = Number(r.inQty || 0);
    if (!(inQty > 0)) continue;
    const pk = r.prodKey;
    if (!pk) continue;

    const arrival = Number(r.displayArrivalKRW || 0);
    const perStem = Number(r.arrivalPerStem || 0);
    const perBunch = r.arrivalPerBunch != null ? Number(r.arrivalPerBunch) : null;

    if (!acc[pk]) {
      acc[pk] = {
        sumQty: 0,
        sumArrivalOut: 0,
        sumStemOut: 0,
        maxArrival: 0,
        displayUnit: r.displayUnit || '단',
        source: r.source || 'live',
        bunchList: [],
      };
    }
    const a = acc[pk];
    a.sumQty        += inQty;
    a.sumArrivalOut += inQty * arrival;
    a.sumStemOut    += inQty * perStem;
    if (arrival > a.maxArrival) a.maxArrival = arrival;

    // displayUnit / source 승격: live 소스를 우선한다
    if (r.source === 'live') {
      a.source = 'live';
      a.displayUnit = r.displayUnit || a.displayUnit;
    }

    if (perBunch != null) a.bunchList.push({ qty: inQty, val: perBunch });
  }

  const out = {};
  for (const pk of Object.keys(acc)) {
    const a = acc[pk];
    const arrivalCost = a.sumQty > 0 ? a.sumArrivalOut / a.sumQty : a.maxArrival;
    const arrivalPerStem = a.sumQty > 0 ? a.sumStemOut / a.sumQty : 0;

    let arrivalPerBunch = null;
    if (a.bunchList.length > 0) {
      const sumBQ = a.bunchList.reduce((s, x) => s + x.qty, 0);
      const sumBO = a.bunchList.reduce((s, x) => s + x.qty * x.val, 0);
      arrivalPerBunch = sumBQ > 0 ? sumBO / sumBQ : null;
    }

    out[Number(pk)] = {
      arrivalCost,
      arrivalPerStem,
      arrivalPerBunch,
      displayUnit: a.displayUnit,
      source: a.source,
    };
  }
  return out;
}
