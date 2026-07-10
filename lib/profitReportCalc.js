// 매출이익 보고서 계산 — 페이지/엑셀생성 공용 (DB 의존 없음, 클라이언트 안전)
// 엑셀 원본 수식 그대로: C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C
// 이스라엘·뉴질랜드·일본(variant 'noEnding'): I=E+G+H, J=C−I+F, K=J/(C+F)
export const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/** F 기말상품재고액 자동 — 엑셀 원본 F열 공식 그대로(2026-07-09 로직검증):
 *   (구매금액×환율 + 포워딩×환율 + 그외통관비) ÷ 이번 차수 매입 총수량 × 기말 재고수량
 * 이번 차수 매입이 없으면(엑셀 호주 사례) 품목별 최근 매입 외화단가 × 기말수량 × 환율,
 * 그것도 없으면 재고단가표 평가액(tableF, 수량×단가÷1.1)을 최후 fallback 으로 쓴다.
 * stock = { purchQty: 매입총수량, endQty: 기말재고수량, recentCost: Σ(최근외화단가×수량), tableF } */
export function computeAutoEndingStock(stock, { Q, S, H, R }) {
  if (!stock) return null;
  const endQty = n0(stock.endQty);
  if (endQty <= 0) return null;
  const purchQty = n0(stock.purchQty);
  const landedWon = n0(Q) * n0(R) + n0(S) * n0(R) + n0(H); // 매입원화 + 포워딩원화 + 그외통관비
  if (purchQty > 0 && landedWon > 0) return (landedWon / purchQty) * endQty;
  if (n0(stock.recentCost) > 0 && n0(R) > 0) return n0(stock.recentCost) * n0(R);
  return stock.tableF != null ? Number(stock.tableF) : null;
}

export function computeProfitRow(row, edits = {}) {
  const e = edits[row.category] || {};
  const pick = (col, fallback) => {
    const ev = e[col];
    if (ev !== undefined) return ev === '' ? null : Number(ev);
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
  // E 기초: 전차수 기말 이월(저장값 우선, 없으면 서버 자동계산 auto.E)
  const E = pick('E', row.auto.E ?? null);
  // F 기말: 입력·저장값 우선, 없으면 엑셀 방식 자동(H·R·S 수정을 즉시 반영해 재계산)
  const autoF = computeAutoEndingStock(row.stock, { Q, S, H, R }) ?? row.auto.F ?? null;
  const F = pick('F', autoF);
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

/** 합계행 — 엑셀 24행 범위 규칙: C/D/E/F/J 는 공제(23행) 포함, 나머지는 8~22행 */
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
