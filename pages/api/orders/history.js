// pages/api/orders/history.js — 주문 변경 내역 조회
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderHistorySearch, buildOrderHistoryWhere, ORDER_HISTORY_PAGE_SIZE } from '../../../lib/orderHistorySearch';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const scope = normalizeOrderHistorySearch(req.query);
    const { where, values } = buildOrderHistoryWhere(scope);
    const params = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { type: sql.NVarChar, value }]));
    params.offset = { type: sql.Int, value: (scope.page - 1) * ORDER_HISTORY_PAGE_SIZE };
    params.take = { type: sql.Int, value: ORDER_HISTORY_PAGE_SIZE + 1 };
    const result = await query(
      `SELECT oh.OrderHistoryKey AS historyKey,
        CONVERT(NVARCHAR(19), oh.ChangeDtm, 120) AS 변경일자,
        oh.ChangeID AS 변경사용자,
        om.OrderYear AS 연도,
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
       ORDER BY oh.ChangeDtm DESC, oh.OrderHistoryKey DESC
       OFFSET @offset ROWS FETCH NEXT @take ROWS ONLY`,
      params
    );
    const records = result.recordset || [];
    return res.status(200).json({ success: true, history: records.slice(0, ORDER_HISTORY_PAGE_SIZE), page: scope.page,
      hasMore: records.length > ORDER_HISTORY_PAGE_SIZE, orderYear: scope.year });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});
