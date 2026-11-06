// Read-only settlement view. Stored per-date values are never recalculated from totals.
const DAY = 86400000;
export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('날짜를 YYYY-MM-DD 형식으로 선택하세요.');
  const time = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '9998-12-31') throw new Error('유효한 날짜를 선택하세요.');
  return time;
}
const ymd = time => new Date(time).toISOString().slice(0, 10);
export function weekdayValue(value) {
  if (!/^[0-6]$/.test(String(value))) throw new Error('정산 요일을 선택하세요.');
  return Number(value);
}
export function settlementPeriods(anchor, startDay, endDay, count = 12) {
  const time = dateValue(anchor), start = weekdayValue(startDay), end = weekdayValue(endDay);
  const first = time - ((new Date(time).getUTCDay() - start + 7) % 7) * DAY;
  const length = (end - start + 7) % 7;
  return Array.from({ length: count }, (_, i) => ({ startDate: ymd(first - i * 7 * DAY), endDate: ymd(first + (length - i * 7) * DAY) }));
}
export function validateSalesRequest(input) {
  if (!/^[1-9]\d*$/.test(String(input.custKey)) || !Number.isSafeInteger(Number(input.custKey))) throw new Error('업체를 선택하세요.');
  const custKey = Number(input.custKey);
  if (input.mode === 'history') {
    const periods = settlementPeriods(input.anchor, input.startDay, input.endDay);
    return { custKey, periods, startDate: periods.at(-1).startDate, endDate: periods[0].endDate };
  }
  if (input.mode && input.mode !== 'range') throw new Error('조회 방식을 확인하세요.');
  const start = dateValue(input.startDate), end = dateValue(input.endDate);
  if (start > end) throw new Error('종료일은 시작일보다 빠를 수 없습니다.');
  if (end - start > 366 * DAY) throw new Error('직접 조회는 한 번에 최대 1년까지 선택하세요.');
  return { custKey, startDate: input.startDate, endDate: input.endDate, periods: [{ startDate: input.startDate, endDate: input.endDate }] };
}
export const shipmentDateSalesSql = `
SELECT 'shipment' AS Kind, sdd.SdateKey AS RowKey, vs.OrderYear, vs.OrderWeek,
       vs.ProdKey, p.ProdName, p.EstUnit AS Unit,
       CONVERT(char(10),sdd.ShipmentDtm,23) AS SaleDate,
       sdd.EstQuantity AS Quantity, sdd.Cost, ISNULL(sdd.Amount,0) AS Amount, ISNULL(sdd.Vat,0) AS Vat
FROM ViewShipment vs
JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey
LEFT JOIN Product p ON p.ProdKey=vs.ProdKey
WHERE vs.CustKey=@custKey AND vs.DetailFix=1 AND vs.EstQuantity>0 AND sdd.EstQuantity>0
  AND sdd.ShipmentDtm>=@startDate AND sdd.ShipmentDtm<DATEADD(day,1,@endDate)
  AND EXISTS (SELECT 1 FROM ViewOrder vo WHERE vo.OrderYear=vs.OrderYear
    AND vo.OrderWeek=vs.OrderWeek AND vo.CustKey=vs.CustKey AND vo.ProdKey=vs.ProdKey)
UNION ALL
SELECT 'adjustment', e.EstimateKey, sm.OrderYear, sm.OrderWeek,
       e.ProdKey, p.ProdName, e.Unit,
       CONVERT(char(10),e.EstimateDtm,23), e.Quantity, e.Cost, ISNULL(e.Amount,0), ISNULL(e.Vat,0)
FROM Estimate e
JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
LEFT JOIN Product p ON p.ProdKey=e.ProdKey
WHERE sm.CustKey=@custKey AND sm.isDeleted=0
  AND e.EstimateDtm>=@startDate AND e.EstimateDtm<DATEADD(day,1,@endDate)
ORDER BY SaleDate DESC, OrderYear DESC, OrderWeek, ProdKey, Kind, RowKey`;

export function shortWeek(week) {
  return String(week).split('-').map(part => /^\d+$/.test(part) ? String(Number(part)) : part).join('-');
}
function numeric(value) {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result)) throw new Error('조회 금액 또는 수량이 올바르지 않습니다.');
  return result;
}
export function quantityFormula(item) {
  const fmt = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
  return `${fmt(item.quantity)} = ${item.sources.map(source => `${fmt(source.quantity)}(${shortWeek(source.orderWeek)})`).join(' / ')}`;
}
export function summarizeSales(rows, periods) {
  return periods.map(period => {
    const selected = rows.filter(row => row.SaleDate >= period.startDate && row.SaleDate <= period.endDate);
    const products = new Map(), quantities = new Map();
    let amount = 0, vat = 0, adjustmentAmount = 0;
    for (const row of selected) {
      const quantity = numeric(row.Quantity), supply = numeric(row.Amount), tax = numeric(row.Vat);
      amount += supply; vat += tax;
      if (row.Kind === 'adjustment') adjustmentAmount += supply + tax;
      else quantities.set(row.Unit ?? '', (quantities.get(row.Unit ?? '') ?? 0) + quantity);
      const key = JSON.stringify([row.Kind, row.ProdKey, row.Unit]);
      if (!products.has(key)) products.set(key, { key, kind: row.Kind, prodKey: row.ProdKey, prodName: row.ProdName ?? '(품목명 없음)', unit: row.Unit ?? '', quantity: 0, amount: 0, vat: 0, sources: [], details: [] });
      const product = products.get(key);
      product.quantity += quantity; product.amount += supply; product.vat += tax;
      let source = product.sources.find(s => s.orderYear === String(row.OrderYear) && s.orderWeek === row.OrderWeek);
      if (!source) { source = { orderYear: String(row.OrderYear), orderWeek: row.OrderWeek, quantity: 0 }; product.sources.push(source); }
      source.quantity += quantity;
      product.details.push({ date: row.SaleDate, orderYear: String(row.OrderYear), orderWeek: row.OrderWeek, quantity, cost: numeric(row.Cost), amount: supply, vat: tax, rowKey: row.RowKey });
    }
    for (const product of products.values()) product.sources.sort((a,b) => a.orderYear.localeCompare(b.orderYear) || a.orderWeek.localeCompare(b.orderWeek, 'en', { numeric: true }));
    return { ...period, amount, vat, totalAmount: amount + vat, adjustmentAmount, quantities: [...quantities].map(([unit, quantity]) => ({ unit, quantity })), products: [...products.values()] };
  });
}
