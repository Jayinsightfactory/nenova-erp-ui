// pages/api/m/order-request.js — 주문 등록 신청 생성
// POST  : 신청 생성 (모바일에서)
// GET   : 내 신청 목록 또는 전체 pending (관리자)
import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';

async function handler(req, res) {
  if (req.method === 'POST') return await createRequest(req, res);
  if (req.method === 'GET')  return await listRequests(req, res);
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

async function createRequest(req, res) {
  const { custKey, orderWeek, memo, items } = req.body || {};
  if (!custKey || !orderWeek || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: '거래처/차수/품목이 필요합니다.' });
  }

  try {
    const requestKey = await withTransaction(async (tQ) => {
      const ins = await tQ(
        `INSERT INTO OrderRequest (RequesterUserId, RequesterName, CustKey, OrderWeek, Status, Memo, CreatedAt)
         OUTPUT INSERTED.RequestKey
         VALUES (@uid, @uname, @ck, @wk, 'pending', @memo, GETDATE())`,
        {
          uid:   { type: sql.NVarChar, value: req.user.userId },
          uname: { type: sql.NVarChar, value: req.user.userName || req.user.userId },
          ck:    { type: sql.Int,      value: parseInt(custKey) },
          wk:    { type: sql.NVarChar, value: orderWeek },
          memo:  { type: sql.NVarChar, value: memo || '' },
        }
      );
      const rk = ins.recordset[0].RequestKey;
      for (const it of items) {
        if (!it.prodKey || !it.quantity) continue;
        await tQ(
          `INSERT INTO OrderRequestDetail (RequestKey, ProdKey, Quantity, Unit)
           VALUES (@rk, @pk, @qty, @u)`,
          {
            rk:  { type: sql.Int,      value: rk },
            pk:  { type: sql.Int,      value: parseInt(it.prodKey) },
            qty: { type: sql.Float,    value: parseFloat(it.quantity) },
            u:   { type: sql.NVarChar, value: it.unit || '박스' },
          }
        );
      }
      return rk;
    });
    return res.status(201).json({ success: true, requestKey });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function listRequests(req, res) {
  const status = req.query.status || 'pending';
  const isAdmin = /admin|관리자|대표/i.test(req.user?.authority || '') || req.user?.deptName === '대표';
  const where = isAdmin ? '' : 'AND r.RequesterUserId = @uid';
  const params = {
    st: { type: sql.NVarChar, value: status },
    ...(isAdmin ? {} : { uid: { type: sql.NVarChar, value: req.user.userId } }),
  };

  const rows = await query(
    `SELECT r.RequestKey, r.OrderWeek, r.Status, r.CreatedAt, r.RequesterName,
            r.Memo, r.ProcessedAt, r.ProcessedBy, r.RejectReason, r.ApprovedOrderKey,
            c.CustKey, c.CustName,
            (SELECT COUNT(*) FROM OrderRequestDetail d WHERE d.RequestKey=r.RequestKey) AS itemCount
       FROM OrderRequest r
       JOIN Customer c ON c.CustKey = r.CustKey
      WHERE r.Status = @st ${where}
      ORDER BY r.CreatedAt DESC`,
    params
  );
  return res.status(200).json({ success: true, requests: rows.recordset, isAdmin });
}

export default withAuth(handler);
