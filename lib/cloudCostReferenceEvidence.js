import catalog from '../data/cloud-cost-reference-evidence.json' with {type:'json'};
import {nativeCostSourceFingerprint} from './nativeReceiptCostEvidence.js';
import {isSpecialWarehouseDetailRow} from './warehouseWeightRows.js';

// Reviewed workbook header evidence only. Request data can never manufacture a
// source association, a weight, or a source-only unit equivalence.
export function resolveCloudCostReference(rows,records=catalog.records){
 if(!Array.isArray(rows)||!rows.length)return null;
 const goodsRows=rows.filter(r=>!isSpecialWarehouseDetailRow(r));
 if(!goodsRows.length)return null;
 const h=goodsRows[0],digest=nativeCostSourceFingerprint(goodsRows),base=v=>String(v??'').split(/[\\/]/).pop();
 const matches=records.filter(e=>e.scope.warehouseKey===h.WarehouseKey&&e.scope.orderYear===String(h.OrderYear)
  &&e.scope.orderWeek===h.OrderWeek&&e.scope.invoiceNo===h.InvoiceNo&&e.scope.farmName===h.FarmName
  &&e.scope.fileName===base(h.FileName)&&e.rowCount===goodsRows.length&&e.nativeDigest===digest
  &&/^[a-f0-9]{64}$/.test(e.source?.sha256??''));
 if(matches.length!==1)return null;
 const e=matches[0],gw=e.weights?.find(w=>w.kind==='GW'),cw=e.weights?.find(w=>w.kind==='CW');
 if(e.exchangeRate?.currency!=='CNY'||!(e.exchangeRate.value>0)||!Number.isFinite(e.exchangeRate.value)
  ||e.freight?.currency!=='CNY'||!(e.freight.amount>=0)||!Number.isFinite(e.freight.amount))return null;
 if(!Number.isSafeInteger(e.quarantineCount?.value)||e.quarantineCount.value<0||e.quarantineCount.value>1000)return null;
 if(!gw||!cw||e.weights.length!==2||!(gw.kg>0)||!(cw.kg>=gw.kg)
  ||h.GrossWeight!=null&&h.GrossWeight!==gw.kg||h.ChargeableWeight!=null&&h.ChargeableWeight!==cw.kg)return null;
 for(const c of e.unitConversions??[]){const r=rows.find(r=>r.WdetailKey===c.key);
  if(!r||c.from!=='송이'||c.to!=='BUNCH'||r.ProdKey!==c.prodKey||r.OutUnit!==c.from||r.BunchQuantity!==null
   ||r.SteamQuantity!==c.quantity||r.OutQuantity!==c.quantity||r.TPrice!==c.amount||Math.abs(r.UPrice*c.quantity-r.TPrice)>1e-6)return null;
 }
 return structuredClone(e);
}
