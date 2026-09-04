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
        ORDER BY CASE WHEN LTRIM(RTRIM(ISNULL(c.Manager,''))) IN (LTRIM(RTRIM(@uid)), LTRIM(RTRIM(@uname))) THEN 0 ELSE 1 END,
          CASE WHEN recent.LastOrderDtm IS NULL THEN 1 ELSE 0 END, recent.LastOrderDtm DESC, c.CustName`, {
        uid: { type: sql.NVarChar, value: String(req.user?.userId || '') }, uname: { type: sql.NVarChar, value: String(req.user?.userName || '') },
      });
      return res.status(200).json({ success: true, customers: r.recordset });
    }
    const active = await query(`SELECT TOP 1 CustKey FROM Customer WHERE CustKey=@ck AND ISNULL(isDeleted,0)=0`, { ck: { type: sql.Int, value: custKey } });
    if (!active.recordset[0]) return res.status(404).json({ success: false, error: '사용 가능한 업체가 아닙니다.' });
    if (req.query.view === 'history') {
      const { orderYear, orderWeek } = requireOrderYear(req.query.week || '', req.query.year || '');
      const h = await query(`SELECT om.OrderMasterKey, om.OrderYear, om.OrderWeek, om.OrderDtm,
          od.ProdKey, p.ProdName, p.DisplayName, p.FlowerName,
          COALESCE(NULLIF(LTRIM(RTRIM(p.CountryFlower)),''), ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'')) AS CountryFlower,
          p.CounName, p.OutUnit,
          ISNULL(od.OutQuantity,0) AS Qty
        FROM OrderMaster om
        JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
        JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
        WHERE om.CustKey=@ck AND om.OrderYear=@year AND om.OrderWeek < @week AND ISNULL(om.isDeleted,0)=0
        ORDER BY om.OrderDtm DESC, om.OrderMasterKey DESC, od.OrderDetailKey`, {
        ck: { type: sql.Int, value: custKey }, year: { type: sql.NVarChar, value: orderYear }, week: { type: sql.NVarChar, value: orderWeek },
      });
      const orders = [];
      const byMaster = new Map();
      for (const row of h.recordset) {
        if (!byMaster.has(row.OrderMasterKey)) {
          const order = { id: row.OrderMasterKey, year: String(row.OrderYear || ''), week: row.OrderWeek,
            date: row.OrderDtm, items: [] };
          byMaster.set(row.OrderMasterKey, order); orders.push(order);
        }
        if (Number(row.Qty) > 0) byMaster.get(row.OrderMasterKey).items.push({
          prodKey: row.ProdKey, prodName: row.ProdName, displayName: row.DisplayName,
          flowerName: row.FlowerName, countryFlower: row.CountryFlower, counName: row.CounName,
          unit: row.OutUnit, qty: Number(row.Qty),
        });
      }
      return res.status(200).json({ success: true, orders: orders.filter(order => order.items.length).slice(0, 40) });
    }
    const { orderYear, orderWeek } = requireOrderYear(req.query.week || '', req.query.year || '');
    const r = await query(`SELECT p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName,
        COALESCE(NULLIF(LTRIM(RTRIM(p.CountryFlower)),''), ISNULL(p.CounName,'') + ISNULL(p.FlowerName,'')) AS CountryFlower,
        p.CounName, p.OutUnit, p.BunchOf1Box, p.SteamOf1Bunch, p.SteamOf1Box,
        COUNT_BIG(*) AS UsageCount, MAX(om.OrderYear) AS LastOrderYear, MAX(om.OrderWeek) AS LastOrderWeek,
        ISNULL(cur.OutQty,0) AS CurrentQty,
        ISNULL(cur.ActiveRows,0) AS CurrentOrderRows
      FROM OrderMaster om
      JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
      JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
      OUTER APPLY (SELECT SUM(ISNULL(xod.OutQuantity,0)) AS OutQty,
                          COUNT_BIG(*) AS ActiveRows
        FROM OrderMaster xom JOIN OrderDetail xod ON xod.OrderMasterKey=xom.OrderMasterKey AND ISNULL(xod.isDeleted,0)=0
        WHERE xom.CustKey=@ck AND xom.OrderYear=@year AND xom.OrderWeek=@week AND ISNULL(xom.isDeleted,0)=0 AND xod.ProdKey=p.ProdKey) cur
      WHERE om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0
      GROUP BY p.ProdKey,p.ProdName,p.DisplayName,p.FlowerName,p.CountryFlower,p.CounName,p.OutUnit,p.BunchOf1Box,p.SteamOf1Bunch,p.SteamOf1Box,cur.OutQty,cur.ActiveRows`, {
      ck: { type: sql.Int, value: custKey }, year: { type: sql.NVarChar, value: orderYear }, week: { type: sql.NVarChar, value: orderWeek },
    });
    return res.status(200).json({ success: true, products: sortCustomerProducts(r.recordset), year: orderYear, week: orderWeek });
  } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
});
