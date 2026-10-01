import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { SOURCE, MAX_ROWS, WeekdayBaselineError, normalizeBaselineScope, canonicalRows, baselineDigest } from './weekdayInitialBaselineStore.js';

// One SELECT rowset verifies the active customer even when the scoped inventory is empty.
// HOLDLOCK keeps the scoped inventory, totals and dates consistent until this statement ends.
// Aggregate ShipmentDetail directly, never join orders into the sum (fan-out), never default NULL quantities.
export const WEEKDAY_INITIAL_BASELINE_SQL = `WITH inventory AS (
  SELECT od.ProdKey FROM OrderMaster om WITH (HOLDLOCK)
  JOIN OrderDetail od WITH (HOLDLOCK) ON od.OrderMasterKey = om.OrderMasterKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey = od.ProdKey AND ISNULL(p.isDeleted,0)=0
  WHERE om.OrderYear = @year AND om.OrderWeek = @orderWeek AND om.CustKey = @custKey
    AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
  UNION
  SELECT sd.ProdKey FROM ShipmentMaster sm WITH (HOLDLOCK)
  JOIN ShipmentDetail sd WITH (HOLDLOCK) ON sd.ShipmentKey = sm.ShipmentKey AND sd.CustKey = sm.CustKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey = sd.ProdKey AND ISNULL(p.isDeleted,0)=0
  WHERE sm.OrderYear = @year AND sm.OrderWeek = @orderWeek AND sm.CustKey = @custKey
    AND ISNULL(sm.isDeleted,0)=0
), shipment AS (
  SELECT sd.ProdKey, SUM(sd.OutQuantity) AS Quantity, COUNT_BIG(*) AS DetailRows,
    SUM(CASE WHEN sd.OutQuantity IS NULL OR sd.OutQuantity < 0 THEN 1 ELSE 0 END) AS InvalidQuantityRows
  FROM ShipmentMaster sm WITH (HOLDLOCK)
  JOIN ShipmentDetail sd WITH (HOLDLOCK) ON sd.ShipmentKey = sm.ShipmentKey AND sd.CustKey = sm.CustKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey = sd.ProdKey AND ISNULL(p.isDeleted,0)=0
  WHERE sm.OrderYear = @year AND sm.OrderWeek = @orderWeek AND sm.CustKey = @custKey
    AND ISNULL(sm.isDeleted,0)=0
  GROUP BY sd.ProdKey
), allocations AS (
  SELECT sd.ProdKey, CONVERT(nvarchar(10), sdd.ShipmentDtm,120) AS [date], sm.OrderWeek AS orderWeek,
    SUM(sdd.ShipmentQuantity) AS quantity, SUM(sdd.EstQuantity) AS estimateQuantity,
    SUM(CASE WHEN sdd.ShipmentDtm IS NULL OR sdd.ShipmentQuantity IS NULL OR sdd.ShipmentQuantity < 0
      OR sdd.EstQuantity IS NULL OR sdd.EstQuantity < 0 THEN 1 ELSE 0 END) AS invalidRows
  FROM ShipmentMaster sm WITH (HOLDLOCK)
  JOIN ShipmentDetail sd WITH (HOLDLOCK) ON sd.ShipmentKey = sm.ShipmentKey AND sd.CustKey = sm.CustKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey = sd.ProdKey AND ISNULL(p.isDeleted,0)=0
  JOIN ShipmentDate sdd WITH (HOLDLOCK) ON sdd.SdetailKey = sd.SdetailKey
  WHERE sm.OrderYear = @year AND sm.OrderWeek = @orderWeek AND sm.CustKey = @custKey
    AND ISNULL(sm.isDeleted,0)=0
  GROUP BY sd.ProdKey, CONVERT(nvarchar(10), sdd.ShipmentDtm,120), sm.OrderWeek
)
SELECT TOP 501 @year AS OrderYear, @orderWeek AS OrderWeek, c.CustKey,
  p.ProdKey, p.ProdName, p.FlowerName, p.OutUnit, p.EstUnit,
  CASE WHEN s.ProdKey IS NULL THEN 0 ELSE s.Quantity END AS Quantity,
  CASE WHEN s.ProdKey IS NULL THEN 0 ELSE s.DetailRows END AS DetailRows,
  CASE WHEN s.ProdKey IS NULL THEN 0 ELSE s.InvalidQuantityRows END AS InvalidQuantityRows,
  CAST(ISNULL((SELECT a.[date], a.orderWeek, a.quantity, a.estimateQuantity, a.invalidRows
    FROM allocations a WHERE a.ProdKey = p.ProdKey
    ORDER BY a.[date], a.orderWeek FOR JSON PATH, INCLUDE_NULL_VALUES), N'[]') AS nvarchar(max)) AS ShipmentDates
FROM Customer c WITH (HOLDLOCK)
LEFT JOIN inventory i ON 1=1
LEFT JOIN Product p WITH (HOLDLOCK) ON p.ProdKey = i.ProdKey AND ISNULL(p.isDeleted,0)=0
LEFT JOIN shipment s ON s.ProdKey = i.ProdKey
WHERE c.CustKey = @custKey AND ISNULL(c.isDeleted,0)=0
ORDER BY p.ProdKey`;

function finiteNumber(value) {
  if (!(typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')))
    return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function snapshotFromBaselineRowset(input, rowset) {
  const scope = normalizeBaselineScope(input);
  if (!Array.isArray(rowset)) throw new WeekdayBaselineError('INVALID_ERP_SNAPSHOT', '전산 조회 결과가 올바르지 않습니다.', 500);
  if (!rowset.length) throw new WeekdayBaselineError('CUSTOMER_NOT_ACTIVE', '활성 거래처를 확인할 수 없습니다.', 409);
  if (rowset.length > MAX_ROWS) throw new WeekdayBaselineError('BASELINE_PRODUCT_LIMIT', '조회 품목이 500개를 넘습니다. 일부 품목만 확정할 수 없습니다.', 409);
  const rows = [];
  for (const row of rowset) {
    if (Number(row.OrderYear) !== scope.year || row.OrderWeek !== scope.orderWeek || Number(row.CustKey) !== scope.custKey) {
      throw new WeekdayBaselineError('ERP_SCOPE_MISMATCH', '전산 조회 범위가 일치하지 않습니다.', 409);
    }
    if (row.ProdKey === null && rowset.length === 1) {
      if (row.ProdName !== null || row.FlowerName !== null || row.OutUnit !== null || row.EstUnit !== null
        || row.ShipmentDates !== '[]' || finiteNumber(row.DetailRows) !== 0
        || finiteNumber(row.InvalidQuantityRows) !== 0 || finiteNumber(row.Quantity) !== 0) {
        throw new WeekdayBaselineError('INVALID_ERP_SNAPSHOT', '빈 전산 범위를 검증할 수 없습니다.', 409);
      }
      continue;
    }
    const unit = normalizeWeekdayUnit(row.OutUnit);
    const estUnit = normalizeWeekdayUnit(row.EstUnit);
    const quantity = finiteNumber(row.Quantity);
    const detailRows = finiteNumber(row.DetailRows);
    const invalidRows = finiteNumber(row.InvalidQuantityRows);
    if (!unit || quantity === null || !Number.isInteger(detailRows) || invalidRows !== 0
      || (detailRows === 0 && quantity !== 0)) {
      throw new WeekdayBaselineError('INVALID_ERP_QUANTITY_OR_UNIT', '알 수 없는 단위·NULL·음수 수량은 최초 기준으로 확정할 수 없습니다.', 409);
    }
    let rawDates;
    try { rawDates = JSON.parse(row.ShipmentDates); }
    catch { throw new WeekdayBaselineError('INVALID_ERP_DATES', '실제 출고일 배분을 읽을 수 없습니다.', 409); }
    if (!Array.isArray(rawDates) || (detailRows === 0 && rawDates.length)) {
      const shape = Array.isArray(rawDates) ? `${rawDates.length}행` : rawDates === null ? 'NULL' : typeof rawDates;
      throw new WeekdayBaselineError('INVALID_ERP_DATES', `실제 출고일 배분을 검증할 수 없습니다. (품목 ${row.ProdKey}, 분배 ${detailRows}행, 날짜 ${shape})`, 409);
    }
    const shipmentDates = rawDates.map((allocation) => {
      const datedQuantity = finiteNumber(allocation.quantity);
      const estimateQuantity = finiteNumber(allocation.estimateQuantity);
      if (finiteNumber(allocation.invalidRows) !== 0 || datedQuantity === null || estimateQuantity === null
        || allocation.orderWeek !== scope.orderWeek) {
        throw new WeekdayBaselineError('INVALID_ERP_DATES', '출고일의 NULL·음수·범위 불일치 수량은 기준으로 확정할 수 없습니다.', 409);
      }
      return { date: allocation.date, orderWeek: allocation.orderWeek, quantity: datedQuantity, estimateQuantity };
    });
    rows.push({ prodKey: finiteNumber(row.ProdKey), prodName: row.ProdName, flowerName: row.FlowerName,
      unit, outUnit: unit, rawOutUnit: row.OutUnit, quantity,
      estUnit, shipmentDates,
      state: detailRows === 0 ? 'NO_SHIPMENT' : 'ERP_DISTRIBUTION' });
  }
  const canonical = canonicalRows(rows);
  return { scope, source: SOURCE, digest: baselineDigest(scope, canonical),
    rows: canonical, canConfirm: canonical.some((row) => row.quantity > 0) };
}

export async function readWeekdayInitialBaselineSnapshot(input, { query, sql }) {
  const scope = normalizeBaselineScope(input);
  const result = await query(WEEKDAY_INITIAL_BASELINE_SQL, {
    year: { type: sql.Int, value: scope.year },
    orderWeek: { type: sql.NVarChar(10), value: scope.orderWeek },
    custKey: { type: sql.Int, value: scope.custKey },
  });
  return snapshotFromBaselineRowset(scope, result?.recordset);
}
