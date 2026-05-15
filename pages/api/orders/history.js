// pages/api/orders/history.js — 주문 변경 내역 조회
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { custName, week } = req.query;

  let where = 'WHERE 1=1';
  const params = {};
  if (week)     { where += ' AND om.OrderWeek = @week'; params.week = { type: sql.NVarChar, value: normalizeOrderWeek(week) }; }
  if (custName) { where += ' AND c.CustName LIKE @cust'; params.cust = { type: sql.NVarChar, value: `%${custName}%` }; }

  try {
    const result = await query(
      `SELECT TOP 500
        CONVERT(NVARCHAR(10), oh.ChangeDtm, 120) AS 변경일자,
        oh.ChangeID AS 변경사용자,
        om.OrderWeek AS 차수,
        c.CustName AS 거래처명,
        p.CounName AS 국가,
        p.FlowerName AS 꽃,
        p.ProdName AS 품목명,
        oh.ChangeType AS 변경유형,
        oh.ColumName AS 변경항목,
        oh.BeforeValue AS 기준값,
        oh.AfterValue AS 변경값,
        oh.Descr AS 비고
       FROM OrderHistory oh
       JOIN OrderDetail od  ON oh.OrderDetailKey = od.OrderDetailKey
       JOIN OrderMaster om  ON od.OrderMasterKey = om.OrderMasterKey
       LEFT JOIN Customer c ON om.CustKey = c.CustKey
       LEFT JOIN Product p  ON od.ProdKey = p.ProdKey
       ${where}
       ORDER BY oh.ChangeDtm DESC`,
      params
    );
    return res.status(200).json({ success: true, history: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
