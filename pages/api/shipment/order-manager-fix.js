// pages/api/shipment/order-manager-fix.js
//  OrderMaster.Manager 가 UserInfo.UserID 에 없으면 ViewOrder(전산 분배 grid 원천) INNER JOIN UserInfo
//  에서 탈락 → 거래처가 전산 주문/분배 화면에 안 뜸. 웹이 Manager 에 문자열 '관리자'(=UserName)를
//  잘못 넣어 발생. 올바른 '관리자' 계정의 UserID 로 정정한다.
//
//  GET  ?week=23-01           → 진단: 유효 관리자 UserID, 깨진 주문 목록, 정상 주문 Manager 샘플
//  POST { week, action:'fix' }→ 보정: 해당 차수에서 Manager∉UserInfo 인 주문을 유효 UserID 로 UPDATE
import { withAuth } from '../../../lib/auth';
import { withTransaction, query, sql } from '../../../lib/db';
import { withActionLog } from '../../../lib/withActionLog';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

async function resolveAdminUserId(q) {
  // 1) UserName='관리자' 인 계정의 UserID
  const r = await q(
    `SELECT TOP 1 UserID FROM UserInfo WHERE UserName=N'관리자' ORDER BY UserID`, {}
  );
  if (r.recordset[0]?.UserID != null) return r.recordset[0].UserID;
  // 2) fallback: CreateID 관례인 'admin' 이 UserInfo 에 있으면 사용
  const a = await q(`SELECT TOP 1 UserID FROM UserInfo WHERE UserID='admin'`, {});
  return a.recordset[0]?.UserID ?? null;
}

async function handler(req, res) {
  const week = normalizeOrderWeek(req.query?.week || req.body?.week || '');
  if (!week) return res.status(400).json({ success: false, error: 'week 필요' });
  const uid = req.user?.userId || 'system';

  try {
    if (req.method === 'GET') {
      const adminId = await resolveAdminUserId(query);
      const usersSample = await query(`SELECT TOP 15 UserID, UserName FROM UserInfo ORDER BY UserID`, {});
      const validManagers = await query(
        `SELECT TOP 10 om.Manager, ui.UserName, COUNT(*) AS Cnt
           FROM OrderMaster om JOIN UserInfo ui ON om.Manager=ui.UserID
          WHERE om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0
          GROUP BY om.Manager, ui.UserName ORDER BY COUNT(*) DESC`,
        { wk: { type: sql.NVarChar, value: week } }
      );
      const broken = await query(
        `SELECT om.OrderMasterKey, om.Manager, c.CustName, COUNT(od.OrderDetailKey) AS Lines
           FROM OrderMaster om
           JOIN Customer c ON c.CustKey=om.CustKey
           LEFT JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
          WHERE om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0
            AND NOT EXISTS (SELECT 1 FROM UserInfo ui WHERE ui.UserID=om.Manager)
          GROUP BY om.OrderMasterKey, om.Manager, c.CustName
          ORDER BY c.CustName`,
        { wk: { type: sql.NVarChar, value: week } }
      );
      return res.status(200).json({
        success: true, week,
        adminUserId: adminId,
        usersSample: usersSample.recordset,
        validManagers: validManagers.recordset,
        brokenCount: broken.recordset.length,
        broken: broken.recordset,
      });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || '');
      if (action !== 'fix') return res.status(400).json({ success: false, error: 'action=fix 필요' });

      const result = await withTransaction(async (tQ) => {
        const adminId = await resolveAdminUserId(tQ);
        if (adminId == null) throw new Error("UserInfo 에서 '관리자' 계정을 찾지 못했습니다. 정정 기준 UserID 를 확인하세요.");
        const upd = await tQ(
          `UPDATE om
              SET om.Manager=@adminId, om.LastUpdateID=@uid, om.LastUpdateDtm=GETDATE()
             FROM OrderMaster om
            WHERE om.OrderWeek=@wk AND ISNULL(om.isDeleted,0)=0
              AND NOT EXISTS (SELECT 1 FROM UserInfo ui WHERE ui.UserID=om.Manager)`,
          { wk: { type: sql.NVarChar, value: week },
            adminId: { type: sql.NVarChar, value: String(adminId) },
            uid: { type: sql.NVarChar, value: uid } }
        );
        return { adminId, updated: upd.rowsAffected?.[0] || 0 };
      });

      return res.status(200).json({
        success: true, week,
        ...result,
        message: `Manager 정정 완료 — ${result.updated}건을 유효 UserID(${result.adminId})로 변경. 이제 전산 분배 grid 에 거래처가 표시됩니다.`,
      });
    }

    return res.status(405).json({ success: false, error: 'GET/POST only' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(withActionLog(handler, { actionType: 'ORDER_MANAGER_FIX', affectedTable: 'OrderMaster', riskLevel: 'MEDIUM' }));
