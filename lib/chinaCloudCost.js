// User-confirmed CLOUD reference; never a HUBFRESH fallback.
export const CLOUD_COST_FORMULA = Object.freeze({
  formulaId:'CN_CLOUD_CBM_V1',formulaVersion:'2.0.0',country:'CN',transportMode:'AIR',priceBasis:'BUNCH',
  formulaSourceHash:'534642102c2b66c40d2f25c362114142b6c019430db9ebd9fb1915e623327386',
  formulaSourceSheet:'46-2 CLOUD cbm',formulaSourceCells:'K7:Q28,C7:C11,T6:V11,E33:X75',
  label:'중국 CLOUD · 품종 CBM·단수 배분',lineInputFields:['categoryCode'],
});
// Source K/L/M/Q. AE (gross-weight hints) is deliberately NOT used: detail N
// references T11, not the unused GW-based auxiliary table Y.
export const CLOUD_CATEGORIES=Object.freeze([
  ['ROSE',10,100,40,20,.214,/\brose\b|장미/i],
  ['CARNATION',15,98,38,16,.214,/carnation|카네이션/i],
  ['LISIANTHUS',10,100,30,20,.214,/lisianthus|리시안|유스토마/i],
  ['EUCALYPTUS',10,null,null,null,.032,/eucalyptus|유칼립/i],
  ['Sinensis',20,100,40,24,.214,/sinensis|시네신스|시넨시스/i],
  ['PETAL',20,100,30,20,.214,/petal|꽃잎/i],
  ['Gypsophila',10,100,40,24,.214,/gypsophila|안개/i],
  ['ORCHID',10,100,40,10,.214,/orchid|난초|호접/i],
  ['ROSE A grade',10,100,40,20,.214,/rose\s*a\s*grade|장미\s*a등급/i],
  ['ASPARAGUS',25,100,30,20,.032,/asparagus|아스파라/i],
  ['AMARANTHUS',20,100,30,20,.25,/amaranthus|아마란/i],
  ['ACASIA',10,100,30,20,.214,/aca[cs]ia|아카시아/i],
  ['WAX',10,100,30,20,.214,/\bwax\b|왁스/i],
  ['ORNITHOGALUM',10,100,30,20,.214,/ornithogalum|ornithogallum|오니소|오니토/i],
  ['RANUNCULUS',10,95,25,12,.214,/ranunculus|라넌|라난/i],
  ['DIDISCUS',10,98,30,16,.214,/didiscus|디디스/i],
  ['SCABIOSA',10,100,40,20,.214,/scabiosa|스카비/i],
  ['DELPHINIUM',10,119,39,20,.214,/delphinium|델피/i],
  ['DAHLIA',10,100,30,20,.214,/dahlia|다알리아|달리아/i],
  ['GREENS',10,100,30,20,.032,/\bgreens\b|그린소재/i],
  ['POPULUS GRAIN',15,null,null,null,.032,/populus\s*grain|포플러스|포플러/i],
].map(([label,bunchesPerBox,length,width,height,tariffRate,pattern],index)=>Object.freeze({
  code:index+1,label,bunchesPerBox,length,width,height,tariffRate,pattern,
  // M10/M27 are literal 15 kg/box; never invent missing box dimensions.
  volumeKgPerBox:[4,21].includes(index+1)?15:length*width*height/6000,
  volumeKgPerBunch:([4,21].includes(index+1)?15:length*width*height/6000)/bunchesPerBox,
})));

export function isCloudInvoice(document){
  const m=document?.reviewedMetadata||{};
  const values=[m.farmName,document?.rawMetadata?.supplier].filter(Boolean).map(String);
  return values.some(s=>/\bCLOUD(?:\s*LAND)?\b/i.test(s))&&!values.some(s=>/HUB\s*FRESH/i.test(s));
}
export function cloudCategory(value){return typeof value==='boolean'||value==null||value===''?null:CLOUD_CATEGORIES.find(c=>c.code===Number(value))||null;}
// A manual category is an explicit, complete specification, never a loose name
// match. Incomplete UI drafts remain editable but cannot be saved/calculated.
export function cloudLineCategory(input={}){
  const base=cloudCategory(input.categoryCode), raw=input.categoryOverride;
  if(raw==null)return base;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['label','bunchesPerBox','length','width','height','tariffRate','weightMode'].includes(k)))return null;
  const label=typeof raw.label==='string'?raw.label.trim():'';
  if(!label||label.length>120||/[\u0000-\u001f<>]/.test(label))return null;
  const number=(value,min,max)=>typeof value==='boolean'||value==null||typeof value==='string'&&!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>max?null:Number(value);
  const bunchesPerBox=number(raw.bunchesPerBox,.001,10000),tariffRate=number(raw.tariffRate,0,1);
  if(bunchesPerBox===null||tariffRate===null||!['VOLUME','FIXED_15KG'].includes(raw.weightMode))return null;
  const length=number(raw.length,.001,400),width=number(raw.width,.001,400),height=number(raw.height,.001,400);
  if(raw.weightMode==='VOLUME'&&[length,width,height].some(v=>v===null))return null;
  const volumeKgPerBox=raw.weightMode==='FIXED_15KG'?15:length*width*height/6000;
  return {code:base?.code??0,label,bunchesPerBox,length,width,height,tariffRate,volumeKgPerBox,volumeKgPerBunch:volumeKgPerBox/bunchesPerBox,
    categoryIdentity:JSON.stringify([base?.code??0,label.normalize('NFKC').toUpperCase(),bunchesPerBox,length,width,height,tariffRate,raw.weightMode])};
}
export const CLOUD_CUSTOMS_DEFAULTS=Object.freeze({cloudWarehousePerKg:460,cloudBrokerage:33000,cloudQuarantinePerCategory:10000,cloudDomesticTransport:195000,cloudMiscellaneous:40000,cloudDisinfection:200000,cloudOrchidPermitNative:300});
export function cloudCustomsTotal(document,lines,input){
  if(typeof document?.reviewedMetadata?.gw==='boolean')return null;
  const gw=Number(document?.reviewedMetadata?.gw);
  if(!(gw>0)||!Number.isFinite(gw))return null;
  const activeIds=new Set(lines.filter(l=>Number(l.outQuantity??l.actualQuantity)>0).map(l=>String(l.lineId).toLowerCase()));
  const codes=new Set((input.lineInputs||[]).filter(l=>activeIds.has(String(l.lineId).toLowerCase())&&cloudLineCategory(l)).map(l=>cloudLineCategory(l).categoryIdentity??cloudLineCategory(l).code));
  const values={};for(const [k,v] of Object.entries(CLOUD_CUSTOMS_DEFAULTS)){
    const raw=input[k]??v;if(raw===''||typeof raw==='boolean'||!Number.isFinite(Number(raw))||Number(raw)<0)return null;
    values[k]=Number(raw);
  }
  const count=input.cloudQuarantineCategoryCount===undefined?codes.size:Number(input.cloudQuarantineCategoryCount);
  if(input.cloudQuarantineCategoryCount===''||input.cloudQuarantineCategoryCount===null||typeof input.cloudQuarantineCategoryCount==='boolean'||!Number.isSafeInteger(count)||count<0||count>1000)return null;
  return gw*values.cloudWarehousePerKg+values.cloudBrokerage+count*values.cloudQuarantinePerCategory+values.cloudDomesticTransport+values.cloudMiscellaneous+values.cloudDisinfection;
}
export function matchCloudCategory(name){
  const text=String(name||'').normalize('NFKC');
  const hits=CLOUD_CATEGORIES.filter(c=>c.pattern.test(text));
  // A-grade is a specific rose subtype; every other ambiguity needs a choice.
  if(hits.some(c=>c.code===9)&&hits.every(c=>[1,9].includes(c.code)))return 9;
  return hits.length===1?hits[0].code:null;
}

export function cloudCostPreview(document,rows,input,common,issues){
  const problem=(code,message,lineId)=>issues.push({code,message,severity:'error',...(lineId?{lineId}:{})});
  if(!isCloudInvoice(document))problem('CLOUD_FARM_REQUIRED','CLOUD 전용 공식입니다. HUBFRESH 또는 확인되지 않은 농장에는 적용할 수 없습니다.');
  if(document.reviewedMetadata?.country!=='CN'||document.reviewedMetadata?.transportMode!=='AIR')problem('CLOUD_SCOPE_INVALID','중국 CLOUD 항공 인보이스만 계산할 수 있습니다.');
  if(common.nativeCurrency!=='CNY'||common.freightCurrency!=='CNY')problem('CLOUD_CURRENCY_INVALID','CLOUD 매입·운임 통화는 CNY여야 합니다.');
  if(document.reviewedMetadata?.cloudReference?.financialReviewRequired&&input.cloudFinancialReviewConfirmed!==true)
    problem('CLOUD_FINANCIAL_REVIEW_REQUIRED','운영 단가 유지·원문 통화·호접 허가증 비용·검역 분류수를 확인하세요. 원가표 예외는 자동 확정하지 않습니다.');
  if(document.reviewedMetadata?.cloudReference?.financialReviewRequired&&(input.cloudOrchidPermitNative==null||input.cloudOrchidPermitNative===''))
    problem('CLOUD_PERMIT_REQUIRED','원문 미반영 허가증은 직접 확인해 입력하세요. 확인한 미반영은0CNY이며 빈값을0·300으로 대신하지 않습니다.');
  const customs=input.cloudCustomsMode==='FORMULA'?cloudCustomsTotal(document,rows,input):input.customsTotalKRW;
  if(customs==null||customs===''||typeof customs==='boolean'||!Number.isFinite(Number(customs))||Number(customs)<0)problem('CUSTOMS_TOTAL_REQUIRED','통관비 합계를 확인하세요. 빈 값은 0으로 처리하지 않습니다.');
  const byId=new Map((input.lineInputs||[]).map(l=>[String(l.lineId).toLowerCase(),l]));
  const active=rows.filter(r=>r.actualQuantity>0);
  const prepared=active.map(r=>{
    const category=cloudLineCategory(byId.get(r.lineId));
    if(!category)problem('CLOUD_CATEGORY_REQUIRED',`${r.originalName||'품목'}: 원가 카테고리를 선택하세요.`,r.lineId);
    if(r.unit!=='BUNCH'||!(r.bunchQuantity>0)||Math.abs(r.actualQuantity-r.bunchQuantity)>1e-6)problem('CLOUD_BUNCH_REQUIRED','CLOUD 원본은 실제 단수 기준입니다. 송이·박스 수량을 단수로 임의 대입하지 않습니다.',r.lineId);
    return {row:r,category,weight:category?r.actualQuantity*category.volumeKgPerBunch:0};
  });
  const totalVolume=prepared.reduce((s,r)=>s+r.weight,0),totalBunches=active.reduce((s,r)=>s+r.actualQuantity,0);
  const orchidBunches=prepared.filter(p=>p.category?.code===8).reduce((s,p)=>s+p.row.actualQuantity,0);
  const rawPermit=input.cloudOrchidPermitNative??300,permit=Number(rawPermit);
  if(rawPermit===''||typeof rawPermit==='boolean'||!Number.isFinite(permit)||permit<0)problem('CLOUD_PERMIT_INVALID','호접 허가증 비용을 0 이상의 CNY 금액으로 확인하세요.');
  if(!(totalVolume>0&&totalBunches>0))problem('CLOUD_QUANTITY_REQUIRED','품종별 CBM과 실제 단수 합계가 0보다 커야 합니다.');
  if(issues.some(i=>i.severity==='error'))return {lines:[],expected95:null};
  const preparedById=new Map(prepared.map(r=>[r.row.lineId,r]));
  return {expected95:null,lines:rows.map(row=>{
    const p=preparedById.get(row.lineId),q=row.actualQuantity;
    if(!p)return {lineId:row.lineId,prodKey:row.prodKey,unit:row.unit,quantity:0,currency:'KRW',costPerUnitKRW:null,totalCostKRW:0,componentAmounts:{cancellation:true}};
    const goodsNative=row.lineAmount,freightNative=common.effectiveFreightAmount*p.weight/totalVolume;
    const permitNative=p.category.code===8?permit*q/orchidBunches:0;
    const goodsKRW=goodsNative*common.exchangeRate,freightKRW=freightNative*common.exchangeRate,permitKRW=permitNative*common.exchangeRate;
    const surchargeKRW=(goodsKRW+freightKRW+permitKRW)*.03;
    // Source J adds 3% separately; M taxes L (CNF KRW) before that surcharge.
    const tariffKRW=(goodsKRW+freightKRW+permitKRW)*p.category.tariffRate;
    const customsKRW=Number(customs)*q/totalBunches,total=goodsKRW+freightKRW+permitKRW+surchargeKRW+tariffKRW+customsKRW;
    return {lineId:row.lineId,prodKey:row.prodKey,unit:row.unit,quantity:q,currency:'KRW',costPerUnitKRW:total/q,totalCostKRW:total,
      categoryCode:p.category.code,componentAmounts:{goodsNative,freightNative,permitNative,goodsKRW,freightKRW,permitKRW,surchargeKRW,tariffKRW,customsKRW,volumeWeightKg:p.weight},
      freightAllocationBasis:'CATEGORY_VOLUME_KG'};
  })};
}
