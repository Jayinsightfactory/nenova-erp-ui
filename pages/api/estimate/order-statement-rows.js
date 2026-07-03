// pages/api/estimate/order-statement-rows.js
// GET — 주문등록(ViewOrder) 품목 → 거래명세표 Excel용 행

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { buildPrintRowsFromOrderDetails } from '../../../lib/orderStatementRows';

function normalizeParentWeek(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (full) return full[2];
  const sub = s.match(/^(\d{2})-(\d{2})$/);
  if (sub) return sub[1];
  return s.replace(/[^\d]/g, '').slice(0, 2) || s;
}

async function hasWeekProdCostTable() {
  try {
    const r = await query(
      `SELECT CASE WHEN OBJECT_ID(N'dbo.WeekProdCost', N'U') IS NOT NULL THEN 1 ELSE 0 END AS ok`,
    );
    return Number(r.recordset[0]?.ok || 0) === 1;
  } catch {
    return false;
  }
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { custKey, week, parentWeek, custName } = req.query;
  const pw = normalizeParentWeek(parentWeek || week);
  if (!pw) {
    return res.status(400).json({ success: false, error: 'week 또는 parentWeek 필요 (예: 28)' });
  }

  let resolvedCustKey = custKey ? parseInt(custKey, 10) : null;
  if (!resolvedCustKey && custName) {
    const cr = await query(
      `SELECT TOP 1 CustKey FROM Customer WHERE CustName LIKE @name AND isDeleted = 0`,
      { name: { type: sql.NVarChar, value: `%${custName}%` } },
    );
    resolvedCustKey = cr.recordset[0]?.CustKey || null;
  }
  if (!resolvedCustKey) {
    return res.status(400).json({ success: false, error: 'custKey 또는 custName 필요' });
  }

  try {
    const useWpc = await hasWeekProdCostTable();
    const costExpr = useWpc
      ? `ISNULL(NULLIF(wpc.WeekCost, 0), ISNULL(NULLIF(cpc.Cost, 0), ISNULL(px.Cost, 0)))`
      : `ISNULL(NULLIF(cpc.Cost, 0), ISNULL(px.Cost, 0))`;
    const wpcApply = useWpc
      ? `OUTER APPLY (
           SELECT TOP 1 wpc.Cost AS WeekCost
           FROM WeekProdCost wpc
           WHERE wpc.CustKey = vo.CustKey AND wpc.ProdKey = vo.ProdKey
             AND LEFT(wpc.OrderWeek, LEN(@pw)) = @pw
           ORDER BY wpc.OrderWeek DESC
         ) wpc`
      : '';

    const result = await query(
      `SELECT
         vo.ProdKey,
         vo.ProdName,
         ISNULL(px.DisplayName, vo.ProdName) AS DisplayName,
         ISNULL(vo.FlowerName, px.FlowerName) AS FlowerName,
         ISNULL(vo.CounName, px.CounName) AS CounName,
         ISNULL(vo.BoxQuantity, 0) AS BoxQuantity,
         ISNULL(vo.BunchQuantity, 0) AS BunchQuantity,
         ISNULL(vo.SteamQuantity, 0) AS SteamQuantity,
         ISNULL(vo.OutQuantity, 0) AS OutQuantity,
         px.OutUnit,
         ${costExpr} AS Cost
       FROM ViewOrder vo
       LEFT JOIN Product px ON vo.ProdKey = px.ProdKey
       LEFT JOIN CustomerProdCost cpc ON cpc.CustKey = vo.CustKey AND cpc.ProdKey = vo.ProdKey
       ${wpcApply}
       WHERE vo.CustKey = @ck
         AND (
           LEFT(vo.OrderWeek, CASE WHEN CHARINDEX('-', vo.OrderWeek) > 0
             THEN CHARINDEX('-', vo.OrderWeek) - 1 ELSE LEN(vo.OrderWeek) END) = @pw
           OR vo.OrderWeek = @pw
         )
         AND (
           ISNULL(vo.BoxQuantity, 0) <> 0
           OR ISNULL(vo.BunchQuantity, 0) <> 0
           OR ISNULL(vo.SteamQuantity, 0) <> 0
           OR ISNULL(vo.OutQuantity, 0) <> 0
         )
       ORDER BY vo.ProdName, vo.OrderDetailKey`,
      {
        ck: { type: sql.Int, value: resolvedCustKey },
        pw: { type: sql.NVarChar, value: pw },
      },
    );

    const rows = buildPrintRowsFromOrderDetails(result.recordset);
    const custRow = await query(
      `SELECT TOP 1 CustName FROM Customer WHERE CustKey = @ck`,
      { ck: { type: sql.Int, value: resolvedCustKey } },
    );

    return res.status(200).json({
      success: true,
      custKey: resolvedCustKey,
      custName: custRow.recordset[0]?.CustName || '',
      parentWeek: pw,
      source: 'order',
      itemCount: rows.length,
      rows,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
