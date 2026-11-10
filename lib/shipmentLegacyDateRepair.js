// Explicitly approved legacy repair only; never resynchronizes Detail or stock.
import { distributeUnits } from './distributeUnits.js';
export function planUsLegacyDateRepair(rows, expectedCount = 29) {
  if (!Array.isArray(rows) || rows.length !== expectedCount) throw new Error('TARGET_COUNT_CHANGED');
  const seen = new Set();
  return rows.map(r => {
    if (String(r.OrderYear) !== '2025' || r.OrderWeek !== '46-01' || r.CounName !== '미국' || ![670,1718,2677].includes(Number(r.ProdKey))) throw new Error('TARGET_SCOPE_CHANGED');
    if (seen.has(Number(r.SdetailKey))) throw new Error('MULTIPLE_DATES_OR_DUPLICATE_DETAIL');
    seen.add(Number(r.SdetailKey));
    if (r.OrderYearWeek !== '202546' || Number(r.DetailFix)!==1 || Number(r.MasterFix)!==1 || !Number.isInteger(Number(r.SdateKey)) || Number(r.SdateKey)<=0) throw new Error('TARGET_NOT_CONFIRMED');
    if (['DateEst','DateCost','DateAmount','DateVat'].some(k => r[k] !== null)) throw new Error('DATE_ALREADY_PRICED');
    if (!(Number(r.ShipmentQuantity) >= 0) || Number(r.ShipmentQuantity) !== Number(r.OutQuantity) || new Date(r.ShipmentDtm).getTime() !== new Date(r.DetailDtm).getTime()) throw new Error('DATE_QUANTITY_OR_TIME_MISMATCH');
    for (const k of ['DetailCost','DetailAmount','DetailVat']) if (r[k] == null || !Number.isFinite(Number(r[k]))) throw new Error('DETAIL_MONEY_MISSING');
    if (Number(r.OutQuantity) === 0) {
      if (Number(r.DetailAmount)!==0 || Number(r.DetailVat)!==0) throw new Error('ZERO_QUANTITY_HAS_MONEY');
      return null; // Do not manufacture a positive invoice row for a zero shipment.
    }
    const est = distributeUnits(Number(r.ShipmentQuantity), r).estQty;
    if (!(est > 0) || Math.abs(est * Number(r.DetailCost) - Number(r.DetailAmount) - Number(r.DetailVat)) > 0.02) throw new Error('HISTORICAL_CONVERSION_MONEY_MISMATCH');
    return {SdateKey:Number(r.SdateKey),SdetailKey:Number(r.SdetailKey),ShipmentKey:Number(r.ShipmentKey),CustKey:Number(r.CustKey),ProdKey:Number(r.ProdKey),
      EstQuantity:est,Cost:Number(r.DetailCost),Amount:Number(r.DetailAmount),Vat:Number(r.DetailVat)};
  }).filter(Boolean);
}
export async function applyUsLegacyDateRepair(q, sql, plan) {
  for (const r of plan) {
    const params={};for(const k of ['SdateKey','SdetailKey','ShipmentKey','CustKey','ProdKey'])params[k]={type:sql.Int,value:r[k]};
    for(const k of ['EstQuantity','Cost','Amount','Vat'])params[k]={type:sql.Float,value:r[k]};
    const changed=await q(`UPDATE dt SET EstQuantity=@EstQuantity,Cost=@Cost,Amount=@Amount,Vat=@Vat
      FROM ShipmentDate dt JOIN ShipmentDetail sd ON sd.SdetailKey=dt.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey JOIN Product p ON p.ProdKey=sd.ProdKey
      WHERE dt.SdateKey=@SdateKey AND sd.SdetailKey=@SdetailKey AND sm.ShipmentKey=@ShipmentKey AND sm.CustKey=@CustKey AND sd.ProdKey=@ProdKey
        AND sm.OrderYear=N'2025' AND sm.OrderWeek=N'46-01' AND p.CounName=N'미국' AND sm.isDeleted=0 AND sd.isFix=1 AND sm.isFix=1
        AND dt.EstQuantity IS NULL AND dt.Cost IS NULL AND dt.Amount IS NULL AND dt.Vat IS NULL;
      SELECT @@ROWCOUNT AS changed`,params);
    if(Number(changed.recordset[0]?.changed)!==1)throw new Error('REPAIR_COMPARE_AND_SET_FAILED');
  }
}
