import { dateValue, summarizeSales } from './estimateShipmentDateSales.js';
const DAY = 86400000;
export const calendarDate = value => new Date(value).toISOString().slice(0, 10);
export function visibleSalesPeriods(periods, mode, page = 0, showAll = false) {
  if (!Number.isInteger(page) || page < 0) throw Error('조회할 정산기간을 확인하세요.');
  return mode === 'history' && !showAll ? periods.slice(page * 2, page * 2 + 2) : periods;
}
export function storedPriceBuckets(row) {
  const prices = new Map();
  for (const week of row.weeks) for (const cell of week.cells) for (const detail of cell.details) {
    const cost = detail.cost;
    if (!prices.has(cost)) prices.set(cost, { cost, quantity:0 });
    prices.get(cost).quantity += detail.quantity;
  }
  return [...prices.values()].sort((a,b)=>a.cost-b.cost);
}
export function rangeWeeks(startDate, endDate) {
  const first = dateValue(startDate), last = dateValue(endDate);
  if (first > last || last - first > 366 * DAY) throw Error('조회 기간을 확인하세요.');
  const result = [];
  for (let day = first; day <= last; day += 7 * DAY) result.push({ startDate: calendarDate(day), endDate: calendarDate(Math.min(day + 6 * DAY, last)) });
  return result;
}
export function buildSalesMatrix(periods, mode) {
  // The API retains its original read-only contract. Repartition stored daily facts only.
  const raw = periods.flatMap(period => period.products.flatMap(product => product.details.map(detail => ({
    Kind: product.kind, ProdKey: product.prodKey, ProdName: product.prodName, Unit: product.unit,
    RowKey: detail.rowKey, OrderYear: detail.orderYear, OrderWeek: detail.orderWeek,
    SaleDate: detail.date, Quantity: detail.quantity, Cost: detail.cost, Amount: detail.amount, Vat: detail.vat,
  }))));
  const spans = mode === 'range' && periods.length ? rangeWeeks(periods[0].startDate, periods[0].endDate) : periods;
  const weeks = summarizeSales(raw, spans).map(week => {
    const dates = [];
    for (let day = dateValue(week.startDate); day <= dateValue(week.endDate); day += DAY) dates.push(calendarDate(day));
    const dailyAmounts = dates.map(date => week.products.reduce((sum, p) => sum + p.details.filter(d => d.date === date).reduce((n, d) => n + d.amount + d.vat, 0), 0));
    const sources = [...new Set(week.products.flatMap(p => p.sources.map(s => s.orderWeek)))].sort((a,b) => a.localeCompare(b, 'en', { numeric:true }));
    return { ...week, dates, dailyAmounts, sources };
  });
  const products = new Map();
  for (const week of weeks) for (const product of week.products) if (!products.has(product.key)) products.set(product.key, product);
  const rows = [...products.values()].sort((a,b) => a.kind.localeCompare(b.kind) || a.prodName.localeCompare(b.prodName, 'ko')).map(product => ({
    ...product,
    weeks: weeks.map(week => {
      const found = week.products.find(p => p.key === product.key);
      return { product:found ?? null, cells:week.dates.map(date => {
        const details = found?.details.filter(d => d.date === date) ?? [];
        return { date, details, quantity:details.reduce((sum,d) => sum + d.quantity,0), amount:details.reduce((sum,d) => sum + d.amount + d.vat,0) };
      }) };
    }),
  }));
  return { weeks, rows, supplyAmount:weeks.reduce((sum,week)=>sum+week.amount,0), vatAmount:weeks.reduce((sum,week)=>sum+week.vat,0), totalAmount:weeks.reduce((sum,week) => sum + week.totalAmount,0) };
}
