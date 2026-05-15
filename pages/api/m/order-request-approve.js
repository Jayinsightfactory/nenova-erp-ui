// pages/api/m/order-request-approve.js
// POST { requestKey, action: 'approve'|'reject', rejectReason? }
// 승인 시: 기존 OrderMaster/OrderDetail 에 INSERT (13/14차 구조 유지)
import { withAuth } from '../../../lib/auth';
import { query, withTransaction, sql } from '../../../lib/db';
import { safeNextKey } from '../../../lib/safeNextKey';
import { normalizeOrderUnit } from '../../../lib/orderUtils';

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

      // 동일 CustKey+OrderWeek OrderMaster 찾기 (실제 컬럼: OrderMasterKey)
      const existing = await tQ(
        `SELECT OrderMasterKey FROM OrderMaster
          WHERE CustKey=@ck AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0`,
        {
          ck: { type: sql.Int,      value: reqRow.CustKey },
          wk: { type: sql.NVarChar, value: reqRow.OrderWeek },
        }
      );
      let ok;
      if (existing.recordset.length > 0) {
        ok = existing.recordset[0].OrderMasterKey;
      } else {
        ok = await safeNextKey(tQ, 'OrderMaster', 'OrderMasterKey');
        // 전산 ViewOrder INNER JOIN UserInfo 충돌 방지: Manager 필수
        await tQ(
          `INSERT INTO OrderMaster
             (OrderMasterKey, OrderDtm, OrderYear, OrderWeek, OrderYearWeek, Manager, CustKey, OrderCode, Descr,
              isDeleted, CreateID, CreateDtm, LastUpdateID, LastUpdateDtm)
           VALUES (@ok, GETDATE(), @yr, @wk, @ywk, @mgr, @ck, '', '',
                   0, @uid, GETDATE(), @uid, GETDATE())`,
          {
            ok:  { type: sql.Int,      value: ok },
            yr:  { type: sql.NVarChar, value: year },
            wk:  { type: sql.NVarChar, value: reqRow.OrderWeek },
            ywk: { type: sql.NVarChar, value: ywk },
            mgr: { type: sql.NVarChar, value: req.user.userId || 'admin' },
            ck:  { type: sql.Int,      value: reqRow.CustKey },
            uid: { type: sql.NVarChar, value: 'admin' },
          }
        );
      }

      // OrderRequestDetail → OrderDetail INSERT
      // Product 환산정보 함께 가져와 Box/Bunch/Steam 3종 채움 (전산 호환)
      const details = await tQ(
        `SELECT ord.ProdKey, ord.Quantity, ord.Unit,
                p.OutUnit, p.EstUnit, ISNULL(p.BunchOf1Box,1) AS bpb, ISNULL(p.SteamOf1Box,1) AS spb
           FROM OrderRequestDetail ord
           JOIN Product p ON ord.ProdKey = p.ProdKey
          WHERE ord.RequestKey=@rk`,
        { rk: { type: sql.Int, value: parseInt(requestKey) } }
      );
      for (const d of details.recordset) {
        const odk = await safeNextKey(tQ, 'OrderDetail', 'OrderDetailKey');
        // 단위 환산: 사용자가 입력한 단위(d.Unit) 기준으로 박스 수량 역산
        const unit = normalizeOrderUnit(d.Unit, normalizeOrderUnit(d.OutUnit, '박스'));
        const outUnit = normalizeOrderUnit(d.OutUnit, unit);
        const estUnit = normalizeOrderUnit(d.EstUnit, outUnit);
        const qty = d.Quantity || 0;
        let boxQ;
        if (unit === '단' || unit.toUpperCase() === 'BUNCH') {
          boxQ = qty / d.bpb;
        } else if (unit === '송이' || unit.toUpperCase() === 'STEM' || unit.toUpperCase() === 'STEAM') {
          boxQ = qty / d.spb;
        } else { // 박스 / BOX
          boxQ = qty;
        }
        const bunchQ = boxQ * d.bpb;
        const steamQ = boxQ * d.spb;
        // OutUnit 기준 단일값 (전산 환산)
        let outQ = boxQ;
        if (outUnit === '단') outQ = bunchQ;
        else if (outUnit === '송이') outQ = steamQ;

        await tQ(
          `INSERT INTO OrderDetail
             (OrderDetailKey, OrderMasterKey, ProdKey,
              BoxQuantity, BunchQuantity, SteamQuantity, OutQuantity, EstQuantity, EstUnit, NoneOutQuantity,
              isDeleted, CreateID, CreateDtm)
           VALUES (@odk, @ok, @pk,
                   @box, @bnq, @sq, @oq, @oq, @estUnit, 0,
                   0, @uid, GETDATE())`,
          {
            odk: { type: sql.Int,   value: odk },
            ok:  { type: sql.Int,   value: ok },
            pk:  { type: sql.Int,   value: d.ProdKey },
            box: { type: sql.Float, value: boxQ },
            bnq: { type: sql.Float, value: bunchQ },
            sq:  { type: sql.Float, value: steamQ },
            oq:  { type: sql.Float, value: outQ },
            estUnit: { type: sql.NVarChar, value: estUnit },
            uid: { type: sql.NVarChar, value: 'admin' },
          }
        );
      }

      await runStockCalculation(tQ, String(new Date().getFullYear()), reqRow.OrderWeek, req.user?.userId || 'admin');

      // 신청 상태 업데이트 (ApprovedOrderKey → 컬럼명이 다를 수 있음, 일단 그대로)
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

async function runStockCalculation(tQ, orderYear, orderWeek, uid) {
  await tQ(
    `IF EXISTS (
       SELECT 1 FROM sys.parameters
        WHERE object_id = OBJECT_ID(N'dbo.usp_StockCalculation')
          AND name = N'@oResult'
     )
     BEGIN
       DECLARE @r INT, @m NVARCHAR(MAX);
       EXEC dbo.usp_StockCalculation
            @OrderYear = @year, @OrderWeek = @week, @iUserID = @uid,
            @oResult = @r OUTPUT, @oMessage = @m OUTPUT;
       SELECT @r AS result, @m AS message;
     END
     ELSE
     BEGIN
       EXEC dbo.usp_StockCalculation @OrderYear = @year, @OrderWeek = @week, @iUserID = @uid;
     END`,
    {
      year: { type: sql.NVarChar, value: String(orderYear) },
      week: { type: sql.NVarChar, value: orderWeek || '' },
      uid:  { type: sql.NVarChar, value: uid || 'admin' },
    }
  );
}
