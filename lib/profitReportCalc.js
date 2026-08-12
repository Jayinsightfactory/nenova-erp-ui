// 매출이익 보고서 계산 — 페이지/엑셀생성 공용 (DB 의존 없음, 클라이언트 안전)
// 엑셀 원본 수식 그대로: C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C
// 이스라엘·뉴질랜드·일본(variant 'noEnding'): I=E+G+H, J=C−I+F, K=J/(C+F)
export const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/**
 * F 기말상품재고액 자동값.
 *
 * ## 2026-08-12 원천 정정 (사용자 확정 업무 규칙)
 * F는 **선택 대차수의 마지막 확정 세부차수 ProductStock 수량 × 품목별 재고평가단가의 합계**다.
 * 즉 1순위는 `stock.tableF`(lib/profitReport.js stockSnapshotByCategory가 품목 단위로
 * `ProductStock.Stock × 환산 × 적용단가 ÷ 1.1`을 합산한 값)이며, 원본 엑셀 `재고잔량` 시트의
 * 단순 총합을 그대로 옮겨 적는 방식이 아니다 — 그 시트에는 수동정정·오입력 흔적이 있다
 * (예: 27차 카네이션 기말 단가가 11,000이 아니라 110,000으로 10배 입력되어 있다).
 *
 * 이전 구현은 "landed cost 평균단가 × 기말수량"(매입금액+포워딩+통관비 ÷ 매입총수량)을 1순위로 썼는데,
 * 이는 그 차수에 매입이 있는 카테고리에서만 성립하고 재고평가단가와 무관한 값이라 원천이 다르다.
 * 이제 그 계산은 **재고평가단가를 구할 수 없을 때만** 쓰는 2순위 폴백으로 내린다.
 *
 * 우선순위
 *   1. 재고평가단가 기반 평가액(tableF)                — 정상 경로
 *   2. 품목별 최근 매입 외화단가 × 기말수량 × 환율      — 평가단가가 전혀 없을 때
 *   3. landed cost 평균단가 × 기말수량                 — 위 둘 다 없고 이번 차수 매입이 있을 때
 * 어느 것도 없으면 null(=원천 없음)이며 audit이 needs_input으로 표시한다.
 *
 * stock = { purchQty, endQty, recentCost, tableF, unitMismatch }
 * unitMismatch: 카테고리 안에서 매입수량 단위(박스)와 기말재고 단위(단/송이)가 섞이면 3순위
 * (category 평균단가) 자체가 단위가 안 맞는 나눗셈이라 무효다 — 그 카테고리는 3순위를 건너뛴다.
 */
export function computeAutoEndingStock(stock, { Q, S, H, R }) {
  if (!stock) return null;
  const endQty = n0(stock.endQty);
  if (endQty <= 0) return null;
  if (stock.tableF != null && Number(stock.tableF) !== 0) return Number(stock.tableF);
  if (n0(stock.recentCost) > 0 && n0(R) > 0) return n0(stock.recentCost) * n0(R);
  const purchQty = n0(stock.purchQty);
  const landedWon = n0(Q) * n0(R) + n0(S) * n0(R) + n0(H); // 매입원화 + 포워딩원화 + 그외통관비
  if (!stock.unitMismatch && purchQty > 0 && landedWon > 0) return (landedWon / purchQty) * endQty;
  return stock.tableF != null ? Number(stock.tableF) : null;
}

/** 위 우선순위 중 실제로 채택된 단계 — 화면·감사에 "무엇으로 계산했는지"를 그대로 표시한다. */
export function endingStockSourceKind(stock, { Q, S, H, R }) {
  if (!stock || n0(stock.endQty) <= 0) return 'no_stock';
  if (stock.tableF != null && Number(stock.tableF) !== 0) return 'stock_price_table';
  if (n0(stock.recentCost) > 0 && n0(R) > 0) return 'recent_purchase_cost';
  const landedWon = n0(Q) * n0(R) + n0(S) * n0(R) + n0(H);
  if (!stock.unitMismatch && n0(stock.purchQty) > 0 && landedWon > 0) return 'landed_cost_average';
  return 'missing';
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
