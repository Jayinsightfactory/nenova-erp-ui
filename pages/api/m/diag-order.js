// pages/api/m/diag-order.js — 주문 원시값 진단 (품목 수량 컬럼 구조 확인용)
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

async function handler(req, res) {
  const custKey = parseInt(req.query.custKey || '13');
  const week = req.query.week || '16-01';
  try {
    const rows = await query(
      `SELECT om.OrderWeek, p.ProdName, p.OutUnit, p.BunchOf1Box, p.SteamOf1Bunch, p.SteamOf1Box,
              od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
              (ISNULL(od.BoxQuantity,0)+ISNULL(od.BunchQuantity,0)+ISNULL(od.SteamQuantity,0)) AS SumAll
         FROM OrderMaster om
         JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         JOIN Product p ON p.ProdKey = od.ProdKey
        WHERE om.CustKey=@ck AND om.OrderWeek=@wk
          AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
        ORDER BY p.ProdName`,
      {
        ck: { type: sql.Int, value: custKey },
        wk: { type: sql.NVarChar, value: week },
      }
    );
    return res.status(200).json({ success: true, custKey, week, rowCount: rows.recordset.length, rows: rows.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
