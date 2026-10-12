// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 구조.
// nenova.exe DB 에서 자동으로 채울 수 있는 열(N순수매출·L불량·O그외매출·Q구매외화·S포워딩·R환율기본)은 SQL 로,
// 외부 확정값(H 통관비·R 과세환율·S 포워딩)과 비고만 웹 전용 테이블에 저장한다.
// E/F는 EXE가 계산한 마지막 ProductStock + 해당 스냅샷 시점 VERIFIED 단가 근거로만 평가하며 최종값 override를 금지한다.
// H의 국가별 GW/CW와 콜롬비아 트럭 등급은 입고관리 원장에서 자동 병합한다.
import { query, sql } from './db.js';
import { formatUnclassifiedNote, composeProfitReportNote } from './profitReportNotes.js';
import {
  CATEGORIES,
  EXTRA_CATEGORY,
  classifyCategory,
  isNonValueWeightItem,
  isNonInventoryCostItem,
  isNonStockableItem,
  profitReportCategoriesForWeek,
} from './profitReportClassification.js';
import {
  buildProfitReportCategorySql,
  CATEGORY_CURRENCY,
  currencyCodeForCategory as resolveCurrencyCodeForCategory,
} from './profitReportCountryResolver.js';
import { assertWebSchemaContract } from './webSchemaContract.js';
import {
  inventoryWorkbookPriceEvidenceByProduct,
  normalizeInventoryUnit,
} from './profitReportInventoryWorkbookCatalog.js';
import { distributionMajorityStockPriceSuggestion } from './profitReportCalc.js';
import { loadConfirmedCustomerProductPrices } from './profitReportCustomerMixSql.js';

export { formatUnclassifiedNote, composeProfitReportNote } from './profitReportNotes.js';
export {
  CATEGORIES, EXTRA_CATEGORY, classifyCategory, isNonValueWeightItem,
  isNonInventoryCostItem, isNonStockableItem, profitReportCategoriesForWeek,
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
 * 그대로 배분 대상으로 써야 하므로 이 조건을 쓰지 않는다.
 * export되어 lib/kcsRateDateWeights.js(관세청 조회 기준일자 가중평균)가 동일한 필터를
 * 재사용한다. 카테고리 분류/필터 로직을 그 파일에서 새로 만들지 말 것. */
export const stockablePurchaseItemSql = (alias = 'p') => `${nonValueWeightSql(alias)} AND ${nonInventoryCostItemSql(alias)}`;

// ── 외부 확정값 저장 schema 확인. 생성/변경은 migration만 담당한다.
let _ensured = null;
export async function ensureProfitReportTable() {
  if (_ensured) return _ensured;
  _ensured = assertWebSchemaContract('profit-report-inputs@2', [
    { table: 'WebProfitReport', columns: ['OrderYear', 'MajorWeek', 'Category', 'ColKey', 'Value', 'TextValue', 'UpdatedBy', 'UpdatedAt', 'SourceRef', 'EffectiveAt', 'ConfirmedBy', 'ConfirmedAt'] },
  ]);
  return _ensured;
}

export async function assertProfitReportReadSchema() {
  await Promise.all([ensureProfitReportTable(), ensureStockPriceTable()]);
}

// export되어 lib/kcsRateDateWeights.js(관세청 조회 기준일자 가중평균)가 동일한 국가/화종
// 분류를 재사용한다. 카테고리 분류 SQL을 그 파일에서 복제하지 말 것 — 이 조각을 import해서 쓴다.
export const CASE_CATEGORY = buildProfitReportCategorySql('p');

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
        WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw
          AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sm.isFix,0)=1 AND ISNULL(sd.isFix,0)=1
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
        WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw
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
      WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sm.isFix,0)=1 AND ISNULL(sd.isFix,0)=1
        AND ISNULL(sd.OutQuantity,0) <> 0
        AND ${nonValueWeightSql('p')}
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${orderYear}${major}` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
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
      WHERE sm.OrderYear=@yr AND sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sm.isFix,0)=1
        AND ${nonValueWeightSql('p')}
      GROUP BY ${CASE_CATEGORY}, CASE WHEN ci.Descr2 = N'불량차감' THEN N'L' ELSE N'O' END`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${orderYear}${major}` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
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

// ── 재고 시점 단가 근거 schema 확인. 생성/변경은 migration만 담당한다.
let _spEnsured = null;
export async function ensureStockPriceTable() {
  if (_spEnsured) return _spEnsured;
  _spEnsured = assertWebSchemaContract('profit-report-stock-price-evidence@1', [
    { table: 'WebStockPriceEvidence', columns: ['OrderYear', 'OrderWeek', 'ProdKey', 'Price', 'SourceRef', 'EffectiveAt', 'ConfirmedBy', 'ConfirmedAt', 'EvidenceStatus'] },
  ]);
  return _spEnsured;
}

const APPLIED_PRICE_EXPR = 'spe.Price';

let _arrivalEvidenceSchemaAvailable = null;
async function hasArrivalEvidenceSchema() {
  if (_arrivalEvidenceSchemaAvailable != null) return _arrivalEvidenceSchemaAvailable;
  const result = await query(`
    SELECT CASE WHEN
      OBJECT_ID(N'dbo.WebArrivalCostLine',N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.WebArrivalCostImport',N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.WebArrivalCostHistory',N'U') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'OrderYear') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'OrderWeek') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'ProdKey') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'Unit') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'Quantity') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'IsCurrent') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'MatchStatus') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'SelectedArrivalCostKRW') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'SourceArrivalCostKRW') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'SourceFileName') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'SheetName') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostLine',N'SourceRow') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostImport',N'RevisionNo') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostImport',N'IsDeleted') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostHistory',N'ArrivalLineKey') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostHistory',N'ActionType') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostHistory',N'ChangedBy') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostHistory',N'ChangedAt') IS NOT NULL
      AND COL_LENGTH(N'dbo.WebArrivalCostHistory',N'HistoryKey') IS NOT NULL
      THEN 1 ELSE 0 END AS Available`, {});
  _arrivalEvidenceSchemaAvailable = Number(result.recordset[0]?.Available) === 1;
  return _arrivalEvidenceSchemaAvailable;
}

const NORMALIZED_UNIT_SQL = (expression) => `CASE UPPER(LTRIM(RTRIM(ISNULL(${expression},N''))))
  WHEN N'BOX' THEN N'박스' WHEN N'BX' THEN N'박스' WHEN N'박스' THEN N'박스'
  WHEN N'BUNCH' THEN N'단' WHEN N'BUN' THEN N'단' WHEN N'단' THEN N'단'
  WHEN N'STEM' THEN N'송이' WHEN N'EA' THEN N'송이' WHEN N'스팀' THEN N'송이'
  WHEN N'대' THEN N'송이' WHEN N'송이' THEN N'송이'
  ELSE UPPER(LTRIM(RTRIM(ISNULL(${expression},N'')))) END`;

const NORMALIZED_ORDER_WEEK_SQL = (expression) => `CASE
  WHEN CHARINDEX(N'-',LTRIM(RTRIM(ISNULL(${expression},N'')))) > 0 THEN
    CONCAT(
      TRY_CONVERT(INT,LEFT(LTRIM(RTRIM(${expression})),CHARINDEX(N'-',LTRIM(RTRIM(${expression})))-1)),
      N'-',
      RIGHT(N'00'+CONVERT(NVARCHAR(2),TRY_CONVERT(INT,SUBSTRING(LTRIM(RTRIM(${expression})),CHARINDEX(N'-',LTRIM(RTRIM(${expression})))+1,2))),2)
    )
  ELSE LTRIM(RTRIM(ISNULL(${expression},N''))) END`;

/**
 * exact 차수·품목의 사용자 확정 도착원가만 재고단가 후보로 읽는다.
 * 업로드만 된 자동매칭, 단위 불일치, 출처 불완전 행은 조용히 제외되어 INPUT_REQUIRED로 남는다.
 * 조회 중 evidence table을 만들거나 WebStockPriceEvidence에 복사하지 않는다.
 */
export async function arrivalPriceEvidenceByProduct(orderYear, orderWeek) {
  if (!await hasArrivalEvidenceSchema()) return {};
  const result = await query(`
    SELECT l.ArrivalLineKey,l.ImportKey,l.ProdKey,l.Unit,l.Quantity,
           CASE WHEN ISNULL(l.SelectedArrivalCostKRW,0)>0 THEN l.SelectedArrivalCostKRW
                ELSE l.SourceArrivalCostKRW END AS Price,
           l.SourceFileName,l.SheetName,l.SourceRow,i.RevisionNo,
           confirmation.ChangedBy AS ConfirmedBy,confirmation.ChangedAt AS ConfirmedAt
      FROM dbo.WebArrivalCostLine l
      JOIN dbo.WebArrivalCostImport i ON i.ImportKey=l.ImportKey AND ISNULL(i.IsDeleted,0)=0
      JOIN dbo.Product p ON p.ProdKey=l.ProdKey AND ISNULL(p.isDeleted,0)=0
      CROSS APPLY (
        SELECT TOP 1 h.ChangedBy,h.ChangedAt,h.ActionType
          FROM dbo.WebArrivalCostHistory h
         WHERE h.ArrivalLineKey=l.ArrivalLineKey AND h.ActionType IN (N'MATCH',N'BASIS_CHANGE')
           AND NULLIF(LTRIM(RTRIM(ISNULL(h.ChangedBy,N''))),N'') IS NOT NULL
         ORDER BY h.ChangedAt DESC,h.HistoryKey DESC
      ) confirmation
     WHERE l.OrderYear=@yr AND ${NORMALIZED_ORDER_WEEK_SQL('l.OrderWeek')}=${NORMALIZED_ORDER_WEEK_SQL('@week')}
       AND l.IsCurrent=1 AND l.MatchStatus=N'MATCHED'
       AND ISNULL(l.Quantity,0)>0
       AND (ISNULL(l.SelectedArrivalCostKRW,0)>0 OR ISNULL(l.SourceArrivalCostKRW,0)>0)
       AND NULLIF(LTRIM(RTRIM(ISNULL(l.SourceFileName,N''))),N'') IS NOT NULL
       AND NULLIF(LTRIM(RTRIM(ISNULL(l.SheetName,N''))),N'') IS NOT NULL
       AND ISNULL(l.SourceRow,0)>0 AND ISNULL(i.RevisionNo,0)>0
       AND ${NORMALIZED_UNIT_SQL('l.Unit')}=${NORMALIZED_UNIT_SQL('p.EstUnit')}`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) },
      week: { type: sql.NVarChar, value: String(orderWeek) },
    });
  const grouped = {};
  for (const row of result.recordset) {
    const prodKey = String(row.ProdKey);
    const quantity = Number(row.Quantity || 0);
    const price = Number(row.Price || 0);
    if (!(quantity > 0 && price > 0)) continue;
    if (!grouped[prodKey]) grouped[prodKey] = { weightedValue: 0, quantity: 0, sourceRefs: [], confirmedAt: null };
    grouped[prodKey].weightedValue += quantity * price;
    grouped[prodKey].quantity += quantity;
    grouped[prodKey].sourceRefs.push(`arrival-cost:${orderYear}:${orderWeek}:import-${row.ImportKey}:rev-${row.RevisionNo}:${row.SourceFileName}#${row.SheetName}!row-${row.SourceRow}`);
    const confirmedAt = row.ConfirmedAt ? new Date(row.ConfirmedAt) : null;
    if (confirmedAt && (!grouped[prodKey].confirmedAt || confirmedAt > grouped[prodKey].confirmedAt)) grouped[prodKey].confirmedAt = confirmedAt;
  }
  return Object.fromEntries(Object.entries(grouped).map(([prodKey, item]) => [prodKey, {
    price: item.quantity > 0 ? item.weightedValue / item.quantity : null,
    source: 'VERIFIED_ARRIVAL_COST',
    sourceRefs: item.sourceRefs,
    confirmedAt: item.confirmedAt,
  }]));
}

// 입고 라인의 금액단위 수량 — 이카운트 구매현황 "수량"(D열)과 같은 기준.
// 26차 실측: EstQuantity(전표 금액기준 수량)가 엑셀 D열과 일치(수국 23,090·알스트로 3,200·에콰도르 1,400·베트남 1,600·루스커스 675 완전일치).
// EstQuantity 가 0인 행은 단(Bunch)→송이(Steam)→박스 순 fallback. 분모(매입수량)와 재고수량이 같은 기준이면 비율은 단위 무관.
const WD_UNIT_QTY_EXPR = `
  CASE WHEN ISNULL(wd.EstQuantity,0) > 0 THEN wd.EstQuantity
       WHEN ISNULL(wd.BunchQuantity,0) > 0 THEN wd.BunchQuantity
       WHEN ISNULL(wd.SteamQuantity,0) > 0 THEN wd.SteamQuantity
       ELSE ISNULL(wd.BoxQuantity,0) END`;

function normalizeReportUnit(value) {
  const unit = String(value || '').trim().toUpperCase();
  if (['BOX', 'BX', '박스'].includes(unit)) return '박스';
  if (['BUNCH', 'BUN', '단'].includes(unit)) return '단';
  if (['STEM', 'EA', '스팀', '대', '송이'].includes(unit)) return '송이';
  return unit;
}

/**
 * ProductStock.Stock(출고단위)을 엑셀 재고평가의 EstUnit으로 바꾸는 유일한 허용 규칙.
 * 계수·단위가 없을 때 1배로 추정하면 재고금액을 조용히 왜곡하므로 INPUT_REQUIRED로 남긴다.
 */
export function resolveStockToEstUnitConversion({ outUnit, estUnit, bunchOf1Box, steamOf1Box, steamOf1Bunch } = {}) {
  const from = normalizeReportUnit(outUnit);
  const to = normalizeReportUnit(estUnit);
  const valid = (factor, rule) => Number.isFinite(Number(factor)) && Number(factor) > 0
    ? { status: 'VERIFIED', multiplier: Number(factor), rule }
    : { status: 'INPUT_REQUIRED', multiplier: null, rule, reason: `${from || '출고'}→${to || '금액'} 단위 환산계수가 없습니다.` };
  if (!from || !to) return { status: 'INPUT_REQUIRED', multiplier: null, rule: 'missing-unit', reason: '출고단위 또는 금액단위가 없습니다.' };
  if (from === to) return { status: 'VERIFIED', multiplier: 1, rule: 'same-unit' };
  if (from === '박스' && to === '단') return valid(bunchOf1Box, 'box-to-bunch');
  if (from === '박스' && to === '송이') return valid(steamOf1Box, 'box-to-stem');
  if (from === '단' && to === '송이') return valid(steamOf1Bunch, 'bunch-to-stem');
  return { status: 'INPUT_REQUIRED', multiplier: null, rule: 'unsupported-unit-conversion', reason: `${from}→${to} 환산 규칙이 등록되지 않았습니다.` };
}

// ProductStock.Stock 은 품목의 출고단위(OutUnit), 엑셀 기말재고 수식의 매입수량은
// 금액단위(EstUnit) 기준이다. 두 단위가 다를 때만 품목 마스터의 환산값을 적용한다.
// SQL은 위 순수 규칙과 같은 허용 변환만 반환하며, 계수 없음/미지원 변환은 NULL로 남긴다.
const STOCK_TO_EST_UNIT_EXPR = `
  CASE
    WHEN NULLIF(LTRIM(RTRIM(ISNULL(p.OutUnit,N''))),N'') IS NOT NULL
      AND LTRIM(RTRIM(ISNULL(p.OutUnit,N''))) = LTRIM(RTRIM(ISNULL(p.EstUnit,N''))) THEN 1
    WHEN ISNULL(p.OutUnit,N'') = N'박스' AND ISNULL(p.EstUnit,N'') = N'단'
      THEN CASE WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box ELSE NULL END
    WHEN ISNULL(p.OutUnit,N'') = N'박스' AND ISNULL(p.EstUnit,N'') = N'송이'
      THEN CASE WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box ELSE NULL END
    WHEN ISNULL(p.OutUnit,N'') = N'단' AND ISNULL(p.EstUnit,N'') = N'송이'
      THEN CASE WHEN ISNULL(p.SteamOf1Bunch,0) > 0 THEN p.SteamOf1Bunch ELSE NULL END
    ELSE NULL
  END`;

const STOCK_TO_EST_UNIT_STATUS_EXPR = `
  CASE WHEN (${STOCK_TO_EST_UNIT_EXPR}) IS NULL THEN N'INPUT_REQUIRED' ELSE N'VERIFIED' END`;

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
 * 카테고리 안의 전체 상품매입이 스냅샷으로 덮이지 않으면 부분 평균을 쓰지 않고 다음 공식 원천으로 넘긴다. */
export async function invoiceRatesByCategory(major, orderYear) {
  try {
    const r = await query(
      `SELECT ${CASE_CATEGORY} AS Category,
              SUM(CAST(wd.TPrice AS FLOAT)) AS TotalWeight,
              SUM(CASE WHEN ISNULL(fc.ExchangeRate,0)>0 THEN CAST(wd.TPrice AS FLOAT) ELSE 0 END) AS CoveredWeight,
              SUM(CASE WHEN ISNULL(fc.ExchangeRate,0)>0
                       THEN CAST(wd.TPrice AS FLOAT) * CAST(fc.ExchangeRate AS FLOAT) ELSE 0 END)
                / NULLIF(SUM(CASE WHEN ISNULL(fc.ExchangeRate,0)>0 THEN CAST(wd.TPrice AS FLOAT) ELSE 0 END),0) AS rate
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
         OUTER APPLY (
           SELECT TOP 1 fcx.ExchangeRate
             FROM FreightCost fcx
            WHERE fcx.WarehouseKey=wm.WarehouseKey
              AND ISNULL(fcx.isDeleted,0)=0
              AND ISNULL(fcx.ExchangeRate,0)>0
            ORDER BY fcx.FreightKey DESC
         ) fc
         LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
        WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0
          AND ISNULL(wm.OrderYear,'')=@yr AND ISNULL(wd.TPrice,0)>0
          AND ${stockablePurchaseItemSql('p')}
        GROUP BY ${CASE_CATEGORY}`,
      {
        pfx: { type: sql.NVarChar, value: `${major}-%` },
        yr: { type: sql.NVarChar, value: String(orderYear) },
      }
    );
    // 한 카테고리의 상품 매입 전부가 같은 차수 FreightCost 환율 스냅샷으로 덮일 때만
    // 자동 원천으로 인정한다. 일부 입고만 환율이 있으면 그 일부만 평균한 값은 과세환율이
    // 아니므로 통째로 제외하고, 저장된 공식값/KCS/직접입력 단계로 넘긴다.
    return Object.fromEntries((r.recordset || [])
      .filter((x) => {
        const total = Number(x.TotalWeight || 0);
        const covered = Number(x.CoveredWeight || 0);
        const tolerance = Math.max(0.000001, Math.abs(total) * 1e-9);
        return total > 0 && Math.abs(total - covered) <= tolerance;
      })
      .map(x => [x.Category, Number(x.rate)])
      .filter(([, v]) => Number.isFinite(v) && v > 0));
  } catch {
    // FreightCost가 아직 없거나 조회할 수 없는 차수는 부분값을 추정하지 않고 다음 공식 원천으로 넘긴다.
    return {};
  }
}

/**
 * 선택 대차수에서 nenova.exe 재고현황의 마지막 ProductStock 세부차수를 찾는다.
 *
 * - 27-01/27-02만 존재한다는 가정 금지: 27-03, 27-04도 숫자 순서로 지원한다.
 * - FormStockView/usp_StockCalculation의 실제 원천은 ProductStock 스냅샷이다.
 * - FormStockView는 StockMaster.isFix를 재고 마감 조건으로 읽지 않는다. 보고서도 같은 연도·대차수에서
 *   ProductStock 행이 실제로 있는 마지막 숫자 세부차수를 사용한다.
 * - NULL·시작재고 마커는 전년도/입출고 추정으로 대체하지 않는다.
 * - ProductStock가 없는 빈 StockMaster 행은 제외한다.
 * - 같은 세부차수에 중복 StockMaster가 남아 있으면 ProductStock 행이 가장 많은
 *   StockKey, 그 다음 가장 큰 StockKey를 선택한다.
 *
 * 반환값의 { orderYear, week, stockKey }는 보고서 확정본(REPORT_CONFIRM_SNAPSHOT, lib/profitReportConfirm.js)이
 * begin/end 좌표를 그대로 저장할 때 쓰는 명시적 계약이다. 선택 로직 자체는 바꾸지 않고
 * 호출부에 이미 있던 orderYear를 반환 객체에도 그대로 실어 보낸다(2026-08-11 결함수정 4).
 */
export async function latestStockSnapshotWeek(major, orderYear) {
  const pfx = `${String(major).padStart(2, '0')}-%`;
  const r = await query(
    `SELECT TOP 1 sm.OrderWeek, sm.StockKey
       FROM StockMaster sm
      WHERE sm.OrderYear=@yr
        AND sm.OrderWeek LIKE @pfx
        AND CHARINDEX('-', sm.OrderWeek) > 0
        AND TRY_CONVERT(INT, SUBSTRING(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek)+1, 10)) IS NOT NULL
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
    ? { orderYear: String(orderYear), week: row.OrderWeek, stockKey: Number(row.StockKey), snapshotAvailable: true }
    : { orderYear: String(orderYear), week: null, stockKey: null, snapshotAvailable: false };
}

/** 재고단가표 편집용 — 기초/기말 스냅샷에 재고가 있는 품목 목록 + 적용단가 */
export async function stockPriceRows(major, prevMajor, orderYear, prevOrderYear = orderYear) {
  await ensureStockPriceTable();
  const [endSnapshot, beginSnapshot] = await Promise.all([
    latestStockSnapshotWeek(major, orderYear),
    latestStockSnapshotWeek(prevMajor, prevOrderYear),
  ]);
  const endWeek = endSnapshot.week;
  const beginWeek = beginSnapshot.week;
  if (!endWeek && !beginWeek) return { beginWeek, endWeek, rows: [] };
  const [beginArrival, endArrival] = await Promise.all([
    beginWeek ? arrivalPriceEvidenceByProduct(prevOrderYear, beginWeek) : {},
    endWeek ? arrivalPriceEvidenceByProduct(orderYear, endWeek) : {},
  ]);
  const beginWorkbookCatalog = beginWeek ? inventoryWorkbookPriceEvidenceByProduct(prevOrderYear, beginWeek) : {};
  const endWorkbookCatalog = endWeek ? inventoryWorkbookPriceEvidenceByProduct(orderYear, endWeek) : {};
  const r = await query(
    `SELECT p.ProdKey, p.ProdName, ${CASE_CATEGORY} AS Category,
            p.EstUnit,
            CASE WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box
                 WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box ELSE 1 END AS UnitPerBox,
            MAX(CASE WHEN smk.StockKey=@beginStockKey THEN spe.Price END) AS BeginPrice,
            MAX(CASE WHEN smk.StockKey=@endStockKey THEN spe.Price END) AS SetPrice,
            MAX(CASE WHEN smk.StockKey=@endStockKey THEN spe.Price END) AS AppliedPrice,
            CASE WHEN MAX(CASE WHEN smk.StockKey=@endStockKey THEN spe.Price END) IS NULL
                 THEN N'INPUT_REQUIRED' ELSE N'VERIFIED_EVIDENCE' END AS AppliedSource,
            SUM(CASE WHEN smk.StockKey = @beginStockKey THEN ps.Stock ELSE 0 END) AS StockBegin,
            SUM(CASE WHEN smk.StockKey = @endStockKey THEN ps.Stock ELSE 0 END) AS StockEnd
       FROM ProductStock ps
       JOIN StockMaster smk ON ps.StockKey=smk.StockKey
       JOIN Product p ON ps.ProdKey=p.ProdKey
       LEFT JOIN WebStockPriceEvidence spe ON spe.ProdKey=p.ProdKey
        AND spe.OrderYear=smk.OrderYear AND spe.OrderWeek=smk.OrderWeek
        AND spe.EvidenceStatus=N'VERIFIED' AND spe.SourceRef IS NOT NULL
        AND spe.EffectiveAt IS NOT NULL AND spe.ConfirmedBy IS NOT NULL AND spe.ConfirmedAt IS NOT NULL
      WHERE (smk.StockKey=@beginStockKey OR smk.StockKey=@endStockKey)
        AND ISNULL(ps.Stock,0) > 0
        AND ${stockablePurchaseItemSql('p')}
      GROUP BY p.ProdKey, p.ProdName, p.CounName, p.FlowerName, p.EstUnit, p.SteamOf1Box, p.BunchOf1Box
      ORDER BY 3, p.ProdName`,
    {
      beginStockKey: { type: sql.Int, value: beginSnapshot.stockKey || 0 },
      endStockKey: { type: sql.Int, value: endSnapshot.stockKey || 0 },
    }
  );
  const currentWeekDistributionRows = endWeek
    ? await loadConfirmedCustomerProductPrices(orderYear, major, { prodKeys: r.recordset.map((row) => row.ProdKey) })
    : [];
  const distributionRowsByProduct = new Map();
  for (const row of currentWeekDistributionRows) {
    const key = String(row.prodKey);
    if (!distributionRowsByProduct.has(key)) distributionRowsByProduct.set(key, []);
    distributionRowsByProduct.get(key).push(row);
  }
  const rows = r.recordset.map((row) => {
    const key = String(row.ProdKey);
    const beginCatalog = beginWorkbookCatalog[key];
    const endCatalog = endWorkbookCatalog[key];
    const unit = normalizeInventoryUnit(row.EstUnit);
    const validBeginCatalog = beginCatalog && beginCatalog.unit === unit ? beginCatalog : null;
    const validEndCatalog = endCatalog && endCatalog.unit === unit ? endCatalog : null;
    const beginFallback = row.BeginPrice == null ? beginArrival[key] || validBeginCatalog : null;
    const endFallback = row.SetPrice == null ? endArrival[key] || validEndCatalog : null;
    const beginPrice = row.BeginPrice == null ? beginFallback?.price ?? null : Number(row.BeginPrice);
    const endPrice = row.SetPrice == null ? endFallback?.price ?? null : Number(row.SetPrice);
    const distributionSuggestion = distributionMajorityStockPriceSuggestion({
      category: row.Category,
      rows: distributionRowsByProduct.get(key) || [],
    });
    const suggestionReadAt = new Date().toISOString();
    const suggestionCandidates = (distributionSuggestion?.candidates || []).map((candidate) => ({
      ...candidate,
      sourceRef: `erp:confirmed-distribution:${orderYear}:${major}:prod:${key}:gross:${candidate.grossCost}:customers:${candidate.customerCount}`,
      effectiveAt: suggestionReadAt.slice(0, 10),
    }));
    const primarySuggestion = suggestionCandidates[0] || null;
    return {
      ...row,
      BeginPrice: beginPrice,
      SetPrice: endPrice,
      AppliedPrice: endPrice,
      AppliedSource: row.SetPrice != null ? 'VERIFIED_EVIDENCE' : endFallback?.source || 'INPUT_REQUIRED',
      BeginSource: row.BeginPrice != null ? 'VERIFIED_EVIDENCE' : beginFallback?.source || 'INPUT_REQUIRED',
      ArrivalSourceRefs: endFallback?.sourceRefs || [],
      SuggestedPrice: endPrice == null ? distributionSuggestion?.price ?? null : null,
      SuggestedGrossPrice: distributionSuggestion?.grossCost ?? null,
      SuggestedBasis: distributionSuggestion?.basis || null,
      SuggestionCustomerCount: distributionSuggestion?.customerCount || 0,
      SuggestionDistributionCount: distributionSuggestion?.distributionCount || 0,
      SuggestionEstQuantity: distributionSuggestion?.totalEstQuantity || 0,
      SuggestionCandidates: suggestionCandidates,
      SuggestedSourceRef: primarySuggestion?.sourceRef || null,
      SuggestedEffectiveAt: primarySuggestion?.effectiveAt || null,
    };
  });
  return { beginWeek, endWeek, rows };
}

/** 재고단가 근거 저장 — { prodKey: { price, sourceRef, effectiveAt } } */
export async function saveStockPrices(prices, actor, context = {}) {
  await ensureStockPriceTable();
  const orderYear = String(context.orderYear || '');
  const orderWeek = String(context.orderWeek || '');
  if (!/^\d{4}$/.test(orderYear) || !/^\d{2}-\d{2}$/.test(orderWeek)) {
    const error = new Error('재고단가 근거의 orderYear/orderWeek가 필요합니다.');
    error.code = 'PRICE_EVIDENCE_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  for (const [prodKey, input] of Object.entries(prices || {})) {
    const pk = Number(prodKey);
    if (!pk) continue;
    if (input == null || input === '') {
      await query(
        `UPDATE WebStockPriceEvidence
            SET EvidenceStatus=N'REVOKED', UpdatedBy=@actor, UpdatedAt=GETDATE()
          WHERE OrderYear=@yr AND OrderWeek=@week AND ProdKey=@pk`,
        {
          yr: { type: sql.NVarChar, value: orderYear },
          week: { type: sql.NVarChar, value: orderWeek },
          pk: { type: sql.Int, value: pk },
          actor: { type: sql.NVarChar, value: actor || 'user' },
        },
      );
      continue;
    }
    const effectiveAt = new Date(input?.effectiveAt);
    const confirmedAt = input?.confirmedAt ? new Date(input.confirmedAt) : new Date();
    if (typeof input !== 'object' || !String(input.sourceRef || '').trim()
      || !Number.isFinite(Number(input.price)) || Number(input.price) < 0
      || Number.isNaN(effectiveAt.getTime()) || Number.isNaN(confirmedAt.getTime())) {
      const error = new Error(`ProdKey ${pk}: 유효한 price/sourceRef/effectiveAt가 모두 필요합니다.`);
      error.code = 'PRICE_EVIDENCE_REQUIRED';
      error.statusCode = 400;
      throw error;
    }
    await query(
      `MERGE WebStockPriceEvidence AS t
       USING (SELECT @yr AS OrderYear, @week AS OrderWeek, @pk AS ProdKey) AS s
          ON t.OrderYear=s.OrderYear AND t.OrderWeek=s.OrderWeek AND t.ProdKey=s.ProdKey
       WHEN MATCHED THEN UPDATE SET Price=@price, SourceRef=@sourceRef, EffectiveAt=@effectiveAt,
         ConfirmedBy=@confirmedBy, ConfirmedAt=@confirmedAt, EvidenceStatus=N'VERIFIED', UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, OrderWeek, ProdKey, Price, SourceRef, EffectiveAt, ConfirmedBy, ConfirmedAt, EvidenceStatus, UpdatedBy)
         VALUES (@yr, @week, @pk, @price, @sourceRef, @effectiveAt, @confirmedBy, @confirmedAt, N'VERIFIED', @actor);`,
      {
        yr: { type: sql.NVarChar, value: orderYear },
        week: { type: sql.NVarChar, value: orderWeek },
        pk: { type: sql.Int, value: pk },
        price: { type: sql.Float, value: Number(input.price) },
        sourceRef: { type: sql.NVarChar, value: String(input.sourceRef).trim().slice(0, 500) },
        effectiveAt: { type: sql.DateTime2, value: effectiveAt },
        confirmedBy: { type: sql.NVarChar, value: String(input.confirmedBy || actor || 'user').slice(0, 100) },
        confirmedAt: { type: sql.DateTime2, value: confirmedAt },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      },
    );
  }
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

/** 차수말 재고 스냅샷 집계 — EXE 계산 ProductStock 수량과 같은 차수 VERIFIED 단가 증거를 집계한다.
 * nenova.exe 재고현황과 동일하게 해당 대차수의 마지막 ProductStock 세부차수 Stock을 기말잔량으로 쓴다.
 * ProductStock.Stock(OutUnit)을 품목별 EstUnit으로 조건부 환산해 매입수량 분모와 단위를 맞춘다.
 * 반환: { week, qtys: 재고현황 마지막 Stock 열 합계(EstUnit), values, negativeQtys }
 * 임의로 시작재고+입고−출고를 재계산하지 않는다. EXE 화면의 마지막 Stock 열이 이 보고서의 단일 기준이다. */
export async function stockSnapshotByCategory(major, orderYear) {
  const snapshot = await latestStockSnapshotWeek(major, orderYear);
  const week = snapshot.week;
  if (!week) return {
    week: null, stockKey: null, values: {}, qtys: {}, priceEvidenceStatus: {}, missingPriceCounts: {},
    conversionMissingCounts: {}, conversionIssues: {},
    recentCost: {}, recentCostMissingQty: {}, unitMismatch: {}, negativeQtys: {}, anchored: {},
    selection: 'missing_stock_snapshot', snapshotAvailable: false,
  };
  await ensureStockPriceTable();
  const [r, arrivalEvidence, unitMismatch] = await Promise.all([
    query(
    `SELECT ${CASE_CATEGORY} AS Category,p.ProdKey,p.OutUnit,p.EstUnit,
            ps.Stock * (${STOCK_TO_EST_UNIT_EXPR}) AS q,
            spe.Price AS VerifiedPrice,
            ${STOCK_TO_EST_UNIT_STATUS_EXPR} AS ConversionStatus,
            CASE WHEN ps.Stock < 0 THEN ABS(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) ELSE 0 END AS nq
       FROM ProductStock ps
       JOIN StockMaster smk ON ps.StockKey=smk.StockKey
       JOIN Product p ON ps.ProdKey=p.ProdKey
       LEFT JOIN WebStockPriceEvidence spe ON spe.ProdKey=p.ProdKey
        AND spe.OrderYear=smk.OrderYear AND spe.OrderWeek=smk.OrderWeek
        AND spe.EvidenceStatus=N'VERIFIED' AND spe.SourceRef IS NOT NULL
        AND spe.EffectiveAt IS NOT NULL AND spe.ConfirmedBy IS NOT NULL AND spe.ConfirmedAt IS NOT NULL
      WHERE smk.StockKey=@stockKey AND smk.OrderYear=@yr AND smk.OrderWeek=@week
        AND ISNULL(ps.Stock,0) <> 0
        AND ${stockablePurchaseItemSql('p')}`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) },
      week: { type: sql.NVarChar, value: week },
      stockKey: { type: sql.Int, value: snapshot.stockKey },
    },
    ),
    arrivalPriceEvidenceByProduct(orderYear, week),
    categoryUnitMismatch(major, orderYear, snapshot.stockKey),
  ]);
  const workbookCatalog = inventoryWorkbookPriceEvidenceByProduct(orderYear, week);
  const grouped = {};
  for (const row of r.recordset) {
    const category = row.Category;
    if (!grouped[category]) grouped[category] = {
      value: 0, qty: 0, negativeQty: 0, missing: 0,
      direct: 0, arrival: 0, workbookCatalog: 0, sourceRefs: [],
      conversionMissing: 0, conversionIssues: [],
    };
    const item = grouped[category];
    if (row.ConversionStatus !== 'VERIFIED') {
      item.missing += 1;
      item.conversionMissing += 1;
      item.conversionIssues.push({
        prodKey: Number(row.ProdKey),
        outUnit: normalizeReportUnit(row.OutUnit),
        estUnit: normalizeReportUnit(row.EstUnit),
      });
      continue;
    }
    const qty = Number(row.q || 0);
    const directPrice = row.VerifiedPrice == null ? null : Number(row.VerifiedPrice);
    const arrival = arrivalEvidence[String(row.ProdKey)];
    const catalogCandidate = workbookCatalog[String(row.ProdKey)];
    const catalogEvidence = catalogCandidate
      && catalogCandidate.unit === normalizeInventoryUnit(row.EstUnit)
      ? catalogCandidate
      : null;
    const fallback = arrival || catalogEvidence;
    const price = directPrice == null ? fallback?.price ?? null : directPrice;
    item.qty += qty;
    item.negativeQty += Number(row.nq || 0);
    if (price == null || !Number.isFinite(Number(price))) item.missing += 1;
    else {
      item.value += qty * Number(price);
      if (directPrice != null) item.direct += 1;
      else if (arrival) {
        item.arrival += 1;
        item.sourceRefs.push(...(arrival?.sourceRefs || []));
      } else {
        item.workbookCatalog += 1;
        item.sourceRefs.push(...(catalogEvidence?.sourceRefs || []));
      }
    }
  }
  const categories = Object.entries(grouped);
  return {
    week,
    stockKey: snapshot.stockKey,
    selection: 'latest_product_stock_subweek',
    snapshotAvailable: snapshot.snapshotAvailable,
    values: Object.fromEntries(categories.map(([category, item]) => [category, item.missing ? null : item.value])),
    qtys: Object.fromEntries(categories.map(([category, item]) => [category, item.qty])),
    priceEvidenceStatus: Object.fromEntries(categories.map(([category, item]) => [category,
      item.missing || item.conversionMissing ? 'INPUT_REQUIRED'
        : [item.direct > 0, item.arrival > 0, item.workbookCatalog > 0].filter(Boolean).length > 1 ? 'VERIFIED_MIXED'
          : item.arrival > 0 ? 'VERIFIED_ARRIVAL_COST'
            : item.workbookCatalog > 0 ? 'VERIFIED_WORKBOOK_CATALOG'
              : 'VERIFIED'])),
    priceEvidenceSources: Object.fromEntries(categories.map(([category, item]) => [category, [...new Set(item.sourceRefs)]])),
    missingPriceCounts: Object.fromEntries(categories.map(([category, item]) => [category, item.missing])),
    conversionMissingCounts: Object.fromEntries(categories.map(([category, item]) => [category, item.conversionMissing])),
    conversionIssues: Object.fromEntries(categories.map(([category, item]) => [category, item.conversionIssues])),
    recentCost: {},
    recentCostMissingQty: {},
    unitMismatch,
    negativeQtys: Object.fromEntries(categories.map(([category, item]) => [category, item.negativeQty])),
    // 사용자가 지정한 기준은 nenova.exe 재고현황의 확정 Stock 열이다.
    // 이 소스를 직접 사용한 카테고리는 별도 실사 앵커 경고 대상이 아니다.
    anchored: Object.fromEntries(categories.map(([category]) => [category, true])),
  };
}

/** 카테고리별 구매 통화 — CurrencyMaster 환율을 R 기본값으로 매핑 (청구서 환율과 다르면 수정) */
export { CATEGORY_CURRENCY };
export function currencyCodeForCategory(category) {
  return resolveCurrencyCodeForCategory(category);
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
    `SELECT Category, ColKey, Value, TextValue, SourceRef, EffectiveAt, ConfirmedBy, ConfirmedAt
       FROM WebProfitReport
      WHERE OrderYear=@yr AND MajorWeek=@mw
        AND (Category=N'_note' OR (ColKey IN (N'H',N'R',N'S')
          AND SourceRef IS NOT NULL AND EffectiveAt IS NOT NULL AND ConfirmedBy IS NOT NULL AND ConfirmedAt IS NOT NULL))`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } }
  );
  const manual = {};
  const evidence = {};
  let note = '';
  for (const x of r.recordset) {
    if (x.Category === '_note') { note = x.TextValue || ''; continue; }
    if (!manual[x.Category]) manual[x.Category] = {};
    manual[x.Category][x.ColKey] = x.Value;
    if (!evidence[x.Category]) evidence[x.Category] = {};
    evidence[x.Category][x.ColKey] = {
      sourceRef: x.SourceRef,
      effectiveAt: x.EffectiveAt,
      confirmedBy: x.ConfirmedBy,
      confirmedAt: x.ConfirmedAt,
    };
  }
  return { manual, evidence, note };
}

export async function saveManual(major, orderYear, values, note, actor, evidenceByCategory = {}) {
  await ensureProfitReportTable();
  const upsert = async (category, colKey, value, textValue, evidence = null) => {
    await query(
      `MERGE WebProfitReport AS t
       USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category, @col AS ColKey) AS s
          ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category AND t.ColKey=s.ColKey
       WHEN MATCHED THEN UPDATE SET Value=@val, TextValue=@txt, SourceRef=@sourceRef, EffectiveAt=@effectiveAt,
         ConfirmedBy=@confirmedBy, ConfirmedAt=@confirmedAt, UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, ColKey, Value, TextValue, SourceRef, EffectiveAt, ConfirmedBy, ConfirmedAt, UpdatedBy)
            VALUES (@yr, @mw, @cat, @col, @val, @txt, @sourceRef, @effectiveAt, @confirmedBy, @confirmedAt, @actor);`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) },
        mw: { type: sql.NVarChar, value: major },
        cat: { type: sql.NVarChar, value: category },
        col: { type: sql.NVarChar, value: colKey },
        val: { type: sql.Float, value: value == null || value === '' ? null : Number(value) },
        txt: { type: sql.NVarChar, value: textValue == null ? null : String(textValue).slice(0, 2000) },
        sourceRef: { type: sql.NVarChar, value: evidence?.sourceRef ? String(evidence.sourceRef).slice(0, 500) : null },
        effectiveAt: { type: sql.DateTime2, value: evidence?.effectiveAt ? new Date(evidence.effectiveAt) : null },
        confirmedBy: { type: sql.NVarChar, value: evidence?.confirmedBy ? String(evidence.confirmedBy).slice(0, 100) : null },
        confirmedAt: { type: sql.DateTime2, value: evidence?.confirmedAt ? new Date(evidence.confirmedAt) : null },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      }
    );
  };
  for (const [category, cols] of Object.entries(values || {})) {
    for (const [colKey, value] of Object.entries(cols || {})) {
      if (!['H', 'R', 'S'].includes(colKey)) {
        const error = new Error(`${colKey}는 자동계산 필드이므로 직접입력할 수 없습니다.`);
        error.code = 'AUTOMATIC_FIELD_READ_ONLY';
        error.statusCode = 400;
        throw error;
      }
      const suppliedEvidence = evidenceByCategory?.[category]?.[colKey];
      const effectiveAt = suppliedEvidence?.effectiveAt ? new Date(suppliedEvidence.effectiveAt) : null;
      if (!String(suppliedEvidence?.sourceRef || '').trim() || !effectiveAt || Number.isNaN(effectiveAt.getTime())) {
        const error = new Error(`${category}.${colKey}: 유효한 sourceRef/effectiveAt가 필요합니다.`);
        error.code = 'EXTERNAL_EVIDENCE_REQUIRED';
        error.statusCode = 400;
        throw error;
      }
      const confirmedAt = suppliedEvidence.confirmedAt ? new Date(suppliedEvidence.confirmedAt) : new Date();
      if (Number.isNaN(confirmedAt.getTime())) {
        const error = new Error(`${category}.${colKey}: confirmedAt가 올바르지 않습니다.`);
        error.code = 'EXTERNAL_EVIDENCE_REQUIRED';
        error.statusCode = 400;
        throw error;
      }
      const evidence = {
        ...suppliedEvidence,
        sourceRef: String(suppliedEvidence.sourceRef).trim(),
        effectiveAt,
        confirmedBy: suppliedEvidence.confirmedBy || actor || 'user',
        confirmedAt,
      };
      await upsert(category, colKey, value, null, evidence);
    }
  }
  if (note != null) await upsert('_note', 'note', null, note);
}
