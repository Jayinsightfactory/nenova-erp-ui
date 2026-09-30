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

export function aggregateArrivalCosts(records, options = {}) {
  if (!records || records.length === 0) return {};
  if (options.mode === 'weighted') return aggregateArrivalCostsWeighted(records);

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
      // 환율 0(통화 환율 미등록·스냅샷 없음)으로 상품원가(FOB×환율)가 빠지고 통관 배분만 남은 행 표시.
      // 소비자(재고평가·FIFO)는 이 값을 "도착원가 전체"로 쓰면 안 된다(2026 30~32차 호주 AUD 사고).
      ...(r.goodsCostMissing ? { goodsCostMissing: true, invoiceCurrency: r.invoiceCurrency || null } : {}),
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

/**
 * 입고수량(inQty) 가중평균 집계 — 매출이익 보고서(재고평가·FIFO 근거) 전용(2026-09-30).
 * 같은 ProdKey 가 여러 농장/행으로 들어오면 원가자료 엑셀은 행마다 도착원가를 따로 계산하고, 재고·매출원가는
 * 그 수량만큼 합산된다. MAX(최고가 농장)는 카탈로그 표시용이라 보고서에 쓰면 수국 30-1~34-2 에서 엑셀 대비
 * +3~8%(행별 계산은 0.99~1.00)로 부풀었다. 표시단위가 섞이면 수량이 가장 많은 단위의 행만 평균한다.
 * 상품원가 누락(goodsCostMissing) 행은 정상 행이 하나라도 있으면 평균에서 뺀다.
 */
export function aggregateArrivalCostsWeighted(records) {
  const groups = {};
  for (const r of records || []) {
    const inQty = Number(r.inQty || 0);
    if (!(inQty > 0) || !r.prodKey) continue;
    (groups[r.prodKey] ||= []).push(r);
  }
  const out = {};
  for (const [pk, rowsAll] of Object.entries(groups)) {
    const ok = rowsAll.filter((r) => !r.goodsCostMissing);
    const rows0 = ok.length ? ok : rowsAll;
    const qtyByUnit = {};
    for (const r of rows0) { const u = r.displayUnit || '단'; qtyByUnit[u] = (qtyByUnit[u] || 0) + Number(r.inQty); }
    const unit = Object.entries(qtyByUnit).sort((a, b) => b[1] - a[1])[0][0];
    const rows = rows0.filter((r) => (r.displayUnit || '단') === unit);
    const q = rows.reduce((a, r) => a + Number(r.inQty), 0);
    const avg = (f) => rows.reduce((a, r) => a + (Number(r[f]) || 0) * Number(r.inQty), 0) / q;
    const hasBunch = rows.every((r) => r.arrivalPerBunch != null);
    const missing = !ok.length && rowsAll.some((r) => r.goodsCostMissing);
    out[Number(pk)] = {
      arrivalCost: avg('displayArrivalKRW'),
      arrivalPerStem: avg('arrivalPerStem'),
      arrivalPerBunch: hasBunch ? avg('arrivalPerBunch') : null,
      displayUnit: unit,
      source: rows.some((r) => r.source === 'live') ? 'live' : (rows[0].source || 'live'),
      aggregation: 'weighted',
      rowCount: rows.length,
      ...(missing ? { goodsCostMissing: true, invoiceCurrency: rowsAll.find((r) => r.invoiceCurrency)?.invoiceCurrency || null } : {}),
    };
  }
  return out;
}
