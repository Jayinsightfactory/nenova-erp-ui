// Approved acquisition-cost fallback in the declared physical unit. A bunch is
// never treated as one stem, nor is conflicting SteamQuantity overwritten.
import {averageProductIdentity} from './profitAverageSources.mjs';
import {costPeriod} from './profitAverageFallback.mjs';
import {isNonStockableItem} from './profitReportClassification.js';
const n=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const nonnegative=v=>n(v)!=null&&n(v)>=0;
const period2026=v=>Number.isFinite(v)&&v>=2026010100&&v<=2026539999;
const FX_SOURCES=new Set(['freight_cost_snapshot','saved_official_week','excel_historical_snapshot','kcs_api','manual_input','manual','approved_customs_timing_estimate']);
const deduplicate=rows=>{
 const byId=new Map();
 for(const row of rows){if(!row.id)return null;const old=byId.get(row.id);if(old&&JSON.stringify(old)!==JSON.stringify(row))return null;byId.set(row.id,row);}
 return [...byId.values()];
};
const unitQuantity=(r,unit)=>n(unit==='단'?r.BunchQuantity:unit==='송이'?r.SteamQuantity:unit==='박스'?r.BoxQuantity:null);
export function buildNativeUnitCostSources(reports,products,receipts,lines=[]){
 const index=new Map(products.map(p=>[Number(p.ProdKey),p])),donors=[],purchases=[];
 for(const report of reports)for(const row of report.rows||[]){
  if(row.category!=='중국'||row.currency!=='CNY')continue;
  const rs=receipts.filter(r=>String(r.OrderYear)==='2026'&&Number(String(r.OrderWeek).split('-')[0])===Number(report.major)).flatMap(r=>{
   const p=index.get(Number(r.ProdKey));if(!p||isNonStockableItem(p.ProdName)||averageProductIdentity(p).category!==row.category)return [];
   const quantity=unitQuantity(r,p.OutUnit);if(quantity===0&&n(r.TPrice)===0)return [];
   return [{...r,unit:p.OutUnit,quantity}];
  });
  const rate=n(row.calc?.R),period=costPeriod('2026',`${report.major}-99`);
  const supportedRate=rate>0&&FX_SOURCES.has(row.source?.R);
  for(const r of rs){if(!supportedRate||!(r.quantity>0)||n(r.TPrice)==null||r.TPrice<0||!['단','송이','박스'].includes(r.unit))continue;
   if(lines.some(l=>Number(l.warehouseDetailKey)===Number(r.WdetailKey)&&l.currency!=='CNY'))continue;
   purchases.push({id:`native-purchase:2026:${r.WdetailKey}`,prodKey:Number(r.ProdKey),country:'중국',currency:'CNY',unit:r.unit,quantity:r.quantity,goods:Number(r.TPrice)*rate,period:costPeriod('2026',r.OrderWeek),rate,rateSource:row.source?.R});
  }
  const units=new Set(rs.map(r=>r.unit));
  if(!rs.length||units.size!==1||rs.some(r=>!(r.quantity>0)||n(r.TPrice)==null)||!supportedRate||row.averageFallback)continue;
  const unit=rs[0].unit,quantity=rs.reduce((s,r)=>s+r.quantity,0),foreign=rs.reduce((s,r)=>s+Number(r.TPrice),0);
  const g=n(row.calc?.G),h=n(row.calc?.H),goods=n(row.calc?.P);
  if(!['단','송이','박스'].includes(unit)||g==null||h==null||goods==null||g<goods||h<0||Math.abs(foreign-Number(row.calc?.Q))>.01
    ||!['actual','manual','gw_auto','excel_historical_snapshot','approved_estimate','approved_template_duty'].includes(row.source?.H))continue;
  // Each complete country/receipt set enters once. Currency-inference conflicts
  // remain excluded; a majority label is not a currency conversion.
  const ids=new Set(rs.map(r=>Number(r.WdetailKey)));
  if(lines.some(l=>ids.has(Number(l.warehouseDetailKey))&&l.currency!=='CNY'))continue;
  const duty=n(row.templateDuty?.total)??n(row.actualCostEvidence?.components?.customs);
  donors.push({id:`native-cost:2026:${report.major}:중국`,country:'중국',currency:'CNY',unit,period,quantity,freight:g-goods,customs:h,duty,sourceReceiptKeys:[...ids],actualPaymentCertified:false});
 }
 return {donors,purchases};
}
export function nativeUnitReceiptCustoms(item,{donors=[]}={}){
 if(item.country!=='중국'||!['단','송이','박스'].includes(item.unit)||!(n(item.quantity)>0)||!period2026(item.period))return null;
 const ds=deduplicate(donors.filter(d=>d.country===item.country&&d.currency==='CNY'&&d.unit===item.unit&&d.quantity>0&&period2026(d.period)&&d.period<=item.period&&nonnegative(d.customs)));
 if(!ds?.length)return null;
 const quantity=ds.reduce((s,d)=>s+d.quantity,0),customs=item.quantity*ds.reduce((s,d)=>s+d.customs,0)/quantity;
 const duty=ds.every(d=>n(d.duty)!=null)?item.quantity*ds.reduce((s,d)=>s+d.duty,0)/quantity:null;
 return {method:'approved_native_unit_customs',quantity:item.quantity,unit:item.unit,customs,duty,other:duty==null?null:customs-duty,sourceIds:ds.map(d=>d.id),sourcePeriods:[...new Set(ds.map(d=>d.period))],physicalStemConversionApplied:false,actualPaymentCertified:false};
}
export function nativeUnitInventoryValue(items,{donors=[],purchases=[]}={}){
 let total=0;const details=[],missing=[];
 for(const item of items||[]){
  if(n(item.quantity)===0){details.push({prodKey:item.prodKey,value:0});continue;}
  if(item.country!=='중국'||!['단','송이','박스'].includes(item.unit)||n(item.quantity)==null||!period2026(item.period)){missing.push({prodKey:item.prodKey,reason:'NATIVE_UNIT_SCOPE_UNCONFIRMED'});continue;}
  const all=donors.filter(d=>d.country===item.country&&d.currency==='CNY'&&d.unit===item.unit&&d.quantity>0&&period2026(d.period)&&d.period<=item.period&&nonnegative(d.customs)&&nonnegative(d.freight));
  const goods=purchases.filter(p=>p.prodKey===item.prodKey&&p.country===item.country&&p.currency==='CNY'&&p.unit===item.unit&&p.quantity>0&&period2026(p.period)&&p.period<=item.period&&nonnegative(p.goods));
  if(!all.length||!goods.length){missing.push({prodKey:item.prodKey,reason:'NATIVE_UNIT_ACQUISITION_EVIDENCE_MISSING'});continue;}
  const ds=deduplicate(all),ps=deduplicate(goods);
  if(!ds||!ps){missing.push({prodKey:item.prodKey,reason:'NATIVE_UNIT_DUPLICATE_SOURCE_CONFLICT'});continue;}
  const den=ds.reduce((s,d)=>s+d.quantity,0),pq=ps.reduce((s,p)=>s+p.quantity,0);
  const goodsPerUnit=ps.reduce((s,p)=>s+p.goods,0)/pq,freightPerUnit=ds.reduce((s,d)=>s+d.freight,0)/den,customsPerUnit=ds.reduce((s,d)=>s+d.customs,0)/den;
  const landedPerUnit=goodsPerUnit+freightPerUnit+customsPerUnit,value=item.quantity*landedPerUnit;
  total+=value;details.push({prodKey:item.prodKey,stockKey:item.stockKey,rawQuantity:item.quantity,rawUnit:item.unit,coverage:item.coverage,snapshotBasisChange:item.snapshotBasisChange,value,goodsPerUnit,freightPerUnit,customsPerUnit,landedPerUnit,
   sourceIds:ds.map(d=>d.id),purchaseSourceIds:ps.map(p=>p.id),sourcePeriods:[...new Set(ds.map(d=>d.period))],level:'same_country_declared_unit',physicalStemConversionApplied:false,actualPaymentCertified:false});
 }
 const units=new Set(details.map(d=>d.rawUnit).filter(Boolean));
 return {available:Array.isArray(items)&&items.length>0&&!missing.length,value:missing.length?null:total,details,missing,quantity:units.size===1?details.reduce((s,d)=>s+(d.rawQuantity??0),0):null,unit:units.size===1?[...units][0]:null,method:'approved_native_unit_acquisition',fallback:true,actualPaymentCertified:false};
}
