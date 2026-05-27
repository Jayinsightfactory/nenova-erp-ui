import { query, withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

function toInt(value, fallback = 200) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : fallback;
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ success: false, error: 'Method not allowed' });

  const limit = toInt(req.query.limit || req.body?.limit);
  const apply = req.method === 'POST' || req.query.apply === '1';
  const week = String(req.query.week || req.body?.week || '').trim();

  const params = { limit: { type: sql.Int, value: limit } };
  let weekWhere = '';
  if (week) {
    weekWhere = 'AND sm.OrderWeek = @week';
    params.week = { type: sql.NVarChar, value: week };
  }

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
      ISNULL(sdt.EstQuantity, ISNULL(sdt.ShipmentQuantity,0)) AS DateEstQuantity,
      ROUND(ISNULL(sd.Cost,0) * ROUND(ISNULL(NULLIF(sdt.EstQuantity,0), sdt.ShipmentQuantity), 0) / 1.1, 0) AS ExpectedDateAmount,
      ROUND(ISNULL(sd.Cost,0) * ROUND(ISNULL(NULLIF(sdt.EstQuantity,0), sdt.ShipmentQuantity), 0) / 11, 0) AS ExpectedDateVat,
      LEFT(ISNULL(sd.Descr,''), 500) AS DetailDescr
    FROM ShipmentDetail sd
    JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
    JOIN ShipmentDate sdt ON sdt.SdetailKey = sd.SdetailKey
    LEFT JOIN Customer c ON c.CustKey = sm.CustKey
    LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
    WHERE ISNULL(sm.isDeleted,0)=0
      AND ISNULL(sd.Descr,'') LIKE N'%] 단가 %→%'
      ${weekWhere}
      AND (
        ABS(ISNULL(sdt.Cost,0) - ISNULL(sd.Cost,0)) > 0.001
        OR ABS(ISNULL(sdt.Amount,0) - ROUND(ISNULL(sd.Cost,0) * ROUND(ISNULL(NULLIF(sdt.EstQuantity,0), sdt.ShipmentQuantity), 0) / 1.1, 0)) > 0.001
        OR ABS(ISNULL(sdt.Vat,0) - ROUND(ISNULL(sd.Cost,0) * ROUND(ISNULL(NULLIF(sdt.EstQuantity,0), sdt.ShipmentQuantity), 0) / 11, 0)) > 0.001
      )
    ORDER BY sd.SdetailKey DESC, sdt.SdateKey DESC`;

  const before = await query(selectSql, params);
  const targets = before.recordset || [];

  if (apply && targets.length > 0) {
    await withTransaction(async (tQ) => {
      const keys = targets.map(r => r.SdateKey).filter(Boolean);
      for (const sdateKey of keys) {
        await tQ(
          `UPDATE sdt
              SET Cost = sd.Cost,
                  Amount = ROUND(ISNULL(sd.Cost,0) * ROUND(ISNULL(NULLIF(sdt.EstQuantity,0), sdt.ShipmentQuantity), 0) / 1.1, 0),
                  Vat = ROUND(ISNULL(sd.Cost,0) * ROUND(ISNULL(NULLIF(sdt.EstQuantity,0), sdt.ShipmentQuantity), 0) / 11, 0)
             FROM ShipmentDate sdt
             JOIN ShipmentDetail sd ON sd.SdetailKey = sdt.SdetailKey
            WHERE sdt.SdateKey=@sdateKey
              AND ISNULL(sd.Descr,'') LIKE N'%] 단가 %→%'`,
          { sdateKey: { type: sql.Int, value: sdateKey } }
        );
      }
    });
  }

  const after = apply ? await query(selectSql, params) : null;

  return res.status(200).json({
    success: true,
    apply,
    checked: targets.length,
    remaining: after ? after.recordset.length : undefined,
    rows: targets,
  });
}

export default withAuth(handler);
