import {cloudLineCategory} from './chinaCloudCost.js';
const bad=message=>{throw Object.assign(Error(message),{statusCode:422});};
export const reviewNumber=v=>typeof v==='boolean'||v==null||String(v).trim()===''||!Number.isFinite(Number(v))?null:Number(v);
export const reviewText=v=>typeof v==='string'&&v.trim().length>0&&v.length<=1000&&!/[\u0000-\u0008<>]/.test(v);
export const reviewKey=scope=>`cost.review.${scope.country}.${scope.orderYear}.${scope.orderWeek}.${[...scope.selectedKeys].sort((a,b)=>a-b).join('-')}`;
export const isReviewKey=key=>/^cost\.review\.CN\.\d{4}\.\d{2}-\d{2}\.[1-9]\d*(?:-[1-9]\d*){0,99}$/.test(key);
const ordered=o=>Array.isArray(o)?o.map(ordered):o&&typeof o==='object'?Object.fromEntries(Object.keys(o).sort().map(k=>[k,ordered(o[k])])):o;
export const reviewSignature=value=>JSON.stringify(ordered(value));
export function reviewRowSignature(member,row,draft){
 const awb=draft.awbInputs?.find(a=>a.awb===member.awb)?.input;
 const expenses=(draft.expensePools??[]).filter(p=>p.awbs?.includes(member.awb));
 return reviewSignature({scope:[member.warehouseKey,member.invoiceNo,member.awb],erp:{prodKey:row.prodKey,wdetailKey:row.wdetailKey,quantity:row.outQuantity,unit:row.outUnit,amount:row.lineAmount,unitPrice:row.unitPrice},original:member.reviewSource?.lines.find(l=>l.wdetailKey===row.wdetailKey),row:draft.rows?.[row.lineId],category:draft.lineInputs?.find(l=>l.lineId===row.lineId)??member.lineInputs.find(l=>l.lineId===row.lineId),awb,expenses,mode:draft.mode});
}
export function validateCostReviewDraft(value){
 if(!value||value.version!==1||!['TEST_ONLY','REVIEWED'].includes(value.mode)||!value.rows||typeof value.rows!=='object'||Array.isArray(value.rows)||!Array.isArray(value.lineInputs)||!Array.isArray(value.awbInputs)||!Array.isArray(value.expensePools)||!value.confirmations||typeof value.confirmations!=='object'||Array.isArray(value.confirmations))bad('원가 검토 초안 형식을 확인하세요.');
 if(Object.keys(value).some(k=>!['version','mode','rows','lineInputs','awbInputs','expensePools','expenseDecisions','confirmations','reason','baselineDigest'].includes(k)))bad('지원하지 않는 초안 항목입니다.');
 if(Object.keys(value.rows).length>1000||value.lineInputs.length>1000||value.awbInputs.length>100||value.expensePools.length>100||JSON.stringify(value).length>240000)bad('원가 초안 범위를 확인하세요.');
 for(const [id,row]of Object.entries(value.rows)){
  if(!/^[a-f0-9-]{36}$/.test(id)||!row||Object.keys(row).some(k=>!['basis','quantity','amount','reason','source','manualFreight','manualDuty','manualReason'].includes(k))||!['ERP','SOURCE','MANUAL'].includes(row.basis))bad('원가 적용 행 형식을 확인하세요.');
  for(const k of ['quantity','amount','manualFreight','manualDuty'])if(row[k]!=null&&row[k]!==''&&(reviewNumber(row[k])===null||reviewNumber(row[k])<0))bad('원가 적용 숫자는 0 이상이어야 합니다.');
  for(const k of ['reason','source','manualReason'])if(row[k]&&(!reviewText(row[k])))bad('원가 변경 사유·출처를 확인하세요.');
 }
 for(const row of value.lineInputs)if(!row||typeof row.lineId!=='string'||Object.keys(row).some(k=>!['lineId','categoryCode','categoryOverride'].includes(k)))bad('입고별 분류 입력 형식을 확인하세요.');
 for(const entry of value.awbInputs)if(!entry||typeof entry.awb!=='string'||!entry.input||Object.keys(entry).some(k=>!['awb','input'].includes(k)))bad('입고별 중량 입력 형식을 확인하세요.');
 for(const p of value.expensePools)if(!p||!Array.isArray(p.awbs)||p.awbs.length>100||typeof p.sourceId!=='string'||p.sourceId.length>160||typeof p.reason!=='string'||p.reason.length>1000)bad('비용 증빙 형식을 확인하세요.');
 for(const signature of Object.values(value.confirmations))if(typeof signature!=='string'||signature.length>40000)bad('행 확인 기록을 확인하세요.');
 return value;
}
export function reviewAppliedLine(member,line,draft){
 if(!['BUNCH','단'].includes(line.outUnit))bad(`${line.lineNo}행: 원가 계산단위 변환 근거를 먼저 확인하세요.`);
 const choice=draft.rows?.[line.lineId]??{basis:'ERP'},original=member.reviewSource?.lines.find(l=>l.wdetailKey===line.wdetailKey);
 let quantity=reviewNumber(line.outQuantity),amount=reviewNumber(line.lineAmount);
 if(choice.basis==='SOURCE'){
  if(!original||original.currency!=='CNY'||({BUNCH:'단',STEM:'송이',BOX:'박스'}[original.unit]??original.unit)!==({BUNCH:'단',STEM:'송이',BOX:'박스'}[line.nativeOutUnit??line.outUnit]??line.nativeOutUnit??line.outUnit)||!reviewText(choice.reason))bad(`${line.lineNo}행: 원문 적용의 연결 근거와 사유가 필요합니다.`);
  quantity=reviewNumber(original.quantity);amount=reviewNumber(original.amount);
 }else if(choice.basis==='MANUAL'){
  if(!reviewText(choice.reason)||!reviewText(choice.source))bad(`${line.lineNo}행: 직접 입력 출처·사유가 필요합니다.`);
  quantity=reviewNumber(choice.quantity);amount=reviewNumber(choice.amount);
 }
 if(choice.basis==='ERP'&&original&&(original.amount!==line.lineAmount||original.quantity!==line.outQuantity||original.prodKey!==line.prodKey)&&!reviewText(choice.reason))bad(`${line.lineNo}행: 원문과 다른 ERP 값을 유지하는 사유를 입력하세요.`);
 if(!(quantity>0)||!(amount>=0))bad(`${line.lineNo}행: 적용 수량·원금을 확인하세요.`);
 const manualFreight=reviewNumber(choice.manualFreight),manualDuty=reviewNumber(choice.manualDuty),manual=manualFreight!==null||manualDuty!==null;
 if(manual&&(manualFreight===null||manualDuty===null||!reviewText(choice.manualReason)))bad(`${line.lineNo}행: 수기 운임·관세와 출처를 모두 입력하세요. 확인한 0도 명시하세요.`);
 return {...line,appliedDescription:choice.basis==='SOURCE'?[original.originalName,original.specification].filter(Boolean).join(' / '):line.originalName,outQuantity:quantity,lineAmount:amount,unitPrice:amount/quantity,reviewChoice:choice,originalComparison:original,manualFreight,manualDuty,manual};
}
export function checkCostReview(prepared,draft,{requireConfirmed=false}={}){
 validateCostReviewDraft(draft);
 const ids=new Set(prepared.members.flatMap(m=>m.rows.map(l=>l.lineId)));
 if([...Object.keys(draft.rows),...Object.keys(draft.confirmations),...draft.lineInputs.map(l=>l.lineId)].some(id=>!ids.has(id)))bad('선택 입고 밖의 원가 행입니다.');
 if(new Set(draft.lineInputs.map(l=>l.lineId)).size!==draft.lineInputs.length)bad('원가 카테고리 행이 중복되었습니다.');
 const rows=[];
 for(const member of prepared.members)for(const line of member.rows){
  const applied=reviewAppliedLine(member,line,draft),choice=draft.lineInputs.find(l=>l.lineId===line.lineId)??member.lineInputs.find(l=>l.lineId===line.lineId);
  if(!applied.manual&&!cloudLineCategory(choice)&&requireConfirmed)bad(`${line.lineNo}행: 카테고리 규격이 미완성입니다.`);
  if(requireConfirmed&&draft.confirmations[line.lineId]!==reviewRowSignature(member,line,draft))bad(`${line.lineNo}행: 변경된 원가 적용값을 다시 확인하세요.`);
  rows.push({...applied,warehouseKey:member.warehouseKey,awb:member.awb,categoryInput:choice});
 }
 return rows;
}

// Explicit line freight is reserved before the remaining pool is allocated.
// Never fabricate CBM/tariff for manual-cost items.
export function calculateCloudReviewedRows(prepared,draft,inputs,amounts){
 const rows=checkCostReview(prepared,draft,{requireConfirmed:true}),lines=[];
 for(const awb of prepared.awbs){
  const group=rows.filter(l=>l.awb===awb.awb),input=inputs.get(awb.awb),pool=amounts.get(awb.awb),fx=input.exchangeRate;
  const qty=group.reduce((s,l)=>s+l.outQuantity,0),reserved=group.reduce((s,l)=>s+(l.manual?l.manualFreight*l.outQuantity:0),0);
  if(reserved>pool.FREIGHT+1e-6)bad('수기 운임 합계가 운임 증빙 합계를 초과합니다.');
  const volume=group.reduce((s,l)=>s+(l.manual?0:l.outQuantity*cloudLineCategory(l.categoryInput).volumeKgPerBunch),0),remainder=pool.FREIGHT-reserved;
  if(remainder>1e-6&&!(volume>0))bad('남은 운임을 배분할 CBM 품목이 없습니다.');
  const orchids=group.filter(l=>Number(l.categoryInput?.categoryCode)===8).reduce((s,l)=>s+l.outQuantity,0);
  if(orchids&&(reviewNumber(input.permitAmount)===null||!reviewText(input.permitReason)))bad('허가증 포함·제외 금액과 사유를 출처와 함께 확인하세요.');
  if(draft.mode==='TEST_ONLY'&&(!reviewText(input.reviewReason)||input.financialReviewConfirmed===true))bad('검증본은 재무 승인과 분리해 원가표 재현 사유를 입력하세요.');
  if(draft.mode==='REVIEWED'&&input.financialReviewConfirmed!==true)bad('운영 비용 적용 확인이 필요합니다.');
  let allocated=0;const standard=group.filter(l=>!l.manual);
  for(const line of group){
   const category=cloudLineCategory(line.categoryInput),weight=line.manual?0:line.outQuantity*category.volumeKgPerBunch;
   const freightNative=line.manual?line.manualFreight*line.outQuantity:line.lineId===standard.at(-1)?.lineId?remainder-allocated:remainder*weight/volume;
   if(!line.manual)allocated+=freightNative;
   const goodsNative=line.lineAmount,permitNative=Number(line.categoryInput?.categoryCode)===8?(reviewNumber(input.permitAmount)??0)*line.outQuantity/orchids:0;
   const goodsKRW=goodsNative*fx,freightKRW=freightNative*fx,permitKRW=permitNative*fx,cnf=goodsKRW+freightKRW+permitKRW;
   const tariffKRW=line.manual?line.manualDuty*line.outQuantity:cnf*category.tariffRate,surchargeKRW=cnf*.03,customsKRW=pool.CUSTOMS*line.outQuantity/qty;
   const totalCostKRW=cnf+tariffKRW+surchargeKRW+customsKRW;
   lines.push({...line,quantity:line.outQuantity,unit:line.nativeOutUnit==='송이'?'STEM':'BUNCH',currency:'KRW',costPerUnitKRW:totalCostKRW/line.outQuantity,totalCostKRW,
    componentAmounts:{goodsNative,freightNative,permitNative,goodsKRW,freightKRW,permitKRW,tariffKRW,surchargeKRW,customsKRW,volumeWeightKg:weight},freightAllocationBasis:line.manual?'SOURCE_MANUAL_THEN_RESIDUAL_CBM':'RESIDUAL_CATEGORY_VOLUME_KG'});
  }
 }
 return lines;
}


export function costReviewChanges(before,after){
 const ids=new Set([...Object.keys(before?.rows??{}),...Object.keys(after.rows)]);
 return [...ids].filter(id=>reviewSignature(before?.rows?.[id])!==reviewSignature(after.rows[id])||reviewSignature(before?.lineInputs?.find(l=>l.lineId===id))!==reviewSignature(after.lineInputs.find(l=>l.lineId===id))).slice(0,100).map(lineId=>({lineId,before:before?.rows?.[lineId]??null,after:after.rows[lineId]??null,categoryBefore:before?.lineInputs?.find(l=>l.lineId===lineId)??null,categoryAfter:after.lineInputs.find(l=>l.lineId===lineId)??null}));
}
