import {useEffect,useRef,useState} from 'react';

export const CHECKLIST_STATUSES=['PENDING','REVIEWED','NOT_NEEDED','LATER'];
const STATUS_LABELS={PENDING:'미확인',REVIEWED:'확인완료',NOT_NEEDED:'처리불필요',LATER:'나중에확인'};

function errorText(error,fallback) {
  return typeof error==='string'?error:error?.message||fallback;
}

export function shortChecklistWeek(year,fullWeek) {
  const match=/^(\d{4})-(\d{2}-\d{2})$/.exec(String(fullWeek||''));
  return match&&match[1]===String(year||'')?match[2]:null;
}

function reviewMap(data) {
  return data.reviews.reduce((map,row)=>row&&typeof row.sourceIdentity==='string'?{...map,[row.sourceIdentity]:row}:map,{});
}

function requestId() {
  return globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function'?globalThis.crypto.randomUUID():'';
}

export default function DistributionChecklistReview({year,week,messages=[],totalMessages=0,disabled}) {
  const [reviews,setReviews]=useState({}),[drafts,setDrafts]=useState({}),[openRows,setOpenRows]=useState({});
  const [loading,setLoading]=useState(false),[loadError,setLoadError]=useState(''),[saving,setSaving]=useState({}),[saveErrors,setSaveErrors]=useState({});
  const loadSequence=useRef(0);
  const mounted=useRef(false),activeScope=useRef('');
  const shortWeek=shortChecklistWeek(year,week);
  const scopeKey=`${String(year||'')}:${String(week||'')}`;

  useEffect(()=>{
    mounted.current=true;activeScope.current=scopeKey;
    return ()=>{mounted.current=false;};
  },[scopeKey]);

  useEffect(()=>{
    const sequence=++loadSequence.current;
    setReviews({});setLoadError('');
    if(!year&&!week) return undefined;
    if(!shortWeek) {setLoadError('체크리스트를 불러오려면 선택 연도와 전체 차수가 일치해야 합니다.');return undefined;}
    setLoading(true);
    fetch(`/api/orders/distribution-checklist?${new URLSearchParams({year:String(year),week:shortWeek})}`)
      .then(async response=>({ok:response.ok,data:await response.json().catch(()=>({}))}))
      .then(({ok,data})=>{
        if(sequence!==loadSequence.current) return;
        if(!ok) {setLoadError(errorText(data.error,'체크리스트 저장 내용을 불러오지 못했습니다.'));return;}
        if(!Array.isArray(data.reviews)) {setLoadError('체크리스트 응답 형식이 올바르지 않습니다.');return;}
        setReviews(reviewMap(data));
      })
      .catch(()=>{if(sequence===loadSequence.current)setLoadError('체크리스트 저장 내용을 불러오지 못했습니다.');})
      .finally(()=>{if(sequence===loadSequence.current)setLoading(false);});
    return ()=>{loadSequence.current++;};
  },[year,week,shortWeek]);

  function currentReview(identity) {
    return drafts[identity]||reviews[identity]||{status:'PENDING',memo:''};
  }
  function updateDraft(identity,patch) {
    setDrafts(previous=>{
      const current=previous[identity]||reviews[identity]||{status:'PENDING',memo:''};
      return {...previous,[identity]:{...current,...patch,requestId:undefined}};
    });
    setSaveErrors(previous=>({...previous,[identity]:''}));
  }
  async function save(identity) {
    const draft=currentReview(identity);
    const id=draft.requestId||requestId();
    if(!id) {setSaveErrors(previous=>({...previous,[identity]:'저장 요청 ID를 만들 수 없습니다. 메모는 유지되며 다시 시도할 수 있습니다.'}));return;}
    const payload={year:String(year),week:shortWeek,sourceIdentity:identity,status:draft.status,memo:String(draft.memo||'').slice(0,1000),requestId:id};
    const saveScope=activeScope.current;
    setDrafts(previous=>({...previous,[identity]:{...draft,requestId:id}}));setSaving(previous=>({...previous,[identity]:true}));setSaveErrors(previous=>({...previous,[identity]:''}));
    try {
      const response=await fetch('/api/orders/distribution-checklist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const data=await response.json().catch(()=>({}));
      if(!mounted.current||activeScope.current!==saveScope) return;
      if(!response.ok) {setSaveErrors(previous=>({...previous,[identity]:errorText(data.error,'저장하지 못했습니다. 메모는 유지됩니다. 다시 시도하세요.')}));return;}
      if(!data.review||typeof data.review.sourceIdentity!=='string'||data.review.sourceIdentity!==identity||!CHECKLIST_STATUSES.includes(data.review.status)) {setSaveErrors(previous=>({...previous,[identity]:'저장 응답 형식이 올바르지 않습니다. 메모는 유지됩니다. 다시 시도하세요.'}));return;}
      setReviews(previous=>({...previous,[identity]:data.review}));
      setDrafts(previous=>{const next={...previous};delete next[identity];return next;});
    } catch {if(mounted.current&&activeScope.current===saveScope)setSaveErrors(previous=>({...previous,[identity]:'저장하지 못했습니다. 메모는 유지됩니다. 다시 시도하세요.'}));}
    finally {if(mounted.current&&activeScope.current===saveScope)setSaving(previous=>({...previous,[identity]:false}));}
  }

  return <section className="checklist" aria-label="원문 확인 체크리스트">
    <div className="checklist-head"><strong>원문 수동 확인 목록</strong><span>사용자 확인·메모 · 전산 자동 대조 결과와 별개</span>{loading&&<span>저장 내용 불러오는 중…</span>}</div>
    <p className="continue-note">참고용 체크리스트 · 미확인 항목이 있어도 등록·분배·확정 작업은 계속할 수 있습니다.</p>
    {loadError&&<p className="checklist-error" role="status">{loadError}</p>}
    {totalMessages>messages.length&&<p className="checklist-note">현재 불러온 원문 중 처음 {messages.length}건만 검토 목록에 표시합니다.</p>}
    <div className="checklist-list">{messages.map(message=>{
      const identity=message.identity;
      const review=currentReview(identity);
      const expanded=!!openRows[identity];
      const busy=!!saving[identity];
      return <div className="checklist-row" key={identity}>
        <button type="button" className="review-toggle" aria-expanded={expanded} onClick={()=>setOpenRows(previous=>({...previous,[identity]:!previous[identity]}))}>
          검토 {expanded?'닫기':'열기'}
        </button>
        <span className={`review-status status-${review.status}`}>{STATUS_LABELS[review.status]||STATUS_LABELS.PENDING}</span><span className="machine-state">사용자 확인 상태</span>
        <small>{message.sender||'보낸이 확인 필요'} · {message.created_at||'시각 확인 필요'}</small>
        {expanded&&<div className="review-form">
          <div className="review-text">{message.message||'원문 없음'}</div>
          <label>수동 상태 <select value={CHECKLIST_STATUSES.includes(review.status)?review.status:'PENDING'} disabled={disabled||busy} onChange={event=>updateDraft(identity,{status:event.target.value})}>{CHECKLIST_STATUSES.map(status=><option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
          <label className="memo">메모 <textarea value={review.memo||''} maxLength={1000} disabled={disabled||busy} onChange={event=>updateDraft(identity,{memo:event.target.value.slice(0,1000)})}/><small>{String(review.memo||'').length}/1000</small></label>
          <button type="button" disabled={disabled||busy||!shortWeek} onClick={()=>save(identity)}>{busy?'저장 중…':'검토 상태 저장'}</button>
          {saveErrors[identity]&&<p className="checklist-error" role="status">{saveErrors[identity]}</p>}
        </div>}
      </div>;
    })}{!messages.length&&<p className="checklist-note">먼저 현재 영업방 원문을 불러오면 이 목록에서 수동 검토를 기록할 수 있습니다.</p>}</div>
    <style jsx>{`.checklist{border:1px solid #c6d5e4;background:#fbfdff;margin:8px 0;font-size:12px}.checklist-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:5px 7px;border-bottom:1px solid #dce7f1}.checklist-head strong{color:#294f73}.checklist-head span,.checklist-note{color:#5c7286}.continue-note{margin:5px 7px;color:#425d76;font-weight:600}.checklist-error{margin:5px 7px;color:#a33b28}.checklist-list{max-height:260px;overflow:auto}.checklist-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:5px 7px;border-top:1px solid #e3ebf2}.review-toggle,.review-form button{font:inherit;background:#fff;border:1px solid #9db2ca;padding:3px 7px;color:#245b93;cursor:pointer}.review-toggle:disabled,.review-form button:disabled{opacity:.55;cursor:not-allowed}.review-status,.machine-state{border-radius:9px;padding:1px 6px;background:#edf1f5;color:#43576a}.machine-state{background:#f4f5f7;color:#66727d}.status-REVIEWED{background:#e8f0f8;color:#28587d}.status-NOT_NEEDED,.status-LATER{background:#f1f3f5;color:#596673}.checklist-row>small{color:#687b8d}.review-form{width:100%;display:grid;grid-template-columns:minmax(240px,1fr) auto minmax(220px,1fr) auto;gap:6px;align-items:start;padding:5px;background:#f5f9fc;border-top:1px dashed #cbd9e6}.review-text{max-height:54px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#43576a}.review-form label{display:flex;gap:4px;align-items:flex-start}.memo{display:grid!important;grid-template-columns:auto 1fr auto}.memo textarea{min-height:42px;resize:vertical;font:inherit}.memo small{color:#687b8d}@media(max-width:900px){.review-form{grid-template-columns:1fr}.memo{grid-template-columns:auto 1fr auto}}`}</style>
  </section>;
}
