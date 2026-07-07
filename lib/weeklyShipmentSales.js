// lib/weeklyShipmentSales.js
// 차수매출관리 집계 — JSON API와 엑셀 API가 공유
//   판매금액 = ShipmentDetail.Amount (= round(업체별단가 × 환산수량 / 1.1))
//   합계(청구액) = Amount + Vat
import { query, sql } from './db';

const METRIC_KEYS = ['amount', 'vat', 'qty', 'cnt', 'noPriceCnt', 'noPriceQty', 'total'];
const emptyCell = () => ({ amount: 0, vat: 0, qty: 0, cnt: 0, noPriceCnt: 0, noPriceQty: 0, total: 0 });
const addInto = (acc, cell) => { for (const k of METRIC_KEYS) acc[k] += cell[k] || 0; };

export async function aggregateWeeklySales({ year, from, to, fix = 'all' } = {}) {
  const yr = String(year || new Date().getFullYear());

  // 1) 해당 연도에 출고가 있는 차수
  const wkRes = await query(
    `SELECT DISTINCT sm.OrderWeek AS week
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey = sm.ShipmentKey
      WHERE sm.OrderYear = @year AND ISNULL(sm.isDeleted,0)=0
        AND (ISNULL(sd.OutQuantity,0)<>0 OR ISNULL(sd.Amount,0)<>0)
      ORDER BY sm.OrderWeek`,
    { year: { type: sql.NVarChar, value: yr } }
  );
  const availableWeeks = wkRes.recordset.map((r) => r.week).filter(Boolean);

  let f = from, t = to;
  if (!f || !t) {
    const recent = availableWeeks.slice(-8);
    f = f || recent[0] || '01-01';
    t = t || availableWeeks[availableWeeks.length - 1] || '30-02';
  }
  const weeks = availableWeeks.filter((w) => w >= f && w <= t);

  const fixFilter = fix === 'fixed' ? 'AND ISNULL(sd.isFix,0)=1'
    : fix === 'unfixed' ? 'AND ISNULL(sd.isFix,0)=0' : '';

  // 2) 차수 × 품종 집계
  const aggRes = await query(
    `SELECT sm.OrderWeek AS week,
            ISNULL(p.CounName,N'(미분류)') AS counName,
            ISNULL(p.CountryFlower,N'(미분류)') AS countryFlower,
            COUNT(*) AS cnt,
            SUM(ISNULL(sd.OutQuantity,0)) AS qty,
            SUM(ISNULL(sd.Amount,0)) AS amount,
            SUM(ISNULL(sd.Vat,0)) AS vat,
            SUM(CASE WHEN ISNULL(sd.Amount,0)=0 AND ISNULL(sd.OutQuantity,0)<>0 THEN 1 ELSE 0 END) AS noPriceCnt,
            SUM(CASE WHEN ISNULL(sd.Amount,0)=0 AND ISNULL(sd.OutQuantity,0)<>0 THEN ISNULL(sd.OutQuantity,0) ELSE 0 END) AS noPriceQty
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       JOIN Product p ON p.ProdKey = sd.ProdKey
      WHERE sm.OrderYear = @year AND sm.OrderWeek >= @from AND sm.OrderWeek <= @to
        AND ISNULL(sm.isDeleted,0)=0
        AND (ISNULL(sd.OutQuantity,0)<>0 OR ISNULL(sd.Amount,0)<>0)
        ${fixFilter}
      GROUP BY sm.OrderWeek, p.CounName, p.CountryFlower
      ORDER BY p.CounName, p.CountryFlower, sm.OrderWeek`,
    {
      year: { type: sql.NVarChar, value: yr },
      from: { type: sql.NVarChar, value: f },
      to: { type: sql.NVarChar, value: t },
    }
  );

  // 3) 피벗 (행=품종, 열=차수)
  const rowMap = new Map();
  const weekTotals = {};
  const grandTotal = emptyCell();
  weeks.forEach((w) => { weekTotals[w] = emptyCell(); });

  for (const r of aggRes.recordset) {
    const key = `${r.counName}||${r.countryFlower}`;
    if (!rowMap.has(key)) {
      rowMap.set(key, { counName: r.counName, countryFlower: r.countryFlower, byWeek: {}, total: emptyCell() });
    }
    const row = rowMap.get(key);
    const cell = {
      amount: Number(r.amount) || 0,
      vat: Number(r.vat) || 0,
      qty: Number(r.qty) || 0,
      cnt: Number(r.cnt) || 0,
      noPriceCnt: Number(r.noPriceCnt) || 0,
      noPriceQty: Number(r.noPriceQty) || 0,
    };
    cell.total = cell.amount + cell.vat;
    row.byWeek[r.week] = cell;
    addInto(row.total, cell);
    if (weekTotals[r.week]) addInto(weekTotals[r.week], cell);
    addInto(grandTotal, cell);
  }

  const rows = [...rowMap.values()].sort((a, b) =>
    a.counName.localeCompare(b.counName, 'ko') || b.total.amount - a.total.amount);

  // 국가별 소계
  const countryTotals = {};
  for (const row of rows) {
    const c = (countryTotals[row.counName] = countryTotals[row.counName] || { counName: row.counName, byWeek: {}, total: emptyCell() });
    for (const w of weeks) {
      if (!c.byWeek[w]) c.byWeek[w] = emptyCell();
      const cell = row.byWeek[w];
      if (cell) addInto(c.byWeek[w], cell);
    }
    addInto(c.total, row.total);
  }

  return { year: yr, from: f, to: t, fix, availableWeeks, weeks, rows, countryTotals, weekTotals, grandTotal };
}

export default { aggregateWeeklySales };
