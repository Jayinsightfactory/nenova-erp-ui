import { query, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { normalizeWeekdayCompareRequest, normalizeWeekdayUnit } from '../../../lib/weekdayEstimateCompare.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).end(); }
  let scope;
  try { scope = normalizeWeekdayCompareRequest({ ...req.query, orderWeeks:String(req.query.orderWeeks ?? '').split(','), prodKeys:[1] }); }
  catch(error) { return res.status(400).json({success:false,error:error.message}); }
  const params = { year:{type:sql.Int,value:scope.year}, custKey:{type:sql.Int,value:scope.custKey} };
  const majors=[...new Set(scope.weeks.map(week=>week.slice(0,2)))];
  majors.forEach((major,i)=>{params[`major${i}`]={type:sql.NVarChar(2),value:major};});
  const majorIn = majors.map((_,i)=>`@major${i}`).join(',');
  try {
    const result = await query(`WITH selected AS (
      SELECT sd.ProdKey FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.CustKey=sm.CustKey
      WHERE sm.OrderYear=@year AND sm.CustKey=@custKey AND LEFT(sm.OrderWeek,2) IN (${majorIn}) AND ISNULL(sm.isDeleted,0)=0
      UNION
      SELECT od.ProdKey FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
      WHERE om.OrderYear=@year AND om.CustKey=@custKey AND LEFT(om.OrderWeek,2) IN (${majorIn})
        AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
    ) SELECT TOP 501 p.ProdKey,p.ProdName,p.OutUnit,p.FlowerName,p.CounName
      FROM selected s JOIN Product p ON p.ProdKey=s.ProdKey AND ISNULL(p.isDeleted,0)=0
      WHERE EXISTS(SELECT 1 FROM Customer c WHERE c.CustKey=@custKey AND ISNULL(c.isDeleted,0)=0)
      ORDER BY p.FlowerName,p.ProdName,p.ProdKey;
      SELECT DISTINCT sm.OrderWeek FROM ShipmentMaster sm
      WHERE sm.OrderYear=@year AND sm.CustKey=@custKey AND LEFT(sm.OrderWeek,2) IN (${majorIn}) AND ISNULL(sm.isDeleted,0)=0
      UNION SELECT DISTINCT om.OrderWeek FROM OrderMaster om
      WHERE om.OrderYear=@year AND om.CustKey=@custKey AND LEFT(om.OrderWeek,2) IN (${majorIn}) AND ISNULL(om.isDeleted,0)=0`,params);
    if(result.recordset.length>500) return res.status(409).json({success:false,error:'조회 품목이 500개를 넘습니다. 차수 범위를 줄여주세요. 일부 품목만 숨겨 표시하지 않습니다.'});
    const orderWeeks=[...new Set([...scope.weeks,...(result.recordsets?.[1]||[]).map(row=>String(row.OrderWeek||''))])];
    if(orderWeeks.some(week=>!/^\d{2}-\d{2}$/.test(week))||orderWeeks.length>20) return res.status(409).json({success:false,error:'실제 세부차수 형식 또는 개수를 확인해야 합니다. 일부 차수만 숨겨 표시하지 않습니다.'});
    res.setHeader('Cache-Control','no-store');
    return res.status(200).json({success:true,readOnly:true,scope:{year:scope.year,custKey:scope.custKey,orderWeeks},products:result.recordset.map(row=>({...row,ProdKey:Number(row.ProdKey),outUnit:normalizeWeekdayUnit(row.OutUnit)}))});
  } catch(error) { console.error('[weekday-products]',error); return res.status(500).json({success:false,error:'거래처 전산 품목을 불러오지 못했습니다.'}); }
});
