import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success:false, error:'Method not allowed' });
  const year = String(req.query.year || '');
  const week = String(req.query.week || '').replace(/^\d{4}-/, '');
  const custKey = Number(req.query.custKey);
  const source = req.query.source === 'shipment' ? 'shipment' : 'order';
  if (!/^\d{4}$/.test(year) || !/^\d{2}-\d{2}$/.test(week) || !Number.isInteger(custKey) || custKey <= 0) {
    return res.status(400).json({ success:false, error:'year, week, custKey가 필요합니다.' });
  }
  try {
    const common = { year:{type:sql.NVarChar,value:year}, week:{type:sql.NVarChar,value:week}, ck:{type:sql.Int,value:custKey} };
    const result = source === 'order' ? await query(
      `SELECT od.ProdKey,p.ProdName,ISNULL(p.DisplayName,p.ProdName) DisplayName,p.FlowerName,p.CounName,p.OutUnit,
              ISNULL(p.Cost,0) unitPrice, CASE WHEN p.OutUnit IN (N'단',N'BUNCH',N'Bunch') THEN od.BunchQuantity
                   WHEN p.OutUnit IN (N'송이',N'STEAM',N'STEM') THEN od.SteamQuantity ELSE od.BoxQuantity END qty
         FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND ISNULL(od.isDeleted,0)=0
         JOIN Product p ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
        WHERE om.OrderYear=@year AND om.OrderWeek=@week AND om.CustKey=@ck AND ISNULL(om.isDeleted,0)=0`, common)
      : await query(
      `SELECT sd.ProdKey,p.ProdName,ISNULL(p.DisplayName,p.ProdName) DisplayName,p.FlowerName,p.CounName,p.OutUnit,ISNULL(sd.Cost,0) unitPrice,sd.OutQuantity qty
         FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
        WHERE sm.OrderYear=@year AND sm.OrderWeek=@week AND sm.CustKey=@ck AND ISNULL(sm.isDeleted,0)=0 AND sd.OutQuantity>0`, common);
    return res.json({ success:true, source, rows:result.recordset || [] });
  } catch (e) { return res.status(500).json({ success:false,error:e.message }); }
});
