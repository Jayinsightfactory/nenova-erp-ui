import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

function toInt(value, fallback = 200) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : fallback;
}

const billableSql = `
  CASE
    WHEN dc.DateCount = 1 AND ISNULL(sd.Cost,0) > 0 AND ISNULL(sd.Amount,0) > 0
      THEN ROUND(ISNULL(sd.Amount,0) * 1.1 / NULLIF(sd.Cost,0), 0)
    ELSE ROUND(ISNULL(NULLIF(sdt.EstQuantity,0), ISNULL(NULLIF(sd.EstQuantity,0), sdt.ShipmentQuantity)), 0)
  END`;

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: 'Method not allowed' });

  const limit = toInt(req.query.limit || req.body?.limit);
  const apply = req.method === 'POST' || req.query.apply === '1';
  const week = String(req.query.week || req.body?.week || '').trim();
  const prod = String(req.query.prod || req.query.product || req.body?.prod || '').trim();
  const scope = String(req.query.scope || req.body?.scope || 'web-edits').trim();
  const allCostSources = scope === 'all' || scope === 'all-cost-sources';

  const params = { limit: { type: sql.Int, value: limit } };
  let weekWhere = '';
  if (week) {
    weekWhere = 'AND sm.OrderWeek = @week';
    params.week = { type: sql.NVarChar, value: week };
  }
  let prodWhere = '';
  if (prod) {
    prodWhere = 'AND (p.ProdName LIKE @prod OR p.FlowerName LIKE @prod)';
    params.prod = { type: sql.NVarChar, value: `%${prod}%` };
  }
  const editWhere = (allCostSources || prod) ? '' : "AND (ISNULL(sd.Descr,'') LIKE N'%] 단가 %→%' OR ISNULL(sd.Descr,'') LIKE N'%단가 %>%')";

  const selectSql = `
    SELECT TOP (@limit)
      sd.SdetailKey,
      sdt.SdateKey,
      sm.ShipmentKey,
      sm.OrderWeek,
      sm.CustKey,
      c.CustName,
      sd.ProdKey,
      p.ProdName,
      ISNULL(sd.Cost,0) AS DetailCost,
      ISNULL(sd.Amount,0) AS DetailAmount,
      ISNULL(sd.Vat,0) AS DetailVat,
      ISNULL(sdt.Cost,0) AS DateCost,
      ISNULL(sdt.Amount,0) AS DateAmount,
      ISNULL(sdt.Vat,0) AS DateVat,
      calc.BillableQuantity AS DateEstQuantity,
      ROUND(ISNULL(sd.Cost,0) * calc.BillableQuantity / 1.1, 0) AS ExpectedDateAmount,
      ROUND(ISNULL(sd.Cost,0) * calc.BillableQuantity / 11, 0) AS ExpectedDateVat,
      LEFT(ISNULL(sd.Descr,''), 500) AS DetailDescr
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
    JOIN ShipmentDate sdt ON sdt.SdetailKey = sd.SdetailKey
    LEFT JOIN Customer c ON c.CustKey = sm.CustKey
    LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
    OUTER APPLY (
      SELECT COUNT(*) AS DateCount
      FROM ShipmentDate sdt2
      WHERE sdt2.SdetailKey = sd.SdetailKey
    ) dc
    OUTER APPLY (
      SELECT ${billableSql} AS BillableQuantity
    ) calc
    WHERE ISNULL(sm.isDeleted,0)=0
      ${editWhere}
      ${weekWhere}
      ${prodWhere}
      AND (
        ABS(ISNULL(sdt.Cost,0) - ISNULL(sd.Cost,0)) > 0.001
        OR ABS(ISNULL(sdt.Amount,0) - ROUND(ISNULL(sd.Cost,0) * calc.BillableQuantity / 1.1, 0)) > 0.001
        OR ABS(ISNULL(sdt.Vat,0) - ROUND(ISNULL(sd.Cost,0) * calc.BillableQuantity / 11, 0)) > 0.001
      )
    ORDER BY sd.SdetailKey DESC, sdt.SdateKey DESC`;

  const before = await query(selectSql, params);
  const targets = before.recordset || [];

  if (apply && targets.length > 0) {
    await withTransaction(async (tQ) => {
      const keys = targets.map(r => r.SdateKey).filter(Boolean);
      for (const sdateKey of keys) {
        const keyParam = { sdateKey: { type: sql.Int, value: sdateKey } };
        await tQ(
          `UPDATE sdt
              SET Cost = sd.Cost,
                  EstQuantity = calc.BillableQuantity,
                  Amount = ROUND(ISNULL(sd.Cost,0) * calc.BillableQuantity / 1.1, 0),
                  Vat = ROUND(ISNULL(sd.Cost,0) * calc.BillableQuantity / 11, 0)
             FROM ShipmentDate sdt
             JOIN ShipmentDetail sd ON sd.SdetailKey = sdt.SdetailKey
             OUTER APPLY (
               SELECT COUNT(*) AS DateCount
               FROM ShipmentDate sdt2
               WHERE sdt2.SdetailKey = sd.SdetailKey
             ) dc
             OUTER APPLY (
               SELECT ${billableSql} AS BillableQuantity
             ) calc
            WHERE sdt.SdateKey=@sdateKey
              ${editWhere}`,
          keyParam
        );
        await tQ(
          `UPDATE sd
              SET EstQuantity = ROUND(ISNULL(sd.Amount,0) * 1.1 / NULLIF(sd.Cost,0), 0)
             FROM ShipmentDetail sd
             JOIN ShipmentDate sdt ON sdt.SdetailKey = sd.SdetailKey
             OUTER APPLY (
               SELECT COUNT(*) AS DateCount
               FROM ShipmentDate sdt2
               WHERE sdt2.SdetailKey = sd.SdetailKey
             ) dc
            WHERE sdt.SdateKey=@sdateKey
              AND dc.DateCount = 1
              AND ISNULL(sd.Cost,0) > 0
              AND ISNULL(sd.Amount,0) > 0
              AND ABS(ISNULL(sd.EstQuantity,0) - ROUND(ISNULL(sd.Amount,0) * 1.1 / NULLIF(sd.Cost,0), 0)) > 0.001
              ${editWhere}`,
          keyParam
        );
      }
    });
  }

  const after = apply ? await query(selectSql, params) : null;

  return res.status(200).json({
    success: true,
    apply,
    scope: allCostSources ? 'all-cost-sources' : 'web-edits',
    checked: targets.length,
    remaining: after ? after.recordset.length : undefined,
    rows: targets,
  });
}

export default withAuth(handler);
