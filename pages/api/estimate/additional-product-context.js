import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { FARM_CANDIDATE_SCOPE_SQL } from '../../../lib/shipmentFarmCandidates.js';
import { rankReferenceCosts } from '../../../lib/estimateAdditionalProduct.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const year = String(req.query.year || '').trim();
  const week = String(req.query.week || '').trim();
  const custKey = Number(req.query.custKey);
  const prodKey = Number(req.query.prodKey);
  if (!/^\d{4}$/.test(year) || !/^\d{2}-02$/.test(week) || !(custKey > 0) || !(prodKey > 0)) {
    return res.status(400).json({ success: false, error: '연도·검증된 02차·거래처·품목이 필요합니다.' });
  }
  try {
    const scope = await query(
      `SELECT TOP 1 sm.ShipmentKey, CONVERT(varchar(10), sd.ShipmentDtm, 23) AS ShipmentDate,
              ISNULL(sm.isFix,0) AS MasterFix, ISNULL(sd.isFix,0) AS DetailFix, sd.SdetailKey
         FROM ShipmentMaster sm
         LEFT JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=@pk
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND ISNULL(sm.isDeleted,0)=0
        ORDER BY ISNULL(sd.isFix,0) DESC, sm.ShipmentKey`,
      { yr:{type:sql.NVarChar,value:year}, wk:{type:sql.NVarChar,value:week}, ck:{type:sql.Int,value:custKey}, pk:{type:sql.Int,value:prodKey} },
    );
    if (!scope.recordset[0]) return res.status(409).json({ success:false, code:'SUBWEEK_02_MISSING', error:`${year}년 ${week}차 거래처 출고 마스터가 없습니다. 02차를 추정 생성하지 않습니다.` });

    const dates = await query(
      `SELECT DISTINCT CONVERT(varchar(10), ShipmentDtm,23) AS ShipmentDate
         FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck AND ISNULL(sm.isDeleted,0)=0 AND sd.ShipmentDtm IS NOT NULL`,
      { yr:{type:sql.NVarChar,value:year}, wk:{type:sql.NVarChar,value:week}, ck:{type:sql.Int,value:custKey} },
    );
    if (dates.recordset.length !== 1) return res.status(409).json({ success:false, code:'SHIPMENT_DATE_AMBIGUOUS', error:`${year}년 ${week}차 출고일이 ${dates.recordset.length ? '여러 개라' : '없어'} 자동 저장할 수 없습니다.` });

    const prices = await query(
      `SELECT TOP 20 sd.SdetailKey, sm.CustKey, c.CustName, sm.OrderYear, sm.OrderWeek,
              CONVERT(varchar(10),sd.ShipmentDtm,23) AS ShipmentDate, sd.Cost,
              CAST(1 AS bit) AS VatIncluded,
              CASE WHEN sm.CustKey=@ck THEN 1 ELSE 0 END AS CustomerPriority,
              ISNULL((SELECT COUNT(*) FROM ShipmentAdjustment sa WHERE sa.ProdKey=sd.ProdKey AND sa.CustKey=sm.CustKey AND sa.Memo LIKE N'%단가출처=SDETAIL:' + CONVERT(nvarchar(20),sd.SdetailKey) + N'%'),0) AS SelectedCount
         FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
         JOIN Customer c ON c.CustKey=sm.CustKey
        WHERE sd.ProdKey=@pk AND ISNULL(sd.Cost,0)>0 AND ISNULL(sm.isDeleted,0)=0
        ORDER BY CASE WHEN sm.CustKey=@ck THEN 0 ELSE 1 END, sm.OrderYear DESC, sm.OrderWeek DESC, sd.ShipmentDtm DESC`,
      { ck:{type:sql.Int,value:custKey}, pk:{type:sql.Int,value:prodKey} },
    );
    const farms = await query(
      `SELECT f.FarmKey, f.FarmName, ISNULL(f.FarmCode,'') AS FarmCode, SUM(ISNULL(vw.OutQuantity,0)) AS UsageQuantity
         FROM ViewWarehouse vw JOIN Farm f ON f.FarmName=vw.FarmName AND ISNULL(f.isDeleted,0)=0
        WHERE ${FARM_CANDIDATE_SCOPE_SQL}
        GROUP BY f.FarmKey,f.FarmName,f.FarmCode ORDER BY SUM(ISNULL(vw.OutQuantity,0)) DESC,f.FarmName`,
      { pk:{type:sql.Int,value:prodKey} },
    );
    return res.json({ success:true, year, week, shipmentDate:dates.recordset[0].ShipmentDate,
      fixed:Boolean(scope.recordset[0].DetailFix || scope.recordset[0].MasterFix),
      existingSdetailKey:scope.recordset[0].SdetailKey || null,
      priceSources:rankReferenceCosts(prices.recordset).map(r => ({ id:`SDETAIL:${r.SdetailKey}`, custKey:r.CustKey, customerName:r.CustName, year:r.OrderYear, week:r.OrderWeek, shipmentDate:r.ShipmentDate, cost:Number(r.Cost), vatIncluded:true, customerPriority:Number(r.CustomerPriority), selectedCount:Number(r.SelectedCount) })),
      farms:farms.recordset.map(r => ({ farmKey:Number(r.FarmKey), farmName:r.FarmName, farmCode:r.FarmCode, usageQuantity:Number(r.UsageQuantity||0) })) });
  } catch (e) { return res.status(500).json({ success:false, error:e.message }); }
}
export default withAuth(handler);
