import fs from 'node:fs/promises';
import { loadSettlementContext, loadSettlementYearCandidates } from './customsSettlementContext.js';
import policy from './customsSettlementPlan.cjs';
import store from './customsSettlementStore.cjs';

const defaults={root:store.ROOT,loadContext:loadSettlementContext,loadCandidates:loadSettlementYearCandidates};
async function yearDocuments(year,root) {
  let names;try{names=await fs.readdir(root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const records=[];
  for(const name of names.filter(n=>new RegExp(`^${year}-\\d{2}\\.json$`).test(n)).sort()){
    const major=name.slice(5,7),ledger=await store.readLedger(root,year,major);
    records.push(...ledger.documents.map(d=>({...d,registrationMajor:major})));
  }
  return records;
}
// The original AWB is immutable. A manual alternative is a separate, audited link.
export async function reviewSettlementRegistration(job,{links={},selectedHashes=null,...options}={}) {
  const deps={...defaults,...options},candidates=(await deps.loadCandidates(job.year)).filter(c=>String(c.year)===String(job.year)),existing=await yearDocuments(job.year,deps.root);
  const rows=[],assigned=[],contextCache=new Map();
  const ready=job.files.filter(f=>f.status==='READY');
  for(const file of job.files){
    if(file.status!=='READY'){rows.push({sourceHash:file.sourceHash,status:'ocr_review',reason:file.error||'첫 페이지 판독 대기'});continue;}
    const receipt=file.receipt,old=existing.find(d=>policy.receiptKey(d)===policy.receiptKey(receipt));
    if(old){rows.push({sourceHash:file.sourceHash,status:old.fingerprint===policy.receiptFingerprint(receipt)?'registered':'blocked',reason:old.fingerprint===policy.receiptFingerprint(receipt)?'이미 등록된 정산서':'같은 신고번호의 원문 금액이 달라 확인 필요',year:job.year,major:old.registrationMajor,targetKey:old.targetKey});continue;}
    const exact=candidates.filter(c=>c.awb===policy.awbOf(receipt.awb));
    const manual=Object.prototype.hasOwnProperty.call(links,file.sourceHash),chosen=manual?candidates.find(c=>c.matchId===links[file.sourceHash]):exact.length===1?exact[0]:null;
    const row={sourceHash:file.sourceHash,documentId:receipt.documentId,awb:receipt.awb,status:'review',reason:'',suggestions:exact.length?exact:candidates.filter(c=>c.targetKey&&receipt.currency&&c.currency===receipt.currency&&c.orderWeek.split('-')[0]===job.major)};
    rows.push(row);
    if(!chosen?.targetKey){row.reason=manual?'선택 입고가 현재 범위에서 유효하지 않습니다.':exact.length?'여러 차수·국가의 AWB — 입고 선택 필요':'정확한 AWB 없음 — 합산 입고를 명시 선택하고 금액·GW 검산 필요';continue;}
    const major=chosen.orderWeek.split('-')[0];Object.assign(row,{year:job.year,major,targetKey:chosen.targetKey,matchId:chosen.matchId});
    if(major!==job.major&&!manual){row.reason=`실제 활성 입고는 ${job.year}년 ${chosen.orderWeek}입니다. 귀속 확인 후 선택하세요.`;continue;}
    if(manual&&chosen.awb!==policy.awbOf(receipt.awb)){
      const pool=new Map();
      for(const other of [...ready.map(f=>f.receipt),...existing]){
        const isMember=other.sourceHash===receipt.sourceHash||links[other.sourceHash]===chosen.matchId||other.matchedAwb===chosen.awb&&other.matchedOrderWeek===chosen.orderWeek||!other.matchedAwb&&policy.awbOf(other.awb)===chosen.awb;
        if(isMember)pool.set(policy.receiptKey(other),other);
      }
      const parts=[...pool.values()];
      const valid=parts.length>0&&parts.every(p=>p.currency&&p.currency===chosen.currency&&Number.isFinite(p.foreignAmount)&&Number.isFinite(p.grossWeight)&&p.grossWeight>0)
        &&Number.isFinite(chosen.foreignAmount)&&Number.isFinite(chosen.grossWeight)
        &&Math.abs(parts.reduce((n,p)=>n+p.foreignAmount,0)-chosen.foreignAmount)<.005
        &&Math.abs(parts.reduce((n,p)=>n+p.grossWeight,0)-chosen.grossWeight)<.01;
      if(!valid){row.reason='합산 입고의 원문 통화·결제금액·GW 동시 검산 불일치/누락 — 연결 보류';continue;}
      row.matchProof={type:'MANUAL_COMBINED_AMOUNT_AND_GW',documentIds:parts.map(p=>p.documentId).sort(),currency:chosen.currency,foreignAmount:chosen.foreignAmount,grossWeight:chosen.grossWeight};
    }
    row.status=manual?'confirmation':'auto';row.reason=manual?'선택 귀속·실제 원천 우선 반영을 확인하세요.':'정확 AWB·귀속·금액 검산 — 자동등록 대상';
    if(selectedHashes&&!selectedHashes.includes(file.sourceHash))continue;
    assigned.push({row,receipt:{...receipt,matchedAwb:chosen.awb,matchedOrderWeek:chosen.orderWeek,...(manual?{manualLink:true,matchProof:row.matchProof||{type:'EXACT_OTHER_SCOPE_CONFIRMED'}}:{})}});
  }
  const groups=[];
  for(const major of [...new Set(assigned.map(a=>a.row.major))].sort()){
    if(!contextCache.has(major))contextCache.set(major,await deps.loadContext(job.year,major));
    const receipts=assigned.filter(a=>a.row.major===major).map(a=>a.receipt),ledger=await store.readLedger(deps.root,job.year,major);
    const plan=policy.buildSettlementPlan({...contextCache.get(major),receipts,applied:ledger.documents});
    const conflictTargets=new Set(plan.issues.map(i=>i.targetKey).filter(Boolean));
    for(const a of assigned.filter(a=>a.row.major===major)){
      const docIssue=plan.issues.find(i=>i.documentId===a.receipt.documentId);
      if(docIssue){a.row.status='blocked';a.row.reason='원문 식별·금액 변경 또는 지원하지 않는 비용 — 연결 보류';}
      else if(conflictTargets.has(a.row.targetKey)){a.row.status='confirmation';a.row.reason='기존 입력과 실제 원천에 차이 — DB는 보존하고 원천 우선 계산을 확인하세요.';}
    }
    groups.push({year:job.year,major,plan});
  }
  const result={jobId:job.jobId,year:job.year,requestedMajor:job.major,rows,groups};
  return {...result,reviewDigest:policy.hash(result)};
}
export async function registerSettlementJob(job,{automatic=false,links={},selectedHashes=null,reviewDigest,confirmed=false,actor='settlement-worker',...options}={}){
  const deps={...defaults,...options},review=await reviewSettlementRegistration(job,{...deps,links,selectedHashes});
  if(!automatic&&(confirmed!==true||reviewDigest!==review.reviewDigest))throw Object.assign(Error('대상·금액·귀속이 변경되었습니다. 다시 확인하세요.'),{statusCode:409});
  const hashes=automatic?review.rows.filter(r=>r.status==='auto').map(r=>r.sourceHash):review.rows.filter(r=>['auto','confirmation'].includes(r.status)&&(!selectedHashes||selectedHashes.includes(r.sourceHash))).map(r=>r.sourceHash);
  const results=[],errors=[];
  for(const major of [...new Set(review.rows.filter(r=>hashes.includes(r.sourceHash)).map(r=>r.major))].sort()){
    const receipts=job.files.filter(f=>hashes.includes(f.sourceHash)&&review.rows.some(r=>r.sourceHash===f.sourceHash&&r.major===major)).map(f=>{
      const r=review.rows.find(r=>r.sourceHash===f.sourceHash),candidateId=links[f.sourceHash]||r.matchId;
      const [year,matchedOrderWeek,matchedAwb]=candidateId.split('|');
      return {...f.receipt,matchedOrderWeek,matchedAwb,...(links[f.sourceHash]?{manualLink:true,matchProof:r.matchProof||{type:'EXACT_OTHER_SCOPE_CONFIRMED'}}:{})};
    });
    const makePlan=async ledger=>{
      // Called again inside the global root lock, not merely during preview.
      const yearDocs=await yearDocuments(job.year,deps.root);
      for(const receipt of receipts){const other=yearDocs.find(d=>policy.receiptKey(d)===policy.receiptKey(receipt)&&d.registrationMajor!==major);if(other)throw Object.assign(Error('같은 신고번호가 다른 차수에 이미 등록되었습니다. 임의 이동·중복 등록하지 않습니다.'),{statusCode:409});}
      return policy.buildSettlementPlan({...await deps.loadContext(job.year,major),receipts,applied:ledger.documents});
    };
    try{
      const latest=await makePlan(await store.readLedger(deps.root,job.year,major));
      const expected=review.groups.find(g=>g.major===major)?.plan;
      // Auto may exclude conflict targets; revalidate that subset under the same lock.
      if(!automatic&&latest.baseline!==expected.baseline)throw Object.assign(Error('입고·기존 입력이 변경되었습니다. 다시 검토하세요.'),{statusCode:409});
      results.push({year:job.year,major,...await store.applySettlementPlan({root:deps.root,year:job.year,major,expectedDigest:latest.planDigest,confirmed:true,approveConflicts:!automatic,actor,makePlan})});
    }catch(e){errors.push({year:job.year,major,error:e.statusCode?e.message:'원천 등록에 실패했습니다. 상태를 재확인하세요.'});}
  }
  return {results,errors,registeredDocuments:results.reduce((n,r)=>n+(r.documentCount||0),0),erpWrites:0,reportWrites:0};
}
