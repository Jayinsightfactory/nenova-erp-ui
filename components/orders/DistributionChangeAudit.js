import {useEffect,useRef,useState} from 'react';

const STATUS_LABEL={MATCHING_HISTORY:'동일 변동 이력',PARTIAL_HISTORY:'일부 이력',NEEDS_REVIEW:'확인 필요',NO_MATCHING_HISTORY:'확인 필요',AMBIGUOUS:'확인 필요'};
const ACTION_LABEL={ADD:'추가',CANCEL:'취소'};

export function shortAuditWeek(year,fullWeek) {
  const match=/^(\d{4})-(\d{2}-\d{2})$/.exec(String(fullWeek||''));
  return match&&match[1]===String(year||'')?match[2]:null;
}

function errorText(value,fallback) {
  if(typeof value==='string') return value;
  if(typeof value?.message==='string') return value.message;
  return fallback;
}

function resultText(value) {
  return typeof value==='string'?value:value?.reasonKorean||value?.reason||value?.message||'';
}

function selectedPayload(messages) {
  return messages.map(message=>({identity:message.identity,message:message.message,created_at:message.created_at,timestamp_approximate:message.timestamp_approximate}));
}

function alignedFindings(audit) {
  return audit.findings.map((finding,index)=>({finding,request:audit.requests[index]||null}));
}

function quoteFor(request) {
  return request?.quote||request?.sourceQuote||request?.message||request?.sourceText||'원문 인용이 없습니다.';
}

function candidateEventsFor(finding) {
  return Array.isArray(finding?.evidence?.candidateEvents)?finding.evidence.candidateEvents:[];
}

function validReport(report) {
  return !!report&&report.advisoryOnly===true&&report.scope&&typeof report.scope==='object'&&Array.isArray(report.findings)&&Array.isArray(report.requests)&&Array.isArray(report.unresolved)&&Array.isArray(report.warnings);
}

export default function DistributionChangeAudit({year,week,messages=[],disabled}) {
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[combined,setCombined]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[audit,setAudit]=useState(null);
  const [historyItems,setHistoryItems]=useState([]),[historyBusy,setHistoryBusy]=useState(false),[historyError,setHistoryError]=useState(''),[snapshotLabel,setSnapshotLabel]=useState('');
  const shortWeek=shortAuditWeek(year,week);
  const combinedAvailable=shortWeek?.endsWith('-02');
  const tooMany=messages.length>50;
  const selectionKey=messages.map(message=>`${message.identity}\u001f${message.created_at||''}`).join('\u001e');
  const contextKey=`${String(year||'')}:${String(week||'')}:${selectionKey}`;
  const activeContext=useRef(contextKey);
  activeContext.current=contextKey;

  useEffect(()=>{if(!combinedAvailable)setCombined(false);},[combinedAvailable]);
  useEffect(()=>{setAudit(null);setError('');setBusy(false);setHistoryItems([]);setHistoryError('');setHistoryBusy(false);setSnapshotLabel('');},[contextKey]);
  useEffect(()=>()=>{activeContext.current='unmounted';},[]);

  async function runAudit() {
    setError('');setAudit(null);
    if(!shortWeek) {setError('비교를 실행하려면 선택 연도와 전체 차수가 일치해야 합니다.');return;}
    if(!from||!to) {setError('비교할 시작일과 종료일을 선택해 주세요.');return;}
    if(from>to) {setError('종료일은 시작일보다 빠를 수 없습니다.');return;}
    if(!messages.length) {setError('비교할 대화 원문을 선택해 주세요.');return;}
    if(tooMany) {setError('한 번에 최대 50개 원문만 비교할 수 있습니다. 선택을 줄여 주세요.');return;}
    const runContext=contextKey;
    setBusy(true);
    const payload={year:String(year),week:shortWeek,combined:Boolean(combined),from,to,messages:selectedPayload(messages)};
    try {
      const response=await fetch('/api/orders/distribution-change-audit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      const data=await response.json().catch(()=>null);
      if(activeContext.current!==runContext) return;
      if(!response.ok) {setError(errorText(data?.error,'카톡 변경사항을 비교하지 못했습니다. 선택 원문은 유지됩니다.'));return;}
      if(data?.success!==true||!validReport(data)) {
        setError('비교 응답 형식이 올바르지 않습니다. 기존 작업에는 영향을 주지 않습니다.');return;
      }
      setAudit(data);
      setSnapshotLabel(data.snapshot?.id?`비교 결과 저장됨 · ${data.snapshot.createdAt}`:'');
    } catch {if(activeContext.current===runContext)setError('카톡 변경사항을 비교하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.');}
    finally {if(activeContext.current===runContext)setBusy(false);}
  }

  async function loadHistory() {
    setHistoryError('');
    if(!shortWeek) {setHistoryError('이전 비교 결과를 보려면 선택 연도와 전체 차수가 일치해야 합니다.');return;}
    const runContext=contextKey;
    setHistoryBusy(true);
    try {
      const response=await fetch(`/api/orders/distribution-change-audits?${new URLSearchParams({year:String(year),week:shortWeek})}`);
      const data=await response.json().catch(()=>null);
      if(activeContext.current!==runContext) return;
      if(!response.ok||!Array.isArray(data?.items)) {setHistoryError(errorText(data?.error,'이전 비교 결과를 불러오지 못했습니다.'));return;}
      setHistoryItems(data.items.filter(item=>item&&typeof item.id==='string'));
    } catch {if(activeContext.current===runContext)setHistoryError('이전 비교 결과를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.');}
    finally {if(activeContext.current===runContext)setHistoryBusy(false);}
  }

  async function restoreHistory(id) {
    const runContext=contextKey;
    setHistoryError('');setHistoryBusy(true);
    try {
      const response=await fetch(`/api/orders/distribution-change-audits?${new URLSearchParams({year:String(year),week:shortWeek,id})}`);
      const data=await response.json().catch(()=>null);
      if(activeContext.current!==runContext) return;
      if(!response.ok||!data?.audit||typeof data.audit.id!=='string'||!validReport(data.audit.report)) {setHistoryError(errorText(data?.error,'저장된 비교 결과를 열지 못했습니다.'));return;}
      setAudit(data.audit.report);
      setSnapshotLabel(`저장된 비교 결과 · ${data.audit.createdAt||'저장 시각 확인 필요'}`);
    } catch {if(activeContext.current===runContext)setHistoryError('저장된 비교 결과를 열지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.');}
    finally {if(activeContext.current===runContext)setHistoryBusy(false);}
  }

  return <section className="change-audit" aria-label="카톡 변경사항 비교">
    <div className="audit-head"><strong>카톡 변경사항 비교</strong><span>참고용 · 실제 적용·완료 여부를 판단하거나 기존 작업을 막지 않습니다.</span></div>
    <div className="audit-controls">
      <label>시작일 <input type="date" value={from} disabled={busy||disabled} onChange={event=>setFrom(event.target.value)}/></label>
      <label>종료일 <input type="date" value={to} disabled={busy||disabled} onChange={event=>setTo(event.target.value)}/></label>
      {combinedAvailable&&<label className="combined"><input type="checkbox" checked={combined} disabled={busy||disabled} onChange={event=>setCombined(event.target.checked)}/> 01·02 전산 함께 비교</label>}
      <button type="button" disabled={busy||disabled||!shortWeek||!from||!to||!messages.length||tooMany} onClick={runAudit}>{busy?'비교 중…':`선택 ${messages.length}건 전산 이력과 비교`}</button>
      <button type="button" disabled={historyBusy||disabled||!shortWeek} onClick={loadHistory}>{historyBusy?'불러오는 중…':'이전 비교 결과'}</button>
      <span className="audit-count">최대 50건 · 현재 {messages.length}건</span>
    </div>
    <p className="audit-note">이 결과는 원문과 이력의 동일 증거를 보여 주는 자문일 뿐입니다. 수동 검토 상태는 별도 체크리스트에서 관리합니다.</p>
    {tooMany&&<p className="audit-error" role="status">한 번에 최대 50개 원문만 비교할 수 있습니다.</p>}
    {error&&<p className="audit-error" role="status">{error}</p>}
    {historyError&&<p className="audit-error" role="status">{historyError}</p>}
    {historyItems.length>0&&<div className="audit-history" aria-label="이전 비교 결과 목록">{historyItems.map(item=><button type="button" key={item.id} disabled={historyBusy||disabled} onClick={()=>restoreHistory(item.id)}>{item.createdAt||'저장 시각 확인 필요'} 비교 결과 열기</button>)}</div>}
    {audit&&<div className="audit-results" aria-live="polite">
      {snapshotLabel&&<p className="snapshot-label" role="status">{snapshotLabel}</p>}
      <p className="audit-note">분석 {audit.requests.length}건 · 기준 시각 {audit.asOf||audit.scope.asOf||'응답에 없음'} · 자문 결과이며 기존 분석·등록·분배·확정 흐름은 계속 사용할 수 있습니다.</p>
      <div className="audit-request-list">{alignedFindings(audit).map(({finding,request},index)=><article className="audit-request" key={`${finding?.id||finding?.sourceIdentity||request?.id||request?.sourceIdentity||'finding'}:${index}`}>
        <strong>{STATUS_LABEL[finding?.status]||'확인 필요'}</strong><span>{resultText(finding)||'이력 증거를 추가로 확인해 주세요.'}</span>
        <div className="audit-request-data"><span>요청 {request?.customerText||'업체 확인 필요'} · {request?.productText||'품목 확인 필요'} · {ACTION_LABEL[request?.action]||'변경'} {request?.inputQty??request?.qty??'?'} {request?.inputUnit||request?.unit||''}</span><span>요청 차수 {request?.week||request?.requestedWeek||audit.scope.week||'확인 필요'}</span><blockquote>{quoteFor(request)}</blockquote>{candidateEventsFor(finding).length>0&&<details><summary>이력 근거 {candidateEventsFor(finding).length}건 보기</summary>{candidateEventsFor(finding).map((event,index)=><div className="candidate-event" key={`${event.changeAt||'time'}:${event.week||'week'}:${index}`}>{event.before??'?'} → {event.after??'?'} · 차수 {event.week||'확인 필요'} · 출고일 {event.shipmentDate||'확인 필요'} · 단위 {event.unit||'확인 필요'} · 변경 시각 {event.changeAt||'확인 필요'}</div>)}</details>}</div>
        {Array.isArray(finding?.candidateEventIds)&&finding.candidateEventIds.length>0&&<small>참고 이력 {finding.candidateEventIds.join(', ')}</small>}
      </article>)}{!audit.findings.length&&<p className="audit-note">요청별 자문 결과가 없습니다.</p>}</div>
      {[['추가 확인',audit.unresolved],['경고',audit.warnings]].map(([title,items])=>items.length>0&&<div className="audit-extra" key={title}><strong>{title}</strong><ul>{items.map((item,index)=><li key={index}>{item?.quote&&<span style={{whiteSpace:'pre-wrap'}}>“{item.quote}” · </span>}{resultText(item)||'내용을 확인해 주세요.'}</li>)}</ul></div>)}
    </div>}
    <style jsx>{`.change-audit{border:1px solid #c8d9e7;background:#fbfdff;margin:8px 0;font-size:12px}.audit-head,.audit-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:5px 7px}.audit-head{border-bottom:1px solid #dce8f1}.audit-head strong{color:#294f73}.audit-head span,.audit-note,.audit-count{color:#5c7286}.audit-controls label{display:flex;gap:4px;align-items:center}.audit-controls input{font:inherit}.audit-controls button,.audit-history button{font:inherit;background:#fff;border:1px solid #9db2ca;padding:4px 8px;color:#245b93;cursor:pointer;min-height:27px}.audit-controls button:disabled,.audit-history button:disabled{opacity:.55;cursor:not-allowed}.combined{color:#435d75}.audit-note,.audit-error,.snapshot-label{margin:5px 7px}.audit-error{color:#a33b28}.snapshot-label{color:#28587d;font-weight:600}.audit-history{display:flex;gap:5px;flex-wrap:wrap;padding:5px 7px;border-top:1px solid #e4edf4}.audit-results{border-top:1px solid #dce8f1}.audit-request-list{max-height:250px;overflow:auto}.audit-request{display:grid;grid-template-columns:108px minmax(260px,1fr);gap:5px 8px;padding:6px 7px;border-top:1px solid #e4edf4}.audit-request strong{color:#385f7d}.audit-request>span{color:#43576a}.audit-request-data{grid-column:2;display:grid;gap:3px;color:#4a6176}.audit-request-data blockquote{margin:1px 0;padding:3px 6px;border-left:2px solid #bfd1e0;background:#f5f8fb;white-space:pre-wrap;overflow-wrap:anywhere;color:#52677b}.audit-request-data details{padding:3px 0}.audit-request-data summary{cursor:pointer;color:#28587d}.candidate-event{padding:3px 5px;margin:3px 0;background:#f5f8fb;overflow-wrap:anywhere}.audit-request small{grid-column:2;color:#6a7d8e;overflow-wrap:anywhere}.audit-extra{padding:5px 7px;border-top:1px solid #e4edf4;color:#4a6176}.audit-extra ul{margin:3px 0 0;padding-left:18px}@media(max-width:900px){.audit-request{grid-template-columns:1fr}.audit-request-data,.audit-request small{grid-column:auto}}`}</style>
  </section>;
}
