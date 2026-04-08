// pages/api/shipment/history.js — 출고 변경 내역 (실제 DB)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { startDate, endDate, search } = req.query;

  let where = 'WHERE 1=1';
  const params = {};
  if (startDate) { where += ' AND CAST(sh.ChangeDtm AS DATE) >= @start'; params.start = { type: sql.NVarChar, value: startDate }; }
  if (endDate)   { where += ' AND CAST(sh.ChangeDtm AS DATE) <= @end';   params.end   = { type: sql.NVarChar, value: endDate }; }
  if (search)    { where += ' AND (p.ProdName LIKE @q OR c.CustName LIKE @q OR sm.OrderWeek LIKE @q)'; params.q = { type: sql.NVarChar, value: `%${search}%` }; }

  try {
    const result = await query(
      `SELECT TOP 200
        CONVERT(NVARCHAR(10), sh.ChangeDtm, 120) AS ChangeDtm,
        ISNULL(sm.OrderWeek, '') AS week,
        c.CustName, p.CounName AS country, p.FlowerName AS flower,
        p.ProdName AS name, sh.ChangeType AS type,
        CONVERT(NVARCHAR(10), sh.ShipmentDtm, 120) AS outDate,
        sh.BeforeValue AS before, sh.AfterValue AS after, sh.Descr
       FROM ShipmentHistory sh
       LEFT JOIN ShipmentDetail sd ON sh.SdetailKey = sd.SdetailKey
       LEFT JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       LEFT JOIN Customer c ON sd.CustKey = c.CustKey
       LEFT JOIN Product p  ON sd.ProdKey = p.ProdKey
       ${where}
       ORDER BY sh.ChangeDtm DESC`, params
    );
    return res.status(200).json({ success: true, source: 'real_db', history: result.recordset });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
