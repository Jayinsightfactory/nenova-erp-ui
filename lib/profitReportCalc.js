// 매출이익 보고서 계산 — 페이지/엑셀생성 공용 (DB 의존 없음, 클라이언트 안전)
// 엑셀 원본 수식 그대로: C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C
// 이스라엘·뉴질랜드·일본(variant 'noEnding'): I=E+G+H, J=C−I+F, K=J/(C+F)
export const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/**
 * E/F 재고평가액은 확정 ProductStock 수량과 그 스냅샷 시점의 VERIFIED 단가 근거만 사용한다.
 * 구매원가·최근원가·Product.Cost·최종값 직접입력으로 조용히 대체하지 않는다.
 */
export function computeAutoEndingStock(stock) {
  if (!stock) return null;
  const endQty = n0(stock.endQty);
  if (endQty === 0 && stock.snapshotConfirmed === true) return 0;
  if (stock.snapshotConfirmed !== true || stock.priceEvidenceStatus !== 'VERIFIED') return null;
  return stock.evidenceValue == null ? null : Number(stock.evidenceValue);
}

export function computeProfitRow(row, edits = {}) {
  // 확정 스냅샷은 조회 시점의 ERP/웹 원천으로 다시 계산하지 않는다.
  // 행별 결과 전체를 캡처한 confirmedSnapshot.values가 유일한 기준이다.
  if (row?.confirmedSnapshot?.values) return { ...row.confirmedSnapshot.values };
  const e = edits[row.category] || {};
  const pick = (col, fallback) => {
    const ev = e[col];
    if (ev !== undefined) return ev === '' ? fallback : Number(ev); // 빈칸은 수기 override 해제 → 자동값 즉시 복귀
    const mv = row.manual[col];
    if (mv != null) return Number(mv);
    return fallback;
  };
  const N = row.auto.N, L = row.auto.L, O = row.auto.O, Q = row.auto.Q;
  // R 환율: 입력·저장값 > CurrencyMaster 기본값(카테고리 통화 매핑) — 청구서 환율과 다르면 수정
  const R = pick('R', row.auto.R ?? null);
  // H 그외통관비: 입력·저장값 > 그외통관비/포워딩 입력 화면에서 계산된 자동값(2026-07-10)
  const H = pick('H', row.auto.H ?? null);
  const S = pick('S', row.auto.S || null);
  // E/F는 서버가 검증한 ProductStock+시점단가 결과만 허용한다. edits/manual 최종값은 무시한다.
  const E = row.auto.E ?? null;
  const F = computeAutoEndingStock(row.stock) ?? row.auto.F ?? null;
  const C = N + L + O;
  const P = Q * n0(R);
  const T = n0(S) * n0(R);
  const G = P + T;
  const noEnd = row.variant === 'noEnding';
  const I = noEnd ? n0(E) + G + n0(H) : n0(E) + G + n0(H) - n0(F);
  const J = noEnd ? C - I + n0(F) : C - I;
  const K = noEnd ? (C + n0(F) !== 0 ? J / (C + n0(F)) : null) : (C !== 0 ? J / C : null);
  const M = C !== 0 ? -(L / C) : null;
  return { N, L, O, Q, E, F, H, R, S, C, P, T, G, I, J, K, M };
}

/** 합계행 — 28차 원본은 국내 행을 포함한다. 구형 공제 행은 원가계열 합계에서만 제외한다. */
export function computeProfitTotals(rowsWithCalc) {
  const rows = rowsWithCalc;
  const nonDeduct = rows.filter(r => r.category !== '공제');
  const sum = (sel, list = rows) => list.reduce((s, r) => s + n0(sel(r.calc)), 0);
  const totals = {
    C: sum(c => c.C), E: sum(c => c.E), F: sum(c => c.F), J: sum(c => c.J),
    G: sum(c => c.G, nonDeduct), H: sum(c => c.H, nonDeduct), I: sum(c => c.I, nonDeduct),
    L: sum(c => c.L, nonDeduct), N: sum(c => c.N, nonDeduct), O: sum(c => c.O, nonDeduct),
    P: sum(c => c.P, nonDeduct), Q: sum(c => c.Q, nonDeduct), S: sum(c => c.S, nonDeduct),
    T: sum(c => c.T, nonDeduct),
  };
  totals.K = totals.C + totals.F !== 0 ? totals.J / (totals.C + totals.F) : null;
  totals.M = totals.C !== 0 ? -(totals.L / totals.C) : null;
  return totals;
}
