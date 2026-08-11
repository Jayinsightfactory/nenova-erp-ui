import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { requireOrderYear } from '../../../lib/orderUtils';
import { sortCustomerProducts } from '../../../lib/myCustomerOrderEntry';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  try {
    const custKey = Number(req.query.custKey || 0);
    if (!custKey) {
      const r = await query(`SELECT c.CustKey, c.CustName, ISNULL(c.CustArea,'') AS CustArea, ISNULL(c.OrderCode,'') AS OrderCode,
          ISNULL(NULLIF(LTRIM(RTRIM(m.ManagerName)),''), N'담당자 미지정') AS ManagerName,
          CASE WHEN LTRIM(RTRIM(ISNULL(c.Manager,''))) IN (LTRIM(RTRIM(@uid)), LTRIM(RTRIM(@uname))) THEN 1 ELSE 0 END AS IsMine,
          recent.LastOrderDtm, recent.LastOrderYear, recent.LastOrderWeek
        FROM Customer c
        OUTER APPLY (SELECT TOP 1 ISNULL(NULLIF(ui.UserName,''),c.Manager) AS ManagerName FROM UserInfo ui
          WHERE ui.UserID=c.Manager OR ui.UserName=c.Manager ORDER BY CASE WHEN ui.UserID=c.Manager THEN 0 ELSE 1 END) m
        OUTER APPLY (SELECT TOP 1 om.OrderDtm AS LastOrderDtm, om.OrderYear AS LastOrderYear, om.OrderWeek AS LastOrderWeek
          FROM OrderMaster om WHERE om.CustKey=c.CustKey AND ISNULL(om.isDeleted,0)=0
          ORDER BY om.OrderDtm DESC, om.OrderMasterKey DESC) recent
        WHERE ISNULL(c.isDeleted,0)=0
        ORDER BY CASE WHEN recent.LastOrderDtm IS NULL THEN 1 ELSE 0 END, recent.LastOrderDtm DESC,
          CASE WHEN LTRIM(RTRIM(ISNULL(c.Manager,''))) IN (LTRIM(RTRIM(@uid)), LTRIM(RTRIM(@uname))) THEN 0 ELSE 1 END, c.CustName`, {
        uid: { type: sql.NVarChar, value: String(req.user?.userId || '') }, uname: { type: sql.NVarChar, value: String(req.user?.userName || '') },
      });
      return res.status(200).json({ success: true, customers: r.recordset });
    }
    const active = await query(`SELECT TOP 1 CustKey FROM Customer WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0`, { ck: { type: sql.Int, value: custKey } });
    if (!active.recordset[0]) return res.status(404).json({ success: false, error: '사용 가능한 업체가 아닙니다.' });
    const { orderYear, orderWeek } = requireOrderYear(req.query.week || '', req.query.year || '');
    const r = await query(`SELECT p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit,
        COUNT_BIG(*) AS UsageCount, MAX(om.OrderYear) AS LastOrderYear, MAX(om.OrderWeek) AS LastOrderWeek,
        CASE WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(cur.BoxQty,0)
             WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(cur.BunchQty,0)
             ELSE ISNULL(cur.SteamQty,0) END AS CurrentQty
      FROM OrderMaster om
      JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
      OUTER APPLY (SELECT SUM(ISNULL(xod.BoxQuantity,0)) AS BoxQty,
                          SUM(ISNULL(xod.BunchQuantity,0)) AS BunchQty,
                          SUM(ISNULL(xod.SteamQuantity,0)) AS SteamQty
        FROM OrderMaster xom JOIN OrderDetail xod ON xod.OrderMasterKey=xom.OrderMasterKey AND ISNULL(xod.isDeleted,0)=0
        WHERE xom.CustKey=@ck AND xom.OrderYear=@year AND xom.OrderWeek=@week AND ISNULL(xom.isDeleted,0)=0 AND xod.ProdKey=p.ProdKey) cur
      WHERE om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
      GROUP BY p.ProdKey,p.ProdName,p.DisplayName,p.FlowerName,p.CounName,p.OutUnit,cur.BoxQty,cur.BunchQty,cur.SteamQty`, {
      ck: { type: sql.Int, value: custKey }, year: { type: sql.NVarChar, value: orderYear }, week: { type: sql.NVarChar, value: orderWeek },
    });
    return res.status(200).json({ success: true, products: sortCustomerProducts(r.recordset), year: orderYear, week: orderWeek });
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
});
