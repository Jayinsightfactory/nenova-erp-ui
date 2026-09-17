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

// Current customer master metadata is intentionally independent of the report year.
export function sqlPivotExeCustomerOrderCodes() {
  return 'SELECT CustKey, OrderCode FROM Customer WHERE isDeleted=0';
}

function positiveCustKey(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

const CUSTOMER_LIST_TYPES = new Set(['02. 주문', '03. 미발주수량', '04. 출고']);

export function enrichPivotExeRows(rows = [], distributionRows = [], arrivalMap = {}, customerRows = []) {
  const customers = new Map();
  for (const customer of customerRows) {
    const custKey = positiveCustKey(customer.CustKey);
    if (custKey !== null) customers.set(custKey, customer.OrderCode == null ? null : String(customer.OrderCode));
  }
  const distribution = new Map(distributionRows.map((row) => [
    key(row.OrderYear, row.OrderWeek, row.CustKey, row.ProdKey),
    Number.isFinite(Number(row.DistCost)) ? Number(row.DistCost) : null,
  ]));
  return rows.map((row) => {
    // The EXE pivot exposes the customer order columns as the working sales columns.
    // ShipmentDetail.Cost is therefore shown on both the matching order and shipment
    // rows; otherwise the value area is blank whenever the user keeps `02. 주문` visible.
    // It is deliberately not attached to unfulfilled/incoming/stock rows, avoiding
    // duplicated weighted totals across unrelated inventory categories.
    const listType = String(row.ListType || '');
    const isDistributionRow = listType.startsWith('02.') || listType.startsWith('04.');
    const isIncoming = String(row.ListType || '') === '03. 입고';
    const arrival = arrivalMap?.[row.ProdKey]?.arrivalCost;
    const hasArrival = arrival !== null && arrival !== undefined && arrival !== '' && Number.isFinite(Number(arrival));
    return {
      ...row,
      CustOrderCode: CUSTOMER_LIST_TYPES.has(row.ListType)
        ? (customers.get(positiveCustKey(row.CustKey)) ?? null) : null,
      DistCost: isDistributionRow ? (distribution.get(key(row.OrderYear, row.OrderWeek, row.CustKey, row.ProdKey)) ?? null) : null,
      ArrivalCost: isIncoming && hasArrival ? Number(arrival) : null,
    };
  });
}
