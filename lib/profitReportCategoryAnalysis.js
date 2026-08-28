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
import { CNF_CATEGORIES, isNonValueWeightItem, isNonInventoryCostItem } from './profitReportClassification.js';
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

/** 연간 전수 재고시차 스캔 — 2026년 모든 세부차수의 대표 재고 스냅샷에서 잔량 음수 품목을 찾는다.
 * 대표 스냅샷 선택은 latestStockSnapshotWeek(lib/profitReport.js)와 같은 기준:
 * 같은 세부차수에 스냅샷이 여러 개면 ProductStock 행 수 많은 것 → StockKey 큰 것.
 * (낡은/중복 스냅샷의 잔량을 실제 음수로 오인하지 않기 위함.)
 */
export async function loadYearNegativeStock(orderYear) {
  const result = await query(
    `WITH ranked AS (
       SELECT smk.StockKey, smk.OrderWeek,
              ROW_NUMBER() OVER (
                PARTITION BY smk.OrderWeek
                ORDER BY (SELECT COUNT(*) FROM ProductStock x WHERE x.StockKey = smk.StockKey) DESC,
                         smk.StockKey DESC
              ) AS rn
         FROM StockMaster smk
        WHERE smk.OrderYear = @yr
          AND CHARINDEX('-', smk.OrderWeek) > 0
          AND EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey = smk.StockKey)
     )
     SELECT r.OrderWeek, ps.ProdKey, ps.Stock AS EndStock,
            LTRIM(RTRIM(ISNULL(p.ProdName,N''))) AS ProductName,
            ${CASE_CATEGORY} AS Category
       FROM ranked r
       JOIN ProductStock ps ON ps.StockKey = r.StockKey
       LEFT JOIN Product p ON p.ProdKey = ps.ProdKey
      WHERE r.rn = 1
        AND ISNULL(ps.Stock, 0) < 0
      ORDER BY r.OrderWeek, ps.Stock ASC`,
    { yr: { type: sql.NVarChar, value: String(orderYear) } },
  );
  return (result.recordset || []).map((row) => ({
    orderWeek: row.OrderWeek,
    major: String(row.OrderWeek).split('-')[0],
    prodKey: Number(row.ProdKey),
    productName: row.ProductName || '',
    category: row.Category || null,
    endStock: n0(row.EndStock),
  }));
}

/** 연도 전체의 (대차수, ProdKey) 입고 존재 집합 — "다음 차수 입고 확인"을 한 번에 배치 조회. */
export async function loadYearArrivalMajors(orderYear) {
  const result = await query(
    `SELECT DISTINCT LEFT(wm.OrderWeek, CHARINDEX('-', wm.OrderWeek + '-') - 1) AS Major, wd.ProdKey
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
      WHERE ISNULL(wm.OrderYear,'') = @yr
        AND ISNULL(wm.isDeleted,0) = 0`,
    { yr: { type: sql.NVarChar, value: String(orderYear) } },
  );
  const set = new Set();
  for (const row of result.recordset || []) {
    set.add(`${String(row.Major).padStart(2, '0')}:${Number(row.ProdKey)}`);
  }
  return set;
}

/** 연간 재고 흐름 재구성 — 스냅샷 잔량에 의존하지 않고 (전차수 기말 + 입고 − 출고)를 직접 계산해
 * 음수가 나오는 (차수, 품목)을 전수 검출한다. 나중에 재고조정·재계산이 스냅샷의 음수를 지웠어도
 * 입출고 원장은 남아 있으므로 "조정으로 가려진 선판매"까지 잡힌다.
 * 모든 수량은 Product.OutUnit 기준(ps.Stock·wd.OutQuantity·sd.OutQuantity 동일 단위 — DB_STRUCTURE).
 * 출고는 보고서와 같은 확정 기준(sm.isFix=1, sd.isFix=1)만 집계한다.
 */
async function loadYearFlowMaps(orderYear) {
  const yr = { type: sql.NVarChar, value: String(orderYear) };
  const [arrivalsQ, shipmentsQ, snapshotsQ] = await Promise.all([
    query(
      `SELECT LEFT(wm.OrderWeek, CHARINDEX('-', wm.OrderWeek + '-') - 1) AS Major, wd.ProdKey,
              SUM(ISNULL(wd.OutQuantity, 0)) AS Qty
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
        WHERE ISNULL(wm.OrderYear,'') = @yr AND ISNULL(wm.isDeleted,0) = 0
        GROUP BY LEFT(wm.OrderWeek, CHARINDEX('-', wm.OrderWeek + '-') - 1), wd.ProdKey`,
      { yr },
    ),
    query(
      `SELECT LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) AS Major, sd.ProdKey,
              SUM(ISNULL(sd.OutQuantity, 0)) AS Qty
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
        WHERE ISNULL(sm.OrderYear,'') = @yr AND ISNULL(sm.isDeleted,0) = 0
          AND ISNULL(sm.isFix,0) = 1 AND ISNULL(sd.isFix,0) = 1
          AND ISNULL(sd.OutQuantity,0) <> 0
        GROUP BY LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1), sd.ProdKey`,
      { yr },
    ),
    query(
      // 세부차수별 대표 스냅샷(행수→StockKey) 중 대차수의 마지막 세부차수 = 그 주 기말.
      `WITH ranked AS (
         SELECT smk.StockKey, smk.OrderWeek,
                LEFT(smk.OrderWeek, CHARINDEX('-', smk.OrderWeek + '-') - 1) AS Major,
                TRY_CONVERT(INT, SUBSTRING(smk.OrderWeek, CHARINDEX('-', smk.OrderWeek) + 1, 10)) AS MinorNo,
                ROW_NUMBER() OVER (
                  PARTITION BY smk.OrderWeek
                  ORDER BY (SELECT COUNT(*) FROM ProductStock x WHERE x.StockKey = smk.StockKey) DESC,
                           smk.StockKey DESC
                ) AS rn
           FROM StockMaster smk
          WHERE smk.OrderYear = @yr AND CHARINDEX('-', smk.OrderWeek) > 0
            AND EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey = smk.StockKey)
       ), weekEnd AS (
         SELECT StockKey, Major,
                ROW_NUMBER() OVER (PARTITION BY Major ORDER BY MinorNo DESC, StockKey DESC) AS wrn
           FROM ranked WHERE rn = 1
       )
       SELECT w.Major, ps.ProdKey, ps.Stock
         FROM weekEnd w
         JOIN ProductStock ps ON ps.StockKey = w.StockKey
        WHERE w.wrn = 1`,
      { yr },
    ),
  ]);
  const toMap = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      const major = String(r.Major || '').padStart(2, '0');
      if (!/^\d+$/.test(String(r.Major || ''))) continue;
      if (!m.has(major)) m.set(major, new Map());
      m.get(major).set(Number(r.ProdKey), n0(r.Qty != null ? r.Qty : r.Stock));
    }
    return m;
  };
  return {
    arrivals: toMap(arrivalsQ.recordset),
    shipments: toMap(shipmentsQ.recordset),
    snapshots: toMap(snapshotsQ.recordset),
  };
}

/** 품명/카테고리 배치 조회 + 무게 placeholder·운송료성 품목 제외 필터. */
async function attachProductNames(rows) {
  if (!rows.length) return [];
  const keys = [...new Set(rows.map((f) => f.prodKey))];
  const nameByProd = new Map();
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    const params = {};
    const ph = chunk.map((k, j) => { params[`nk${j}`] = { type: sql.Int, value: k }; return `@nk${j}`; });
    const r = await query(
      `SELECT p.ProdKey, LTRIM(RTRIM(ISNULL(p.ProdName,N''))) AS ProdName, ${CASE_CATEGORY} AS Category
         FROM Product p WHERE p.ProdKey IN (${ph.join(',')})`,
      params,
    );
    for (const row of r.recordset || []) nameByProd.set(Number(row.ProdKey), { name: row.ProdName || '', category: row.Category || null });
  }
  return rows
    .map((f) => ({ ...f, productName: nameByProd.get(f.prodKey)?.name || `#${f.prodKey}`, category: nameByProd.get(f.prodKey)?.category || null }))
    .filter((f) => !isNonValueWeightItem(f.productName) && !isNonInventoryCostItem(f.productName));
}

export async function loadYearStockFlow(orderYear) {
  const { arrivals, shipments, snapshots } = await loadYearFlowMaps(orderYear);
  const majors = [...snapshots.keys()].sort((a, b) => Number(a) - Number(b));
  const flagged = [];
  for (let i = 1; i < majors.length; i += 1) {
    const prevMajor = majors[i - 1];
    const major = majors[i];
    if (Number(major) !== Number(prevMajor) + 1) continue; // 연속 차수만 체인(중간 결측 주는 재구성 불가)
    const begin = snapshots.get(prevMajor);
    const inW = arrivals.get(major) || new Map();
    const outW = shipments.get(major) || new Map();
    const endW = snapshots.get(major) || new Map();
    const prodKeys = new Set([...begin.keys(), ...inW.keys(), ...outW.keys()]);
    for (const prodKey of prodKeys) {
      const b = n0(begin.get(prodKey));
      const inc = n0(inW.get(prodKey));
      const out = n0(outW.get(prodKey));
      const implied = b + inc - out;
      if (implied >= -1e-6) continue;
      const snap = endW.has(prodKey) ? n0(endW.get(prodKey)) : null;
      const nextMajor = String(Number(major) + 1).padStart(2, '0');
      flagged.push({
        major, prodKey,
        begin: b, arrivals: inc, shipments: out,
        impliedEnd: Math.round(implied * 100) / 100,
        snapshotEnd: snap,
        adjustment: snap == null ? null : Math.round((snap - implied) * 100) / 100, // 스냅샷이 음수를 안 보이게 만든 보정량
        masked: snap != null && snap >= 0,
        nextWeekArrival: (arrivals.get(nextMajor) || new Map()).has(prodKey),
        nextMajor,
      });
    }
  }
  const named = await attachProductNames(flagged);
  return named.sort((a, b) => Number(a.major) - Number(b.major) || a.impliedEnd - b.impliedEnd);
}

/** 연간 재고 조정 원장 전수 — 음수 여부와 무관하게 모든 (차수, 품목)의
 * 조정량 = 기말 스냅샷 − (전차수 기말 + 입고 − 출고) 를 원장으로 뽑는다.
 * 양수 = 흐름에 없는 재고가 주입됨(선판매 가림·실사 보정·기록 누락 입고),
 * 음수 = 흐름상 있어야 할 재고가 증발(폐기·불량·기록 누락 출고).
 * 조정이 한 번 재고를 부풀리면 그 다음 주 선판매는 음수로 안 나타나므로,
 * 선판매의 전체 규모는 음수 검출이 아니라 이 원장의 양수 조정 누적으로 봐야 한다.
 */
export async function loadYearStockAdjustments(orderYear) {
  const { arrivals, shipments, snapshots } = await loadYearFlowMaps(orderYear);
  const majors = [...snapshots.keys()].sort((a, b) => Number(a) - Number(b));
  const rows = [];
  for (let i = 1; i < majors.length; i += 1) {
    const prevMajor = majors[i - 1];
    const major = majors[i];
    if (Number(major) !== Number(prevMajor) + 1) continue;
    const begin = snapshots.get(prevMajor);
    const inW = arrivals.get(major) || new Map();
    const outW = shipments.get(major) || new Map();
    const endW = snapshots.get(major) || new Map();
    const prodKeys = new Set([...begin.keys(), ...inW.keys(), ...outW.keys(), ...endW.keys()]);
    for (const prodKey of prodKeys) {
      const b = n0(begin.get(prodKey));
      const inc = n0(inW.get(prodKey));
      const out = n0(outW.get(prodKey));
      const snap = n0(endW.get(prodKey));
      const implied = b + inc - out;
      const adj = snap - implied;
      if (Math.abs(adj) <= 0.005) continue;
      rows.push({
        major, prodKey,
        begin: b, arrivals: inc, shipments: out,
        impliedEnd: Math.round(implied * 100) / 100,
        snapshotEnd: Math.round(snap * 100) / 100,
        adjustment: Math.round(adj * 100) / 100,
        kind: adj > 0 ? 'inject' : 'shrink',
        negativeFlow: implied < -1e-6,
      });
    }
  }
  const named = await attachProductNames(rows);
  return named.sort((a, b) => Number(a.major) - Number(b.major) || Math.abs(b.adjustment) - Math.abs(a.adjustment));
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
