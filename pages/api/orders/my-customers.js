import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { requireOrderYear } from '../../../lib/orderUtils';
import { sortCustomerProducts } from '../../../lib/myCustomerOrderEntry';

function userParams(user) {
  return {
    uid: { type: sql.NVarChar, value: String(user?.userId || '') },
    uname: { type: sql.NVarChar, value: String(user?.userName || '') },
  };
}

async function ownsCustomer(user, custKey) {
  const r = await query(`SELECT TOP 1 CustKey FROM Customer WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0
    AND (LTRIM(RTRIM(ISNULL(Manager,'')))=LTRIM(RTRIM(@uid)) OR LTRIM(RTRIM(ISNULL(Manager,'')))=LTRIM(RTRIM(@uname)))`, {
    ck: { type: sql.Int, value: Number(custKey) }, ...userParams(user),
  });
  return Boolean(r.recordset[0]);
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  try {
    const custKey = Number(req.query.custKey || 0);
    if (!custKey) {
      const r = await query(`SELECT CustKey, CustName, ISNULL(CustArea,'') AS CustArea, ISNULL(OrderCode,'') AS OrderCode
        FROM Customer WHERE ISNULL(isDeleted,0)=0
          AND (LTRIM(RTRIM(ISNULL(Manager,'')))=LTRIM(RTRIM(@uid)) OR LTRIM(RTRIM(ISNULL(Manager,'')))=LTRIM(RTRIM(@uname)))
        ORDER BY CustName`, userParams(req.user));
      return res.status(200).json({ success: true, customers: r.recordset });
    }
    if (!(await ownsCustomer(req.user, custKey))) return res.status(403).json({ success: false, error: '본인 담당 업체만 조회할 수 있습니다.' });
    const { orderYear, orderWeek } = requireOrderYear(req.query.week || '', req.query.year || '');
    const r = await query(`SELECT p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.OutUnit,
        COUNT_BIG(*) AS UsageCount, MAX(om.OrderYear) AS LastOrderYear, MAX(om.OrderWeek) AS LastOrderWeek,
        ISNULL(cur.CurrentQty,0) AS CurrentQty
      FROM OrderMaster om
      JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
      OUTER APPLY (SELECT SUM(CASE WHEN p.OutUnit IN (N'박스','BOX','Box') THEN xod.BoxQuantity WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN xod.BunchQuantity ELSE xod.SteamQuantity END) CurrentQty
        FROM OrderMaster xom JOIN OrderDetail xod ON xod.OrderMasterKey=xom.OrderMasterKey AND ISNULL(xod.isDeleted,0)=0
        WHERE xom.CustKey=@ck AND xom.OrderYear=@year AND xom.OrderWeek=@week AND ISNULL(xom.isDeleted,0)=0 AND xod.ProdKey=p.ProdKey) cur
      WHERE om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
      GROUP BY p.ProdKey,p.ProdName,p.DisplayName,p.FlowerName,p.CounName,p.OutUnit,cur.CurrentQty`, {
      ck: { type: sql.Int, value: custKey }, year: { type: sql.NVarChar, value: orderYear }, week: { type: sql.NVarChar, value: orderWeek },
    });
    return res.status(200).json({ success: true, products: sortCustomerProducts(r.recordset), year: orderYear, week: orderWeek });
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
});
