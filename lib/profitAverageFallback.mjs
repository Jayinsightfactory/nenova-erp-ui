// Read-only cost policy. Every amount is acquisition/arrival cost, never sale price.
export const AVERAGE_FALLBACK_VERSION='arrival-weighted-country-v1';
const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
export function costPeriod(year,week){
 const m=/^(\d{1,2})-(\d{1,2})([A-Z]?)$/i.exec(String(week||''));
 if(!/^\d{4}$/.test(String(year))||!m||+m[1]<1||+m[1]>53||+m[2]<1||+m[2]>99)return null;
 return +year*1000000+(+m[1])*10000+(+m[2])*100+(m[3]?m[3].toUpperCase().charCodeAt(0)-64:0);
}
const scope=(r,t)=>r.country===t.country&&Number.isFinite(r.period)&&Number.isFinite(t.period)&&r.period<=t.period;
const unitIndexes=new WeakMap();
function unitCandidates(rows,target){
 if(!Object.isFrozen(rows))return rows;
 let index=unitIndexes.get(rows);
 if(!index){index=new Map();for(const r of rows){for(const key of [`${r.country}|${r.unit}|p:${Number(r.prodKey)}`,`${r.country}|${r.unit}|f:${r.flower}|${r.form}|${r.size}`]){if(!index.has(key))index.set(key,[]);index.get(key).push(r);}}unitIndexes.set(rows,index);}
 return [...new Set([...(index.get(`${target.country}|${target.unit}|p:${Number(target.prodKey)}`)||[]),...(index.get(`${target.country}|${target.unit}|f:${target.flower}|${target.form}|${target.size}`)||[])])];
}
function choose(rows,target){
 const exact=rows.filter(r=>r.prodKey!=null&&Number(r.prodKey)===Number(target.prodKey));
 if(exact.length)return {rows:exact,level:'same_product'};
 const variety=rows.filter(r=>r.flower&&target.flower&&r.flower===target.flower&&(!r.form||!target.form||r.form===target.form));
 if(variety.length)return {rows:variety,level:'same_country_variety'};
 return {rows,level:'same_country'};
}
export function weightedArrivalCost(donors,target){
 if(target.allowReferencePeriod===true){
  const groups=[
   ['product_reference_period',(donors||[]).filter(d=>target.prodKey!=null&&d.prodKey!=null&&Number(d.prodKey)===Number(target.prodKey))],
   ['variety_reference_period',(donors||[]).filter(d=>target.flower&&d.flower===target.flower&&(!target.form||!d.form||d.form===target.form))],
   ['country_reference_period',donors||[]],
  ];
  for(const [level,pool]of groups){
   const historical=weightedArrivalCost(pool,{...target,allowReferencePeriod:false});
   if(historical.available)return historical;
   const reference=weightedArrivalCost(pool,{...target,period:Number.MAX_SAFE_INTEGER,allowReferencePeriod:false});
   if(reference.available)return {...reference,level,valuationPeriod:target.period,historicalCostCertified:false};
  }
  return {available:false,reason:'NO_COMPLETE_ARRIVAL_COST',target};
 }
 const seen=new Set(),eligible=[];
 for(const d of donors||[]){
  if(!d.id||seen.has(d.id)||d.fallback===true||d.salePriceBased===true||!scope(d,target))continue;
  const stems=num(d.stems),goodsFreight=num(d.goodsFreight),customs=num(d.customs);
  if(!(stems>0)||goodsFreight==null||customs==null||goodsFreight<0||customs<0)continue;
  if(num(d.total)!=null&&Math.abs(num(d.total)-goodsFreight-customs)>.01)continue;
  seen.add(d.id);eligible.push({...d,stems,goodsFreight,customs});
 }
 const selected=choose(eligible,target);
 const receiptKeys=new Set();
 selected.rows=selected.rows.sort((a,b)=>(a.source==='approved_complete_category_formula'?0:1)-(b.source==='approved_complete_category_formula'?0:1)).filter(d=>{
  const keys=d.sourceReceiptKeys?.length?d.sourceReceiptKeys.map(String):[`donor:${d.id}`];
  if(keys.some(k=>receiptKeys.has(k)))return false;
  keys.forEach(k=>receiptKeys.add(k));return true;
 });
 if(!selected.rows.length)return {available:false,reason:'NO_PAST_COMPLETE_ARRIVAL_COST',target};
 const stems=selected.rows.reduce((s,d)=>s+d.stems,0),goodsFreight=selected.rows.reduce((s,d)=>s+d.goodsFreight,0),customs=selected.rows.reduce((s,d)=>s+d.customs,0);
 const duty=selected.rows.every(d=>num(d.duty)!=null)?selected.rows.reduce((s,d)=>s+Number(d.duty),0):null;
 const goods=selected.rows.every(d=>num(d.goods)!=null)?selected.rows.reduce((s,d)=>s+Number(d.goods),0):null;
 return {available:true,level:selected.level,stems,goodsFreight,customs,total:goodsFreight+customs,
  goodsFreightPerStem:goodsFreight/stems,customsPerStem:customs/stems,landedPerStem:(goodsFreight+customs)/stems,
  dutyPerStem:duty==null?null:duty/stems,otherCustomsPerStem:duty==null?null:(customs-duty)/stems,
  goodsPerStem:goods==null?null:goods/stems,freightPerStem:goods==null?null:(goodsFreight-goods)/stems,
  sourceIds:selected.rows.map(d=>d.id).slice(0,50),sourceCount:selected.rows.length,sourcePeriods:[...new Set(selected.rows.map(d=>d.period))],fallback:true,actualPaymentCertified:false};
}
export function resolveAverageStemFactor(donors,target){
 if(target.allowReferencePeriod===true){
  const past=resolveAverageStemFactor(donors,{...target,allowReferencePeriod:false});if(past.available)return past;
  const reference=resolveAverageStemFactor(donors,{...target,period:Number.MAX_SAFE_INTEGER,allowReferencePeriod:false});
  if(reference.available)return {...reference,level:'reference_conversion',valuationPeriod:target.period,sourcePeriods:[...new Set(unitCandidates(donors||[],target).filter(d=>reference.sourceIds.includes(d.id)).map(d=>d.period))],historicalPackingVerified:false};
  return past;
 }
 if(!['단','송이','박스'].includes(target.unit))return {available:false,reason:'UNIT_NOT_SPECIFIED'};
 const normalized=unitCandidates(donors||[],target).filter(d=>scope(d,target)&&d.unit===target.unit&&(!d.fallback)
  &&(Number(d.prodKey)===Number(target.prodKey)||(d.flower&&d.flower===target.flower&&d.form===target.form&&d.size===target.size)))
  .map(d=>({...d,prodKey:Number(d.prodKey),factor:num(d.factor),weight:num(d.weight)}));
 const exact=normalized.filter(d=>d.prodKey===Number(target.prodKey)&&d.factor>0&&d.weight>0);
 // A conflict is resolved using an explicitly supported peer, not a hard-coded 1.
 const exactFactors=new Set(exact.map(d=>d.factor));
 if(exactFactors.size===1)return {available:true,factor:exact[0].factor,sourceIds:exact.slice(0,20).map(d=>d.id),sourceCount:exact.length,level:'same_product',historicalPackingVerified:exact.some(d=>d.historicalPackingVerified===false)?false:undefined};
 if(exact.length){const latest=Math.max(...exact.map(d=>d.period)),recent=exact.filter(d=>d.period===latest),factors=new Set(recent.map(d=>d.factor));
  if(factors.size===1)return {available:true,factor:recent[0].factor,sourceIds:recent.slice(0,20).map(d=>d.id),sourceCount:recent.length,level:'same_product_latest_period',period:latest,historicalPackingVerified:recent.some(d=>d.historicalPackingVerified===false)?false:undefined};}
 const peers=normalized.filter(d=>scope(d,target)&&d.prodKey!==Number(target.prodKey)&&d.flower&&d.flower===target.flower
  &&d.form===target.form&&d.size===target.size&&d.unit===target.unit&&num(d.factor)>0&&num(d.weight)>0&&!d.fallback);
 if(!peers.length)return {available:false,reason:exact.length?'UNIT_CONFLICT_NO_MATCHING_PEER':'NO_MATCHING_UNIT_EVIDENCE'};
 const votes=new Map();for(const p of peers)votes.set(p.factor,(votes.get(p.factor)||0)+p.weight);
 const sorted=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
 if(sorted.length>1&&sorted[0][1]===sorted[1][1])return {available:false,reason:'PEER_UNIT_TIE'};
 const matching=peers.filter(p=>p.factor===sorted[0][0]);
 return {available:true,factor:sorted[0][0],sourceIds:matching.slice(0,20).map(p=>p.id),sourceCount:matching.length,level:'similar_product',fallback:true};
}
export function weightedKnownPurchase(purchases,target){
 const eligible=(purchases||[]).filter(p=>p.country===target.country&&Number(p.prodKey)===Number(target.prodKey)&&num(p.foreign)>=0&&num(p.foreign)!=null&&num(p.stems)>0&&num(p.rate)>0&&!p.fallback);
 const past=eligible.filter(p=>p.period<=target.period),pool=past.length?past:target.allowReferencePeriod?eligible:[];
 const seen=new Set(),rows=pool.filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true;});
 if(!rows.length)return null;
 const stems=rows.reduce((s,p)=>s+Number(p.stems),0),goods=rows.reduce((s,p)=>s+Number(p.foreign)*Number(p.rate),0);
 return {goodsPerStem:goods/stems,stems,goods,sourceCount:rows.length,sourceIds:rows.slice(0,20).map(p=>p.id),sourcePeriods:[...new Set(rows.map(p=>p.period))],level:past.length?'same_product_purchase':'same_product_purchase_reference',rateReference:rows.some(p=>p.rateReference),actualLandedCostCertified:false};
}
export function averageInventoryValue(items,donors,conversionDonors,purchases=[]){
 let total=0;const details=[],missing=[];
 for(const item of items||[]){
  if(num(item.quantity)===0){details.push({prodKey:item.prodKey,value:0});continue;}
  let stems=num(item.stems),conversion=null;
  if(stems==null&&num(item.quantity)!=null){conversion=resolveAverageStemFactor(conversionDonors,item);if(conversion.available)stems=item.quantity*conversion.factor;}
  const cost=weightedArrivalCost(donors,item);
  if(stems==null||!cost.available){missing.push({prodKey:item.prodKey,reason:item.reason||(stems==null?'QUANTITY_CONVERSION_UNAVAILABLE':cost.reason),conversionReason:conversion?.reason});continue;}
  const purchase=weightedKnownPurchase(purchases,item);
  const landed=purchase&&cost.freightPerStem!=null?purchase.goodsPerStem+cost.freightPerStem+cost.customsPerStem:cost.landedPerStem;
  const value=stems*landed;total+=value;details.push({prodKey:item.prodKey,stockKey:item.stockKey,rawQuantity:item.quantity,rawUnit:item.unit,coverage:item.coverage,snapshotBasisChange:item.snapshotBasisChange,stems,value,cost,purchase,landedPerStem:landed,conversion});
 }
 return {available:missing.length===0&&Array.isArray(items)&&items.length>0,value:missing.length?null:total,details,missing,fallback:true};
}
