// pages/api/debug/watch.js — DB 변경 모니터링 (전산 입력 감지용)
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { sinceDetailKey, sinceMasterKey } = req.query;

  try {
    if (!sinceDetailKey && !sinceMasterKey) {
      // 초기화: 현재 max key 반환
      const r = await query(`
        SELECT
          (SELECT ISNULL(MAX(OrderDetailKey),0) FROM OrderDetail) AS maxDetailKey,
          (SELECT ISNULL(MAX(OrderMasterKey),0) FROM OrderMaster) AS maxMasterKey
      `, {});
      return res.json(r.recordset[0]);
    }

    const dk = parseInt(sinceDetailKey) || 0;
    const mk = parseInt(sinceMasterKey) || 0;

    // 새로운 OrderMaster
    const newMasters = await query(`
      SELECT om.OrderMasterKey, om.CustKey, c.CustName, om.OrderWeek,
             CONVERT(NVARCHAR(19), om.OrderDtm, 120) AS OrderDtm,
             om.Manager, om.isDeleted
      FROM OrderMaster om
      LEFT JOIN Customer c ON om.CustKey = c.CustKey
      WHERE om.OrderMasterKey > @mk
      ORDER BY om.OrderMasterKey
    `, { mk: { type: sql.Int, value: mk } });

    // 새로운 OrderDetail
    const newDetails = await query(`
      SELECT od.OrderDetailKey, od.OrderMasterKey, od.ProdKey,
             p.ProdName, p.OutUnit,
             od.BoxQuantity, od.BunchQuantity, od.SteamQuantity,
             od.NoneOutQuantity, od.isDeleted,
             c.CustName
      FROM OrderDetail od
      LEFT JOIN OrderMaster om ON od.OrderMasterKey = om.OrderMasterKey
      LEFT JOIN Customer c ON om.CustKey = c.CustKey
      LEFT JOIN Product p ON od.ProdKey = p.ProdKey
      WHERE od.OrderDetailKey > @dk
      ORDER BY od.OrderDetailKey
    `, { dk: { type: sql.Int, value: dk } });

    // 최신 max key (다음 폴링용)
    const maxR = await query(`
      SELECT
        (SELECT ISNULL(MAX(OrderDetailKey),0) FROM OrderDetail) AS maxDetailKey,
        (SELECT ISNULL(MAX(OrderMasterKey),0) FROM OrderMaster) AS maxMasterKey
    `, {});

    return res.json({
      newMasters: newMasters.recordset,
      newDetails: newDetails.recordset,
      maxDetailKey: maxR.recordset[0].maxDetailKey,
      maxMasterKey: maxR.recordset[0].maxMasterKey,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
