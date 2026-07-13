// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 구조.
// nenova.exe DB 에서 자동으로 채울 수 있는 열(N순수매출·L불량·O그외매출·Q구매외화·S포워딩·R환율기본)은 SQL 로,
// 수기 열(E기초재고·F기말재고·H그외통관비·R환율수정·비고)은 웹 전용 테이블에 저장한다.
import { query, sql } from './db';

// 엑셀 8~23행 품명 순서 그대로
export const CATEGORIES = [
  { key: '콜롬비아 수국', coun: '콜롬비아', flower: /수국/ },
  { key: '콜롬비아 카네이션', coun: '콜롬비아', flower: /카네이션/ },
  { key: '콜롬비아 장미', coun: '콜롬비아', flower: /장미/ },
  { key: '콜롬비아 루스커스', coun: '콜롬비아', flower: /루스커스/ },
  { key: '콜롬비아 알스트로', coun: '콜롬비아', flower: /알스트로/ },
  { key: '네덜란드', coun: '네덜란드' },
  { key: '호주', coun: '호주' },
  { key: '태국', coun: '태국' },
  { key: '중국', coun: '중국' },
  { key: '에콰도르', coun: '에콰도르' },
  { key: '미국', coun: '미국' },
  { key: '이스라엘', coun: '이스라엘', variant: 'noEnding' },
  { key: '뉴질랜드', coun: '뉴질랜드', variant: 'noEnding' },
  { key: '일본', coun: '일본', variant: 'noEnding' },
  { key: '베트남', coun: '베트남' },
  { key: '공제', manualOnly: true },
];
export const EXTRA_CATEGORY = '기타(미분류)'; // 어떤 행에도 못 들어간 품목 — 유실 방지용 표시 행

export function classifyCategory(counName, flowerName) {
  const coun = String(counName || '');
  const flower = String(flowerName || '');
  for (const c of CATEGORIES) {
    if (c.manualOnly) continue;
    if (!coun.includes(c.coun)) continue;
    if (c.flower && !c.flower.test(flower)) continue;
    return c.key;
  }
  return EXTRA_CATEGORY;
}

// ── 수기값 저장 테이블 (웹 전용, idempotent)
let _ensured = null;
export async function ensureProfitReportTable() {
  if (_ensured) return _ensured;
  _ensured = query(
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebProfitReport')
     BEGIN
       CREATE TABLE WebProfitReport (
         AutoKey INT IDENTITY(1,1) PRIMARY KEY,
         OrderYear NVARCHAR(4) NOT NULL,
         MajorWeek NVARCHAR(4) NOT NULL,
         Category NVARCHAR(60) NOT NULL,   -- 품명 행 또는 '_note'
         ColKey NVARCHAR(20) NOT NULL,     -- E/F/H/R/S/note
         Value FLOAT NULL,
         TextValue NVARCHAR(2000) NULL,
         UpdatedBy NVARCHAR(50),
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
       CREATE UNIQUE INDEX UX_WebProfitReport ON WebProfitReport(OrderYear, MajorWeek, Category, ColKey);
     END`,
    {}
  );
  return _ensured;
}

const CASE_CATEGORY = `
  CASE
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%수국%' THEN N'콜롬비아 수국'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%카네이션%' THEN N'콜롬비아 카네이션'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%장미%' THEN N'콜롬비아 장미'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%루스커스%' THEN N'콜롬비아 루스커스'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%알스트로%' THEN N'콜롬비아 알스트로'
    WHEN ISNULL(p.CounName,'') LIKE N'%네덜란드%' THEN N'네덜란드'
    WHEN ISNULL(p.CounName,'') LIKE N'%호주%' THEN N'호주'
    WHEN ISNULL(p.CounName,'') LIKE N'%태국%' THEN N'태국'
    WHEN ISNULL(p.CounName,'') LIKE N'%중국%' THEN N'중국'
    WHEN ISNULL(p.CounName,'') LIKE N'%에콰도르%' THEN N'에콰도르'
    WHEN ISNULL(p.CounName,'') LIKE N'%미국%' THEN N'미국'
    WHEN ISNULL(p.CounName,'') LIKE N'%이스라엘%' THEN N'이스라엘'
    WHEN ISNULL(p.CounName,'') LIKE N'%뉴질랜드%' THEN N'뉴질랜드'
    WHEN ISNULL(p.CounName,'') LIKE N'%일본%' THEN N'일본'
    WHEN ISNULL(p.CounName,'') LIKE N'%베트남%' THEN N'베트남'
    ELSE N'기타(미분류)'
  END`;

/** N 순수매출액 — 판매현황(공급가액) 국가별. 엑셀 판매현황!E(공급가액) SUMIF 와 동일 기준 */
export async function salesByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(ISNULL(sd.Amount,0)) AS v
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
      WHERE sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sd.OutQuantity,0) <> 0
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${orderYear}${major}` } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)]));
}

/** L 불량금액 / O 그외매출액 — Estimate 를 불량차감 vs 나머지(검역·취소·단가·부족·중복·출하오류·샘플·판매요청)로 분리 */
export async function estimateByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category,
            CASE WHEN ci.Descr2 = N'불량차감' THEN N'L' ELSE N'O' END AS Col,
            SUM(ISNULL(e.Amount,0)) AS v
       FROM Estimate e
       JOIN ShipmentMaster sm ON e.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Product p ON e.ProdKey=p.ProdKey
       LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
      WHERE sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw AND ISNULL(sm.isDeleted,0)=0
      GROUP BY ${CASE_CATEGORY}, CASE WHEN ci.Descr2 = N'불량차감' THEN N'L' ELSE N'O' END`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${orderYear}${major}` } }
  );
  const L = {}; const O = {};
  for (const x of r.recordset) {
    if (x.Col === 'L') L[x.Category] = (L[x.Category] || 0) + Number(x.v);
    else O[x.Category] = (O[x.Category] || 0) + Number(x.v);
  }
  return { L, O };
}

/** Q 구매금액(외화) — 입고(WarehouseDetail.TPrice=외화총액) 국가별 */
export async function purchaseByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(ISNULL(wd.TPrice,0)) AS v
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)]));
}

/** S 포워딩(USD 추정) — BILL(WarehouseMaster) CW×운임률 + DocFee 를 그 BILL 품목 구성비로 국가별 배분 */
export async function forwardingByCategory(major, orderYear) {
  const r = await query(
    `WITH bill AS (
       SELECT wm.WarehouseKey,
              (ISNULL(wm.ChargeableWeight,0) * ISNULL(wm.FreightRateUSD,0) + ISNULL(wm.DocFeeUSD,0)) AS billUsd
         FROM WarehouseMaster wm
        WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
     ), alloc AS (
       SELECT b.WarehouseKey, b.billUsd, wd.ProdKey, ISNULL(wd.TPrice,0) AS tp,
              SUM(ISNULL(wd.TPrice,0)) OVER (PARTITION BY b.WarehouseKey) AS billTp
         FROM bill b JOIN WarehouseDetail wd ON wd.WarehouseKey=b.WarehouseKey
     )
     SELECT ${CASE_CATEGORY} AS Category,
            SUM(CASE WHEN a.billTp > 0 THEN a.billUsd * a.tp / a.billTp ELSE 0 END) AS v
       FROM alloc a LEFT JOIN Product p ON a.ProdKey=p.ProdKey
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)]));
}

// ── 재고 평가단가표 (웹 전용) — 품목별 지정단가. 지정 > 수국단가표 > Product.Cost 순으로 적용.
let _spEnsured = null;
export async function ensureStockPriceTable() {
  if (_spEnsured) return _spEnsured;
  _spEnsured = query(
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebStockPrice')
     BEGIN
       CREATE TABLE WebStockPrice (
         ProdKey INT PRIMARY KEY,
         Price FLOAT NOT NULL,
         UpdatedBy NVARCHAR(50),
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
     END`,
    {}
  );
  return _spEnsured;
}

// 지정단가 → 수국단가표(사장님 지정) → Product.Cost
const APPLIED_PRICE_EXPR = `
  CASE WHEN sp.Price IS NOT NULL THEN sp.Price
       WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%수국%' THEN
         CASE
           WHEN p.ProdName LIKE N'%White%' OR p.ProdName LIKE N'%화이트%' THEN 2600
           WHEN p.ProdName LIKE N'%Blue%' OR p.ProdName LIKE N'%블루%' THEN 2700
           WHEN p.ProdName LIKE N'%Esmeral%' OR p.ProdName LIKE N'%그린%' OR p.ProdName LIKE N'%S/GN%' OR p.ProdName LIKE N'%Green%' THEN 3100
           WHEN p.ProdName LIKE N'%모히또%' OR p.ProdName LIKE N'%Mojito%' THEN 2250
           WHEN p.ProdName LIKE N'%골드피치%' OR p.ProdName LIKE N'%Gold%' THEN 3200
           WHEN p.ProdName LIKE N'%노랑%' OR p.ProdName LIKE N'%Yellow%' THEN 3200
           WHEN p.ProdName LIKE N'%S.PK%' OR p.ProdName LIKE N'%스페셜%' THEN 3200
           ELSE 3300
         END
       ELSE ISNULL(p.Cost,0) END`;
const APPLIED_SOURCE_EXPR = `
  CASE WHEN sp.Price IS NOT NULL THEN N'지정'
       WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%수국%' THEN N'수국표'
       ELSE N'Cost' END`;

// 재고 1박스당 금액단위 수량 — 송이(SteamOf1Box) > 단(BunchOf1Box) > 박스(1) 우선
const STOCK_UNIT_PER_BOX_EXPR = `
  CASE WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box
       WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box
       ELSE 1 END`;

// 입고 라인의 금액단위 수량 — 이카운트 구매현황 "수량"(D열)과 같은 기준.
// 26차 실측: EstQuantity(전표 금액기준 수량)가 엑셀 D열과 일치(수국 23,090·알스트로 3,200·에콰도르 1,400·베트남 1,600·루스커스 675 완전일치).
// EstQuantity 가 0인 행은 단(Bunch)→송이(Steam)→박스 순 fallback. 분모(매입수량)와 재고수량이 같은 기준이면 비율은 단위 무관.
const WD_UNIT_QTY_EXPR = `
  CASE WHEN ISNULL(wd.EstQuantity,0) > 0 THEN wd.EstQuantity
       WHEN ISNULL(wd.BunchQuantity,0) > 0 THEN wd.BunchQuantity
       WHEN ISNULL(wd.SteamQuantity,0) > 0 THEN wd.SteamQuantity
       ELSE ISNULL(wd.BoxQuantity,0) END`;

/** 이번 차수 매입 총수량(송이/단 단위) — 엑셀 F열 공식의 분모. purchaseByCategory 와 동일 필터 */
export async function purchaseQtyByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(${WD_UNIT_QTY_EXPR}) AS q
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.q)]));
}

/** 재고단가표 편집용 — 기초/기말 스냅샷에 재고가 있는 품목 목록 + 적용단가 */
export async function stockPriceRows(major, prevMajor, orderYear) {
  await ensureStockPriceTable();
  const wkOf = async (mj) => {
    const r = await query(
      `SELECT TOP 1 OrderWeek FROM StockMaster WHERE OrderYear=@yr AND OrderWeek LIKE @pfx ORDER BY OrderWeek DESC`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, pfx: { type: sql.NVarChar, value: `${mj}-%` } }
    );
    return r.recordset[0]?.OrderWeek || null;
  };
  const [endWeek, beginWeek] = await Promise.all([wkOf(major), wkOf(prevMajor)]);
  if (!endWeek && !beginWeek) return { beginWeek, endWeek, rows: [] };
  const weeks = [beginWeek, endWeek].filter(Boolean);
  const r = await query(
    `SELECT p.ProdKey, p.ProdName, ${CASE_CATEGORY} AS Category,
            CASE WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box
                 WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box ELSE 1 END AS UnitPerBox,
            ISNULL(p.Cost,0) AS Cost, sp.Price AS SetPrice,
            ${APPLIED_PRICE_EXPR} AS AppliedPrice,
            ${APPLIED_SOURCE_EXPR} AS AppliedSource,
            SUM(CASE WHEN smk.OrderWeek = @beginWeek THEN ps.Stock ELSE 0 END) AS StockBegin,
            SUM(CASE WHEN smk.OrderWeek = @endWeek THEN ps.Stock ELSE 0 END) AS StockEnd
       FROM ProductStock ps
       JOIN StockMaster smk ON ps.StockKey=smk.StockKey
       JOIN Product p ON ps.ProdKey=p.ProdKey
       LEFT JOIN WebStockPrice sp ON sp.ProdKey=p.ProdKey
      WHERE smk.OrderYear=@yr AND smk.OrderWeek IN (${weeks.map((_, i) => `@w${i}`).join(',')})
        AND ISNULL(ps.Stock,0) > 0
      GROUP BY p.ProdKey, p.ProdName, p.CounName, p.FlowerName, p.SteamOf1Box, p.BunchOf1Box, p.Cost, sp.Price
      ORDER BY 3, p.ProdName`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) },
      beginWeek: { type: sql.NVarChar, value: beginWeek || '' },
      endWeek: { type: sql.NVarChar, value: endWeek || '' },
      ...Object.fromEntries(weeks.map((w, i) => [`w${i}`, { type: sql.NVarChar, value: w }])),
    }
  );
  return { beginWeek, endWeek, rows: r.recordset };
}

/** 재고단가 저장 — { prodKey: price(null=지정 해제) } */
export async function saveStockPrices(prices, actor) {
  await ensureStockPriceTable();
  for (const [prodKey, price] of Object.entries(prices || {})) {
    const pk = Number(prodKey);
    if (!pk) continue;
    if (price == null || price === '') {
      await query(`DELETE FROM WebStockPrice WHERE ProdKey=@pk`, { pk: { type: sql.Int, value: pk } });
    } else {
      await query(
        `MERGE WebStockPrice AS t USING (SELECT @pk AS ProdKey) AS s ON t.ProdKey=s.ProdKey
         WHEN MATCHED THEN UPDATE SET Price=@price, UpdatedBy=@actor, UpdatedAt=GETDATE()
         WHEN NOT MATCHED THEN INSERT (ProdKey, Price, UpdatedBy) VALUES (@pk, @price, @actor);`,
        {
          pk: { type: sql.Int, value: pk },
          price: { type: sql.Float, value: Number(price) },
          actor: { type: sql.NVarChar, value: actor || 'user' },
        }
      );
    }
  }
}

/** 차수말 재고 스냅샷 집계 — 엑셀 F열 공식의 재료(수량·최근매입원가)와 단가표 평가액을 한 번에.
 * 해당 대차수의 마지막 세부차수(…-02 없으면 -01) 스냅샷을 그 차수의 "기말"로 본다.
 * 반환: { week, qtys: 재고수량(송이/단), recentCost: Σ(최근 매입 외화단가×수량), values: 단가표 평가(÷1.1, 최후 fallback) }
 *
 * 2026-07-10: ProductStock.Stock 스냅샷 드리프트 대응 — 실제 입출고 흐름과 무관하게 옛 수치를
 * 그대로 들고 있거나(예: 매입 0인데 재고 그대로) 설명 안 되는 값이 끼어드는 카테고리가 감사에서 다수
 * 확인됨(호주·베트남·콜롬비아 장미 등). isFix IN (1,2)(전산 확정 또는 차수피벗 "시작재고" 사용자 입력)
 * 앵커가 있는 품목은 그 앵커 이후 입고−출고(+StockHistory 조정)를 그대로 더해 실시간 계산값을 쓰고,
 * 앵커가 없는 품목은 기존처럼 ps.Stock 스냅샷을 그대로 쓴다(회귀 없음).
 * ⚠️ 2026-07-10 기준 isFix=1/2 가 실사용된 적이 전혀 없어 앵커가 0건 — 차수피벗에서 실사 후
 * "시작재고"를 입력하기 전까지는 이 함수의 출력이 기존과 동일하다. */
export async function stockSnapshotByCategory(major, orderYear) {
  const wk = await query(
    `SELECT TOP 1 OrderWeek FROM StockMaster
      WHERE OrderYear=@yr AND OrderWeek LIKE @pfx
      ORDER BY OrderWeek DESC`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, pfx: { type: sql.NVarChar, value: `${major}-%` } }
  );
  const week = wk.recordset[0]?.OrderWeek;
  if (!week) return { week: null, values: {}, qtys: {}, recentCost: {}, anchored: {} };
  await ensureStockPriceTable();
  // 단가표 우선순위: 웹 단가표(WebStockPrice 지정) > 수국단가표 > Product.Cost
  // 최근 매입 외화단가/박스당수량: 품목별 가장 최근 입고 라인 (WarehouseDetail 엔 isDeleted 없음 — wm 만 필터)
  // 재고수량 환산: 실제 전표의 박스당 금액단위수량(lc.UnitPerBox) 우선 — 매입수량 분모와 같은 기준 유지가 핵심.
  // 전표 이력이 없으면 단(BunchOf1Box)→송이(SteamOf1Box)→박스 순 추정. (v 단가표 평가만 기존 송이 우선 유지 — 수국단가가 송이 기준)
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category,
            SUM(eff.EffectiveStock * ${STOCK_UNIT_PER_BOX_EXPR} * (${APPLIED_PRICE_EXPR}) / 1.1) AS v,
            SUM(eff.EffectiveStock * COALESCE(lc.UnitPerBox,
                  CASE WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box
                       WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box
                       ELSE 1 END)) AS q,
            SUM(eff.EffectiveStock * COALESCE(lc.UnitPerBox,
                  CASE WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box
                       WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box
                       ELSE 1 END) * ISNULL(lc.UnitCost,0)) AS rc,
            SUM(CASE WHEN anchorRow.AnchorWeek IS NULL THEN ABS(eff.EffectiveStock) ELSE 0 END) AS unanchoredQty,
            SUM(ABS(eff.EffectiveStock)) AS totalQty
       FROM ProductStock ps
       JOIN StockMaster smk ON ps.StockKey=smk.StockKey
       JOIN Product p ON ps.ProdKey=p.ProdKey
       LEFT JOIN WebStockPrice sp ON sp.ProdKey=p.ProdKey
       OUTER APPLY (
         SELECT TOP 1
                wd.TPrice * 1.0 / NULLIF(${WD_UNIT_QTY_EXPR}, 0) AS UnitCost,
                (${WD_UNIT_QTY_EXPR}) * 1.0 / NULLIF(wd.BoxQuantity, 0) AS UnitPerBox
           FROM WarehouseDetail wd
           JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
          WHERE wd.ProdKey = ps.ProdKey AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wd.TPrice,0) > 0
          ORDER BY wm.OrderYear DESC, wm.OrderWeek DESC, wd.WdetailKey DESC
       ) lc
       -- 품목별 최근 확정/사용자입력 앵커(isFix IN (1,2), @week 이하 중 최신)
       OUTER APPLY (
         SELECT TOP 1 sm2.OrderWeek AS AnchorWeek, ps2.Stock AS AnchorStock
           FROM StockMaster sm2 JOIN ProductStock ps2 ON ps2.StockKey = sm2.StockKey
          WHERE ps2.ProdKey = ps.ProdKey AND sm2.isFix IN (1,2)
            AND sm2.OrderYear = @yr
            AND sm2.OrderWeek <= @week AND sm2.OrderWeek LIKE '__-__'
          ORDER BY sm2.OrderWeek DESC, sm2.StockKey DESC
       ) anchorRow
       -- 앵커 이후 입고(+조정)−출고 누적 (차수피벗 "잔량(계산)"과 동일 로직)
       OUTER APPLY (
         SELECT
             ISNULL((SELECT SUM(wd2.OutQuantity) FROM WarehouseDetail wd2
                       JOIN WarehouseMaster wm2 ON wd2.WarehouseKey=wm2.WarehouseKey
                      WHERE wd2.ProdKey = ps.ProdKey AND ISNULL(wm2.isDeleted,0)=0
                        AND wm2.OrderWeek > anchorRow.AnchorWeek AND wm2.OrderWeek <= @week), 0)
           + ISNULL((SELECT SUM(ISNULL(sh2.AfterValue,0) - ISNULL(sh2.BeforeValue,0)) FROM StockHistory sh2
                     WHERE sh2.ProdKey = ps.ProdKey
                       AND sh2.OrderWeek > anchorRow.AnchorWeek AND sh2.OrderWeek <= @week
                       AND (sh2.ChangeType IS NULL OR sh2.ChangeType NOT IN (N'확정', N'확정취소', N'입고', N'출고'))), 0)
           - ISNULL((SELECT SUM(sd2.OutQuantity) FROM ShipmentDetail sd2
                       JOIN ShipmentMaster sm3 ON sd2.ShipmentKey=sm3.ShipmentKey
                      WHERE sd2.ProdKey = ps.ProdKey AND ISNULL(sm3.isDeleted,0)=0
                        AND sm3.OrderWeek > anchorRow.AnchorWeek AND sm3.OrderWeek <= @week), 0) AS FlowDelta
       ) flowRow
       OUTER APPLY (
         SELECT CASE WHEN anchorRow.AnchorWeek IS NOT NULL THEN anchorRow.AnchorStock + flowRow.FlowDelta
                     ELSE ISNULL(ps.Stock,0) END AS EffectiveStock
       ) eff
      WHERE smk.OrderYear=@yr AND smk.OrderWeek=@week
        AND (
              (anchorRow.AnchorWeek IS NULL AND ISNULL(ps.Stock,0) > 0)
              OR (anchorRow.AnchorWeek IS NOT NULL AND ISNULL(eff.EffectiveStock,0) <> 0)
            )
      GROUP BY ${CASE_CATEGORY}`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, week: { type: sql.NVarChar, value: week } }
  );
  return {
    week,
    values: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)])),
    qtys: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.q)])),
    recentCost: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.rc)])),
    // true=재고수량이 실사 앵커(또는 앵커 불필요) 기반 · false=앵커 없이 ProductStock 스냅샷에만 의존(확인 필요)
    anchored: Object.fromEntries(r.recordset.map(x => {
      const total = Number(x.totalQty) || 0;
      const unanchored = Number(x.unanchoredQty) || 0;
      return [x.Category, total <= 0 || unanchored / total < 0.01];
    })),
  };
}

/** 카테고리별 구매 통화 — CurrencyMaster 환율을 R 기본값으로 매핑 (청구서 환율과 다르면 수정) */
export const CATEGORY_CURRENCY = {
  '네덜란드': 'EUR',
  '중국': 'CNY',
  '일본': 'JPY',
  // 나머지(콜롬비아·호주·태국·에콰도르·미국·이스라엘·뉴질랜드·베트남)는 USD 청구 기준
};
export function currencyCodeForCategory(category) {
  if (category === '공제' || category === EXTRA_CATEGORY) return null;
  return CATEGORY_CURRENCY[category] || 'USD';
}

/** R 환율 기본값 — CurrencyMaster 활성 환율 목록 */
export async function currencyRates() {
  try {
    const r = await query(
      `SELECT CurrencyCode, CurrencyName, ExchangeRate FROM CurrencyMaster WHERE ISNULL(IsActive,1)=1`,
      {}
    );
    return r.recordset;
  } catch {
    return [];
  }
}

export async function loadManual(major, orderYear) {
  await ensureProfitReportTable();
  const r = await query(
    `SELECT Category, ColKey, Value, TextValue FROM WebProfitReport
      WHERE OrderYear=@yr AND MajorWeek=@mw`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } }
  );
  const manual = {};
  let note = '';
  for (const x of r.recordset) {
    if (x.Category === '_note') { note = x.TextValue || ''; continue; }
    if (!manual[x.Category]) manual[x.Category] = {};
    manual[x.Category][x.ColKey] = x.Value;
  }
  return { manual, note };
}

export async function saveManual(major, orderYear, values, note, actor) {
  await ensureProfitReportTable();
  const upsert = async (category, colKey, value, textValue) => {
    await query(
      `MERGE WebProfitReport AS t
       USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category, @col AS ColKey) AS s
          ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category AND t.ColKey=s.ColKey
       WHEN MATCHED THEN UPDATE SET Value=@val, TextValue=@txt, UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, ColKey, Value, TextValue, UpdatedBy)
            VALUES (@yr, @mw, @cat, @col, @val, @txt, @actor);`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) },
        mw: { type: sql.NVarChar, value: major },
        cat: { type: sql.NVarChar, value: category },
        col: { type: sql.NVarChar, value: colKey },
        val: { type: sql.Float, value: value == null || value === '' ? null : Number(value) },
        txt: { type: sql.NVarChar, value: textValue == null ? null : String(textValue) },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      }
    );
  };
  for (const [category, cols] of Object.entries(values || {})) {
    for (const [colKey, value] of Object.entries(cols || {})) {
      await upsert(category, colKey, value, null);
    }
  }
  if (note != null) await upsert('_note', 'note', null, note);
}
