// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 구조.
// nenova.exe DB 에서 자동으로 채울 수 있는 열(N순수매출·L불량·O그외매출·Q구매외화·S포워딩·R환율기본)은 SQL 로,
// 수기 열(E기초재고·F기말재고·H 잔여 통관비·R환율수정·비고)은 웹 전용 테이블에 저장한다.
// H의 국가별 GW/CW와 콜롬비아 트럭 등급은 입고관리 원장에서 자동 병합한다.
import { query, sql } from './db';
import { formatUnclassifiedNote, composeProfitReportNote } from './profitReportNotes.js';
import {
  CATEGORIES,
  EXTRA_CATEGORY,
  classifyCategory,
  isNonValueWeightItem,
  isNonInventoryCostItem,
  isNonStockableItem,
} from './profitReportClassification.js';

export { formatUnclassifiedNote, composeProfitReportNote } from './profitReportNotes.js';
export {
  CATEGORIES, EXTRA_CATEGORY, classifyCategory, isNonValueWeightItem,
  isNonInventoryCostItem, isNonStockableItem,
} from './profitReportClassification.js';

// 엑셀 8~23행 품명 순서 그대로

/** SQL 집계에서 중량 행을 제외할 때 사용하는 조건. alias는 해당 Product 별칭이다. */
const nonValueWeightSql = (alias = 'p') => `NOT (
  UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGHT%'
  OR UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGTH%'
  OR UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%GROSS WEIGHT%'
  OR UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%GROSS WEIGTH%'
)`;

/**
 * 운송료/SERVICE FEE/현지상차운임 같은 비재고 비용행을 SQL에서 제외할 때 쓰는 단일 조건.
 * lib/profitReportClassification.js isNonInventoryCostItem()의 SQL 등가물이며, 두 쪽 다 같은
 * 패턴(운송료/SERVICE FEE/현지상차운임)을 유지해야 한다. alias는 해당 Product 별칭이다.
 *
 * CASE_CATEGORY는 이 품목들을 여전히 국가/화종으로 분류한다(S 포워딩·H 통관 자동분류 원천이
 * 이 분류에 의존하므로 forwardingByCategory와 unclassifiedDetailsByCategory의 포워딩 조회에는
 * 이 조건을 적용하지 않는다). 이 조건은 "재고/상품구매로 집계할 대상인지"만 판정한다
 * (2026-08-11: 27차 F 폭증 결함 — 운송료 placeholder 품목의 ProductStock 잔량이 상품재고로
 * 잘못 계상되어 네덜란드 F 1,858,041,803원, 태국 F 70,582,040원까지 부풀었던 원인).
 */
const nonInventoryCostItemSql = (alias = 'p') => `NOT (
  ISNULL(${alias}.ProdName,N'') LIKE N'%운송료%'
  OR ISNULL(${alias}.ProdName,N'') LIKE N'%SERVICE FEE%'
  OR ISNULL(${alias}.ProdName,N'') LIKE N'%현지상차운임%'
  OR ISNULL(${alias}.ProdName,N'') LIKE N'%현지상차 운임%'
)`;

/** 재고 평가(ProductStock)·재고단가표·상품구매(Q)/매입수량/과세환율 집계가 함께 쓰는 "상품재고·
 * 상품구매 대상" 조건 — 무게 placeholder 행과 비재고 비용행을 함께 제외한다. purchaseByCategory,
 * purchaseQtyByCategory, invoiceRatesByCategory, categoryUnitMismatch, stockPriceRows,
 * stockSnapshotByCategory가 모두 이 단일 조건을 공유한다. forwardingByCategory(S)는 비용행을
 * 그대로 배분 대상으로 써야 하므로 이 조건을 쓰지 않는다. */
const stockablePurchaseItemSql = (alias = 'p') => `${nonValueWeightSql(alias)} AND ${nonInventoryCostItemSql(alias)}`;

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

export async function assertProfitReportReadSchema() {
  const result = await query(
    `SELECT v.TableName
       FROM (VALUES (N'WebProfitReport'), (N'WebStockPrice')) v(TableName)
      WHERE OBJECT_ID(N'dbo.' + v.TableName, N'U') IS NULL`,
    {},
  );
  const missing = result.recordset.map(row => row.TableName);
  if (missing.length) {
    const error = new Error(`매출이익보고서 스키마가 설치되지 않았습니다: ${missing.join(', ')}. 배포 마이그레이션을 먼저 실행하세요.`);
    error.code = 'PROFIT_REPORT_SCHEMA_MISSING';
    error.statusCode = 503;
    throw error;
  }
}

const CASE_CATEGORY = `
  CASE
    -- 운송료 전용 Product는 Product.CounName='국내'/'FlowerName='왁스'로 저장되어
    -- 국가·품목별 보고서에서 기타(미분류)로 빠지지 않도록 업무 분류를 우선 적용한다.
    WHEN ISNULL(p.ProdName,'') LIKE N'%현지상차운임%' OR ISNULL(p.ProdName,'') LIKE N'%현지상차 운임%' THEN N'콜롬비아 수국'
    WHEN ISNULL(p.ProdName,'') LIKE N'%카네이션 운송료%' THEN N'콜롬비아 카네이션'
    WHEN ISNULL(p.ProdName,'') LIKE N'%장미 운송료%' THEN N'콜롬비아 장미'
    WHEN ISNULL(p.ProdName,'') LIKE N'%루스커스 운송료%' THEN N'콜롬비아 루스커스'
    WHEN ISNULL(p.ProdName,'') LIKE N'%네덜란드 운송료%' THEN N'네덜란드'
    WHEN ISNULL(p.ProdName,'') LIKE N'%태국 운송료%' THEN N'태국'
    WHEN ISNULL(p.ProdName,'') LIKE N'%중국 운송료%' THEN N'중국'
    -- 특이사항(2026-07-13): 국내(운송료 전용) 품목이라도 품명에 수국/Hydrangea 가 들어가면
    -- 콜롬비아 수국으로 강제 분류 — CounName='국내'인 운송료 placeholder 품목용 예외.
    WHEN ISNULL(p.CounName,'') = N'국내' AND (p.ProdName LIKE N'%수국%' OR p.ProdName LIKE N'%Hydrangea%') THEN N'콜롬비아 수국'
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

const UNCLASSIFIED_CATEGORY_FILTER = `${CASE_CATEGORY} = N'${EXTRA_CATEGORY}'`;

const safeNoteText = (value, fallback) => {
  const text = String(value || '').trim();
  return text || fallback;
};

/**
 * 기타(미분류) 행의 원본 품목을 비고/엑셀에 남길 수 있도록 묶는다.
 * 합계 숫자만 보여주면 국가·품종 매핑을 고칠 대상을 찾을 수 없으므로,
 * 매출·견적·입고·포워딩 원천별로 국가/품종/품명을 함께 반환한다.
 */
export async function unclassifiedDetailsByCategory(major, orderYear) {
  const params = {
    pfx: { type: sql.NVarChar, value: `${major}-%` },
    yw: { type: sql.NVarChar, value: `${orderYear}${major}` },
    yr: { type: sql.NVarChar, value: String(orderYear) },
  };
  const [sales, estimates, purchases, forwarding] = await Promise.all([
    query(
      `SELECT N'매출' AS SourceName,
              ISNULL(p.CounName,N'(국가 없음)') AS CountryName,
              ISNULL(p.FlowerName,N'(품종 없음)') AS FlowerName,
              ISNULL(p.ProdName,N'(품명 없음)') AS ProdName,
              SUM(ISNULL(sd.OutQuantity,0)) AS Quantity,
              SUM(ISNULL(sd.Amount,0)) AS Amount
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
         LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
        WHERE sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw
          AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sm.isFix,0)=1
          AND ISNULL(sd.OutQuantity,0) <> 0
          AND ${nonValueWeightSql('p')}
          AND ${UNCLASSIFIED_CATEGORY_FILTER}
        GROUP BY ISNULL(p.CounName,N'(국가 없음)'), ISNULL(p.FlowerName,N'(품종 없음)'), ISNULL(p.ProdName,N'(품명 없음)')`,
      params,
    ),
    query(
      `SELECT N'견적' AS SourceName,
              ISNULL(p.CounName,N'(국가 없음)') AS CountryName,
              ISNULL(p.FlowerName,N'(품종 없음)') AS FlowerName,
              ISNULL(p.ProdName,N'(품명 없음)') AS ProdName,
              CAST(0 AS FLOAT) AS Quantity,
              SUM(ISNULL(e.Amount,0)) AS Amount
         FROM Estimate e
         JOIN ShipmentMaster sm ON e.ShipmentKey=sm.ShipmentKey
         LEFT JOIN Product p ON e.ProdKey=p.ProdKey
        WHERE sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw
          AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sm.isFix,0)=1
          AND ${nonValueWeightSql('p')}
          AND ${UNCLASSIFIED_CATEGORY_FILTER}
        GROUP BY ISNULL(p.CounName,N'(국가 없음)'), ISNULL(p.FlowerName,N'(품종 없음)'), ISNULL(p.ProdName,N'(품명 없음)')`,
      params,
    ),
    query(
      `SELECT N'입고' AS SourceName,
              ISNULL(p.CounName,N'(국가 없음)') AS CountryName,
              ISNULL(p.FlowerName,N'(품종 없음)') AS FlowerName,
              ISNULL(p.ProdName,N'(품명 없음)') AS ProdName,
              SUM(${WD_UNIT_QTY_EXPR}) AS Quantity,
              SUM(ISNULL(wd.TPrice,0)) AS Amount
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
        WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
          AND ${stockablePurchaseItemSql('p')}
          AND ${UNCLASSIFIED_CATEGORY_FILTER}
        GROUP BY ISNULL(p.CounName,N'(국가 없음)'), ISNULL(p.FlowerName,N'(품종 없음)'), ISNULL(p.ProdName,N'(품명 없음)')`,
      params,
    ),
    query(
      `WITH bill AS (
         SELECT wm.WarehouseKey,
                (ISNULL(wm.ChargeableWeight,0) * ISNULL(wm.FreightRateUSD,0) + ISNULL(wm.DocFeeUSD,0)) AS BillUSD
           FROM WarehouseMaster wm
          WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
       ), alloc AS (
         SELECT b.WarehouseKey, b.BillUSD, wd.ProdKey, ISNULL(wd.TPrice,0) AS LineAmount,
                SUM(ISNULL(wd.TPrice,0)) OVER (PARTITION BY b.WarehouseKey) AS BillLineAmount
           FROM bill b
           JOIN WarehouseDetail wd ON wd.WarehouseKey=b.WarehouseKey
           LEFT JOIN Product p0 ON p0.ProdKey=wd.ProdKey
          WHERE ${nonValueWeightSql('p0')}
       )
       SELECT N'포워딩' AS SourceName,
              ISNULL(p.CounName,N'(국가 없음)') AS CountryName,
              ISNULL(p.FlowerName,N'(품종 없음)') AS FlowerName,
              ISNULL(p.ProdName,N'(품명 없음)') AS ProdName,
              CAST(0 AS FLOAT) AS Quantity,
              SUM(CASE WHEN a.BillLineAmount > 0 THEN a.BillUSD * a.LineAmount / a.BillLineAmount ELSE 0 END) AS Amount
         FROM alloc a
         LEFT JOIN Product p ON a.ProdKey=p.ProdKey
        WHERE ${UNCLASSIFIED_CATEGORY_FILTER}
        GROUP BY ISNULL(p.CounName,N'(국가 없음)'), ISNULL(p.FlowerName,N'(품종 없음)'), ISNULL(p.ProdName,N'(품명 없음)')`,
      params,
    ),
  ]);
  return [...sales.recordset, ...estimates.recordset, ...purchases.recordset, ...forwarding.recordset]
    .map((row) => ({
      source: safeNoteText(row.SourceName, '원천'),
      country: safeNoteText(row.CountryName, '국가 없음'),
      flower: safeNoteText(row.FlowerName, '품종 없음'),
      product: safeNoteText(row.ProdName, '품명 없음'),
      quantity: Number(row.Quantity || 0),
      amount: Number(row.Amount || 0),
    }))
    .filter((row) => Math.abs(row.quantity) > 0.001 || Math.abs(row.amount) > 0.001);
}

/** N 순수매출액 — 판매현황(공급가액) 국가별. 엑셀 판매현황!E(공급가액) SUMIF 와 동일 기준 */
export async function salesByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(ISNULL(sd.Amount,0)) AS v
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
      WHERE sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sm.isFix,0)=1
        AND ISNULL(sd.OutQuantity,0) <> 0
        AND ${nonValueWeightSql('p')}
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
        AND ISNULL(sm.isFix,0)=1
        AND ${nonValueWeightSql('p')}
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

/** Q 구매금액(외화) — 입고(WarehouseDetail.TPrice=외화총액) 국가별.
 * 운송료/SERVICE FEE/현지상차운임은 S 포워딩에서 별도 집계하므로 Q에서 제외한다(22~26차 엑셀 Q 총계와 운영 전표 대조). */
export async function purchaseByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(ISNULL(wd.TPrice,0)) AS v
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
        AND ${stockablePurchaseItemSql('p')}
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
         FROM bill b
         JOIN WarehouseDetail wd ON wd.WarehouseKey=b.WarehouseKey
         LEFT JOIN Product p0 ON p0.ProdKey=wd.ProdKey
        WHERE ${nonValueWeightSql('p0')}
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

// 입고 라인의 금액단위 수량 — 이카운트 구매현황 "수량"(D열)과 같은 기준.
// 26차 실측: EstQuantity(전표 금액기준 수량)가 엑셀 D열과 일치(수국 23,090·알스트로 3,200·에콰도르 1,400·베트남 1,600·루스커스 675 완전일치).
// EstQuantity 가 0인 행은 단(Bunch)→송이(Steam)→박스 순 fallback. 분모(매입수량)와 재고수량이 같은 기준이면 비율은 단위 무관.
const WD_UNIT_QTY_EXPR = `
  CASE WHEN ISNULL(wd.EstQuantity,0) > 0 THEN wd.EstQuantity
       WHEN ISNULL(wd.BunchQuantity,0) > 0 THEN wd.BunchQuantity
       WHEN ISNULL(wd.SteamQuantity,0) > 0 THEN wd.SteamQuantity
       ELSE ISNULL(wd.BoxQuantity,0) END`;

// ProductStock.Stock 은 품목의 출고단위(OutUnit), 엑셀 기말재고 수식의 매입수량은
// 금액단위(EstUnit) 기준이다. 두 단위가 다를 때만 품목 마스터의 환산값을 적용한다.
// 박스당 수량을 모든 품목에 일괄 적용하면 이미 '단'으로 저장된 장미·호주 재고가 과대계상된다.
const STOCK_TO_EST_UNIT_EXPR = `
  CASE
    WHEN ISNULL(p.OutUnit,N'') = ISNULL(p.EstUnit,N'') THEN 1
    WHEN ISNULL(p.OutUnit,N'') = N'박스' AND ISNULL(p.EstUnit,N'') = N'단'
      THEN CASE WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box ELSE 1 END
    WHEN ISNULL(p.OutUnit,N'') = N'박스' AND ISNULL(p.EstUnit,N'') = N'송이'
      THEN CASE WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box ELSE 1 END
    WHEN ISNULL(p.OutUnit,N'') = N'단' AND ISNULL(p.EstUnit,N'') = N'송이'
      THEN CASE WHEN ISNULL(p.SteamOf1Bunch,0) > 0 THEN p.SteamOf1Bunch ELSE 1 END
    ELSE 1
  END`;

/** 이번 차수 매입 총수량(송이/단 단위) — 엑셀 F열 공식의 분모. purchaseByCategory 와 동일하게 포워딩 행 제외. */
export async function purchaseQtyByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(${WD_UNIT_QTY_EXPR}) AS q
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
        AND ${stockablePurchaseItemSql('p')}
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.q)]));
}

/** 차수별 과세환율 — FreightCost.ExchangeRate(입고별 과세환율 스냅샷: AUD를 포함한 전 통화가
 * 통관 신고 시점 관세청 과세환율 기준)를 구매금액 가중평균으로 집계.
 * 상업 환율(구매현황 등에 남는 환전 시점 환율)과 다른 값이며, 이 보고서의 R은 항상 과세환율이다.
 * 스냅샷이 없는 구형 입고만 CurrencyMaster 현재값으로 fallback 한다. */
export async function invoiceRatesByCategory(major, orderYear) {
  try {
    const r = await query(
      `SELECT ${CASE_CATEGORY} AS Category,
              SUM(CAST(wd.TPrice AS FLOAT) * CAST(fc.ExchangeRate AS FLOAT))
                / NULLIF(SUM(CAST(wd.TPrice AS FLOAT)),0) AS rate
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
         JOIN FreightCost fc ON fc.WarehouseKey=wm.WarehouseKey
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
        WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0
          AND ISNULL(wm.OrderYear,'')=@yr AND ISNULL(fc.isDeleted,0)=0
          AND ISNULL(fc.ExchangeRate,0)>0 AND ISNULL(wd.TPrice,0)>0
          AND ${stockablePurchaseItemSql('p')}
        GROUP BY ${CASE_CATEGORY}`,
      {
        pfx: { type: sql.NVarChar, value: `${major}-%` },
        yr: { type: sql.NVarChar, value: String(orderYear) },
      }
    );
    return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.rate)]).filter(([, v]) => Number.isFinite(v) && v > 0));
  } catch {
    // FreightCost가 아직 없는 구형 DB 또는 스냅샷이 없는 차수는 기존 fallback을 유지한다.
    return {};
  }
}

/**
 * 선택 대차수에서 nenova.exe 재고현황의 마지막 ProductStock 세부차수를 찾는다.
 *
 * - 27-01/27-02만 존재한다는 가정 금지: 27-03, 27-04도 숫자 순서로 지원한다.
 * - FormStockView/usp_StockCalculation의 실제 원천은 ProductStock 스냅샷이다.
 *   StockMaster.isFix는 구형·부분확정 데이터에서 0/NULL로 남을 수 있으므로
 *   스냅샷 선택 조건으로 사용하지 않는다. 선택된 행의 isFix는 진단 정보로 반환한다.
 * - ProductStock가 없는 빈 StockMaster 행은 제외한다.
 * - 같은 세부차수에 중복 StockMaster가 남아 있으면 ProductStock 행이 가장 많은
 *   StockKey, 그 다음 가장 큰 StockKey를 선택한다.
 *
 * 반환값의 { orderYear, week, stockKey }는 확정 스냅샷(REPORT_CONFIRM_SNAPSHOT, lib/profitReportConfirm.js)이
 * begin/end 좌표를 그대로 저장할 때 쓰는 명시적 계약이다. 선택 로직 자체는 바꾸지 않고
 * 호출부에 이미 있던 orderYear를 반환 객체에도 그대로 실어 보낸다(2026-08-11 결함수정 4).
 */
export async function latestStockSnapshotWeek(major, orderYear) {
  const pfx = `${String(major).padStart(2, '0')}-%`;
  const r = await query(
    `SELECT TOP 1 sm.OrderWeek, sm.StockKey, ISNULL(sm.isFix,0) AS isFix
       FROM StockMaster sm
      WHERE sm.OrderYear=@yr
        AND sm.OrderWeek LIKE @pfx
        AND sm.OrderWeek LIKE '__-__'
        AND EXISTS (SELECT 1 FROM ProductStock ps WHERE ps.StockKey=sm.StockKey)
      ORDER BY TRY_CONVERT(INT, SUBSTRING(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek)+1, 10)) DESC,
               (SELECT COUNT(*) FROM ProductStock ps WHERE ps.StockKey=sm.StockKey) DESC,
               sm.StockKey DESC`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) },
      pfx: { type: sql.NVarChar, value: pfx },
    }
  );
  const row = r.recordset[0];
  return row
    ? { orderYear: String(orderYear), week: row.OrderWeek, stockKey: Number(row.StockKey), isFix: Number(row.isFix) === 1, stockMasterIsFix: Number(row.isFix) }
    : { orderYear: String(orderYear), week: null, stockKey: null, isFix: false, stockMasterIsFix: null };
}

/** 재고단가표 편집용 — 기초/기말 스냅샷에 재고가 있는 품목 목록 + 적용단가 */
export async function stockPriceRows(major, prevMajor, orderYear, prevOrderYear = orderYear) {
  const [endSnapshot, beginSnapshot] = await Promise.all([
    latestStockSnapshotWeek(major, orderYear),
    latestStockSnapshotWeek(prevMajor, prevOrderYear),
  ]);
  const endWeek = endSnapshot.week;
  const beginWeek = beginSnapshot.week;
  if (!endWeek && !beginWeek) return { beginWeek, endWeek, rows: [] };
  const r = await query(
    `SELECT p.ProdKey, p.ProdName, ${CASE_CATEGORY} AS Category,
            CASE WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box
                 WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box ELSE 1 END AS UnitPerBox,
            ISNULL(p.Cost,0) AS Cost, sp.Price AS SetPrice,
            ${APPLIED_PRICE_EXPR} AS AppliedPrice,
            ${APPLIED_SOURCE_EXPR} AS AppliedSource,
            SUM(CASE WHEN smk.StockKey = @beginStockKey THEN ps.Stock ELSE 0 END) AS StockBegin,
            SUM(CASE WHEN smk.StockKey = @endStockKey THEN ps.Stock ELSE 0 END) AS StockEnd
       FROM ProductStock ps
       JOIN StockMaster smk ON ps.StockKey=smk.StockKey
       JOIN Product p ON ps.ProdKey=p.ProdKey
       LEFT JOIN WebStockPrice sp ON sp.ProdKey=p.ProdKey
      WHERE (smk.StockKey=@beginStockKey OR smk.StockKey=@endStockKey)
        AND ISNULL(ps.Stock,0) > 0
        AND ${stockablePurchaseItemSql('p')}
      GROUP BY p.ProdKey, p.ProdName, p.CounName, p.FlowerName, p.SteamOf1Box, p.BunchOf1Box, p.Cost, sp.Price
      ORDER BY 3, p.ProdName`,
    {
      beginStockKey: { type: sql.Int, value: beginSnapshot.stockKey || 0 },
      endStockKey: { type: sql.Int, value: endSnapshot.stockKey || 0 },
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

/** WarehouseMaster.OrderWeek(예: '27-02')을 대차수/세부차수 정수쌍으로 분해. 형식이 아니면 null.
 * (테스트 전용으로 export — __tests__/profitReportRecentCostCutoff.test.js) */
export function splitOrderWeek(week) {
  const m = String(week || '').match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  return { majorNum: Number(m[1]), minorNum: Number(m[2]) };
}

/** 최근 매입단가(recentCost) 서브쿼리 cutoff 조건 — 이 보고서가 선택한 스냅샷 세부차수(orderYear+week)
 * 이하의 입고만 "최근"으로 인정한다. cutoff 없이 전역 최신 WarehouseDetail을 쓰면 미래 입고가
 * 과거 차수의 F(기말재고평가)를 오염시킨다(2026-08-11 결함수정 3). 01차는 호출부(prevOrderYear=전년)에서
 * 이미 연도를 넘겨주므로 이 함수는 항상 넘겨받은 orderYear/week만 기준으로 삼으면 된다.
 * (테스트 전용으로 export — __tests__/profitReportRecentCostCutoff.test.js) */
export function recentCostCutoffSql(alias = 'wm') {
  return `(
    CAST(${alias}.OrderYear AS INT) < @cutoffYear
    OR (
      CAST(${alias}.OrderYear AS INT) = @cutoffYear
      AND (
        TRY_CONVERT(INT, LEFT(${alias}.OrderWeek, CHARINDEX('-', ${alias}.OrderWeek)-1)) < @cutoffMajor
        OR (
          TRY_CONVERT(INT, LEFT(${alias}.OrderWeek, CHARINDEX('-', ${alias}.OrderWeek)-1)) = @cutoffMajor
          AND TRY_CONVERT(INT, SUBSTRING(${alias}.OrderWeek, CHARINDEX('-', ${alias}.OrderWeek)+1, 10)) <= @cutoffMinor
        )
      )
    )
  )`;
}

/** 카테고리 안에서 매입수량 단위(Product.EstUnit, 예: 박스)와 기말재고 환산단위가 혼재하는지 검사.
 * 27차 호주처럼 같은 카테고리에 박스 기준 품목과 단/송이 기준 품목이 섞여 있으면, F열 1순위 공식
 * (매입총액÷매입총수량×기말수량, category 단위 평균)은 서로 다른 물리단위를 그대로 더해 나누는
 * 셈이라 무효다(2026-08-11 결함수정 6, lib/profitReportCalc.js computeAutoEndingStock 참고).
 * 이번 차수 매입분 EstUnit 집합과 기말재고 스냅샷 EstUnit 집합을 합쳐 카테고리별 distinct 개수를 세고,
 * 2개 이상이면 unitMismatch=true. 매입도 재고도 없는 카테고리는 검사 대상이 아니므로 false. */
export async function categoryUnitMismatch(major, orderYear, stockKey) {
  if (!stockKey) return {};
  const r = await query(
    `WITH stockUnits AS (
       SELECT DISTINCT ${CASE_CATEGORY} AS Category, ISNULL(p.EstUnit,N'') AS EstUnit
         FROM ProductStock ps
         JOIN Product p ON ps.ProdKey=p.ProdKey
        WHERE ps.StockKey=@stockKey AND ISNULL(ps.Stock,0) <> 0 AND ${stockablePurchaseItemSql('p')}
     ), purchUnits AS (
       SELECT DISTINCT ${CASE_CATEGORY} AS Category, ISNULL(p.EstUnit,N'') AS EstUnit
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
        WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'')=@yr
          AND ${stockablePurchaseItemSql('p')}
     ), allUnits AS (
       SELECT Category, EstUnit FROM stockUnits
       UNION
       SELECT Category, EstUnit FROM purchUnits
     )
     SELECT Category, COUNT(DISTINCT EstUnit) AS UnitCount FROM allUnits GROUP BY Category`,
    {
      stockKey: { type: sql.Int, value: stockKey },
      pfx: { type: sql.NVarChar, value: `${major}-%` },
      yr: { type: sql.NVarChar, value: String(orderYear) },
    }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.UnitCount) > 1]));
}

/** 차수말 재고 스냅샷 집계 — 엑셀 F열 공식의 재료(수량·최근매입원가)와 단가표 평가액을 한 번에.
 * nenova.exe 재고현황과 동일하게 해당 대차수의 마지막 ProductStock 세부차수 Stock을 기말잔량으로 쓴다.
 * ProductStock.Stock(OutUnit)을 품목별 EstUnit으로 조건부 환산해 매입수량 분모와 단위를 맞춘다.
 * 반환: { week, qtys: 재고현황 마지막 Stock 열 합계(EstUnit), recentCost, values, negativeQtys }
 * 임의로 시작재고+입고−출고를 재계산하지 않는다. EXE 화면의 마지막 Stock 열이 이 보고서의 단일 기준이다. */
export async function stockSnapshotByCategory(major, orderYear) {
  const snapshot = await latestStockSnapshotWeek(major, orderYear);
  const week = snapshot.week;
  if (!week) return { week: null, stockKey: null, values: {}, qtys: {}, recentCost: {}, negativeQtys: {}, recentCostMissingQty: {}, anchored: {}, selection: 'missing_stock_snapshot', stockMasterIsFix: null };
  // 2026-08-11 결함수정 8: 이 함수는 GET(조회)에서도 호출된다. GET은 SELECT 전용이어야 하므로(CLAUDE.md 규칙 1)
  // 여기서 DDL(ensureStockPriceTable)을 실행하지 않는다. 스키마 존재 확인만 하고, 생성은 저장(POST) 경로의
  // saveStockPrices()->ensureStockPriceTable() 또는 배포 마이그레이션에서만 수행한다.
  await assertProfitReportReadSchema();
  // recentCost cutoff — 이 스냅샷(orderYear+week) 이후에 입고된 미래 매입이 과거 최근단가를 오염시키지 않도록
  // WarehouseMaster.OrderYear/OrderWeek <= (orderYear, week) 로 제한한다. 2025/2026 등 다른 연도에 같은
  // OrderWeek(예: 27-01)이 있어도 OrderYear까지 비교하므로 섞이지 않는다.
  const cutoff = splitOrderWeek(week);
  // 단가표 우선순위: 웹 단가표(WebStockPrice 지정) > 수국단가표 > Product.Cost
  // 최근 매입 외화단가/박스당수량: 품목별 가장 최근 입고 라인 (WarehouseDetail 엔 isDeleted 없음 — wm 만 필터)
  // 최근 매입 외화단가는 입고 전표 금액을 그 전표의 Product.OutUnit 기준 수량으로 나눈 값이다.
  // recentCost는 이 스냅샷 세부차수(orderYear+week) 이하의 입고만 본다(cutoff 없으면 미래 입고가 과거 F를 오염).
  const [r, unitRows] = await Promise.all([
    query(
      `SELECT ${CASE_CATEGORY} AS Category,
              SUM(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR}) * (${APPLIED_PRICE_EXPR}) / 1.1) AS v,
              SUM(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) AS q,
              SUM(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR}) * ISNULL(lc.UnitCost,0)) AS rc,
              SUM(CASE WHEN ps.Stock < 0
                       THEN ABS(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) ELSE 0 END) AS nq,
              -- 2026-08-11 결함수정 7: lc.UnitCost가 없는(=최근 입고 라인을 못 찾은) 품목은
              -- rc(recentCost 합계)에 0으로 조용히 반영된다. 재고가 있는데 최근단가를 못 찾은
              -- 수량을 따로 집계해 audit이 needs_input으로 명시하게 한다(값을 추정해 채우지 않음).
              SUM(CASE WHEN ps.Stock <> 0 AND lc.UnitCost IS NULL
                       THEN ABS(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) ELSE 0 END) AS mq
         FROM ProductStock ps
         JOIN StockMaster smk ON ps.StockKey=smk.StockKey
         JOIN Product p ON ps.ProdKey=p.ProdKey
         LEFT JOIN WebStockPrice sp ON sp.ProdKey=p.ProdKey
         OUTER APPLY (
           SELECT TOP 1
                  wd.TPrice * 1.0 / NULLIF(${WD_UNIT_QTY_EXPR}, 0) AS UnitCost
             FROM WarehouseDetail wd
             JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
            WHERE wd.ProdKey = ps.ProdKey AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wd.TPrice,0) > 0
              ${cutoff ? `AND ${recentCostCutoffSql('wm')}` : ''}
            ORDER BY wm.OrderYear DESC, wm.OrderWeek DESC, wd.WdetailKey DESC
         ) lc
        WHERE smk.StockKey=@stockKey AND smk.OrderYear=@yr AND smk.OrderWeek=@week
          AND ISNULL(ps.Stock,0) <> 0
          AND ${stockablePurchaseItemSql('p')}
        GROUP BY ${CASE_CATEGORY}`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) },
        week: { type: sql.NVarChar, value: week },
        stockKey: { type: sql.Int, value: snapshot.stockKey },
        ...(cutoff ? {
          cutoffYear: { type: sql.Int, value: Number(orderYear) },
          cutoffMajor: { type: sql.Int, value: cutoff.majorNum },
          cutoffMinor: { type: sql.Int, value: cutoff.minorNum },
        } : {}),
      }
    ),
    categoryUnitMismatch(major, orderYear, snapshot.stockKey),
  ]);
  return {
    week,
    stockKey: snapshot.stockKey,
    selection: 'latest_stock_subweek',
    stockMasterIsFix: snapshot.stockMasterIsFix,
    values: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)])),
    qtys: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.q)])),
    recentCost: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.rc)])),
    negativeQtys: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.nq)])),
    recentCostMissingQty: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.mq)])),
    unitMismatch: unitRows,
    // 사용자가 지정한 기준은 nenova.exe 재고현황의 확정 Stock 열이다.
    // 이 소스를 직접 사용한 카테고리는 별도 실사 앵커 경고 대상이 아니다.
    anchored: Object.fromEntries(r.recordset.map(x => [x.Category, true])),
  };
}

/** 카테고리별 구매 통화 — CurrencyMaster 환율을 R 기본값으로 매핑 (청구서 환율과 다르면 수정) */
export const CATEGORY_CURRENCY = {
  '네덜란드': 'EUR',
  '호주': 'AUD',
  '중국': 'CNY',
  '일본': 'JPY',
  // 나머지(콜롬비아·태국·에콰도르·미국·이스라엘·뉴질랜드·베트남)는 USD 청구 기준
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

/**
 * 연간 월별 보기의 차수 달력 범위.
 *
 * 차수의 목~수 범위는 nenova.exe가 사용하는 PeriodDay가 유일한 기준이다.
 * 웹에서 날짜를 재생성하면 출고요일 설정·연도 경계와 어긋날 수 있으므로
 * PeriodDay.BaseYmd를 그대로 읽고, 실제 손익 원천이 있는 차수만 hasData=1로 표시한다.
 * 조회 전용이며 ERP 원장에는 쓰지 않는다.
 */
export async function periodDayRangesByMajor(orderYear) {
  const r = await query(
    `WITH active AS (
       SELECT RIGHT(N'0' + CONVERT(NVARCHAR(10), TRY_CONVERT(INT, LEFT(CONVERT(NVARCHAR(20), sm.OrderWeek), 2))), 2) AS Major
         FROM ShipmentMaster sm
        WHERE ISNULL(sm.isDeleted,0)=0 AND CONVERT(NVARCHAR(10), sm.OrderYear)=@yr
       UNION
       SELECT RIGHT(N'0' + CONVERT(NVARCHAR(10), TRY_CONVERT(INT, LEFT(CONVERT(NVARCHAR(20), wm.OrderWeek), 2))), 2)
         FROM WarehouseMaster wm
        WHERE ISNULL(wm.isDeleted,0)=0 AND CONVERT(NVARCHAR(10), wm.OrderYear)=@yr
       UNION
       SELECT RIGHT(N'0' + CONVERT(NVARCHAR(10), TRY_CONVERT(INT, LEFT(CONVERT(NVARCHAR(20), sm.OrderWeek), 2))), 2)
         FROM StockMaster sm
        WHERE CONVERT(NVARCHAR(10), sm.OrderYear)=@yr
       UNION
       SELECT RIGHT(N'0' + CONVERT(NVARCHAR(10), TRY_CONVERT(INT, mw.MajorWeek)), 2)
         FROM WebProfitReport mw
        WHERE CONVERT(NVARCHAR(10), mw.OrderYear)=@yr
     ), periods AS (
       SELECT RIGHT(N'0' + CONVERT(NVARCHAR(10), TRY_CONVERT(INT, RIGHT(CONVERT(NVARCHAR(20), pd.OrderYearWeek), 2))), 2) AS Major,
              CONVERT(CHAR(10), MIN(CONVERT(DATE, pd.BaseYmd)), 23) AS StartDate,
              CONVERT(CHAR(10), MAX(CONVERT(DATE, pd.BaseYmd)), 23) AS EndDate,
              COUNT(DISTINCT CONVERT(DATE, pd.BaseYmd)) AS DayCount
         FROM PeriodDay pd
        WHERE CONVERT(NVARCHAR(20), pd.OrderYearWeek) LIKE @periodPrefix
        GROUP BY RIGHT(N'0' + CONVERT(NVARCHAR(10), TRY_CONVERT(INT, RIGHT(CONVERT(NVARCHAR(20), pd.OrderYearWeek), 2))), 2)
     )
     SELECT p.Major, p.StartDate, p.EndDate, p.DayCount,
            CASE WHEN a.Major IS NULL THEN 0 ELSE 1 END AS HasData
       FROM periods p
       LEFT JOIN (SELECT DISTINCT Major FROM active WHERE Major IS NOT NULL AND Major <> N'00') a ON a.Major=p.Major
      WHERE p.Major IS NOT NULL AND p.Major <> N'00'
      ORDER BY TRY_CONVERT(INT, p.Major)`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) },
      periodPrefix: { type: sql.NVarChar, value: `${String(orderYear)}%` },
    }
  );
  return r.recordset.map(row => ({
    major: String(row.Major).padStart(2, '0'),
    startDate: row.StartDate ? String(row.StartDate).slice(0, 10) : null,
    endDate: row.EndDate ? String(row.EndDate).slice(0, 10) : null,
    dayCount: Number(row.DayCount || 0),
    hasData: Number(row.HasData) === 1,
  }));
}

export async function loadManual(major, orderYear) {
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
        txt: { type: sql.NVarChar, value: textValue == null ? null : String(textValue).slice(0, 2000) },
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
