// pages/api/master/activity.js
// 작업 내역 통합 조회 API
// 수정이력: 2026-03-30 — 초기 작성
//   StockHistory (재고/확정/조정) + OrderHistory (주문) 통합

import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { startDate, endDate, userId, changeType } = req.query;

  try {
    let where = "WHERE sh.ChangeDtm >= @start AND sh.ChangeDtm < DATEADD(day,1,@end)";
    const params = {
      start: { type: sql.NVarChar, value: startDate || new Date(Date.now()-7*86400000).toISOString().slice(0,10) },
      end:   { type: sql.NVarChar, value: endDate   || new Date().toISOString().slice(0,10) },
    };

    if (userId)     { where += ' AND sh.ChangeID = @uid';  params.uid  = { type: sql.NVarChar, value: userId }; }
    if (changeType) { where += ' AND sh.ChangeType = @ct'; params.ct   = { type: sql.NVarChar, value: changeType }; }

    // StockHistory 조회
    const stockResult = await query(
      `SELECT TOP 500
        CONVERT(NVARCHAR(23), sh.ChangeDtm, 121) AS changeDtm,
        sh.ChangeID     AS userId,
        sh.ChangeType   AS changeType,
        sh.OrderWeek    AS week,
        sh.ColumName    AS columnName,
        CAST(sh.BeforeValue AS NVARCHAR) AS before,
        CAST(sh.AfterValue  AS NVARCHAR) AS after,
        sh.Descr        AS descr,
        ISNULL(p.ProdName, '') AS prodName,
        'stock' AS source
       FROM StockHistory sh
       LEFT JOIN Product p ON sh.ProdKey = p.ProdKey
       ${where}
       ORDER BY sh.ChangeDtm DESC`,
      params
    );

    // OrderHistory 조회
    let ohWhere = "WHERE oh.ChangeDtm >= @start AND oh.ChangeDtm < DATEADD(day,1,@end)";
    const ohParams = { ...params };
    if (userId) { ohWhere += ' AND oh.ChangeID = @uid'; }

    const orderResult = await query(
      `SELECT TOP 300
        CONVERT(NVARCHAR(23), oh.ChangeDtm, 121) AS changeDtm,
        oh.ChangeID     AS userId,
        oh.ChangeType   AS changeType,
        om.OrderWeek    AS week,
        oh.ColumName    AS columnName,
        CAST(oh.BeforeValue AS NVARCHAR) AS before,
        CAST(oh.AfterValue  AS NVARCHAR) AS after,
        oh.Descr        AS descr,
        ISNULL(p.ProdName, '') AS prodName,
        'order' AS source
       FROM OrderHistory oh
       LEFT JOIN OrderDetail od ON oh.OrderDetailKey = od.OrderDetailKey
       LEFT JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
       LEFT JOIN Product p      ON od.ProdKey = p.ProdKey
       ${ohWhere}
       ORDER BY oh.ChangeDtm DESC`,
      ohParams
    );

    // 통합 후 시간순 정렬
    const logs = [
      ...stockResult.recordset,
      ...orderResult.recordset,
    ].sort((a, b) => new Date(b.changeDtm) - new Date(a.changeDtm))
     .slice(0, 1000);

    return res.status(200).json({ success: true, count: logs.length, logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
