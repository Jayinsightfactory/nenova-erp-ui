import {classifyCategory,isNonStockableItem} from './profitReportClassification.js';
import {costPeriod,resolveAverageStemFactor} from './profitAverageFallback.mjs';
const n=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
export function averageProductIdentity(p){
 const category=classifyCategory(p.CounName,p.FlowerName,p.ProdName),name=String(p.ProdName||'');
 return {prodKey:Number(p.ProdKey),category,country:category?.startsWith('콜롬비아 ')?'콜롬비아':category,
  flower:category?.startsWith('콜롬비아 ')?category.slice(5):String(p.FlowerName||''),
  form:/preserved|프리저브|\bdry\b|드라이/i.test(name)?'preserved':'fresh',
  size:(name.match(/\b(?:XXL|XL|L|M|S)\b|\d+(?:-\d+)?\s*cm\b/i)||[''])[0].toUpperCase(),name};
}
export function buildAverageConversionSources(products,receipts){
 const byProduct=new Map(products.map(p=>[Number(p.ProdKey),p])),out=[];
 for(const r of receipts){const p=byProduct.get(Number(r.ProdKey)),period=costPeriod(r.OrderYear,r.OrderWeek);if(!p||!period||isNonStockableItem(p.ProdName))continue;
  const id=averageProductIdentity(p),stems=n(r.SteamQuantity);
  for(const [unit,quantity,pack]of [['단',n(r.BunchQuantity),n(p.SteamOf1Bunch)],['박스',n(r.BoxQuantity),n(p.SteamOf1Box)],['송이',stems,1]]){
   if(!(quantity>0))continue;
   let factor=stems>0?stems/quantity:null,source='receipt_ratio';
   // Explicit non-unit packaging is evidence, not an invented factor=1.
   if(unit!=='송이'&&factor===1&&pack>1){
    const approved=Number(p.ProdKey)===3477&&p.ProdName==='SPRAY ROSE CHINA / 소피아 베베 (Spray-Rose Sofia babe) 70-75cm'&&id.country==='중국'
     &&Number(p.SteamOf1Bunch)===10&&Number(p.BunchOf1Box)===10&&Number(p.SteamOf1Box)===100;
    if(!approved)continue;
    factor=pack;source='approved_product_packing';
   } // Other actual 1:1 receipts remain protected; no blanket packaging replacement.
   if(unit!=='송이'&&factor==null&&pack>0){factor=pack;source='approved_product_packing';}
   if(!(factor>0))continue;
   out.push({...id,id:`unit:${r.OrderYear}:${r.WdetailKey}:${unit}`,period,unit,factor,weight:quantity,source,
    ...(source==='approved_product_packing'?{historicalPackingVerified:false,condition:'현재 품목 포장값을 사용한 승인 환산 보완; 해당 입고 당시 실포장 인증 아님'}:{})});
  }
 }
 return Object.freeze(out.map(Object.freeze));
}
function normalizedQuantity(parts,products,conversionSources){
 let stems=0,original=0;const refs=[];
 for(const part of parts){const p=products.get(part.prodKey);if(!p)return null;original+=part.quantity;
  if(part.unit==='송이'){stems+=part.quantity;continue;}
  const f=resolveAverageStemFactor(conversionSources,{...averageProductIdentity(p),period:part.period,unit:part.unit});
  if(!f.available)return null;stems+=part.quantity*f.factor;refs.push(f);
 }
 return {stems,original,refs};
}
export function buildCategoryAverageDonors(reports,products,receipts,conversionSources){
 const index=new Map(products.map(p=>[Number(p.ProdKey),p])),donors=[],rejected=[];
 for(const report of reports)for(const row of report.rows||[]){
  const basis=row.inventoryValuation?.end,a=basis?.average,period=costPeriod(basis?.year,basis?.week);
  if(basis?.method!=='category_average'||!(n(a?.purchaseQty)>0)||!period)continue;
  const h=n(row.calc?.H),g=n(row.calc?.G);
  const completeH=['actual','manual','gw_auto','excel_historical_snapshot','approved_estimate','approved_template_duty'].includes(row.source?.H)||n(row.manual?.H)!=null;
  if(h==null||g==null||!completeH||n(a.totalCost)==null||n(a.customsCost)==null||Math.abs(a.customsCost-h)>.01
    ||Number(basis.major)!==Number(report.major)||Number(String(basis.week).split('-')[0])!==Number(report.major)
    ||Math.abs(a.totalCost-g-h)>.01||row.averageFallback){rejected.push({major:report.major,category:row.category,reason:'INCOMPLETE_OR_MISMATCHED_COST'});continue;}
  let normalized=basis.unit==='송이'?{stems:a.purchaseQty,refs:[]}:null;
  if(!normalized){
   const parts=(basis.sources||[]).flatMap(s=>{const m=/^erp-normalized:(\d{4}):(\d{2}-\d{2}):prod-(\d+):purchase:([\d.]+)(단|송이|박스):/.exec(s);return m?[{prodKey:+m[3],quantity:+m[4],unit:m[5],period:costPeriod(m[1],m[2])}]:[];});
   if(parts.length){const sum=parts.reduce((s,p)=>s+p.quantity,0);if(Math.abs(sum-a.purchaseQty)<.0001)normalized=normalizedQuantity(parts,index,conversionSources);}
  }
  if(!(normalized?.stems>0)){rejected.push({major:report.major,category:row.category,reason:'PURCHASE_STEM_DENOMINATOR_UNAVAILABLE'});continue;}
  const country=row.category.startsWith('콜롬비아 ')?'콜롬비아':row.category,flower=row.category.startsWith('콜롬비아 ')?row.category.slice(5):null;
  const duty=n(row.templateDuty?.total)??n(row.actualCostEvidence?.components?.customs)??(country==='콜롬비아'?0:null);
  donors.push({id:`category:${basis.year}:${report.major}:${row.category}`,country,flower,period,stems:normalized.stems,goodsFreight:g,goods:n(row.calc?.P),customs:h,duty,total:g+h,
   source:'approved_complete_category_formula',sourceReceiptKeys:receipts.filter(r=>String(r.OrderYear)===String(basis.year)&&Number(String(r.OrderWeek).split('-')[0])===Number(report.major)&&averageProductIdentity(index.get(Number(r.ProdKey))||{}).category===row.category).map(r=>`${r.OrderYear}:${r.WdetailKey}`),conversionEvidence:normalized.refs,actualPaymentCertified:false});
 }
 return {donors,rejected};
}
export function receiptFallbackItems(row,year,major,products,receipts){
 const index=new Map(products.map(p=>[Number(p.ProdKey),p]));
 return receipts.filter(r=>String(r.OrderYear)===String(year)&&Number(String(r.OrderWeek).split('-')[0])===Number(major)).flatMap(r=>{
  const p=index.get(Number(r.ProdKey));if(!p||isNonStockableItem(p.ProdName))return [];
  const identity=averageProductIdentity(p);if(identity.category!==row.category)return [];
  const unit=p.OutUnit==='송이'&&n(r.SteamQuantity)>0?'송이':n(r.BunchQuantity)>0?'단':n(r.BoxQuantity)>0?'박스':n(r.SteamQuantity)>0?'송이':p.OutUnit;
  const quantity=unit==='단'?n(r.BunchQuantity):unit==='박스'?n(r.BoxQuantity):unit==='송이'?n(r.SteamQuantity):n(r.OutQuantity);
  if(quantity===0&&n(r.TPrice)===0)return [];
  const rawStems=n(r.SteamQuantity),pack=unit==='단'?n(p.SteamOf1Bunch):unit==='박스'?n(p.SteamOf1Box):1;
  const conflict=unit!=='송이'&&rawStems===quantity&&pack>1;
  return [{...identity,id:`${r.OrderYear}:${r.WdetailKey}`,warehouseDetailKey:Number(r.WdetailKey),period:costPeriod(r.OrderYear,r.OrderWeek),unit,quantity,stems:rawStems>0&&!conflict?rawStems:null}];
 });
}
export function buildReceiptCostDonors(reports,products,receipts,conversionSources,year){
 const donors=[],rejected=[],index=new Map(products.map(p=>[Number(p.ProdKey),p]));
 for(const report of reports)for(const row of report.rows||[]){
  const g=n(row.calc?.G),h=n(row.calc?.H),q=n(row.calc?.Q),r=n(row.calc?.R);
  const completeH=['actual','manual','gw_auto','excel_historical_snapshot','approved_estimate','approved_template_duty'].includes(row.source?.H)||n(row.manual?.H)!=null;
  if(g==null||h==null||!completeH||!(q>0)||!(r>0)||row.source?.R==='currency_master'||row.averageFallback)continue;
  const source=receipts.filter(receipt=>String(receipt.OrderYear)===String(year)&&Number(String(receipt.OrderWeek).split('-')[0])===Number(report.major)).filter(receipt=>{
   const p=index.get(Number(receipt.ProdKey));return p&&!isNonStockableItem(p.ProdName)&&averageProductIdentity(p).category===row.category;
  });
  if(!source.length||source.some(x=>n(x.TPrice)==null)||Math.abs(source.reduce((s,x)=>s+Number(x.TPrice),0)-q)>.01){rejected.push({major:report.major,category:row.category,reason:'PURCHASE_MONEY_COVERAGE_MISMATCH'});continue;}
  const items=receiptFallbackItems(row,year,report.major,products,receipts);let stems=0,complete=true;const conversions=[];
  for(const item of items){const factor=item.stems==null?resolveAverageStemFactor(conversionSources,item):null;const quantity=item.stems??(factor?.available?item.quantity*factor.factor:null);if(!(quantity>0)){complete=false;break;}stems+=quantity;if(factor)conversions.push(factor);}
  if(!complete||!(stems>0)){rejected.push({major:report.major,category:row.category,reason:'PURCHASE_STEM_DENOMINATOR_UNAVAILABLE'});continue;}
  const country=row.category.startsWith('콜롬비아 ')?'콜롬비아':row.category,flower=row.category.startsWith('콜롬비아 ')?row.category.slice(5):null;
  const duty=n(row.templateDuty?.total)??n(row.actualCostEvidence?.components?.customs)??(country==='콜롬비아'?0:null);
  donors.push({id:`category:${year}:${report.major}:${row.category}`,country,flower,period:Math.max(...source.map(x=>costPeriod(x.OrderYear,x.OrderWeek))),stems,goodsFreight:g,goods:n(row.calc?.P),customs:h,duty,total:g+h,
   source:'approved_complete_receipt_formula',sourceReceiptKeys:source.map(x=>`${x.OrderYear}:${x.WdetailKey}`),conversionEvidence:conversions,actualPaymentCertified:false});
 }
 return {donors,rejected};
}
export function buildKnownPurchaseSources(reports,products,receipts,conversionSources){
 const rates=[];
 for(const report of reports)for(const row of report.rows||[]){const rate=n(row.calc?.R),weight=n(row.calc?.Q);if(!(rate>0)||!(weight>0)||!row.currency||row.source?.R==='currency_master')continue;
  rates.push({country:row.category.startsWith('콜롬비아 ')?'콜롬비아':row.category,category:row.category,currency:row.currency,rate,weight,period:costPeriod(row.inventoryValuation?.end?.year||'2026',`${report.major}-99`),major:Number(report.major)});}
 const result=[],index=new Map(products.map(p=>[Number(p.ProdKey),p]));
 for(const receipt of receipts){const p=index.get(Number(receipt.ProdKey));if(!p||isNonStockableItem(p.ProdName)||n(receipt.TPrice)==null||Number(receipt.TPrice)<0)continue;
  const identity=averageProductIdentity(p),period=costPeriod(receipt.OrderYear,receipt.OrderWeek);if(!period)continue;
  const rowItems=receiptFallbackItems({category:identity.category},receipt.OrderYear,String(receipt.OrderWeek).split('-')[0],[p],[receipt]);const item=rowItems[0];if(!item)continue;
  const factor=item.stems==null?resolveAverageStemFactor(conversionSources,item):null,stems=item.stems??(factor?.available&&n(item.quantity)!=null?item.quantity*factor.factor:null);if(!(stems>0))continue;
  const exact=rates.filter(r=>r.category===identity.category&&Math.floor(r.period/1000000)===Number(receipt.OrderYear)&&r.major===Number(String(receipt.OrderWeek).split('-')[0]));
  const past=rates.filter(r=>r.country===identity.country&&r.period<=period),pool=exact.length?exact:past.length?past:rates.filter(r=>r.country===identity.country);
  if(!pool.length||new Set(pool.map(r=>r.currency)).size!==1)continue;
  const rate=pool.reduce((s,r)=>s+r.rate*r.weight,0)/pool.reduce((s,r)=>s+r.weight,0);
  result.push({...identity,id:`purchase:${receipt.OrderYear}:${receipt.WdetailKey}`,period,foreign:Number(receipt.TPrice),stems,rate,rateReference:!exact.length,ratePeriods:[...new Set(pool.map(r=>r.period))],source:'actual_receipt_purchase_plus_period_rate'});
 }
 return result;
}
export function inventoryFallbackItems(row,side,products,stocks,conversionSources=[],allowReferencePeriod=false,stockKey=null,allowCurrentSnapshotBasis=false){
 const basis=row.inventoryValuation?.[side],stock=side==='begin'?row.beginStock:row.stock,week=basis?.week||stock?.week,year=basis?.year;
 const period=costPeriod(year,week),index=new Map(products.map(p=>[Number(p.ProdKey),p]));
 if(!period)return [];
 const scoped=stocks.filter(s=>String(s.OrderYear)===String(year)&&s.OrderWeek===week);
 const counts=new Map();for(const s of scoped)counts.set(Number(s.StockKey),Number(s.SnapshotRowCount)||((counts.get(Number(s.StockKey))||0)+1));
 const latest=n(stockKey)??[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)||b-a)[0];
 const rows=scoped.filter(s=>Number(s.StockKey)===latest&&n(s.Stock)!==0);
 if(rows.some(s=>!index.has(Number(s.ProdKey))))return [{quantity:null,reason:'STOCK_PRODUCT_MAPPING_INCOMPLETE'}];
 const items=rows.flatMap(s=>{
  const p=index.get(Number(s.ProdKey));if(!p||isNonStockableItem(p.ProdName))return [];
  const identity=averageProductIdentity(p);if(identity.category!==row.category)return [];
  return [{...identity,period,quantity:n(s.Stock),unit:p.OutUnit,stems:p.OutUnit==='송이'?n(s.Stock):null,allowReferencePeriod,stockKey:latest,coverage:'complete_canonical_snapshot_product_mapping'}];
 });
 if(scoped.length&&!items.length&&n(basis?.quantity)===0)return [{quantity:0,stems:0,stockKey:latest,coverage:'complete_canonical_snapshot_zero_category'}];
 // A legacy mixed-unit aggregate has no physical unit. Do not compare it to
 // stems or invent one; the complete canonical snapshot is valued per product.
 if(basis?.unit==null&&rows.length&&items.length)return items;
 const expected=n(basis?.quantity);
 if(expected==null)return [{quantity:null,reason:'STOCK_TOTAL_UNCONFIRMED'}];
 let total=0;
 for(const item of items){
  if(item.unit===basis.unit){total+=item.quantity;continue;}
  const product=index.get(item.prodKey),box=n(product?.SteamOf1Box),bunch=n(product?.SteamOf1Bunch),ratio=n(product?.BunchOf1Box);
  if(item.unit==='박스'&&basis.unit==='단'&&box>0&&bunch>0&&ratio>0&&Math.abs(box/bunch-ratio)<1e-8){total+=item.quantity*ratio;continue;}
  if(['송이','단','박스'].includes(basis.unit)){
   const f=item.unit==='송이'?{available:true,factor:1}:resolveAverageStemFactor(conversionSources,item);
   const target=basis.unit==='송이'?{available:true,factor:1}:resolveAverageStemFactor(conversionSources,{...item,unit:basis.unit});
   if(!f.available||!target.available)return [{quantity:null,reason:'STOCK_TOTAL_UNIT_UNCONFIRMED'}];
   total+=item.quantity*f.factor/target.factor;continue;
  }
  return [{quantity:null,reason:'STOCK_TOTAL_UNIT_UNCONFIRMED'}];
 }
 if(Math.abs(total-expected)>Math.max(.01,Math.abs(expected)*1e-8)){
  if(allowCurrentSnapshotBasis&&scoped.some(s=>Number(s.StockKey)===latest&&Number(s.SnapshotRowCount)>0))return items.map(item=>({...item,snapshotBasisChange:{previousQuantity:expected,currentQuantity:total,unit:basis.unit,stockKey:latest,year,week,source:'current_readonly_canonical_product_stock',originalPreserved:true}}));
  return [{quantity:null,reason:'STOCK_TOTAL_MISMATCH'}];
 }
 return items;
}
