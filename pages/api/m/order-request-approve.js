// pages/api/m/order-request-approve.js
// POST { requestKey, action: 'approve'|'reject', rejectReason? }
// 승인 시: 기존 OrderMaster/OrderDetail 에 INSERT (13/14차 구조 유지)
import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';
import { safeNextKey } from '../../../lib/safeNextKey';

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  const { requestKey, action, rejectReason } = req.body || {};
  if (!requestKey || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ success: false, error: 'requestKey, action 필수' });
  }

  // 관리자만 승인 가능
  const isAdmin = /admin|관리자|대표/i.test(req.user?.authority || '') || req.user?.deptName === '대표';
  if (!isAdmin) {
    return res.status(403).json({ success: false, error: '승인 권한이 없습니다.' });
  }

  try {
    // 신청 정보 조회
    const r = await query(
      `SELECT RequestKey, CustKey, OrderWeek, Status FROM OrderRequest WHERE RequestKey=@rk`,
      { rk: { type: sql.Int, value: parseInt(requestKey) } }
    );
    const reqRow = r.recordset[0];
    if (!reqRow) return res.status(404).json({ success: false, error: '신청을 찾을 수 없습니다.' });
    if (reqRow.Status !== 'pending') {
      return res.status(400).json({ success: false, error: `이미 처리됨 (${reqRow.Status})` });
    }

    if (action === 'reject') {
      await query(
        `UPDATE OrderRequest
            SET Status='rejected', ProcessedAt=GETDATE(),
                ProcessedBy=@by, RejectReason=@reason
          WHERE RequestKey=@rk`,
        {
          rk:     { type: sql.Int,      value: parseInt(requestKey) },
          by:     { type: sql.NVarChar, value: req.user.userId },
          reason: { type: sql.NVarChar, value: rejectReason || '' },
        }
      );
      return res.status(200).json({ success: true, status: 'rejected' });
    }

    // 승인 → 기존 OrderMaster/OrderDetail 로 이동
    const orderKey = await withTransaction(async (tQ) => {
      const year = new Date().getFullYear().toString();
      const ywk = year + (reqRow.OrderWeek || '').replace('-', '');

      // 동일 CustKey+OrderWeek OrderMaster 찾기
      const existing = await tQ(
        `SELECT OrderKey FROM OrderMaster
          WHERE CustKey=@ck AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0`,
        {
          ck: { type: sql.Int,      value: reqRow.CustKey },
          wk: { type: sql.NVarChar, value: reqRow.OrderWeek },
        }
      );
      let ok;
      if (existing.recordset.length > 0) {
        ok = existing.recordset[0].OrderKey;
      } else {
        ok = await safeNextKey(tQ, 'OrderMaster', 'OrderKey');
        await tQ(
          `INSERT INTO OrderMaster (OrderKey, OrderYear, OrderWeek, OrderYearWeek, CustKey, isDeleted, CreateID, CreateDtm)
           VALUES (@ok, @yr, @wk, @ywk, @ck, 0, @uid, GETDATE())`,
          {
            ok:  { type: sql.Int,      value: ok },
            yr:  { type: sql.NVarChar, value: year },
            wk:  { type: sql.NVarChar, value: reqRow.OrderWeek },
            ywk: { type: sql.NVarChar, value: ywk },
            ck:  { type: sql.Int,      value: reqRow.CustKey },
            uid: { type: sql.NVarChar, value: req.user.userId },
          }
        );
      }

      // OrderRequestDetail → OrderDetail INSERT
      const details = await tQ(
        `SELECT ProdKey, Quantity, Unit FROM OrderRequestDetail WHERE RequestKey=@rk`,
        { rk: { type: sql.Int, value: parseInt(requestKey) } }
      );
      for (const d of details.recordset) {
        const odk = await safeNextKey(tQ, 'OrderDetail', 'OdetailKey');
        await tQ(
          `INSERT INTO OrderDetail (OdetailKey, OrderKey, ProdKey, OrderQuantity)
           VALUES (@odk, @ok, @pk, @qty)`,
          {
            odk: { type: sql.Int,   value: odk },
            ok:  { type: sql.Int,   value: ok },
            pk:  { type: sql.Int,   value: d.ProdKey },
            qty: { type: sql.Float, value: d.Quantity },
          }
        );
      }

      // 신청 상태 업데이트
      await tQ(
        `UPDATE OrderRequest
            SET Status='approved', ProcessedAt=GETDATE(),
                ProcessedBy=@by, ApprovedOrderKey=@ok
          WHERE RequestKey=@rk`,
        {
          rk: { type: sql.Int,      value: parseInt(requestKey) },
          by: { type: sql.NVarChar, value: req.user.userId },
          ok: { type: sql.Int,      value: ok },
        }
      );
      return ok;
    });

    return res.status(200).json({ success: true, status: 'approved', orderKey });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default withAuth(handler);
