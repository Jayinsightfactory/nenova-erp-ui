import {createHash} from 'node:crypto';
import {calculateSharedAwbCost} from './invoiceSharedAwbCost.js';
import {calculateCoOriginalCustoms} from './coOriginalCostInputs.js';

export const normalizeColombiaCostAwb=value=>typeof value==='string'?value.replace(/[\s-]/g,''):'';
const fail=(code,message)=>{throw Object.assign(Error(message),{code,statusCode:422});};
const round=value=>Math.round(value*1e6)/1e6;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Calculation only. Callers must supply a fresh, complete server-read receipt
 * set. File boundaries and equal amounts are never receipt/expense identities.
 * Existing per-AWB equations remain authoritative; this layer only scopes pools.
 */
export function calculateColombiaWeekCost({scope,awbs,customsPools}){
 if(scope?.country!=='CO'||typeof scope.orderYear!=='string'||!/^\d{4}$/.test(scope.orderYear)||typeof scope.orderWeek!=='string'||!/^(?:0[1-9]|[1-4]\d|5[0-3])-(?:0[1-9]|[1-9]\d)$/.test(scope.orderWeek))fail('WEEK_SCOPE_INVALID','콜롬비아 연도·정확한 세부차수를 확인하세요.');
 if(!Array.isArray(awbs)||!awbs.length||awbs.length>50||!Array.isArray(customsPools)||customsPools.length>100)fail('WEEK_SOURCE_REQUIRED','전체 입고와 통관비 귀속 근거가 필요합니다.');
 const byAwb=new Map(),receipts=new Set(),lines=new Set();
 for(const entry of awbs){
  const awb=normalizeColombiaCostAwb(entry?.manifest?.awb);
  if(!/^\d{11}$/.test(awb)||byAwb.has(awb))fail('WEEK_AWB_DUPLICATE','같은 AWB의 중량·운임을 두 번 입력할 수 없습니다.');
  if(entry.manifest.orderYear!==scope.orderYear||entry.manifest.orderWeek!==scope.orderWeek)fail('WEEK_SCOPE_MISMATCH','다른 연도·차수의 입고가 섞였습니다.');
  if(!Array.isArray(entry.members)||!entry.members.length)fail('WEEK_RECEIPT_REQUIRED','AWB의 입고 전체가 필요합니다.');
  for(const member of entry.members){
   if(!Number.isSafeInteger(member.warehouseKey)||member.warehouseKey<1||receipts.has(member.warehouseKey))fail('WEEK_RECEIPT_DUPLICATE','같은 입고를 여러 AWB에 배분할 수 없습니다.');
   receipts.add(member.warehouseKey);
   for(const row of member.rows??[]){if(!row.lineId||lines.has(row.lineId))fail('WEEK_LINE_DUPLICATE','같은 입고 상세가 중복되었습니다.');lines.add(row.lineId);}
  }
  if(!(number(entry.input?.gw)>0)||!(number(entry.input?.cw)>=entry.input.gw))fail('WEEK_WEIGHT_REQUIRED','AWB별 원본 GW·CW를 확인하세요.');
  byAwb.set(awb,entry);
 }
 if(lines.size>1000)fail('WEEK_TOO_MANY_LINES','차수 통합 계산은 전체 1,000개 상품행까지 지원합니다.');
 const shares=new Map([...byAwb.keys()].map(awb=>[awb,0])),covered=new Set(),sources=new Map();
 for(const pool of customsPools){
  if(typeof pool?.sourceId!=='string'||!pool.sourceId.trim()||pool.sourceId.length>160||pool.confirmed!==true)fail('CUSTOMS_SOURCE_REQUIRED','통관비 증빙 식별자와 귀속 확인이 필요합니다.');
  const targets=Array.isArray(pool.awbs)?pool.awbs.map(normalizeColombiaCostAwb).sort():[];
  if(!targets.length||new Set(targets).size!==targets.length||targets.some(awb=>!byAwb.has(awb)))fail('CUSTOMS_SCOPE_INVALID','통관비 대상 AWB를 확인하세요.');
  const mode=pool.mode??'TOTAL';
  if(!['TOTAL','FORMULA'].includes(mode))fail('CUSTOMS_MODE_INVALID','기존 수식 또는 확인한 통관비 합계를 선택하세요.');
  const gw=targets.reduce((sum,awb)=>sum+byAwb.get(awb).input.gw,0);
  const groups=[...new Set(targets.flatMap(awb=>byAwb.get(awb).members.flatMap(member=>member.lineInputs.map(line=>line.groupId))))].sort();
  const amount=mode==='FORMULA'?calculateCoOriginalCustoms(gw,groups).total:number(pool.amountKRW);
  if(amount===null||amount<0)fail('CUSTOMS_AMOUNT_REQUIRED','확인하지 못한 통관비를 0원으로 처리하지 않습니다.');
  const identity=JSON.stringify({targets,mode,amount});
  if(sources.has(pool.sourceId)){
   if(sources.get(pool.sourceId).identity!==identity)fail('CUSTOMS_SOURCE_CONFLICT','같은 통관비 증빙의 내용 또는 대상이 다릅니다.');
   continue; // Same explicit source repeated by split uploads: allocate once.
  }
  sources.set(pool.sourceId,{identity,sourceId:pool.sourceId,awbs:targets,mode,amountKRW:amount,estimated:mode==='FORMULA'});
  let allocated=0;
  targets.forEach((awb,index)=>{const share=index===targets.length-1?amount-allocated:round(amount*byAwb.get(awb).input.gw/gw);allocated+=share;shares.set(awb,shares.get(awb)+share);covered.add(awb);});
 }
 if([...byAwb.keys()].some(awb=>!covered.has(awb)))fail('CUSTOMS_AWB_UNCOVERED','통관비 귀속 또는 명시적 0원 근거가 없는 AWB가 있습니다.');
 const results=[...byAwb.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([awb,entry])=>{
  const members=[...entry.members].sort((a,b)=>a.warehouseKey-b.warehouseKey).map(member=>({...member,rows:[...member.rows].sort((a,b)=>a.lineId.localeCompare(b.lineId)),lineInputs:[...member.lineInputs].sort((a,b)=>a.lineId.localeCompare(b.lineId))}));
  const manifest={...entry.manifest,awb,members:[...entry.manifest.members].sort((a,b)=>a.documentId.localeCompare(b.documentId))};
  const input={...entry.input,customsMode:'TOTAL',customsTotalKRW:shares.get(awb)};
  const result=calculateSharedAwbCost({manifest,members,input});
  return {awb,input,result};
 });
 const allLines=results.flatMap(({awb,result})=>result.lines.map(line=>({...line,awb}))).sort((a,b)=>a.lineId.localeCompare(b.lineId));
 const issues=results.flatMap(({awb,result})=>result.issues.map(issue=>({...issue,awb})));
 const totals=Object.fromEntries(['goodsNative','freightNative','goodsKRW','freightKRW','tariffKRW','customsKRW'].map(key=>[key,round(results.reduce((sum,{result})=>sum+result.totals[key],0))]));
 const customsSources=[...sources.values()].sort((a,b)=>a.sourceId.localeCompare(b.sourceId)).map(({identity,...source})=>source);
 const sourceIdentity=[...byAwb].sort(([a],[b])=>a.localeCompare(b)).map(([awb,entry])=>({awb,members:[...entry.manifest.members].sort((a,b)=>a.documentId.localeCompare(b.documentId)),input:entry.input}));
 return {scope:{...scope},status:issues.length?'REVIEW_REQUIRED':'CALCULATED',issues,results,lines:allLines,totals,customsSources,
  receiptCount:receipts.size,awbCount:byAwb.size,weights:results.map(({awb,input})=>({awb,gw:input.gw,cw:input.cw})),
  versionHash:digest({scope,sourceIdentity,customsSources,lines:allLines})};
}
