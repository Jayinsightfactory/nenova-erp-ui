// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 구조.
// nenova.exe DB 에서 자동으로 채울 수 있는 열(N순수매출·L불량·O그외매출·Q구매외화·S포워딩·R환율기본)은 SQL 로,
// 외부 확정값(H 통관비·R 과세환율·S 포워딩)과 비고만 웹 전용 테이블에 저장한다.
// E/F는 확정 ProductStock + 해당 스냅샷 시점 단가 근거로만 평가하며 최종값 override를 금지한다.
// H의 국가별 GW/CW와 콜롬비아 트럭 등급은 입고관리 원장에서 자동 병합한다.
import { query, sql } from './db';
import { formatUnclassifiedNote, composeProfitReportNote } from './profitReportNotes.js';
import {
  CATEGORIES,
  EXTRA_CATEGORY,
  classifyCategory,
  isNonValueWeightItem,
} from './profitReportClassification.js';
import {
  buildProfitReportCategorySql,
  CATEGORY_CURRENCY,
  currencyCodeForCategory as resolveCurrencyCodeForCategory,
} from './profitReportCountryResolver.js';
import { assertWebSchemaContract } from './webSchemaContract.js';

export { formatUnclassifiedNote, composeProfitReportNote } from './profitReportNotes.js';
export { CATEGORIES, EXTRA_CATEGORY, classifyCategory, isNonValueWeightItem, profitReportCategoriesForWeek } from './profitReportCountryResolver.js';

// 엑셀 8~23행 품명 순서 그대로

/** SQL 집계에서 중량 행을 제외할 때 사용하는 조건. alias는 해당 Product 별칭이다. */
const nonValueWeightSql = (alias = 'p') => `NOT (
  UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGHT%'
  OR UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%CHARGEABLE WEIGTH%'
  OR UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%GROSS WEIGHT%'
  OR UPPER(LTRIM(RTRIM(ISNULL(${alias}.ProdName,N'')))) LIKE N'%GROSS WEIGTH%'
)`;

// ── 외부 확정값 저장 schema 확인. 생성/변경은 docs/migrations만 담당한다.
let _ensured = null;
export async function ensureProfitReportTable() {
  if (_ensured) return _ensured;
  _ensured = assertWebSchemaContract('profit-report-inputs@2', [
    { table: 'WebProfitReport', columns: ['OrderYear', 'MajorWeek', 'Category', 'ColKey', 'Value', 'TextValue', 'UpdatedBy', 'UpdatedAt', 'SourceRef', 'EffectiveAt', 'ConfirmedBy', 'ConfirmedAt'] },
  ]);
  return _ensured;
}

const CASE_CATEGORY = buildProfitReportCategorySql('p');

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
          AND NOT (ISNULL(p.ProdName,N'') LIKE N'%운송료%' OR ISNULL(p.ProdName,N'')=N'SERVICE FEE')
          AND ${nonValueWeightSql('p')}
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
 * 운송료/SERVICE FEE는 S 포워딩에서 별도 집계하므로 Q에서 제외한다(22~26차 엑셀 Q 총계와 운영 전표 대조). */
export async function purchaseByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(ISNULL(wd.TPrice,0)) AS v
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
        AND NOT (ISNULL(p.ProdName,N'') LIKE N'%운송료%' OR ISNULL(p.ProdName,N'')=N'SERVICE FEE')
        AND ${nonValueWeightSql('p')}
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

const APPLIED_PRICE_EXPR = `spe.Price`;

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
        AND NOT (ISNULL(p.ProdName,N'') LIKE N'%운송료%' OR ISNULL(p.ProdName,N'')=N'SERVICE FEE')
        AND ${nonValueWeightSql('p')}
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.q)]));
}

/** 차수별 청구서 환율 — FreightCost.ExchangeRate(BILL 시점 스냅샷)를 구매금액 가중평균으로 집계.
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
          AND NOT (ISNULL(p.ProdName,N'') LIKE N'%운송료%' OR ISNULL(p.ProdName,N'')=N'SERVICE FEE')
          AND ${nonValueWeightSql('p')}
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
 * - 보고서 E/F는 StockMaster.isFix=1인 확정 ProductStock 스냅샷만 사용한다.
 *   미확정·NULL·시작재고 마커는 전년도/입출고 추정으로 대체하지 않는다.
 * - ProductStock가 없는 빈 StockMaster 행은 제외한다.
 * - 같은 세부차수에 중복 StockMaster가 남아 있으면 ProductStock 행이 가장 많은
 *   StockKey, 그 다음 가장 큰 StockKey를 선택한다.
 */
export async function latestStockSnapshotWeek(major, orderYear) {
  const pfx = `${String(major).padStart(2, '0')}-%`;
  const r = await query(
    `SELECT TOP 1 sm.OrderWeek, sm.StockKey, ISNULL(sm.isFix,0) AS isFix
       FROM StockMaster sm
      WHERE sm.OrderYear=@yr
        AND sm.OrderWeek LIKE @pfx
        AND sm.OrderWeek LIKE '__-__'
        AND ISNULL(sm.isFix,0)=1
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
    ? { week: row.OrderWeek, stockKey: Number(row.StockKey), isFix: Number(row.isFix) === 1, stockMasterIsFix: Number(row.isFix) }
    : { week: null, stockKey: null, isFix: false, stockMasterIsFix: null };
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
  const r = await query(
    `SELECT p.ProdKey, p.ProdName, ${CASE_CATEGORY} AS Category,
            CASE WHEN ISNULL(p.SteamOf1Box,0) > 0 THEN p.SteamOf1Box
                 WHEN ISNULL(p.BunchOf1Box,0) > 0 THEN p.BunchOf1Box ELSE 1 END AS UnitPerBox,
            ISNULL(p.Cost,0) AS Cost, MAX(spe.Price) AS SetPrice,
            MAX(spe.Price) AS AppliedPrice,
            CASE WHEN MAX(spe.Price) IS NULL THEN N'INPUT_REQUIRED' ELSE N'VERIFIED_EVIDENCE' END AS AppliedSource,
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
        AND ISNULL(smk.isFix,0)=1
        AND ISNULL(ps.Stock,0) > 0
        AND ${nonValueWeightSql('p')}
      GROUP BY p.ProdKey, p.ProdName, p.CounName, p.FlowerName, p.SteamOf1Box, p.BunchOf1Box, p.Cost
      ORDER BY 3, p.ProdName`,
    {
      beginStockKey: { type: sql.Int, value: beginSnapshot.stockKey || 0 },
      endStockKey: { type: sql.Int, value: endSnapshot.stockKey || 0 },
    }
  );
  return { beginWeek, endWeek, rows: r.recordset };
}

/** 재고단가 저장 — { prodKey: price(null=지정 해제) } */
export async function saveStockPrices(prices, actor, context = {}) {
  await ensureStockPriceTable();
  const orderYear = String(context.orderYear || '');
  const orderWeek = String(context.orderWeek || '');
  if (!/^\d{4}$/.test(orderYear) || !/^\d{2}-\d{2}$/.test(orderWeek)) {
    const error = new Error('재고단가 근거의 orderYear/orderWeek가 필요합니다.');
    error.code = 'PRICE_EVIDENCE_REQUIRED'; error.statusCode = 400; throw error;
  }
  for (const [prodKey, input] of Object.entries(prices || {})) {
    const pk = Number(prodKey);
    if (!pk) continue;
    if (input == null || input === '') {
      await query(`DELETE FROM WebStockPriceEvidence WHERE OrderYear=@yr AND OrderWeek=@week AND ProdKey=@pk`, {
        yr: { type: sql.NVarChar, value: orderYear }, week: { type: sql.NVarChar, value: orderWeek }, pk: { type: sql.Int, value: pk },
      });
    } else {
      if (typeof input !== 'object' || !input.sourceRef || !input.effectiveAt || !Number.isFinite(Number(input.price))) {
        const error = new Error(`ProdKey ${pk}: price/sourceRef/effectiveAt가 모두 필요합니다.`);
        error.code = 'PRICE_EVIDENCE_REQUIRED'; error.statusCode = 400; throw error;
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
          sourceRef: { type: sql.NVarChar, value: String(input.sourceRef).slice(0, 500) },
          effectiveAt: { type: sql.DateTime2, value: new Date(input.effectiveAt) },
          confirmedBy: { type: sql.NVarChar, value: String(input.confirmedBy || actor || 'user').slice(0, 100) },
          confirmedAt: { type: sql.DateTime2, value: input.confirmedAt ? new Date(input.confirmedAt) : new Date() },
          actor: { type: sql.NVarChar, value: actor || 'user' },
        }
      );
    }
  }
}

/** 차수말 재고 스냅샷 집계 — 확정 ProductStock 수량과 같은 스냅샷 시점 확정 단가만 사용한다.
 * nenova.exe 재고현황과 동일하게 해당 대차수의 마지막 ProductStock 세부차수 Stock을 기말잔량으로 쓴다.
 * ProductStock.Stock(OutUnit)을 품목별 EstUnit으로 조건부 환산해 매입수량 분모와 단위를 맞춘다.
 * 단가 근거가 하나라도 없으면 해당 카테고리 values는 NULL이며 INPUT_REQUIRED로 반환한다.
 * 임의로 시작재고+입고−출고를 재계산하지 않는다. EXE 화면의 마지막 Stock 열이 이 보고서의 단일 기준이다. */
export async function stockSnapshotByCategory(major, orderYear) {
  const snapshot = await latestStockSnapshotWeek(major, orderYear);
  const week = snapshot.week;
  if (!week) return { week: null, stockKey: null, values: {}, qtys: {}, priceEvidenceStatus: {}, missingPriceCounts: {}, negativeQtys: {}, anchored: {}, selection: 'missing_stock_snapshot', stockMasterIsFix: null };
  await ensureStockPriceTable();
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category,
            CASE WHEN SUM(CASE WHEN spe.Price IS NULL THEN 1 ELSE 0 END) > 0 THEN NULL
                 ELSE SUM(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR}) * (${APPLIED_PRICE_EXPR})) END AS v,
            SUM(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) AS q,
            SUM(CASE WHEN spe.Price IS NULL THEN 1 ELSE 0 END) AS MissingPriceCount,
            SUM(CASE WHEN ps.Stock < 0
                     THEN ABS(ps.Stock * (${STOCK_TO_EST_UNIT_EXPR})) ELSE 0 END) AS nq
       FROM ProductStock ps
       JOIN StockMaster smk ON ps.StockKey=smk.StockKey
       JOIN Product p ON ps.ProdKey=p.ProdKey
       LEFT JOIN WebStockPriceEvidence spe ON spe.ProdKey=p.ProdKey
        AND spe.OrderYear=smk.OrderYear AND spe.OrderWeek=smk.OrderWeek
        AND spe.EvidenceStatus=N'VERIFIED' AND spe.SourceRef IS NOT NULL
        AND spe.EffectiveAt IS NOT NULL AND spe.ConfirmedBy IS NOT NULL AND spe.ConfirmedAt IS NOT NULL
      WHERE smk.StockKey=@stockKey AND smk.OrderYear=@yr AND smk.OrderWeek=@week
        AND ISNULL(smk.isFix,0)=1
        AND ISNULL(ps.Stock,0) <> 0
        AND ${nonValueWeightSql('p')}
      GROUP BY ${CASE_CATEGORY}`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) },
      week: { type: sql.NVarChar, value: week },
      stockKey: { type: sql.Int, value: snapshot.stockKey },
    }
  );
  return {
    week,
    stockKey: snapshot.stockKey,
    selection: 'latest_fixed_stock_subweek',
    stockMasterIsFix: snapshot.stockMasterIsFix,
    values: Object.fromEntries(r.recordset.map(x => [x.Category, x.v == null ? null : Number(x.v)])),
    qtys: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.q)])),
    priceEvidenceStatus: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.MissingPriceCount) === 0 ? 'VERIFIED' : 'INPUT_REQUIRED'])),
    missingPriceCounts: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.MissingPriceCount || 0)])),
    negativeQtys: Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.nq)])),
    // 사용자가 지정한 기준은 nenova.exe 재고현황의 확정 Stock 열이다.
    // 이 소스를 직접 사용한 카테고리는 별도 실사 앵커 경고 대상이 아니다.
    anchored: Object.fromEntries(r.recordset.map(x => [x.Category, true])),
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
  await ensureProfitReportTable();
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
  await ensureProfitReportTable();
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
    evidence[x.Category][x.ColKey] = { sourceRef: x.SourceRef, effectiveAt: x.EffectiveAt, confirmedBy: x.ConfirmedBy, confirmedAt: x.ConfirmedAt };
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
        error.code = 'AUTOMATIC_FIELD_READ_ONLY'; error.statusCode = 400; throw error;
      }
      const suppliedEvidence = evidenceByCategory?.[category]?.[colKey];
      if (!suppliedEvidence?.sourceRef || !suppliedEvidence?.effectiveAt) {
        const error = new Error(`${category}.${colKey}: sourceRef/effectiveAt가 필요합니다.`);
        error.code = 'EXTERNAL_EVIDENCE_REQUIRED'; error.statusCode = 400; throw error;
      }
      const evidence = { ...suppliedEvidence, confirmedBy: suppliedEvidence.confirmedBy || actor || 'user', confirmedAt: suppliedEvidence.confirmedAt || new Date() };
      await upsert(category, colKey, value, null, evidence);
    }
  }
  if (note != null) await upsert('_note', 'note', null, note);
}
