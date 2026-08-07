import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

function target02(year, week) {
  const parent = String(week || '').match(/^(\d{1,2})/)?.[1];
  if (!/^\d{4}$/.test(String(year || '')) || !parent) return null;
  return { year: String(year), week: `${String(parent).padStart(2, '0')}-02` };
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'method not allowed' });
  const target = target02(req.query.year, req.query.week);
  const custKey = Number(req.query.custKey);
  const prodKey = Number(req.query.prodKey);
  if (!target || !custKey) return res.status(400).json({ success: false, error: '연도·차수·업체가 필요합니다.' });
  const params = { yr:{type:sql.NVarChar,value:target.year}, wk:{type:sql.NVarChar,value:target.week}, ck:{type:sql.Int,value:custKey}, pk:{type:sql.Int,value:prodKey || 0} };
  const masters = await query(`SELECT ShipmentKey, ISNULL(isFix,0) AS MasterFix FROM ShipmentMaster WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND ISNULL(isDeleted,0)=0 ORDER BY ShipmentKey`, params);
  if (!masters.recordset.length) return res.status(409).json({ success:false, code:'MISSING_SUBWEEK_02', error:`${target.year}년 ${target.week}차 출고 원장이 없습니다. 전산에서 대상 차수를 확인하세요.`, target });
  let duplicate = null;
  let prices = [];
  if (prodKey > 0) {
    duplicate = (await query(`SELECT TOP 1 sd.SdetailKey, sd.OutQuantity, sd.EstQuantity, sd.Cost, ISNULL(sd.isFix,0) AS DetailFix, sd.ShipmentDtm FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND sd.ProdKey=@pk AND ISNULL(sm.isDeleted,0)=0 ORDER BY sd.SdetailKey`, params)).recordset[0] || null;
    prices = (await query(`SELECT TOP 12 sd.Cost, sm.CustKey, c.CustName, sm.OrderYear, sm.OrderWeek, sd.ShipmentDtm FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey JOIN Product sp ON sp.ProdKey=sd.ProdKey JOIN Product tp ON tp.ProdKey=@pk LEFT JOIN Customer c ON c.CustKey=sm.CustKey WHERE sd.Cost>0 AND ISNULL(sm.isDeleted,0)=0 AND sp.OutUnit=tp.OutUnit AND ISNULL(sp.CounName,'')=ISNULL(tp.CounName,'') AND ISNULL(sp.FlowerName,'')=ISNULL(tp.FlowerName,'') AND (sd.ProdKey=@pk OR sp.ProdName=tp.ProdName) ORDER BY CASE WHEN sm.CustKey=@ck THEN 0 ELSE 1 END, sd.ShipmentDtm DESC, sd.SdetailKey DESC`, params)).recordset;
  }
  return res.json({ success:true, target, duplicate, fixed:masters.recordset.some(r=>Number(r.MasterFix)===1)||Number(duplicate?.DetailFix)===1, prices:prices.map(p=>({...p, sourceType:Number(p.CustKey)===custKey?'CUSTOMER_HISTORY':'OTHER_CUSTOMER_REFERENCE', vatIncluded:true})) });
}

export default withAuth(handler);
