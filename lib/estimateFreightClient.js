const endpoint='/api/estimate/freight-register';
export async function registerFreight({input,editGuard,storage,get,post,confirm,uuid,status,isCurrent=()=>true}) {
  const key=`nenova.freight.pending:${input.year}:${input.parentWeek}:${input.custKey}`;
  let pending;
  const stored=storage.getItem(key);
  if(stored) {
    try{pending=JSON.parse(stored);}catch{throw new Error('이전 운임 작업 기록을 읽지 못했습니다. 새 등록을 진행하지 않습니다.');}
    status('이전 운임 작업의 저장 결과 확인 중…');
    const receipt=await get(endpoint,{operationId:pending.operationId});
    if(receipt.found){storage.removeItem(key);return receipt.result;}
    if(!await confirm('이전 운임 작업의 성공 이력이 아직 없습니다. 새 작업을 만들지 않고 동일 작업번호로 다시 확인·시도할까요?')) return null;
  } else {
    status('운임 전체 사전 확인 중… 아직 저장하지 않았습니다.');
    const preview=await post(endpoint,{...input,editGuard,mode:'preview'});
    if(!preview.success || !preview.planHash) throw new Error(preview.error||'운임 사전 확인 실패');
    if(!isCurrent()) throw new Error('업체·차수가 바뀌어 등록을 중단했습니다.');
    const lines=preview.rows.map(r=>`${r.week} ${r.prodName}: ${r.oldQty} → ${r.qty}박스 · ${r.oldCost.toLocaleString()} → ${r.cost.toLocaleString()}원/박스 · ${r.shipmentDate} (${r.action})`);
    if(!await confirm(`${lines.join('\n')}\n\n기존 운임은 추가가 아닌 최종값입니다. 위 내용으로 전체 저장할까요?`)) {status('등록을 취소했습니다. 저장된 운임은 없습니다.');return null;}
    pending={...input,editGuard,mode:'apply',confirmed:true,operationId:uuid(),planHash:preview.planHash};
    // Persist BEFORE the request, so closing/reloading cannot silently create a
    // second operation after a lost commit acknowledgement.
    storage.setItem(key,JSON.stringify(pending));
  }
  status(`운임 ${pending.rows.length}건 전체 저장·재고 재계산·전산 대조 중…\n작업번호 ${pending.operationId}`);
  try {
    const result=await post(endpoint,pending);
    if(!result.success || !result.verified) throw new Error(result.error||'운임 저장 결과가 확인되지 않았습니다.');
    storage.removeItem(key);
    return result;
  } catch(error) {
    if(error.data?.rolledBack===true && error.data?.code!=='STOCK_GATE_BUSY') {storage.removeItem(key);throw new Error(`${error.message}\n전체 운임 저장이 취소됐습니다.`);}
    status('서버 응답을 받지 못했습니다. 같은 작업번호의 실제 저장 결과 확인 중…');
    try {
      const receipt=await get(endpoint,{operationId:pending.operationId});
      if(receipt.found){storage.removeItem(key);return receipt.result;}
    }catch{/* retain the original operation; no automatic second POST */}
    throw new Error('운임 저장 결과가 아직 확인되지 않았습니다. 다시 누르면 새 등록이 아니라 이전 작업번호로 결과를 확인합니다.');
  }
}
