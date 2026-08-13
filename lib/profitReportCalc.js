// 매출이익 보고서 계산 — 페이지/엑셀생성 공용 (DB 의존 없음, 클라이언트 안전)
// 엑셀 원본 수식 그대로: C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C
// 이스라엘·뉴질랜드·일본(variant 'noEnding'): I=E+G+H, J=C−I+F, K=J/(C+F)
export const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/** E/F는 확정 ProductStock 수량과 동일 스냅샷의 VERIFIED 단가 근거만 사용한다. */
export function computeAutoEndingStock(stock) {
  if (!stock) return null;
  const endQty = n0(stock.endQty);
  if (endQty === 0 && stock.snapshotConfirmed === true) return 0;
  if (stock.snapshotConfirmed !== true || stock.priceEvidenceStatus !== 'VERIFIED') return null;
  return stock.evidenceValue == null ? null : Number(stock.evidenceValue);
}

/** 화면·감사에 채택된 재고 원천 또는 누락 원인을 그대로 표시한다. */
export function endingStockSourceKind(stock) {
  if (!stock || stock.snapshotConfirmed !== true) return 'missing_stock_snapshot';
  if (n0(stock.endQty) === 0) return 'no_stock';
  if (stock.priceEvidenceStatus !== 'VERIFIED' || stock.evidenceValue == null) return 'missing_price_evidence';
  return 'verified_product_stock_price';
}

export function computeProfitRow(row, edits = {}) {
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
  // E/F 최종값은 서버가 검증한 ProductStock+시점단가 결과만 허용한다.
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

/** 매출비율(D) — row.C / totals.C. 분모(totals.C)는 공제를 포함하고 기타(미분류)는 제외한다
 * (원본 엑셀 본표에는 미분류 행 자체가 없다 — computeProfitTotals 주석 참고).
 * 합계가 0이면 빈칸(null). pages/sales/profit-report.js 화면과 lib/profitReportExcel.js 엑셀 생성이
 * 각자 중복 계산하던 걸 공용화(2026-08-11 결함수정 5) — 계산식 자체는 바꾸지 않았다.
 * @param {{C:number}} rowCalc  computeProfitRow() 결과(행 1건)
 * @param {{C:number}} totals   computeProfitTotals() 결과 */
export function calcRevenueRatio(rowCalc, totals) {
  const totalC = n0(totals?.C);
  return totalC !== 0 ? n0(rowCalc?.C) / totalC : null;
}

/** 상품구매비율(U) — row.P / totals.P. 분모(totals.P)는 공제 행 제외(computeProfitTotals의 nonDeduct 합계라서
 * D와 분모가 다르다 — 원본 엑셀 그대로). 합계가 0이면 빈칸(null).
 * @param {{P:number}} rowCalc  computeProfitRow() 결과(행 1건)
 * @param {{P:number}} totals   computeProfitTotals() 결과 */
export function calcPurchaseRatio(rowCalc, totals) {
  const totalP = n0(totals?.P);
  return totalP !== 0 ? n0(rowCalc?.P) / totalP : null;
}

/** 본표 합계에서 제외하는 행 — 원본 엑셀 본표(7~22행)에는 이 행 자체가 없다.
 * 화면·엑셀 모두 별도 검증 영역과 비고에만 표시하고, C/D/E/F/I/J/K 어느 합계에도 넣지 않는다.
 * 자동으로 정식 카테고리에 합산하지도 않는다 — 품목 분류를 고쳐야 사라지는 audit 대상이다. */
export const TOTALS_EXCLUDED_CATEGORIES = ['기타(미분류)'];

// 원본 엑셀 합계행 U24는 SUM(U7:U20)이다. 따라서 공제(22행)는 물론
// 베트남(21행)도 합계 표시에서 제외하지만, 분모 P24에는 베트남 구매액이 포함된다.
// 이 비대칭 범위까지 원본 수식을 그대로 재현한다.
export const PURCHASE_RATIO_TOTAL_EXCLUDED_CATEGORIES = ['공제', '베트남', ...TOTALS_EXCLUDED_CATEGORIES];

/**
 * 합계행 — 원본 엑셀 23행(본표 합계) 범위 규칙 그대로.
 *   · C / D / E / F / J : 공제(22행) **포함**   → SUM(x7:x22)
 *   · G/H/I/L/N/O/P/Q/S/T : 공제 **제외**       → SUM(x7:x21)
 *   · K 합계는 행 공식과 달리 항상 J/(C+F), M 합계는 -L/C
 * 기타(미분류)는 원본 본표에 없는 웹 전용 audit 행이라 모든 합계에서 제외한다(2026-08-12).
 */
export function computeProfitTotals(rowsWithCalc) {
  const rows = (rowsWithCalc || []).filter(r => !TOTALS_EXCLUDED_CATEGORIES.includes(r.category));
  const nonDeduct = rows.filter(r => r.category !== '공제');
  const purchaseRatioRows = rows.filter(r => !PURCHASE_RATIO_TOTAL_EXCLUDED_CATEGORIES.includes(r.category));
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
  totals.D = totals.C !== 0 ? 1 : null;
  totals.U = totals.P !== 0 ? sum(c => c.P, purchaseRatioRows) / totals.P : null;
  return totals;
}
