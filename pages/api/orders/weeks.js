// pages/api/orders/weeks.js — 주문등록용 전체 차수 목록
// OrderMaster + WarehouseMaster UNION (중복 제거, 최신순)

import { query } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const r = await query(
      `SELECT DISTINCT OrderWeek AS w FROM OrderMaster
         WHERE isDeleted=0 AND OrderWeek IS NOT NULL AND OrderWeek<>''
       UNION
       SELECT DISTINCT OrderWeek AS w FROM WarehouseMaster
         WHERE isDeleted=0 AND OrderWeek IS NOT NULL AND OrderWeek<>''
       ORDER BY w DESC`
    );
    return res.status(200).json({ success: true, weeks: r.recordset.map(x => x.w) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
