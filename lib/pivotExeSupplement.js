// Read-only supplements for FormQuantityPivot. The native EXE query stays unchanged;
// these fields reuse the legacy web pivot's established price definitions.
export function sqlPivotExeDistributionCosts() {
  return `SELECT sm.OrderYear, sm.OrderWeek, sm.CustKey, sd.ProdKey,
       SUM(CONVERT(float, ISNULL(sd.OutQuantity,0)) * CONVERT(float, ISNULL(sd.Cost,0)))
         / NULLIF(SUM(CONVERT(float, ISNULL(sd.OutQuantity,0))),0) AS DistCost
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey AND sm.isDeleted=0
   WHERE (sm.OrderYear + REPLACE(sm.OrderWeek,'-','')) BETWEEN @weekFrom AND @weekTo
     AND ISNULL(sd.OutQuantity,0)>0
   GROUP BY sm.OrderYear, sm.OrderWeek, sm.CustKey, sd.ProdKey`;
}

const key = (year, week, custKey, prodKey) => [String(year ?? ''), String(week ?? ''), String(custKey ?? ''), String(prodKey ?? '')].join('|');

export function enrichPivotExeRows(rows = [], distributionRows = [], arrivalMap = {}) {
  const distribution = new Map(distributionRows.map((row) => [
    key(row.OrderYear, row.OrderWeek, row.CustKey, row.ProdKey),
    Number.isFinite(Number(row.DistCost)) ? Number(row.DistCost) : null,
  ]));
  return rows.map((row) => {
    const isShipment = String(row.ListType || '').startsWith('04.');
    const isIncoming = String(row.ListType || '') === '03. 입고';
    const arrival = arrivalMap?.[row.ProdKey]?.arrivalCost;
    const hasArrival = arrival !== null && arrival !== undefined && arrival !== '' && Number.isFinite(Number(arrival));
    return {
      ...row,
      DistCost: isShipment ? (distribution.get(key(row.OrderYear, row.OrderWeek, row.CustKey, row.ProdKey)) ?? null) : null,
      ArrivalCost: isIncoming && hasArrival ? Number(arrival) : null,
    };
  });
}
