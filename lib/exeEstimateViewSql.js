/**
 * nenova.exe FormEstimateView — GetData / GetDetail SQL (dnSpy decompile parity)
 * Source: Nenova\FormEstimateView.cs (Export to Project)
 */
import { buildOrderYearWeek } from './orderUtils.js';

/** exe ccmbWeekDay 기본값 "2,3,4,5,6,7,1" — CodeInfo WeekDay DetailCode */
export const EXE_WEEKDAY_CODE_KR = {
  일: 1,
  월: 2,
  화: 3,
  수: 4,
  목: 5,
  금: 6,
  토: 7,
};

const EXE_WEEKDAY_ALL = '1,2,3,4,5,6,7';

/**
 * @param {string} parentWeek - "26" or "26-01"
 * @param {string|number} orderYear
 */
export function buildEstimateOrderYearWeek(orderYear, parentWeek) {
  const pw = String(parentWeek || '').split('-')[0];
  return buildOrderYearWeek(String(orderYear || new Date().getFullYear()), pw);
}

/**
 * @param {Iterable<string>|string[]|null} activeWdKr - 월,화,… Set 또는 배열. 7개=전체
 * @returns {string} SQL IN 목록 (예: "2,3,4")
 */
export function activeWdKrToExeSqlIn(activeWdKr) {
  if (!activeWdKr) return EXE_WEEKDAY_ALL;
  const arr = [...activeWdKr];
  if (arr.length >= 7) return EXE_WEEKDAY_ALL;
  if (arr.length === 0) return '0';
  const codes = arr.map((d) => EXE_WEEKDAY_CODE_KR[d]).filter((n) => Number.isFinite(n));
  return codes.length ? codes.join(',') : '0';
}

/**
 * exe GetData — 왼쪽 출고(거래처) 목록
 * @param {object} opts
 * @param {string} opts.orderYearWeek - sm.OrderYearWeek (예: 202626)
 * @param {number|null} opts.custKey
 * @param {string} opts.weekDayIn - "1,2,3,4,5,6,7"
 */
export function sqlEstimateGetData({ orderYearWeek, custKey, weekDayIn }) {
  const custFilter = custKey ? 'AND sm.CustKey = @custKey' : '';        // 차감(Estimate) CTE — sm 유지
  const custFilterVs = custKey ? 'AND vs.CustKey = @custKey' : '';      // 정상출고 CTE — ViewShipment(vs)
  // 정상출고 소스: exe v1.0.15 와 동일하게 ViewShipment(vs)+ViewOrder(vo) 사용.
  // 매칭키 OrderYearWeek2+CustKey+ProdKey (품목 단위), 확정판정 vs.DetailFix=1.
  return `
WITH ShipmentList AS (
  SELECT vs.OrderYearWeek,
         vs.OrderYear,
         vs.OrderWeek,
         vs.CustKey,
         c.CustName,
         (ISNULL(sdd.Amount, 0) + ISNULL(sdd.Vat, 0)) AS Amount,
         vs.ShipmentKey
    FROM ViewShipment vs
    JOIN ViewOrder vo
      ON vs.OrderYearWeek2 = vo.OrderYearWeek2
     AND vs.CustKey = vo.CustKey
     AND vs.ProdKey = vo.ProdKey
    JOIN ShipmentDate sdd ON vs.SdetailKey = sdd.SdetailKey
    JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
    JOIN Customer c ON vs.CustKey = c.CustKey
   WHERE vs.OrderYearWeek = @orderYearWeek
     ${custFilterVs}
     AND vs.DetailFix = 1
     AND pd.WeekDay IN (${weekDayIn})
     AND sdd.EstQuantity > 0
  UNION ALL
  SELECT sm.OrderYearWeek,
         sm.OrderYear,
         sm.OrderWeek,
         sm.CustKey,
         c.CustName,
         (ISNULL(e.Amount, 0) + ISNULL(e.Vat, 0)) AS Amount,
         sm.ShipmentKey
    FROM Estimate e
    JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
    JOIN PeriodDay pd ON e.EstimateDtm = pd.BaseYmd
    JOIN CodeInfo ci ON e.EstimateType = ci.DetailCode AND ci.Category = N'EstimateType'
    JOIN Customer c ON sm.CustKey = c.CustKey
   WHERE sm.OrderYearWeek = @orderYearWeek
     ${custFilter}
     AND pd.WeekDay IN (${weekDayIn})
)
SELECT sl.OrderYearWeek,
       MIN(LEFT(sl.OrderWeek, CHARINDEX('-', sl.OrderWeek + N'-') - 1)) AS ParentWeek,
       sl.CustKey,
       sl.CustName,
       sl.MinShipmentKey AS ShipmentKey,
       sl.MinShipmentKey AS firstShipmentKey,
       SUM(sl.Amount) AS totalAmount,
       SUM(sl.Amount) AS Amount,
       STUFF((
         SELECT ',' + CAST(sm2.ShipmentKey AS NVARCHAR(20))
           FROM ShipmentMaster sm2
          WHERE sm2.CustKey = sl.CustKey
            AND sm2.OrderYearWeek = @orderYearWeek
            AND sm2.isDeleted = 0
          FOR XML PATH(''), TYPE
       ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS ShipmentKeys,
       STUFF((
         SELECT ',' + sm2.OrderWeek
           FROM ShipmentMaster sm2
          WHERE sm2.CustKey = sl.CustKey
            AND sm2.OrderYearWeek = @orderYearWeek
            AND sm2.isDeleted = 0
          FOR XML PATH(''), TYPE
       ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS SubWeeks
  FROM (
    SELECT *,
           FIRST_VALUE(ShipmentKey) OVER (
             PARTITION BY OrderYearWeek, CustKey ORDER BY OrderWeek ASC
           ) AS MinShipmentKey
      FROM ShipmentList
  ) sl
 GROUP BY sl.OrderYearWeek, sl.CustKey, sl.CustName, sl.MinShipmentKey
 ORDER BY sl.CustKey`;
}

/**
 * exe GetDetail — 거래처 견적 상세 (출고일별 1행)
 * 요일 필터 없음 — exe는 grdViewEstimate.ActiveFilterString 으로 클라이언트 필터
 */
export function sqlEstimateGetDetail({ orderYearWeek, custKey }) {
  return `
WITH list AS (
  SELECT vs.ProdKey,
         sdd.SdateKey AS DetailKey,
         0 AS Sort,
         N'' AS EstimateType,
         sdd.ShipmentDtm,
         pd.WeekDay,
         vvs.TotalQuantity,
         ISNULL(sdd.EstQuantity, 0) AS EstQuantity,
         sdd.Cost AS Cost,
         sdd.Amount AS Amount,
         sdd.Vat AS Vat,
         sdd.Descr AS Descr
    FROM ViewShipment vs
    JOIN ViewOrder vo
      ON vs.OrderYearWeek2 = vo.OrderYearWeek2
     AND vs.CustKey = vo.CustKey
     AND vs.ProdKey = vo.ProdKey
    JOIN ShipmentDate sdd ON vs.SdetailKey = sdd.SdetailKey
    JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
    JOIN (
      SELECT OrderYearWeek, CustKey, ProdKey, SUM(vs.EstQuantity) AS TotalQuantity
        FROM ViewShipment vs
       GROUP BY OrderYearWeek, CustKey, ProdKey
    ) vvs
      ON vs.OrderYearWeek = vvs.OrderYearWeek
     AND vs.CustKey = vvs.CustKey
     AND vs.ProdKey = vvs.ProdKey
   WHERE vs.OrderYearWeek = @orderYearWeek
     AND vs.CustKey = @custKey
     AND vs.DetailFix = 1
     AND ISNULL(vs.EstQuantity, 0) > 0
  UNION ALL
  SELECT e.ProdKey,
         e.EstimateKey AS DetailKey,
         1 AS Sort,
         ci.Descr2 AS EstimateType,
         e.EstimateDtm AS ShipmentDtm,
         pd.WeekDay,
         e.Quantity AS TotalQuantity,
         e.Quantity AS EstQuantity,
         e.Cost,
         e.Amount,
         e.Vat,
         e.Descr
    FROM Estimate e
    JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
    JOIN PeriodDay pd ON e.EstimateDtm = pd.BaseYmd
    JOIN CodeInfo ci ON e.EstimateType = ci.DetailCode AND ci.Category = N'EstimateType'
   WHERE sm.OrderYearWeek = @orderYearWeek
     AND sm.CustKey = @custKey
),
ProductSortLookup AS (
  SELECT p.ProdKey,
         ps.OrderNo,
         ps.GroupNo,
         ROW_NUMBER() OVER (
           PARTITION BY p.ProdKey
           ORDER BY CASE
             WHEN p.CounName = ps.CounName AND p.FlowerName = ps.FlowerName THEN 1
             WHEN p.CountryFlower = ps.CountryFlower THEN 2
             ELSE 99
           END
         ) AS rank_priority
    FROM Product p
    JOIN ProductSort ps
      ON (p.CounName = ps.CounName AND p.FlowerName = ps.FlowerName)
      OR (p.CountryFlower = ps.CountryFlower)
)
SELECT ROW_NUMBER() OVER (
         ORDER BY l.Sort, ISNULL(psl.OrderNo, 99), p.CounName, p.ProdName
       ) AS RowNum,
       l.ProdKey,
       l.DetailKey,
       l.Sort,
       CASE WHEN l.Sort = 0 THEN p.ProdName
            ELSE N'[' + l.EstimateType + N'] ' + ISNULL(p.ProdName, N'')
       END AS ProdName,
       ROUND(l.TotalQuantity, 0) AS TotalQuantity,
       ROUND(l.EstQuantity, 0) AS EstQuantity,
       l.ShipmentDtm,
       l.WeekDay,
       (pd.baseday + N'(' + ci.Descr2 + N')') AS ShipmentDay,
       p.EstUnit AS Unit,
       (CAST(ROUND(l.EstQuantity, 0) AS NVARCHAR) + ISNULL(p.EstUnit, N'')) AS UnitQuantity,
       p.CounName,
       p.FlowerName,
       p.CountryFlower,
       ISNULL(psl.OrderNo, 99) AS OrderNo,
       ISNULL(psl.GroupNo, 99) AS GroupNo,
       l.Cost,
       l.Amount,
       l.Vat,
       l.Descr,
       sd.SdetailKey,
       sd.ShipmentKey,
       sm.OrderWeek,
       l.EstimateType AS EstimateTypeRaw,
       e.EstimateKey
  FROM list l
  JOIN PeriodDay pd ON l.ShipmentDtm = pd.BaseYmd
  JOIN CodeInfo ci ON ci.Category = N'WeekDay' AND ci.DetailCode = pd.WeekDay
  LEFT JOIN Product p ON l.ProdKey = p.ProdKey
  LEFT JOIN ProductSortLookup psl ON p.ProdKey = psl.ProdKey AND psl.rank_priority = 1
  LEFT JOIN Estimate e ON l.Sort = 1 AND e.EstimateKey = l.DetailKey
  LEFT JOIN ShipmentDate sd ON l.Sort = 0 AND sd.SdateKey = l.DetailKey
  LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
 ORDER BY l.Sort,
          l.EstimateType,
          ISNULL(psl.OrderNo, 99),
          p.CounName,
          p.ProdName`;
}

/**
 * exe GetPrintDetail — 인쇄용 품목 집계 (요일 SQL 필터)
 */
export function sqlEstimateGetPrintDetail({ orderYearWeek, custKey, weekDayIn }) {
  return `
WITH list AS (
  SELECT vs.ProdKey,
         0 AS Sort,
         N'' AS EstimateType,
         SUM(sdd.EstQuantity) AS EstQuantity,
         sdd.Cost AS Cost,
         SUM(sdd.Amount) AS Amount,
         SUM(sdd.Vat) AS Vat,
         MAX(sdd.Descr) AS Descr
    FROM ViewShipment vs
    JOIN ViewOrder vo
      ON vs.OrderYearWeek2 = vo.OrderYearWeek2
     AND vs.CustKey = vo.CustKey
     AND vs.ProdKey = vo.ProdKey
    JOIN ShipmentDate sdd ON vs.SdetailKey = sdd.SdetailKey
    JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
   WHERE vs.OrderYearWeek = @orderYearWeek
     AND vs.CustKey = @custKey
     AND pd.WeekDay IN (${weekDayIn})
     AND vs.DetailFix = 1
     AND sdd.EstQuantity > 0
   GROUP BY vs.ProdKey, sdd.Cost
  UNION ALL
  SELECT e.ProdKey,
         1 AS Sort,
         ci.Descr2 AS EstimateType,
         e.Quantity AS EstQuantity,
         e.Cost,
         e.Amount,
         e.Vat,
         e.Descr
    FROM Estimate e
    JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
    JOIN PeriodDay pd ON e.EstimateDtm = pd.BaseYmd
    JOIN CodeInfo ci ON e.EstimateType = ci.DetailCode AND ci.Category = N'EstimateType'
   WHERE sm.OrderYearWeek = @orderYearWeek
     AND sm.CustKey = @custKey
     AND pd.WeekDay IN (${weekDayIn})
),
ProductSortLookup AS (
  SELECT p.ProdKey,
         ps.OrderNo,
         ps.GroupNo,
         ps.GroupName,
         ROW_NUMBER() OVER (
           PARTITION BY p.ProdKey
           ORDER BY CASE
             WHEN p.CounName = ps.CounName AND p.FlowerName = ps.FlowerName THEN 1
             WHEN p.CountryFlower = ps.CountryFlower THEN 2
             ELSE 99
           END
         ) AS rank_priority
    FROM Product p
    JOIN ProductSort ps
      ON (p.CounName = ps.CounName AND p.FlowerName = ps.FlowerName)
      OR (p.CountryFlower = ps.CountryFlower)
)
SELECT ROW_NUMBER() OVER (
         ORDER BY l.Sort, ISNULL(psl.OrderNo, 99), p.CounName, p.ProdName
       ) AS RowNum,
       CASE WHEN l.Sort = 0 THEN p.ProdName
            ELSE N'[' + l.EstimateType + N'] ' + ISNULL(p.ProdName, N'')
       END AS ProdName,
       ROUND(l.EstQuantity, 0) AS EstQuantity,
       (CAST(ROUND(l.EstQuantity, 0) AS NVARCHAR) + ISNULL(p.EstUnit, N'')) AS UnitQuantity,
       ISNULL(psl.OrderNo, 99) AS OrderNo,
       ISNULL(psl.GroupNo, 99) AS GroupNo,
       ISNULL(psl.GroupName, N'') AS GroupName,
       l.Cost,
       l.Amount,
       l.Vat,
       l.Descr,
       l.Sort,
       l.EstimateType AS EstimateTypeRaw,
       l.ProdKey
  FROM list l
  LEFT JOIN Product p ON l.ProdKey = p.ProdKey
  LEFT JOIN ProductSortLookup psl ON p.ProdKey = psl.ProdKey AND psl.rank_priority = 1
 ORDER BY l.Sort,
          l.EstimateType,
          ISNULL(psl.OrderNo, 99),
          p.CounName,
          p.ProdName`;
}

/** exe grdViewEstimate.ActiveFilterString — WeekDay IN (CodeInfo DetailCode) */
export function filterItemsByExeWeekDay(items, activeWdKr) {
  const codes = new Set(
    activeWdKrToExeSqlIn(activeWdKr)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter(Number.isFinite)
  );
  if (codes.size >= 7) return [...(items || [])];
  if (codes.size === 0) return [];
  return (items || []).filter((item) => {
    const wd = Number(item.WeekDay);
    return Number.isFinite(wd) && codes.has(wd);
  });
}

/**
 * exe GetExcelDetail — 이카운트 업로드용 집계
 */
export function sqlEstimateGetExcelDetail({ orderYearWeek, custKey, weekDayIn }) {
  // 정상출고 소스: exe v1.0.15 와 동일 ViewShipment(vs)+ViewOrder(vo). p 조인은 ProdCode/ProdName 위해 유지.
  return `
WITH ShipmentList AS (
  SELECT vs.OrderYearWeek, vs.OrderYear, vs.OrderWeek, vs.ShipmentKey, vs.CustKey,
         c.CustCode, c.CustName, c.Manager,
         sdd.Descr, p.ProdCode, p.ProdName,
         sdd.EstQuantity, sdd.Cost, sdd.Amount, sdd.Vat
    FROM ViewShipment vs
    JOIN ViewOrder vo
      ON vs.OrderYearWeek2 = vo.OrderYearWeek2
     AND vs.CustKey = vo.CustKey
     AND vs.ProdKey = vo.ProdKey
    JOIN ShipmentDate sdd ON vs.SdetailKey = sdd.SdetailKey
    JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
    JOIN Customer c ON vs.CustKey = c.CustKey
    JOIN Product p ON vs.ProdKey = p.ProdKey AND p.isDeleted = 0
   WHERE vs.OrderYearWeek = @orderYearWeek
     AND vs.CustKey = @custKey
     AND vs.DetailFix = 1
     AND pd.WeekDay IN (${weekDayIn})
     AND sdd.EstQuantity > 0
  UNION ALL
  SELECT sm.OrderYearWeek, sm.OrderYear, sm.OrderWeek, sm.ShipmentKey, sm.CustKey,
         c.CustCode, c.CustName, c.Manager,
         p.ProdName AS Descr, ci.DetailCode AS ProdCode, ci.Descr AS ProdName,
         e.Quantity, ROUND(e.Cost, 0), ROUND(e.Amount, 0), ROUND(e.Vat, 0)
    FROM Estimate e
    JOIN ShipmentMaster sm ON e.ShipmentKey = sm.ShipmentKey
    JOIN PeriodDay pd ON e.EstimateDtm = pd.BaseYmd
    JOIN CodeInfo ci ON e.EstimateType = ci.DetailCode AND ci.Category = N'EstimateType'
    JOIN Customer c ON sm.CustKey = c.CustKey
    JOIN Product p ON e.ProdKey = p.ProdKey
   WHERE sm.OrderYearWeek = @orderYearWeek
     AND sm.CustKey = @custKey
     AND pd.WeekDay IN (${weekDayIn})
)
SELECT FORMAT(GETDATE(), 'yyyy-MM-dd') AS EstDate,
       sl.MinShipmentKey AS ShipmentKey,
       sl.CustCode, sl.CustName, sl.Manager,
       N'11' AS EstType,
       sl.Descr,
       sl.ProdCode,
       sl.ProdName,
       SUM(sl.EstQuantity) AS EstQuantity,
       sl.Cost,
       SUM(sl.Amount) AS Amount,
       SUM(sl.Vat) AS Vat
  FROM (
    SELECT *,
           FIRST_VALUE(ShipmentKey) OVER (
             PARTITION BY OrderYearWeek, CustKey ORDER BY OrderWeek ASC
           ) AS MinShipmentKey
      FROM ShipmentList
  ) sl
 GROUP BY sl.MinShipmentKey, sl.CustCode, sl.CustName, sl.Manager,
          sl.ProdCode, sl.ProdName, sl.Cost, sl.Descr
 ORDER BY sl.MinShipmentKey`;
}

/** DB 행 → 견적 API item (웹 UI 호환) */
export function mapExeDetailRowToWebItem(row) {
  const sort = Number(row.Sort) || 0;
  const estQty = Number(row.EstQuantity) || 0;
  const isDeduction = sort !== 0;
  return {
    EstimateKey: row.EstimateKey ?? (isDeduction ? row.DetailKey : null),
    EstimateType: isDeduction ? (row.EstimateTypeRaw || row.EstimateType || '') : '정상출고',
    ShipmentKey: row.ShipmentKey,
    SdetailKey: row.SdetailKey ?? null,
    SdateKey: sort === 0 ? row.DetailKey : null,
    ProdKey: row.ProdKey,
    OrderWeek: row.OrderWeek,
    ProdName: row.ProdName,
    FlowerName: row.FlowerName || '',
    CounName: row.CounName || '',
    CountryFlower: row.CountryFlower || '',
    Unit: row.Unit || '',
    Quantity: estQty,
    TotalQuantity: Number(row.TotalQuantity) || 0,
    Cost: Number(row.Cost) || 0,
    Amount: Number(row.Amount) || 0,
    Vat: Number(row.Vat) || 0,
    Descr: row.Descr || '',
    DescrRaw: row.Descr || '',
    outDate: row.ShipmentDtm
      ? new Date(row.ShipmentDtm).toISOString().slice(0, 10)
      : '',
    WeekDay: row.WeekDay,
    ShipmentDay: row.ShipmentDay,
    RowNum: row.RowNum,
    OrderNo: row.OrderNo,
    GroupNo: row.GroupNo,
    _exeParity: true,
  };
}
