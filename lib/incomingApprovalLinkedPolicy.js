import { approvalError } from './incomingApprovalPolicy.js';
import { correctionDetailFields } from './warehouseCorrectionPolicy.js';
import { normalizeFarmAssignments, assertFarmAssignmentTotal } from './shipmentFarmAssignments.js';

const signature = row => JSON.stringify(correctionDetailFields.map(k=>row[k]??null));
export function suggestReceiptMappings(receiptPlan) {
  const used = new Set();
  return receiptPlan.after.map((after,targetRowIndex)=>{
    if (Object.hasOwn(after, 'SourceWdetailKey')) return {sourceWdetailKey:after.SourceWdetailKey,targetRowIndex};
    const exact = receiptPlan.before.filter(b=>!used.has(b.WdetailKey)&&signature(b)===signature(after));
    const same = receiptPlan.before.filter(b=>!used.has(b.WdetailKey)&&b.ProdKey===after.ProdKey&&b.OrderCode===after.OrderCode);
    const source = exact.length===1?exact[0]:same.length===1?same[0]:null;
    if(source)used.add(source.WdetailKey);
    return {sourceWdetailKey:source?.WdetailKey??null,targetRowIndex};
  });
}
export function buildReceiptIdentityPlan(receiptPlan, matching, { preserveReferenced = false } = {}) {
  if(!receiptPlan.detailsChanged)return {targets:receiptPlan.after.map((row,targetRowIndex)=>({targetRowIndex,row,sourceWdetailKey:row.WdetailKey})),removed:[],issues:[]};
  const mappings = matching.receiptMappings.length ? matching.receiptMappings : suggestReceiptMappings(receiptPlan);
  const issues=[],sourceByKey=new Map(receiptPlan.before.map(r=>[r.WdetailKey,r])),assigned=new Set();
  for(const m of mappings){
    if(m.sourceWdetailKey!==null&&!sourceByKey.has(m.sourceWdetailKey))issues.push({code:'APPROVAL_RECEIPT_SOURCE_INVALID',message:'입고 원본행이 선택 입고에 속하지 않습니다.'});
    if(m.targetRowIndex!==null&&(!Number.isInteger(m.targetRowIndex)||!receiptPlan.after[m.targetRowIndex]))issues.push({code:'APPROVAL_RECEIPT_TARGET_INVALID',message:'수정 파일의 대상 행이 없습니다.'});
  }
  const targets=receiptPlan.after.map((row,targetRowIndex)=>{
    const links=mappings.filter(m=>m.targetRowIndex===targetRowIndex);
    if(!links.length)issues.push({code:'APPROVAL_RECEIPT_MAPPING_REQUIRED',message:`수정 파일 ${targetRowIndex+1}행의 기존 입고 연결 또는 신규 행 여부를 확인하세요.`});
    const candidates=links.map(m=>m.sourceWdetailKey).filter(k=>k!==null&&sourceByKey.has(k)&&!assigned.has(k)).sort((a,b)=>a-b);
    const sourceWdetailKey=candidates[0]??null;if(sourceWdetailKey)assigned.add(sourceWdetailKey);
    return {targetRowIndex,row,sourceWdetailKey,sourceKeys:links.map(m=>m.sourceWdetailKey).filter(k=>k!==null)};
  });
  const removed=receiptPlan.before.filter(r=>!assigned.has(r.WdetailKey)).map(row=>({row,preserve:preserveReferenced}));
  return {targets,removed,issues};
}

export function buildApprovalFarmPlan(facts, matching, groups) {
  const plans=[],issues=[],byKey=new Map(groups.map(g=>[g.key,g]));
  const supplied=new Map(matching.farmGroups.map(g=>[`${g.shipmentKey}:${g.prodKey}`,g]));
  for(const group of groups){
    const old=facts.farmAssignments.filter(a=>a.SdetailKey===group.detail?.SdetailKey);
    const sourceMoved=matching.rows.some(r=>r.sdateKey&&facts.dates.find(d=>d.SdateKey===r.sdateKey)?.SdetailKey===group.detail?.SdetailKey&&r.prodKey!==group.product.ProdKey);
    if(old.length&&(group.outQuantity!==Number(group.detail.OutQuantity)||sourceMoved)&&!supplied.has(group.key))
      issues.push({code:'APPROVAL_FARM_ALLOCATION_REVIEW',message:`${group.master.CustName} / ${group.product.ProdName}: 변경 후 농장별 배정표를 확인하세요.`});
    // Moving an allocated source requires an explicit target allocation as well.
    const receivesAllocated=matching.rows.some(r=>r.prodKey===group.product.ProdKey&&r.shipmentKey===group.master.ShipmentKey&&r.quantity>0&&r.sdateKey&&facts.farmAssignments.some(a=>a.SdetailKey===facts.dates.find(d=>d.SdateKey===r.sdateKey)?.SdetailKey)&&facts.details.find(d=>d.SdetailKey===facts.dates.find(d=>d.SdateKey===r.sdateKey)?.SdetailKey)?.ProdKey!==r.prodKey);
    if(receivesAllocated&&!supplied.has(group.key))issues.push({code:'APPROVAL_FARM_TARGET_REQUIRED',message:`${group.product.ProdName}: 이동 대상의 농장별 최종 배정을 입력하세요.`});
  }
  for(const [key,input]of supplied){
    const detail=facts.details.find(d=>d.ShipmentKey===input.shipmentKey&&d.ProdKey===input.prodKey);
    const group=byKey.get(key),master=group?.master??facts.masters.find(m=>m.ShipmentKey===input.shipmentKey);
    if(!master||!group&&!detail){issues.push({code:'APPROVAL_FARM_SCOPE_INVALID',message:'농장 배정 대상 출고·품목을 확인하세요.'});continue;}
    const before=facts.farmAssignments.filter(a=>a.SdetailKey===detail?.SdetailKey);
    const quantity=group?.outQuantity??Number(detail.OutQuantity);
    const assignments=normalizeFarmAssignments(input.assignments.map(a=>({farmKey:a.farmKey,shipmentQuantity:a.quantity})));
    try{assertFarmAssignmentTotal(assignments,quantity);}catch(e){issues.push({code:'APPROVAL_FARM_TOTAL',message:e.message});}
    for(const a of assignments)if(!facts.farmCandidates[input.prodKey]?.some(f=>f.FarmKey===a.farmKey))issues.push({code:'APPROVAL_FARM_CANDIDATE',message:'해당 품목의 입고 이력에 없는 농장입니다.'});
    if(matching.farms.some(a=>before.some(b=>a.sfarmKey===b.SfarmKey)))issues.push({code:'APPROVAL_FARM_DUPLICATE',message:'같은 농장을 개별 연결과 최종 배정표로 동시에 변경할 수 없습니다.'});
    plans.push({key,shipmentKey:input.shipmentKey,prodKey:input.prodKey,detailKey:detail?.SdetailKey??null,group,before,assignments,quantity});
  }
  return {plans,issues};
}
