// lib/profitReportDriverExplanation.js — 매출이익 보고서: K(이익률) 변동을 손익 영향액으로 설명.
//
// 순수 계산만 한다(DB/거래처 로직 없음, lib/profitReportPriceMixCandidates.js와 역할 분리).
// 열 의미는 lib/profitReportCalc.js 와 동일: C=매출, E=기초재고, F=기말재고, P=매입액,
// H=그외통관비, T=포워딩(환율 환산 후 합계), L=불량.
// 매출이익 J = C - E + F - P - H - T. L(불량)은 이미 C=N+L+O에 포함되어 있으므로
// 별도 기여도로 다시 더하면 중복 해석이 된다. L은 본표의 C 세부항목으로만 본다.
export const DRIVER_COLUMNS = ['C', 'E', 'F', 'P', 'H', 'T'];
const PROFIT_IMPACT_SIGN = { C: 1, E: -1, F: 1, P: -1, H: -1, T: -1 };

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
 * currentTotals vs priorAvgTotals — 원시 증감(delta)과 실제 매출이익 영향액(profitImpact)을
 * 함께 계산한다. 비용·기초재고 증가는 음수 영향, 매출·기말재고 증가는 양수 영향이다.
 * @param {{C?,E?,F?,P?,H?,T?,L?:number}} currentTotals
 * @param {{C?,E?,F?,P?,H?,T?,L?:number}} priorAvgTotals
 * @returns {Array<{column,currentValue,priorAvgValue,delta,pctDelta,profitImpact,impactDirection}>}
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
    const profitImpact = delta == null ? null : delta * (PROFIT_IMPACT_SIGN[column] || 0);
    const impactDirection = profitImpact == null || profitImpact === 0 ? 'neutral' : profitImpact > 0 ? 'improved' : 'worsened';
    return { column, currentValue, priorAvgValue, delta, pctDelta, profitImpact, impactDirection };
  });
  return list.sort((a, b) => Math.abs(b.profitImpact ?? 0) - Math.abs(a.profitImpact ?? 0));
}
