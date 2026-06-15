// lib/pivotArrivalCalc.js — 도착원가 집계 순수함수 (DB/번들러 의존 없음, node 단독 테스트 가능)
//
// 입력: WarehouseDetail + FreightCostDetail / computeFreightCost 결과에서 추출한 레코드 배열
// 출력: { [prodKey]: { arrivalCost, arrivalPerStem, arrivalPerBunch, displayUnit, source } }
//
// 동일 prodKey 에 다중 행(다중 AWB·농장)이 있으면 가장 비싼 농장의 도착원가를 사용한다.
//   - 카탈로그·피벗은 품목당 하나의 도착원가만 표시하므로 MAX(displayArrivalKRW) 채택.
//   - inQty=0 행은 무시(고스트/빈레코드 — CLAUDE 패턴 1·2).
//   - 동률이면 source='live' 행을 우선한다.
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
function _isBetterArrivalRow(candidate, current) {
  if (!current) return true;
  const cArr = Number(candidate.displayArrivalKRW || 0);
  const curArr = Number(current.arrivalCost || 0);
  if (cArr > curArr) return true;
  if (cArr < curArr) return false;
  if (candidate.source === 'live' && current.source !== 'live') return true;
  return false;
}

export function aggregateArrivalCosts(records) {
  if (!records || records.length === 0) return {};

  const acc = {}; // prodKey → best row (max arrivalCost)

  for (const r of records) {
    const inQty = Number(r.inQty || 0);
    if (!(inQty > 0)) continue;
    const pk = r.prodKey;
    if (!pk) continue;

    const arrival = Number(r.displayArrivalKRW || 0);
    const perStem = Number(r.arrivalPerStem || 0);
    const perBunch = r.arrivalPerBunch != null ? Number(r.arrivalPerBunch) : null;
    const candidate = {
      arrivalCost: arrival,
      arrivalPerStem: perStem,
      arrivalPerBunch: perBunch,
      displayUnit: r.displayUnit || '단',
      source: r.source || 'live',
    };

    if (_isBetterArrivalRow(r, acc[pk])) {
      acc[pk] = candidate;
    }
  }

  const out = {};
  for (const pk of Object.keys(acc)) {
    out[Number(pk)] = acc[pk];
  }
  return out;
}
