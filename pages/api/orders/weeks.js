// pages/api/orders/weeks.js — 실제 운영 데이터가 있는 차수 목록
// Order/Warehouse/Shipment/Stock UNION (중복 제거, 유효 차수만, 최신순)

import { query } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const r = await query(
      `SELECT w
         FROM (
           SELECT DISTINCT OrderWeek AS w FROM OrderMaster
            WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
           UNION
           SELECT DISTINCT OrderWeek AS w FROM WarehouseMaster
            WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
           UNION
           SELECT DISTINCT OrderWeek AS w FROM ShipmentMaster
            WHERE ISNULL(isDeleted,0)=0 AND OrderWeek LIKE '__-__'
           UNION
           SELECT DISTINCT OrderWeek AS w FROM StockMaster
            WHERE OrderWeek LIKE '__-__'
         ) x
        WHERE TRY_CONVERT(INT, LEFT(w,2)) BETWEEN 1 AND 52
          AND TRY_CONVERT(INT, RIGHT(w,2)) BETWEEN 1 AND 4
        ORDER BY TRY_CONVERT(INT, LEFT(w,2)) DESC,
                 TRY_CONVERT(INT, RIGHT(w,2)) DESC`
    );
    return res.status(200).json({ success: true, weeks: r.recordset.map(x => x.w) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
