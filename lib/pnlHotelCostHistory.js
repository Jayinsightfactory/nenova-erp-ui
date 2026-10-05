// Read-only stored purchase costs across active P&L hotels. No conversion,
// averaging, price inference, schema creation or write entry point.
import { query, sql } from './db.js';
import { listPnlHotels } from './pnlHotelRegistry.js';

export const HOTEL_PNL_COST_HISTORY_SQL = `
SELECT m.PnlKey,m.OrderYear,m.MajorWeek,m.PartnerCode,m.Title,m.UpdatedAt AS PnlUpdatedAt,
       i.ItemKey,i.ItemName AS Name,i.ProdKey,p.ProdName,i.Unit,i.Qty,
       i.CostPrice,i.CostSource,i.SalePrice,i.SaleAmount,ISNULL(i.IsCustom,0) AS IsCustom
  FROM WebRaumPnl m
  JOIN WebRaumPnlItem i ON i.PnlKey=m.PnlKey
  LEFT JOIN Product p ON p.ProdKey=i.ProdKey AND p.isDeleted=0
 WHERE m.OrderYear=@yr AND ISNULL(m.isDeleted,0)=0
   AND i.CostPrice IS NOT NULL
   AND m.PartnerCode IN (SELECT [value] FROM OPENJSON(@partners))
   AND (m.PartnerCode IN ('raum','choimun','shilla') OR EXISTS (
     SELECT 1 FROM dbo.WebPnlHotel h WHERE h.PartnerCode=m.PartnerCode AND h.IsActive=1
   ))
 ORDER BY TRY_CONVERT(INT,m.MajorWeek) DESC,m.PartnerCode,m.PnlKey DESC,i.Seq,i.ItemKey`;

export function normalizeHotelCostHistoryYear(value) {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value.trim())) {
    const error = new Error('조회할 결산 연도를 네 자리로 지정하세요.');
    error.statusCode = 400;
    error.code = 'HOTEL_COST_HISTORY_YEAR_REQUIRED';
    throw error;
  }
  return value.trim();
}

export async function loadPnlHotelCostHistory({ orderYear }, runQuery = query) {
  const year = normalizeHotelCostHistoryYear(orderYear);
  const hotels = await listPnlHotels(runQuery);
  const partners = hotels.map(({ code, label }) => ({ code, label }));
  const labels = new Map(partners.map(partner => [partner.code, partner.label]));
  const response = await runQuery(HOTEL_PNL_COST_HISTORY_SQL, {
    yr: { type: sql.NVarChar, value: year },
    partners: { type: sql.NVarChar, value: JSON.stringify(partners.map(partner => partner.code)) },
  });
  const rows = (response.recordset || [])
    .filter(row => String(row.OrderYear) === year && labels.has(String(row.PartnerCode)) && row.CostPrice != null)
    .map(row => ({
      pnlKey: Number(row.PnlKey), itemKey: Number(row.ItemKey), orderYear: String(row.OrderYear),
      major: Number(row.MajorWeek), partnerCode: String(row.PartnerCode), partnerLabel: labels.get(String(row.PartnerCode)),
      title: String(row.Title ?? ''), pnlUpdatedAt: row.PnlUpdatedAt ?? null,
      name: String(row.Name ?? ''), prodKey: Number.isInteger(Number(row.ProdKey)) && Number(row.ProdKey) > 0 ? Number(row.ProdKey) : null,
      prodName: String(row.ProdName ?? ''), unit: String(row.Unit ?? ''), qty: Number(row.Qty || 0),
      costPrice: Number(row.CostPrice), costSource: row.CostSource ?? null,
      salePrice: row.SalePrice == null ? null : Number(row.SalePrice), saleAmount: row.SaleAmount == null ? null : Number(row.SaleAmount),
      isCustom: row.IsCustom === true || Number(row.IsCustom) === 1,
    }));
  return { orderYear: year, partners, rows };
}
