// lib/profitReportCategoryAnalysis.js — 매출이익 보고서 "원인분석 탭"의 카테고리(품종)별 근거 수집.
//
// 읽기 전용(SELECT만) — __tests__/profitReportAnalysisGetReadOnlyDdl.test.js 감시 대상.
// 역할 분리: SQL 로더(재고 시차·다음차수 입고 확인)와 순수 계산(buildCategoryEvidence)만 담고,
// 주차 원장 로드(loadWeeklyReportPayload)와 LLM 호출은 API 레이어가 한다.
//
// "재고 시차" 정의(사장님 사례): 34차에 기초3+입고2인데 6이 출고 → 기말 잔량이 음수(-1) =
// 35차에 입고된 물건을 34차에 미리 판매. 전산 usp_StockCalculation이 계산해 둔
// ProductStock.Stock(기말 스냅샷 잔량)이 음수인 품목이 정확히 이 케이스라, 우리가 수식을
// 재발명하지 않고 전산 잔량을 그대로 읽는다(전산이 정답 원칙).
import { query, sql } from './db.js';
import { buildProfitReportCategorySql } from './profitReportCountryResolver.js';
import { CNF_CATEGORIES } from './profitReportClassification.js';
import { explainDrivers } from './profitReportDriverExplanation.js';

const CASE_CATEGORY = buildProfitReportCategorySql('p');
const n = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/** 기말 스냅샷(StockKey)에서 잔량이 음수인 품목 — 다음 차수 입고 선판매(재고 시차) 후보.
 * @param {number|string} endStockKey  이번 차수 기말 재고 스냅샷 StockKey (payload.stockWeeks.endStockKey)
 * @returns {Promise<Array<{prodKey:number, productName:string, category:string, endStock:number}>>}
 */
export async function loadNegativeEndStock(endStockKey) {
  if (endStockKey == null) return [];
  const result = await query(
    `SELECT ps.ProdKey, LTRIM(RTRIM(ISNULL(p.ProdName,N''))) AS ProductName,
            ${CASE_CATEGORY} AS Category, ps.Stock AS EndStock
       FROM ProductStock ps
       LEFT JOIN Product p ON p.ProdKey = ps.ProdKey
      WHERE ps.StockKey = @stockKey
        AND ISNULL(ps.Stock, 0) < 0
      ORDER BY ps.Stock ASC`,
    { stockKey: { type: sql.Int, value: Number(endStockKey) } },
  );
  return (result.recordset || []).map((row) => ({
    prodKey: Number(row.ProdKey),
    productName: row.ProductName || '',
    category: row.Category || null,
    endStock: n0(row.EndStock),
  }));
}

/** 지정 품목들이 다음 차수(orderYear/nextMajor)에 입고됐는지 확인 — "35차 입고분 선판매" 서술 근거.
 * @returns {Promise<Set<number>>} 다음 차수에 입고가 있는 ProdKey 집합
 */
export async function loadNextWeekArrivalProdKeys(orderYear, nextMajor, prodKeys) {
  const keys = [...new Set((prodKeys || []).map((k) => Number(k)).filter((k) => Number.isFinite(k) && k > 0))];
  if (!keys.length) return new Set();
  const params = {
    pfx: { type: sql.NVarChar, value: `${nextMajor}-%` },
    yr: { type: sql.NVarChar, value: String(orderYear) },
  };
  const placeholders = keys.map((k, i) => {
    params[`ak${i}`] = { type: sql.Int, value: k };
    return `@ak${i}`;
  });
  const result = await query(
    `SELECT DISTINCT wd.ProdKey
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
      WHERE wm.OrderWeek LIKE @pfx
        AND ISNULL(wm.OrderYear,'') = @yr
        AND ISNULL(wm.isDeleted,0) = 0
        AND wd.ProdKey IN (${placeholders.join(',')})`,
    params,
  );
  return new Set((result.recordset || []).map((row) => Number(row.ProdKey)));
}

const asCalc = (row) => row?.calc || {};

/**
 * 카테고리별 원인 근거팩(순수 계산) — 화면 카드와 LLM 프롬프트가 같은 값을 쓴다.
 * @param {object} args
 * @param {Array}  args.currentRows   이번 차수 rows (각 row에 calc 포함 — 확정이면 저장 calc)
 * @param {Array}  args.prevRows      직전 차수 rows (calc 포함)
 * @param {Array}  args.currentSales  loadCustomerProductSales(withCategory:true) 이번 차수
 * @param {Array}  args.prevSales     같은 로더 직전 차수
 * @param {Array}  args.priceDrops    detectPriceDecreaseCandidates 결과
 * @param {Array}  args.mixCandidates detectLowPriceCustomerMixCandidates 결과
 * @param {Array}  args.stockLag      loadNegativeEndStock 결과(+nextWeekArrival 표시 후)
 */
export function buildCategoryEvidence({ currentRows = [], prevRows = [], currentSales = [], prevSales = [], priceDrops = [], mixCandidates = [], stockLag = [] }) {
  const prevByCat = new Map(prevRows.map((r) => [r.category, r]));
  // prodKey→카테고리 맵 — 거래처 단가/믹스 후보를 카테고리 카드에 귀속시킨다.
  const catByProd = new Map();
  for (const s of [...currentSales, ...prevSales]) {
    if (s.category && !catByProd.has(s.prodKey)) catByProd.set(s.prodKey, s.category);
  }
  const dropsByCat = groupBy(priceDrops, (d) => catByProd.get(d.prodKey) || null);
  const mixByCat = groupBy(mixCandidates, (d) => catByProd.get(d.prodKey) || null);
  const lagByCat = groupBy(stockLag, (d) => d.category || null);
  const salesByCat = groupBy(currentSales, (s) => s.category || null);

  const categories = currentRows
    .filter((row) => row.category && row.category !== '기타(미분류)')
    .map((row) => {
      const cur = asCalc(row);
      const prevRow = prevByCat.get(row.category);
      const prev = asCalc(prevRow);
      const drivers = explainDrivers(
        { C: cur.C, E: cur.E, F: cur.F, P: cur.P, H: cur.H, T: cur.T },
        { C: prev.C, E: prev.E, F: prev.F, P: prev.P, H: prev.H, T: prev.T },
      );
      // 환율 효과: 외화(구매 Q + 포워딩 S) × (이번 R − 직전 R). R이 없으면 null.
      const rCur = n(cur.R);
      const rPrev = n(prev.R);
      const fx = n0(cur.Q) + n0(cur.S);
      const rateEffect = rCur != null && rPrev != null ? -(fx * (rCur - rPrev)) : null; // 환율 상승 = 비용 증가 = 이익 감소(음수)
      // 카테고리 안 거래처별 단가 스프레드(부가세 포함 분배단가 가중평균 대비) — "주광·태림" 케이스 원자료.
      const custRows = (salesByCat.get(row.category) || []).filter((s) => s.vatInclusiveUnitPrice != null);
      const totalAmount = custRows.reduce((sum, s) => sum + n0(s.amount), 0);
      const byCust = new Map();
      for (const s of custRows) {
        const cu = byCust.get(s.custKey) || { custName: s.custName, amount: 0, estQty: 0, gross: 0 };
        cu.amount += n0(s.amount);
        cu.estQty += n0(s.estQty);
        cu.gross += n0(s.amount) + n0(s.vat);
        byCust.set(s.custKey, cu);
      }
      const catAvgPrice = (() => {
        const est = custRows.reduce((sum, s) => sum + n0(s.estQty), 0);
        const gross = custRows.reduce((sum, s) => sum + n0(s.amount) + n0(s.vat), 0);
        return est ? gross / est : null;
      })();
      const customerPrices = [...byCust.values()]
        .filter((cu) => cu.estQty > 0)
        .map((cu) => ({
          custName: cu.custName,
          unitPrice: cu.gross / cu.estQty,
          amountShare: totalAmount ? cu.amount / totalAmount : null,
          vsCategoryAvgPct: catAvgPrice ? (cu.gross / cu.estQty) / catAvgPrice - 1 : null,
        }))
        .sort((a, b) => (a.vsCategoryAvgPct ?? 0) - (b.vsCategoryAvgPct ?? 0))
        .slice(0, 8);
      return {
        category: row.category,
        cnf: CNF_CATEGORIES.includes(row.category),
        K: n(cur.K),
        prevK: n(prev.K),
        J: n(cur.J),
        C: n(cur.C),
        drivers: drivers.filter((d) => d.delta != null),
        rate: { current: rCur, prev: rPrev, effect: rateEffect },
        customerPrices,
        priceDrops: (dropsByCat.get(row.category) || []).slice(0, 10),
        mixCandidates: (mixByCat.get(row.category) || []).slice(0, 10),
        stockLag: (lagByCat.get(row.category) || []).slice(0, 15),
      };
    })
    .sort((a, b) => (a.K ?? 1) - (b.K ?? 1)); // 이익률 낮은(문제) 카테고리 먼저
  return categories;
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list || []) {
    const key = keyFn(item);
    if (key == null) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
