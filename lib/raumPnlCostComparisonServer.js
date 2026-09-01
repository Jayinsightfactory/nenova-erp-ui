// Server-only read path for Raum/Choimun stored cost history.
import { query, sql } from './db.js';

/** SQL contract: exact OrderYear + PartnerCode, active P&L masters only. */
export const RAUM_PNL_COST_COMPARISON_SQL = `
  SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.PartnerCode, m.Title,
         m.UpdatedAt AS PnlUpdatedAt,
         i.ItemKey, i.ItemName AS Name, i.ProdKey, p.ProdName, i.Unit,
         i.Qty, i.CostPrice, i.CostSource,
         ISNULL(i.IsCustom, 0) AS IsCustom
    FROM WebRaumPnl AS m
    JOIN WebRaumPnlItem AS i ON i.PnlKey = m.PnlKey
    LEFT JOIN Product AS p ON p.ProdKey = i.ProdKey AND ISNULL(p.isDeleted, 0) = 0
   WHERE ISNULL(m.isDeleted, 0) = 0
     AND m.OrderYear = @yr
     AND m.PartnerCode = @pc
   ORDER BY TRY_CONVERT(INT, m.MajorWeek) DESC, m.PnlKey DESC, i.Seq ASC, i.ItemKey ASC`;

const normSpace = value => String(value == null ? '' : value).replace(/[\s\u00a0]+/g, ' ').trim();
const positiveProdKey = value => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export async function loadRaumPnlCostComparisonRows({ orderYear, partnerCode }) {
  const result = await query(RAUM_PNL_COST_COMPARISON_SQL, {
    yr: { type: sql.NVarChar, value: String(orderYear) },
    pc: { type: sql.NVarChar, value: String(partnerCode) },
  });
  return (result.recordset || []).map(row => ({
    pnlKey: Number(row.PnlKey),
    itemKey: Number(row.ItemKey),
    orderYear: String(row.OrderYear ?? ''),
    major: Number(row.MajorWeek),
    partnerCode: String(row.PartnerCode ?? ''),
    title: row.Title == null ? '' : String(row.Title),
    pnlUpdatedAt: row.PnlUpdatedAt || null,
    name: row.Name == null ? '' : String(row.Name),
    prodKey: positiveProdKey(row.ProdKey),
    prodName: row.ProdName == null ? '' : String(row.ProdName),
    unit: normSpace(row.Unit),
    qty: Number(row.Qty || 0),
    costPrice: row.CostPrice == null ? null : Number(row.CostPrice),
    costSource: row.CostSource == null ? null : String(row.CostSource),
    isCustom: !!row.IsCustom,
  }));
}
