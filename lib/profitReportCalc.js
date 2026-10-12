// 매출이익 보고서 계산 — 페이지/엑셀생성 공용 (DB 의존 없음, 클라이언트 안전)
// 엑셀 원본 수식 그대로: C=N+L+O, P=Q×R, T=S×R, G=P+T, I=E+G+H−F, J=C−I, K=J/C, M=−L/C
// 이스라엘·뉴질랜드·일본(variant 'noEnding'): I=E+G+H, J=C−I+F, K=J/(C+F)
import { EXTRA_CATEGORY } from './profitReportClassification.js';

export { EXTRA_CATEGORY } from './profitReportClassification.js';

export const n0 = v => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/** F 기말상품재고액 자동 — 원본 `재고잔량` 시트 공식 그대로(2026-08-12 업무규칙 확정):
 *
 *   F = Σ(품목별 기말 ProductStock 수량 × 품목별 재고평가단가) ÷ 1.1
 *
 * 원본 재고잔량 시트가 품목마다 `수량 × 가격`을 세로로 합산하고(O24=SUM(O7:O23)),
 * 그룹 합계를 공급가로 환산(O25=O24/1.1)한 것과 같다. 서버는 이 값을 `stock.tableF`로 이미
 * 품목 단위(WebStockPrice > 수국단가표 > Product.Cost 우선순위)로 집계해 넘겨준다.
 * 대차수의 **마지막 확정 세부차수** ProductStock 스냅샷이 수량의 단일 기준이다.
 *
 * ⚠️ 2026-08-12 결함수정: 이전 구현은 "(구매금액×환율 + 포워딩×환율 + 그외통관비) ÷ 매입총수량 ×
 * 기말수량"이라는 착륙원가 평균단가를 1순위로 썼다. 이 식은 원본 어느 시트에도 없고, 매입이 없는
 * 주(호주 등)나 카테고리 안에서 단위가 섞인 주에 크게 어긋났다(27차 F 오차 41.6%).
 * 이제 재고평가단가를 1순위로 쓰고, **품목별 평가단가를 하나도 찾지 못한 경우에만**
 * 최근 매입 외화단가(recentCost)×환율로 fallback 한다. 그마저 없으면 null(원천 누락)로 남겨
 * audit이 `needs_input`으로 표시하게 한다 — 값을 추정해 채우지 않는다.
 *
 * stock = { endQty: 기말재고수량, tableF: Σ(수량×평가단가÷1.1), recentCost: Σ(최근외화단가×수량) }
 * Q/S/H는 더 이상 F 계산에 쓰이지 않지만, 호출부 시그니처 호환과 R(fallback 환율)을 위해 유지한다. */
export function computeAutoEndingStock(stock, { R } = {}) {
  if (!stock) return null;
  const endQty = n0(stock.endQty);
  if (endQty <= 0) return null;
  if (stock.tableF != null && n0(stock.tableF) !== 0) return Number(stock.tableF);
  if (n0(stock.recentCost) > 0 && n0(R) > 0) return n0(stock.recentCost) * n0(R);
  return stock.tableF != null ? Number(stock.tableF) : null;
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

/** 매출비율(D) — row.C / totals.C. 분모(totals.C)는 공제 포함, `기타(미분류)` 제외(합계행 규칙과 동일).
 * 미분류 행 자체는 본표 비율을 만들지 않는다(audit-only 영역이라 분모에도 분자에도 넣지 않는다).
 * 합계가 0이면 빈칸(null). 화면(pages/sales/profit-report.js)과 엑셀 생성(lib/profitReportExcel.js)이
 * 이 함수 하나를 공유한다.
 * @param {{C:number}} rowCalc  computeProfitRow() 결과(행 1건)
 * @param {{C:number}} totals   computeProfitTotals() 결과
 * @param {string} [category]   행 카테고리 — 미분류면 null */
export function calcRevenueRatio(rowCalc, totals, category) {
  if (category === EXTRA_CATEGORY) return null;
  const totalC = n0(totals?.C);
  return totalC !== 0 ? n0(rowCalc?.C) / totalC : null;
}

/** 상품구매비율(U) — row.P / totals.P. 분모(totals.P)는 공제 행 제외(computeProfitTotals의 nonDeduct 합계라서
 * D와 분모가 다르다 — 원본 엑셀 그대로). 합계가 0이면 빈칸(null).
 * @param {{P:number}} rowCalc  computeProfitRow() 결과(행 1건)
 * @param {{P:number}} totals   computeProfitTotals() 결과 */
export function calcPurchaseRatio(rowCalc, totals, category) {
  if (category === EXTRA_CATEGORY) return null;
  const totalP = n0(totals?.P);
  return totalP !== 0 ? n0(rowCalc?.P) / totalP : null;
}

/** 합계행 — 원본 23행 SUM 범위 규칙 그대로.
 *   C/D/E/F/J : SUM(7:22) — 공제(22행) 포함
 *   G/H/I/L/N/O/P/Q/S/T : SUM(7:21) — 공제 제외
 *   K = J/(C+F), M = -(L/C)
 *
 * 2026-08-12 업무규칙: `기타(미분류)`는 원본 본표에 아예 없는 행이다. 검증 목록과 비고에는
 * 표시하되 **공식 본표 합계(C/D/I/J/K를 포함한 모든 열)에는 넣지 않는다**. 미분류를 정식
 * 카테고리로 자동 합산하지 않으며, 분류를 고칠 때까지 별도 audit-only 영역으로만 남긴다.
 * 화면 합계와 엑셀 export 합계가 이 함수 하나를 공유하므로 두 값은 항상 같다. */
export function computeProfitTotals(rowsWithCalc) {
  const rows = (rowsWithCalc || []).filter(r => r.category !== EXTRA_CATEGORY);
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
