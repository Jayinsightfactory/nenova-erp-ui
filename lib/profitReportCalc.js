// 매출이익 보고서 계산 — 페이지/엑셀생성 공용 (DB 의존 없음, 클라이언트 안전)
// 엑셀 원본 수식 그대로: C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C
// 이스라엘·뉴질랜드·일본(variant 'noEnding'): I=E+G+H, J=C−I+F, K=J/(C+F)
export const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

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
  // E/F 자동 평가액은 참고값 전용(신뢰도 편차) — 계산에는 입력·저장값만
  const E = pick('E', null), F = pick('F', null);
  const H = pick('H', null), R = pick('R', null);
  const S = pick('S', row.auto.S || null);
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
