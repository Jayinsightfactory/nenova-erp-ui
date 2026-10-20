import { query, sql } from './db';
import { analysisPeriod } from './shillaReconciliation';
// Deliberately do not use loadRaumPnlDetail: its ensure-tables path can execute DDL.
export async function loadShillaAnalysisRows(year) {
  if (!/^20\d{2}$/.test(String(year))) throw new Error('결산 연도가 필요합니다.');
  const result = await query(`SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.QuoteDate,
    i.ItemKey, i.ItemName, i.Unit, i.Qty, i.SalePrice, i.SaleAmount, i.CostPrice, i.Remark,
    i.IsCustom, p.ProdKey, p.ProdName
    FROM WebRaumPnl m LEFT JOIN WebRaumPnlItem i ON i.PnlKey=m.PnlKey
    LEFT JOIN Product p ON p.ProdKey=i.ProdKey AND p.isDeleted=0
    WHERE m.OrderYear=@year AND m.PartnerCode=N'shilla' AND m.isDeleted=0
    ORDER BY m.MajorWeek,i.Seq,i.ItemKey`, {year:{type:sql.NVarChar,value:String(year)}});
  return (result.recordset || []).filter(r=>r.ItemKey!=null).map(r=>({
    year:String(r.OrderYear),period:analysisPeriod(String(r.MajorWeek)),
    name:r.ItemName,unit:r.Unit || '',qty:r.Qty,price:r.SalePrice,amount:r.SaleAmount,costPrice:r.CostPrice,
    source:`DB ${r.PnlKey}/${r.ItemKey}`, remark:r.Remark || '',
    prodKey:r.ProdKey,prodName:r.ProdName,isCustom:!!r.IsCustom,
  }));
}
export async function loadShillaDistributionRows(year) {
  if (!/^20\d{2}$/.test(String(year))) throw new Error('출고 연도를 확인하세요.');
  const customers=await query(`SELECT CustKey FROM Customer WHERE CustName=N'신라호텔' AND isDeleted=0`,{});
  if(customers.recordset?.length!==1) throw new Error('전산 신라호텔 거래처를 하나로 확인할 수 없습니다.');
  const params={year:{type:sql.NVarChar,value:String(year)},custKey:{type:sql.Int,value:customers.recordset[0].CustKey}};
  const result=await query(`SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,sm.isFix AS MasterFix,
    sd.SdetailKey,sd.ProdKey,sd.OutQuantity,sd.EstQuantity,sd.Amount,sd.Cost,sd.isFix AS DetailFix,
    CONVERT(varchar(10),sd.ShipmentDtm,23) AS ShipDate,p.ProdName,p.OutUnit,p.EstUnit
    FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
    JOIN Product p ON p.ProdKey=sd.ProdKey AND p.isDeleted=0
    WHERE sm.OrderYear=@year AND sm.CustKey=@custKey AND sm.isDeleted=0
    ORDER BY sm.OrderWeek,sd.SdetailKey;
    SELECT d.SdetailKey,d.SdateKey,CONVERT(varchar(10),d.ShipmentDtm,23) AS ShipDate,
      d.ShipmentQuantity,d.EstQuantity,d.Amount
    FROM ShipmentDate d JOIN ShipmentDetail sd ON sd.SdetailKey=d.SdetailKey
    JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey
    WHERE sm.OrderYear=@year AND sm.CustKey=@custKey AND sm.isDeleted=0
    ORDER BY d.SdetailKey,d.SdateKey`,params);
  const dates=new Map();
  for(const r of result.recordsets?.[1]||[]) {
    if(!dates.has(r.SdetailKey)) dates.set(r.SdetailKey,[]);
    dates.get(r.SdetailKey).push({id:r.SdateKey,date:r.ShipDate,qty:r.ShipmentQuantity,estimateQty:r.EstQuantity,amount:r.Amount});
  }
  return (result.recordsets?.[0]||[]).map(r=>({
    year:String(r.OrderYear),week:r.OrderWeek,custKey:r.CustKey,id:r.SdetailKey,prodKey:r.ProdKey,name:r.ProdName,
    date:r.ShipDate,unit:r.EstUnit||'',qty:r.EstQuantity,amount:r.Amount,
    price:r.EstQuantity>0&&r.Amount!=null?r.Amount/r.EstQuantity:null,
    outQty:r.OutQuantity,outUnit:r.OutUnit||'',masterFixed:!!r.MasterFix,detailFixed:!!r.DetailFix,
    dates:dates.get(r.SdetailKey)||[],
  }));
}
export async function loadShillaSalesRequests(year) {
  if (!/^20\d{2}$/.test(String(year))) throw new Error('판매요청 연도를 확인하세요.');
  const customers=await query(`SELECT CustKey FROM Customer WHERE CustName=N'신라호텔' AND isDeleted=0`,{});
  if(customers.recordset?.length!==1) throw new Error('전산 신라호텔 거래처를 하나로 확인할 수 없습니다.');
  const result=await query(`SELECT e.EstimateKey,e.ShipmentKey,e.ProdKey,e.Unit,e.Quantity,e.Amount,
      CONVERT(varchar(10),e.EstimateDtm,23) AS RequestDate,sm.OrderYear,sm.OrderWeek,sm.CustKey,sm.isFix
    FROM Estimate e JOIN ShipmentMaster sm ON sm.ShipmentKey=e.ShipmentKey
    WHERE sm.OrderYear=@year AND sm.CustKey=@custKey AND sm.isDeleted=0
      AND EXISTS (SELECT 1 FROM CodeInfo ci WHERE ci.Category=N'EstimateType'
        AND ci.DetailCode=e.EstimateType AND ci.Descr2=N'판매요청')
    ORDER BY e.EstimateKey`,{year:{type:sql.NVarChar,value:String(year)},custKey:{type:sql.Int,value:customers.recordset[0].CustKey}});
  return (result.recordset||[]).map(r=>({
    id:r.EstimateKey,shipmentKey:r.ShipmentKey,prodKey:r.ProdKey,unit:r.Unit,
    qty:r.Quantity,amount:r.Amount,price:r.Quantity>0&&r.Amount!=null?r.Amount/r.Quantity:null,
    date:r.RequestDate,year:String(r.OrderYear),week:r.OrderWeek,custKey:r.CustKey,masterFixed:!!r.isFix,
  }));
}
