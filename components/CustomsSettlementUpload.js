import {useEffect,useRef,useState} from 'react';
import WorkflowGuide from './WorkflowGuide';
const format=n=>n==null?'미확인':Number(n).toLocaleString();
const targetLabel=key=>{const [kind,name,phase]=String(key||'').split('|');return kind==='country'?`${name} ${Number(phase)}차`:kind==='colombia'?`콜롬비아 공동비용 ${name}`:'';};
const fieldLabel=f=>/^Customs[12]_/.test(f)||f==='CustomsFee'?'관세':/^SunYul[12]_/.test(f)?'통관·검역대행':f==='HandlingFee'?'통관수수료(공급가)':'검역대행(공급가)';
const chargeLabel={DUTY:'관세',IMPORT_VAT:'수입 부가세(비용 제외)',HANDLING:'통관수수료',QUARANTINE_AGENCY:'검역대행'};
export default function CustomsSettlementUpload({year,major,onLinked}){
  const [job,setJob]=useState(null),[review,setReview]=useState(null),[selected,setSelected]=useState([]),[links,setLinks]=useState({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[confirmed,setConfirmed]=useState(false),[dirty,setDirty]=useState(false),[worker,setWorker]=useState(null);
  const scope=`${year}|${major}`,active=useRef(scope),sequence=useRef(0),input=useRef(null),notified=useRef(new Set());active.current=scope;
  const storageKey=`customs-settlement-job:${scope}`;
  async function call(body){const r=await fetch('/api/sales/customs-settlement',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||!d.success)throw Error(d.error||'정산 작업을 확인하지 못했습니다.');return d;}
  function accept(d){setJob(d.job);if(d.worker)setWorker(d.worker);if(d.review){setReview(d.review);setSelected(d.review.rows.filter(r=>!['registered','blocked','ocr_review'].includes(r.status)).map(r=>r.sourceHash));const done=d.review.rows.filter(r=>r.status==='registered').length,key=`${d.job.jobId}:${done}`;if(done&&!notified.current.has(key)){notified.current.add(key);onLinked?.();}}}
  async function refresh(id,ownScope=scope){const own=sequence.current,r=await fetch(`/api/sales/customs-settlement?jobId=${encodeURIComponent(id)}`,{credentials:'same-origin'}),d=await r.json();if(active.current!==ownScope||sequence.current!==own)return;if(!d.success)throw Error(d.error);accept(d);}
  useEffect(()=>{
    sequence.current++;setJob(null);setReview(null);setLinks({});setSelected([]);setConfirmed(false);setDirty(false);setBusy(false);setError('');setMessage('');if(input.current)input.current.value='';
    let id;try{id=localStorage.getItem(storageKey);}catch{}
    if(id)refresh(id,scope).catch(()=>{try{localStorage.removeItem(storageKey);}catch{}});
  },[scope]);
  useEffect(()=>{
    if(!job||!['QUEUED','REVIEW_READY'].includes(job.status)||job.status==='REVIEW_READY'&&job.registration?.state==='DONE')return;
    let cancelled=false,inflight=false;const ownScope=scope;
    const timer=setInterval(async()=>{if(inflight)return;inflight=true;try{if(!cancelled)await refresh(job.jobId,ownScope);}catch(e){if(!cancelled&&active.current===ownScope)setError(e.message);}finally{inflight=false;}},5000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[job?.jobId,job?.status,job?.registration?.state,scope]);
  async function upload(event){const file=event.target.files?.[0];if(!file)return;const own=++sequence.current,ownScope=scope;setBusy(true);setError('');setMessage('');setReview(null);setLinks({});setConfirmed(false);setDirty(false);
    try{if(file.size>25*1024*1024||!/\.zip$/i.test(file.name))throw Error('25MiB 이하 ZIP을 선택하세요.');const zipBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('ZIP을 읽지 못했습니다.'));reader.readAsDataURL(file);});
      const d=await call({action:'upload',year,major,zipBase64});if(own!==sequence.current||active.current!==ownScope)return;setJob(d.job);try{localStorage.setItem(storageKey,d.job.jobId);}catch{}await refresh(d.job.jobId,ownScope);setMessage('ZIP 접수 완료. 첫 페이지 판독 후 확실한 정산서는 자동등록합니다. 검토가 필요한 문서만 확인하세요.');
    }catch(e){if(own===sequence.current&&active.current===ownScope)setError(e.message);}finally{if(own===sequence.current&&active.current===ownScope)setBusy(false);}}
  async function run(action){const own=++sequence.current,ownScope=scope;setBusy(true);setError('');setMessage('');try{
    const d=await call({action,year,major,jobId:job.jobId,selectedHashes:selected,links,reviewDigest:review?.reviewDigest,confirmed});if(own!==sequence.current||active.current!==ownScope)return;
    if(d.review){setReview(d.review);setDirty(false);setConfirmed(false);}if(action!=='preview'){setMessage(d.message||'자동등록 상태를 다시 확인했습니다.');await refresh(job.jobId,ownScope);}
  }catch(e){if(own===sequence.current&&active.current===ownScope){setError(e.message);setConfirmed(false);setDirty(true);}}finally{if(own===sequence.current&&active.current===ownScope)setBusy(false);}}
  const rows=review?.rows||[],registered=rows.filter(r=>r.status==='registered'),needs=rows.filter(r=>['review','confirmation'].includes(r.status)),blocked=rows.filter(r=>['blocked','ocr_review'].includes(r.status));
  const pending=job?.status==='QUEUED'||job?.status==='REVIEW_READY'&&job.registration?.state!=='DONE';
  const change=()=>{sequence.current++;setDirty(true);setConfirmed(false);};
  return <section aria-label="선율 정산 ZIP 연결" style={{border:'1px solid #cbd5e1',borderRadius:8,padding:16,marginBottom:16,background:'#f8fafc'}}>
    <h3 style={{marginTop:0}}>관세법인 선율 정산 ZIP 자동등록</h3>
    <p>{year}년 정산서를 판독한 뒤 실제 활성 입고의 AWB·차수에 연결합니다. ZIP명은 귀속 근거가 아닙니다. 선택 {major}차와 다른 차수나 합산 입고는 확인이 필요합니다.</p>
    <p>검산된 실제 원천은 공급가·VAT를 구분하여 계산에 우선 사용합니다. 기존 DB 입력·입고·출고·재고는 변경하지 않습니다. 수입 부가세는 비용에서 제외하고 검역대행을 한국방역비에 중복 등록하지 않습니다.</p>
    <label>정산 PDF가 들어 있는 ZIP <input ref={input} type="file" accept=".zip,application/zip" disabled={busy} onChange={upload}/></label>
    <p>각 PDF 첫 1페이지만 판독합니다. 같은 페이지 확대 재판독·식별번호 작은 영역 보완만 수행하며 뒤 페이지 전체 판독·유료 분석은 하지 않습니다.</p>
    <WorkflowGuide workflowId="customs-settlement-zip"/>
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}{message&&<p role="status">{message}</p>}
    {job&&<>
      <p role="status">첫 페이지 확인 {job.completed}/{job.total} PDF · 원천 등록 완료 {registered.length}건 · 귀속·차액 검토 {needs.length}건 · 판독 보류·차단 {blocked.length}건</p>
      {pending&&<p>{worker?.connected?'전용 OCR 워커 연결 확인 · 판독/자동등록 대기':'판독 대기 · OCR 연결 확인 필요 — 담당 PC 워커를 켜세요. 완료로 처리하지 않습니다.'} 새로고침해도 같은 작업을 이어서 확인합니다.</p>}
      {job.status==='EXPIRED'&&<p role="alert">작업이 만료되었습니다. 워커 연결을 확인한 뒤 같은 ZIP을 다시 선택하세요. 원본 PDF는 만료 시 삭제되며 기존 등록은 보존됩니다.</p>}
      {job.status==='REVIEW_READY'&&job.registration?.state!=='DONE'&&<button type="button" disabled={busy} onClick={()=>run('resume')}>자동등록 상태 재확인·재시도</button>}
      {registered.length>0&&<p style={{color:'#0369a1'}}>등록 완료 대상: {[...new Set(registered.map(r=>`${r.year}년 ${r.major}차`))].join(', ')}. 저장된 매출자료는 해당 차수에서 직접 갱신해야 합니다. 확정·과거 계산본은 자동 변경하지 않습니다.</p>}
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th>검토 선택</th><th>정산서</th><th>원문 비용(공급가 / VAT / 합계)</th><th>등록·귀속</th></tr></thead><tbody>
        {job.files.map((file,i)=>{const r=rows.find(r=>r.sourceHash===file.sourceHash),done=r?.status==='registered';return <tr key={file.sourceHash}>
          <td><input aria-label={`정산서 ${i+1} 선택`} type="checkbox" disabled={busy||pending||file.status!=='READY'||done||r?.status==='blocked'} checked={selected.includes(file.sourceHash)} onChange={e=>{setSelected(p=>e.target.checked?[...p,file.sourceHash]:p.filter(h=>h!==file.sourceHash));change();}}/></td>
          <td>{file.receipt?<>{file.receipt.awb}<br/>{file.receipt.documentId}<br/>입항일 {file.receipt.date}</>:<>문서 {i+1} · 파일명 참고 AWB {file.hint?.awb||'미확인'} {file.hint?.part?`분할 ${file.hint.part}`:''}</>}</td>
          <td>{file.receipt?.charges.map(c=><div key={c.code}>{chargeLabel[c.code]}: {format(c.net)} / {format(c.vat)} / {format(c.total)}{c.vatSource==='VAT_DERIVED_FROM_NET_TOTAL'&&<strong> · VAT는 공급가·합계 차액 검산값</strong>}</div>)}</td>
          <td>{done?`등록 완료 · ${r.major}차 ${targetLabel(r.targetKey)}`:r?.reason||file.error||'판독 대기'}
            {r?.suggestions?.length>0&&!done&&<label><br/>실제 입고 선택 <select aria-label={`정산서 ${i+1} 입고 선택`} value={links[file.sourceHash]||''} disabled={busy||pending} onChange={e=>{setLinks(p=>({...p,[file.sourceHash]:e.target.value}));change();}}><option value="">자동 추정하지 않음 — 선택하세요</option>{r.suggestions.map(c=><option key={c.matchId} value={c.matchId}>{c.year}년 {c.orderWeek} · {targetLabel(c.targetKey)} · AWB {c.awb}</option>)}</select></label>}
            {links[file.sourceHash]&&file.receipt&&<div>합산 검산 원문: {file.receipt.currency||'통화 미확인'} {format(file.receipt.foreignAmount)} / GW {format(file.receipt.grossWeight)}kg. 여러 신고서를 선택하면 합계로 대조합니다.</div>}
          </td></tr>;})}
      </tbody></table></div>
      {needs.length>0&&<button type="button" disabled={busy||pending||!selected.length} onClick={()=>run('preview')}>검토 선택건 귀속·금액 재검증</button>}
    </>}
    {review?.groups?.map(group=><div key={group.major}><h4>{group.year}년 {group.major}차 실제 원천</h4>{group.plan.patches.map((p,i)=><p key={i}>{targetLabel(p.targetKey)} · {fieldLabel(p.field)}: DB 원문 {format(p.current)}원 / 실제 원천 {format(p.amount)}원{p.basis==='gross'?`(VAT 포함, 비용 공급가 ${format(p.netAmount)}원)`:'(공급가 또는 세금)'} · {({covered:'기존 동일액·실제 원천 보존',basis_reconciled:'원문 net/gross 표현 차이 검산 일치',link:'등록 가능',conflict:'차액 확인 후 실제 원천 우선'})[p.status]}</p>)}</div>)}
    {needs.length>0&&review?.groups?.some(g=>g.plan.documents.some(d=>d.status==='new'))&&<div>
      <label><input aria-label="검토 원천 우선 반영 확인" type="checkbox" disabled={busy||pending||dirty} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 귀속·금액·차이를 확인했으며 DB 원문을 보존하고 실제 정산 원천을 우선 사용합니다. 저장 매출자료는 직접 갱신합니다.</label>{' '}
      <button type="button" disabled={busy||pending||dirty||!confirmed} onClick={()=>run('apply')}>확인한 검토건 등록</button>
    </div>}
    <p>정산서가 증명하는 관세·통관수수료·검역대행만 등록합니다. 별도 증빙이 없는 백상창고료·국내운송·한국방역 지출까지 100% 인증하지 않습니다. 원천 등록과 「계산본 생성·갱신」은 별개입니다.</p>
  </section>;
}
