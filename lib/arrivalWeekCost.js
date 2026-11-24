import {createHash} from 'node:crypto';
import {normalizeWarehouseBrowse} from './invoiceWarehouseBrowse.js';
import {baseCountry} from './countryClassification.js';
import {readNativeCostSource,nativeCostDocument,calculateNativeCost} from './nativeReceiptCost.js';
import {COLOMBIA_WEEK_SOURCE_SQL,prepareColombiaWeekCost} from './colombiaWeekCostSource.js';
import {calculateColombiaWeekCost,normalizeColombiaCostAwb} from './colombiaWeekCost.js';
import {CLOUD_COST_FORMULA,CLOUD_CUSTOMS_DEFAULTS,matchCloudCategory,cloudCustomsTotal,cloudLineCategory} from './chinaCloudCost.js';
import {isFreightItem} from './freightCalc.js';

const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode});};
const num=v=>typeof v==='boolean'||v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const round=n=>Math.round(n*1e6)/1e6;
export const weekCostDigest=digest;
export function normalizeArrivalCostScopeKey(value){
 const text=String(value??'');
 return /^RECEIPT:\d{4}:\d{2}-\d{2}:[1-9]\d*$/.test(text)?text:normalizeColombiaCostAwb(value);
}
const receiptScopeKey=(scope,key)=>`RECEIPT:${scope.orderYear}:${scope.orderWeek}:${key}`;
export async function prepareArrivalWeekCost({queryFn,types,request}){
 const scope={...normalizeWarehouseBrowse(request),country:request.country};
 if(!['CN','CO'].includes(scope.country))fail('중국 또는 콜롬비아를 선택하세요.',400);
 const response=await queryFn(COLOMBIA_WEEK_SOURCE_SQL,{orderYear:{type:types.NVarChar(4),value:scope.orderYear},orderWeek:{type:types.NVarChar(5),value:scope.orderWeek}});
 const raw=Array.isArray(response.recordset)?[...response.recordset].sort((a,b)=>a.WarehouseKey-b.WarehouseKey||a.WdetailKey-b.WdetailKey):response.recordset;
 if(!Array.isArray(raw)||raw.length>10000)fail('차수 전체 입고를 읽지 못했습니다.');
 if(raw.some(r=>String(r.OrderYear)!==scope.orderYear||r.OrderWeek!==scope.orderWeek))fail('조회된 입고 연도·차수가 다릅니다.',409);
 const detailKeys=new Set();for(const row of raw){if(!Number.isSafeInteger(row.WdetailKey)||detailKeys.has(row.WdetailKey))fail('입고 상세 식별값이 중복되거나 없습니다.');detailKeys.add(row.WdetailKey);}
 const countryName=scope.country==='CN'?'중국':'콜롬비아';
 const keys=[...new Set(raw.filter(r=>baseCountry(r.CounName)===countryName).map(r=>r.WarehouseKey))].sort((a,b)=>a-b);
 const candidates=keys.map(key=>{const rows=raw.filter(r=>r.WarehouseKey===key),h=rows[0];return {warehouseKey:key,farmName:h.FarmName,invoiceNo:h.InvoiceNo,awb:/^\d{11}$/.test(normalizeColombiaCostAwb(h.OrderNo))?normalizeColombiaCostAwb(h.OrderNo):scope.country==='CN'?receiptScopeKey(scope,key):normalizeColombiaCostAwb(h.OrderNo),fileName:String(h.FileName??'').split(/[\\/]/).pop(),rawRows:rows.length};});
 const selected=request.selectedKeys??[];
 if(!Array.isArray(selected)||selected.length>100||new Set(selected).size!==selected.length||selected.some(k=>!Number.isSafeInteger(k)||!keys.includes(k)))fail('현재 국가·연도·차수의 입고를 중복 없이 선택하세요.');
 const chosen=[...selected].sort((a,b)=>a-b);
 const normalizeIdentity=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
 const ids=new Set(),files=new Set();for(const k of chosen){const h=candidates.find(c=>c.warehouseKey===k),id=`${normalizeIdentity(h.farmName)}\0${normalizeIdentity(h.invoiceNo)}`,fileId=`${normalizeIdentity(h.fileName)}\0${normalizeIdentity(h.invoiceNo)}`;if(ids.has(id)||h.fileName&&files.has(fileId))fail(`같은 농장·송장 ${h.invoiceNo}가 중복 입고되었습니다. 사용할 입고 한 건만 선택하세요.`);ids.add(id);if(h.fileName)files.add(fileId);}
 const baselineDigest=digest({scope,raw});
 if(!chosen.length)return {scope,candidates,baselineDigest,awbs:[],members:[],documents:[],issues:[],excluded:[]};
 const chosenAwbs=new Set(candidates.filter(c=>chosen.includes(c.warehouseKey)).map(c=>c.awb).filter(a=>/^\d{11}$/.test(a)));
 if(raw.some(r=>chosenAwbs.has(normalizeColombiaCostAwb(r.OrderNo))&&r.ProdKey>0&&!isFreightItem(r.ProdName)&&baseCountry(r.CounName)!==countryName))fail('같은 AWB에 다른 국가 또는 원산지 미확인 상품이 있습니다. 해당 국가의 운임 적용 범위를 먼저 확인하세요.');
 // This proxy reuses the established source parser without a second, inconsistent
 // warehouse read. Expense tables are still read through their original helper.
 const sourceQuery=async(sql,params)=>sql.includes('native-cost:readonly-source')?{recordset:raw.filter(r=>r.WarehouseKey===params.warehouseKey.value)}:queryFn(sql,params);
 const incomplete=candidates.filter(c=>!chosen.includes(c.warehouseKey)&&candidates.some(s=>chosen.includes(s.warehouseKey)&&s.awb===c.awb)&&!candidates.some(s=>chosen.includes(s.warehouseKey)&&normalizeIdentity(s.invoiceNo)===normalizeIdentity(c.invoiceNo)&&(normalizeIdentity(s.farmName)===normalizeIdentity(c.farmName)||normalizeIdentity(s.fileName)===normalizeIdentity(c.fileName))));
 if(incomplete.length)fail(`같은 AWB의 입고 #${incomplete.map(c=>c.warehouseKey).join(', #')}도 포함해야 전체 운임을 배분할 수 있습니다. 전체 후보에서 확인하세요.`);
 if(scope.country==='CO'){
  const co=await prepareColombiaWeekCost({types,request:{...request,...scope,selectedKeys:chosen},queryFn:async()=>({recordset:raw})});
  return {...co,scope,candidates,baselineDigest,selectedKeys:chosen};
 }
 const members=[],documents=[],issues=[],excluded=[];
 for(const warehouseKey of chosen){
  const source=await readNativeCostSource({queryFn:sourceQuery,types,input:{...scope,warehouseKey}});
  if(source.country!=='CN')fail(`입고 #${warehouseKey}: 중국 외 국가 또는 미확인 원산지가 섞였습니다.`);
  const head=raw.find(r=>r.WarehouseKey===warehouseKey),awb=candidates.find(c=>c.warehouseKey===warehouseKey).awb;
  if(!/^\d{11}$/.test(awb)&&!awb.startsWith('RECEIPT:'))issues.push({code:'AWB_REQUIRED',warehouseKey,message:'원본 AWB 귀속 확인이 필요합니다.'});
  if(!/\bCLOUD(?:\s*LAND)?\b/i.test(source.farmName??''))issues.push({code:'FORMULA_REQUIRED',warehouseKey,message:'이 통합 경로는 중국 CLOUD A/B 전용입니다. 다른 농장은 기존 개별 공식을 사용하세요.'});
  const document=nativeCostDocument(source,{currency:'CNY',transportMode:'AIR'});
  const settings=document.reviewedMetadata.invoiceCostInput.lineInputs.map(l=>({categoryCode:matchCloudCategory(source.lines.find(r=>r.lineId===l.lineId).originalName),...l,...request.lineInputs?.find(c=>c.lineId===l.lineId)}));
  for(const line of document.lines){if(!line.prodKey||!line.originalName)issues.push({code:'PRODUCT_REQUIRED',warehouseKey,lineId:line.lineId,message:'전산 품목 미연결 원문행입니다. 원가 계산에서 임의 제외하지 않습니다.'});if(!cloudLineCategory(settings.find(l=>l.lineId===line.lineId)))issues.push({code:'CATEGORY_REQUIRED',warehouseKey,lineId:line.lineId,message:`${line.originalName}: CLOUD 카테고리 확인 필요`});}
  members.push({warehouseKey,documentId:document.documentId,sourceHash:source.sourceHash,farmName:source.farmName,invoiceNo:source.invoiceNo,awb,rows:document.lines,lineInputs:settings,source,gw:source.gw,cw:source.cw});
  documents.push(document);excluded.push(...source.excluded.map(e=>({...e,wdetailKey:e.key,warehouseKey,awb})));
 }
 const availableLines=new Set(members.flatMap(m=>m.rows.map(l=>l.lineId))),inputIds=new Set();
 for(const input of request.lineInputs??[]){if(!availableLines.has(input.lineId)||inputIds.has(input.lineId)||Object.keys(input).some(k=>!['lineId','categoryCode','categoryOverride','groupId'].includes(k)))fail('품목별 입력이 중복되거나 선택 입고 범위 밖입니다.');inputIds.add(input.lineId);}
 const awbs=[...new Set(members.map(m=>m.awb))].sort().map(awb=>({awb,scopeType:awb.startsWith('RECEIPT:')?'RECEIPT':'AWB',label:awb.startsWith('RECEIPT:')?`입고별 비용 #${awb.split(':').at(-1)} · AWB 미기재`:`AWB ${awb}`,members:members.filter(m=>m.awb===awb)}));
 return {scope,candidates,selectedKeys:chosen,baselineDigest,members,documents,awbs,issues,excluded};
}

// Explicit evidence identity, not numerical equality, determines duplication.
export function allocateWeekExpenses(prepared,inputs,pools){
 if(!Array.isArray(pools)||pools.length>100)fail('비용 증빙 목록을 확인하세요.');
 const awbs=prepared.awbs.map(a=>a.awb),seen=new Map(),coverage=new Set();
 const amounts=new Map(awbs.map(a=>[a,{FREIGHT:0,CUSTOMS:0}]));
 for(const pool of pools){
  if(!['FREIGHT','CUSTOMS'].includes(pool.kind)||typeof pool.sourceId!=='string'||!pool.sourceId.trim()||pool.sourceId.length>160||pool.confirmed!==true)fail('비용 종류·증빙 식별자·대상 확인이 필요합니다.');
  if(!Array.isArray(pool.awbs))fail('비용 대상 AWB 목록을 확인하세요.');
  const targets=[...pool.awbs].map(normalizeArrivalCostScopeKey).sort();
  if(!targets.length||new Set(targets).size!==targets.length||targets.some(a=>!awbs.includes(a)))fail('비용 대상 AWB가 현재 선택 입고와 다릅니다.');
  const currency=pool.kind==='CUSTOMS'?'KRW':prepared.scope.country==='CN'?'CNY':'USD';
  if(pool.currency!==currency)fail(`비용 통화는 ${currency}여야 합니다.`);
  const basis=pool.basis;
  if(!['GW','CW'].includes(basis)||pool.kind==='CUSTOMS'&&basis!=='GW')fail('공유 운임의 GW/CW 기준 또는 통관비 GW 기준을 확인하세요.');
  const weight=targets.reduce((s,a)=>s+inputs.get(a)[basis.toLowerCase()],0);
  let amount=num(pool.amount);
  if(pool.mode==='FORMULA'&&pool.kind==='CUSTOMS'){
   if(prepared.scope.country==='CN'){
    const members=prepared.members.filter(m=>targets.includes(m.awb));
    if(members.some(m=>m.source?.cloudReference?.financialReviewRequired)&&(targets.some(a=>inputs.get(a)?.financialReviewConfirmed!==true)||pool.quarantineCategoryCount==null||pool.quarantineCategoryCount===''))fail('원가표 통화·허가증·검역 분류수의 적용 확인이 필요합니다.');
    amount=cloudCustomsTotal({reviewedMetadata:{gw:weight}},members.flatMap(m=>m.rows),{...CLOUD_CUSTOMS_DEFAULTS,
      ...(pool.quarantineCategoryCount!==undefined?{cloudQuarantineCategoryCount:pool.quarantineCategoryCount}:{}),lineInputs:members.flatMap(m=>m.lineInputs)});
   }else{
    const groups=new Set(prepared.members.filter(m=>targets.includes(m.awb)).flatMap(m=>m.lineInputs.map(l=>l.groupId)));
    amount=weight*460+33000+groups.size*10000+99000+40000;
   }
  }else if(pool.mode!=='TOTAL')fail('비용 합계 또는 통관비 추정 수식을 선택하세요.');
  if(amount===null||!(amount>=0)||!(weight>0))fail('비용·배분 중량을 확인하세요. 미확인 빈값은 0원이 아닙니다.');
  const normalizedSource=pool.sourceId.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
  const key=`${pool.kind}\0${normalizedSource}`,canonical={kind:pool.kind,sourceId:normalizedSource,awbs:targets,currency,basis,mode:pool.mode,amount:round(amount),estimated:pool.mode==='FORMULA'};
  if(seen.has(key)){if(JSON.stringify(seen.get(key))!==JSON.stringify(canonical))fail('같은 비용 증빙의 금액·통화·대상이 충돌합니다.');continue;}
  seen.set(key,canonical);let allocated=0;
  targets.forEach((a,i)=>{const value=i===targets.length-1?round(amount-allocated):round(amount*inputs.get(a)[basis.toLowerCase()]/weight);allocated+=value;amounts.get(a)[pool.kind]+=value;coverage.add(`${a}/${pool.kind}`);});
 }
 if(awbs.some(a=>['FREIGHT','CUSTOMS'].some(k=>!coverage.has(`${a}/${k}`))))fail('모든 AWB의 운임·통관비 증빙을 지정하세요. 확인된 0원도 별도 근거가 필요합니다.');
 return {amounts,sources:[...seen.values()].sort((a,b)=>(a.kind+a.sourceId).localeCompare(b.kind+b.sourceId))};
}

export function calculateArrivalWeekCost(prepared,request){
 if(!prepared.members.length||prepared.issues.length)fail('입고·품목·원본 귀속 확인을 먼저 마치세요.');
 if(request.confirmed!==true)fail('선택 입고·원가 공식·비용 귀속을 확인하세요.');
 const inputs=new Map();for(const entry of request.awbInputs??[]){const awb=normalizeArrivalCostScopeKey(entry.awb);if(inputs.has(awb)||!prepared.awbs.some(a=>a.awb===awb))fail('AWB 입력이 중복되거나 범위 밖입니다.');const i={...entry.input,gw:num(entry.input?.gw),cw:num(entry.input?.cw),exchangeRate:num(entry.input?.exchangeRate)};if(!(i.gw>0)||!(i.cw>=i.gw)||!(i.exchangeRate>0))fail('AWB 전체 GW·CW·환율을 확인하세요.');if(typeof i.exchangeRateSource!=='string'||!i.exchangeRateSource.trim()||!['SOURCE_REFERENCE','VALIDATION_ONLY'].includes(i.exchangeRateType))fail('적용 환율의 원문 근거 또는 검증용 선택을 명시하세요.');inputs.set(awb,i);}
 if(inputs.size!==prepared.awbs.length)fail('모든 AWB 입력이 필요합니다.');
 const {amounts,sources}=allocateWeekExpenses(prepared,inputs,request.expensePools);
 // Every native expense row with money needs an explicit inclusion reference.
 const invoiceFees=[],decisionKeys=new Set();
 for(const d of request.expenseDecisions??[]){if(!Number.isSafeInteger(d.wdetailKey)||decisionKeys.has(d.wdetailKey)||!prepared.excluded.some(r=>r.wdetailKey===d.wdetailKey&&num(r.amount)!==null&&Number(r.amount)!==0))fail('원장 비용행 확인이 중복되거나 범위 밖입니다.');decisionKeys.add(d.wdetailKey);}
 for(const row of prepared.excluded.filter(r=>num(r.amount)!==null&&Number(r.amount)!==0)){
  const decision=request.expenseDecisions?.find(d=>d.wdetailKey===row.wdetailKey);
  if(!decision||decision.confirmed!==true||typeof decision.evidence!=='string'||!decision.evidence.trim()||!['IN_FREIGHT_POOL','INVOICE_FEE'].includes(decision.treatment))fail(`입고 #${row.warehouseKey} 비용행 ${row.wdetailKey}의 중복·포함 근거를 확인하세요.`);
  if(decision.treatment==='INVOICE_FEE'){
   if(prepared.scope.country!=='CO'||decision.currency!=='USD'||decision.basis!=='BOX')fail('송장별 부대비는 원문 USD·박스배분 근거를 확인하세요.');
   invoiceFees.push({...row,evidence:decision.evidence});
  }
 }
 let lines,results;
 if(prepared.scope.country==='CO'){
  const co=calculateColombiaWeekCost({scope:prepared.scope,awbs:prepared.awbs.map(a=>({...a,input:{...inputs.get(a.awb),freightCurrency:'USD',freightAmount:amounts.get(a.awb).FREIGHT}})),customsPools:prepared.awbs.map(a=>({sourceId:`allocated/${a.awb}`,awbs:[a.awb],mode:'TOTAL',amountKRW:amounts.get(a.awb).CUSTOMS,confirmed:true}))});
  if(co.status!=='CALCULATED')fail(co.issues.map(i=>i.message).join(' · '));lines=co.lines;results=co.results;
 }else{
  results=prepared.awbs.map(a=>{
   const input=inputs.get(a.awb),members=a.members;
   if(members.some(m=>m.lineInputs.some(l=>Number(l.categoryCode)===8))&&num(input.permitAmount)===null)fail('이 AWB의 호접 허가증 비용을 확인하세요. 빈값은 0이나 300CNY로 대체하지 않습니다.');
   const source={...members[0].source,lines:members.flatMap(m=>m.rows),sourceHash:digest(members.map(m=>m.sourceHash)),gw:input.gw,cw:input.cw,workbookEvidence:undefined};
   const costInput={cloudFinancialReviewConfirmed:input.financialReviewConfirmed===true,...CLOUD_COST_FORMULA,...CLOUD_CUSTOMS_DEFAULTS,formulaApplicabilityConfirmed:true,formulaEffectiveDate:source.inputDate,nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRateKRW:input.exchangeRate,exchangeRateType:'USER_INPUT',exchangeRateDate:source.inputDate,costSourceId:'차수 통합 비용증빙',expenseBasis:sources.some(s=>s.estimated)?'ESTIMATED':'CONFIRMED',estimateSource:sources.filter(s=>s.estimated).map(s=>s.sourceId).join(', '),allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,cloudCustomsMode:'TOTAL',customsTotalKRW:amounts.get(a.awb).CUSTOMS,freightAmount:amounts.get(a.awb).FREIGHT,cloudOrchidPermitNative:num(input.permitAmount)??0,lineInputs:members.flatMap(m=>m.lineInputs)};
   const result=calculateNativeCost(source,{sourceHash:source.sourceHash,metadata:{currency:'CNY',transportMode:'AIR',gw:input.gw,cw:input.cw},input:costInput});
   if(result.preview.status!=='APPROVED')fail(result.preview.issues.map(i=>i.message).join(' · '));
   return {awb:a.awb,input,result:result.preview};
  });
  lines=results.flatMap(r=>r.result.lines.map(line=>({...line,awb:r.awb})));
 }
 const origins=new Map(prepared.members.flatMap(m=>m.rows.map(l=>[l.lineId,{warehouseKey:m.warehouseKey,farmName:m.farmName,invoiceNo:m.invoiceNo,awb:m.awb,originalName:l.originalName,unitPrice:l.receiptUnitPrice??l.unitPrice,sourceLine:l}])));
 lines=lines.map(l=>({...l,...origins.get(l.lineId)})).sort((a,b)=>a.warehouseKey-b.warehouseKey||a.sourceLine.wdetailKey-b.sourceLine.wdetailKey||a.lineId.localeCompare(b.lineId));
 for(const fee of invoiceFees){
  const target=lines.filter(l=>l.warehouseKey===fee.warehouseKey&&l.quantity>0),denominator=target.reduce((s,l)=>s+Number(l.sourceLine.boxQuantity),0);
  if(!(denominator>0)||target.some(l=>!(Number(l.sourceLine.boxQuantity)>=0)))fail('송장 부대비의 원본 박스 배분 수량을 확인하세요.');
  let allocated=0;target.forEach((line,i)=>{const native=i===target.length-1?round(fee.amount-allocated):round(fee.amount*line.sourceLine.boxQuantity/denominator);allocated+=native;const won=native*inputs.get(line.awb).exchangeRate;line.componentAmounts={...line.componentAmounts,invoiceFeeNative:(line.componentAmounts.invoiceFeeNative??0)+native,invoiceFeeKRW:(line.componentAmounts.invoiceFeeKRW??0)+won};line.totalCostKRW+=won;line.costPerUnitKRW=line.totalCostKRW/line.quantity;});
  sources.push({kind:'INVOICE_FEE',sourceId:fee.evidence,awbs:[fee.awb],warehouseKeys:[fee.warehouseKey],currency:'USD',basis:'BOX',mode:'TOTAL',amount:fee.amount,estimated:false});
 }
 const totals={totalCostKRW:round(lines.reduce((s,l)=>s+l.totalCostKRW,0)),...Object.fromEntries(['goodsNative','freightNative','goodsKRW','freightKRW','tariffKRW','customsKRW','surchargeKRW','permitNative','invoiceFeeNative'].map(k=>[k,round(lines.reduce((s,l)=>s+(l.componentAmounts[k]??0),0))]))};
 return {scope:prepared.scope,status:'CALCULATED',lines,results,sources,totals,versionHash:digest({baseline:prepared.baselineDigest,selected:prepared.selectedKeys,sources,inputs:[...inputs].sort(),lines}),receiptCount:prepared.members.length};
}

