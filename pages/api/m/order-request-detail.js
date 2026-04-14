// pages/api/m/order-request-detail.js — 주문 신청 상세 품목 조회
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const rk = parseInt(req.query.requestKey);
  if (!rk) return res.status(400).json({ success: false, error: 'requestKey 필요' });
  const r = await query(
    `SELECT d.RequestDetailKey, d.Quantity, d.Unit, p.ProdKey, p.ProdName
       FROM OrderRequestDetail d
       JOIN Product p ON p.ProdKey = d.ProdKey
      WHERE d.RequestKey = @rk`,
    { rk: { type: sql.Int, value: rk } }
  );
  return res.status(200).json({ success: true, items: r.recordset });
}

export default withAuth(handler);
