// lib/profitReportDriverExplanation.js — 매출이익 보고서: K(이익률) 변동을 열별(C/E/F/P/H/T/L) 델타로 설명.
//
// 순수 계산만 한다(DB/거래처 로직 없음, lib/profitReportPriceMixCandidates.js와 역할 분리).
// 열 의미는 lib/profitReportCalc.js 와 동일: C=매출, E=기초재고, F=기말재고, P=매입액,
// H=그외통관비, T=포워딩(환율 환산 후 합계), L=불량.
// "기여도" 정렬은 정확한 편미분 배분이 아니라 delta 절대값 크기로 근사한다(요구사항에 명시된 근사치).
export const DRIVER_COLUMNS = ['C', 'E', 'F', 'P', 'H', 'T', 'L'];

const asFiniteNumber = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/** 여러 주차 totals의 단순 평균 — 필드별로 null/undefined인 주차만 그 필드 평균에서 제외한다
 * (전체 주차가 null인 필드는 결과도 null). loadRateTrend()가 모은 priorTotalsList(주차별 totals,
 * 실패한 주차는 null)를 그대로 넘기면 된다. */
export function averageTotals(totalsList = [], columns = DRIVER_COLUMNS) {
  const list = (totalsList || []).filter(Boolean);
  const out = {};
  for (const col of columns) {
    const values = list
      .map((t) => asFiniteNumber(t?.[col]))
      .filter((v) => v != null);
    out[col] = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  }
  return out;
}

/**
 * currentTotals vs priorAvgTotals — C/E/F/P/H/T/L 각각의 절대/비율 변화를 계산하고,
 * delta 절대값이 큰 순으로 정렬해 반환한다.
 * @param {{C?,E?,F?,P?,H?,T?,L?:number}} currentTotals
 * @param {{C?,E?,F?,P?,H?,T?,L?:number}} priorAvgTotals
 * @returns {Array<{column,currentValue,priorAvgValue,delta,pctDelta}>}
 */
export function explainDrivers(currentTotals, priorAvgTotals) {
  const cur = currentTotals || {};
  const prior = priorAvgTotals || {};
  const list = DRIVER_COLUMNS.map((column) => {
    const currentValue = asFiniteNumber(cur[column]);
    const priorAvgValue = asFiniteNumber(prior[column]);
    const delta = currentValue != null && priorAvgValue != null ? currentValue - priorAvgValue : null;
    const pctDelta = delta != null && priorAvgValue !== 0 && priorAvgValue != null
      ? delta / Math.abs(priorAvgValue)
      : null;
    return { column, currentValue, priorAvgValue, delta, pctDelta };
  });
  return list.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
}
