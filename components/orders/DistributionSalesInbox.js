import {useEffect,useRef,useState} from 'react';
import {MAX_TEXT_BYTES,periodBounds,parseSalesExport,mergeMessages,selectedText} from '../../lib/distributionSalesInbox';
import {DEFAULT_MAX_PAGES,isAutoRefreshEligible,isCurrentRefresh,kstCalendarDate,messageIdentity,readSalesFeedPage,refreshSalesFeed,shouldBufferIncoming,startBoundedAutoRefresh} from '../../lib/distributionSalesInboxRefresh';
import DistributionChecklistReview from './DistributionChecklistReview';
import DistributionChangeAudit from './DistributionChangeAudit';

const MANUAL_APPLICATION_STATUSES=['MANUALLY_APPLIED','MANUALLY_NOT_APPLIED','CLEAR'];
const MANUAL_APPLICATION_LABELS={MANUALLY_APPLIED:'적용됨 · 수동 확인',MANUALLY_NOT_APPLIED:'미적용 · 수동 확인',CLEAR:'적용 미확인 · 표시 해제'};

function shortApplicationWeek(year,fullWeek) {
  const match=/^(\d{4})-(\d{2}-\d{2})$/.exec(String(fullWeek||''));
  return match&&match[1]===String(year||'')?match[2]:null;
}

function byIdentity(items) {
  return Array.isArray(items)?items.reduce((result,item)=>item&&typeof item.sourceIdentity==='string'?{...result,[item.sourceIdentity]:item}:result,{}):{};
}

function applicationError(data,fallback) {
  return typeof data?.error==='string'?data.error:typeof data?.error?.message==='string'?data.error.message:fallback;
}

function shortKstTime(value) {
  const time=Date.parse(value);
  return Number.isFinite(time)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(time)):'시각 확인 필요';
}

export default function DistributionSalesInbox({year,week,disabled,onLoadText}) {
  const [open,setOpen]=useState(true),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [rows,setRows]=useState([]),[selected,setSelected]=useState({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [cursor,setCursor]=useState(''),[more,setMore]=useState(false),[loadedPeriod,setLoadedPeriod]=useState('');
  const seq=useRef(0);
  const [reviewPage,setReviewPage]=useState(0),[reviewOpen,setReviewOpen]=useState(false),[reviewMounted,setReviewMounted]=useState(false);
  const [autoRefresh,setAutoRefresh]=useState(true),[pendingRows,setPendingRows]=useState([]),[refreshStatus,setRefreshStatus]=useState({lastSuccess:'',error:'',incomplete:false,newCount:0,autoShown:0,loading:false});
  const [manualApplications,setManualApplications]=useState({}),[auditApplications,setAuditApplications]=useState({}),[applicationStatus,setApplicationStatus]=useState({loading:false,error:'',limit:20,asOf:'',loaded:false});
  const [applicationDrafts,setApplicationDrafts]=useState({}),[applicationSaving,setApplicationSaving]=useState({}),[applicationErrors,setApplicationErrors]=useState({});
  const requestBusy=useRef(false),requestOwner=useRef(''),refreshSeq=useRef(0),activeRefreshScope=useRef(''),refreshController=useRef(null),rowsRef=useRef(rows),pendingRowsRef=useRef(pendingRows),selectedRef=useRef(selected),reviewOpenRef=useRef(reviewOpen);
  useEffect(()=>{rowsRef.current=rows;},[rows]);
  useEffect(()=>{pendingRowsRef.current=pendingRows;},[pendingRows]);
  useEffect(()=>{selectedRef.current=selected;},[selected]);
  useEffect(()=>{reviewOpenRef.current=reviewOpen;},[reviewOpen]);
  useEffect(()=>{const today=kstCalendarDate();setFrom(previous=>previous||today);setTo(previous=>previous||today);},[]);
  const lastReviewPage=Math.max(0,Math.ceil(rows.length/200)-1);
  const currentReviewPage=Math.min(reviewPage,lastReviewPage);
  const count=rows.filter(r=>selected[r.identity]).length;
  const displayRows=[...rows].reverse();
  const applicationWeek=shortApplicationWeek(year,week);
  const applicationScope=`${String(year||'')}:${String(applicationWeek||'')}`;
  const applicationSequence=useRef(0),activeApplicationScope=useRef(applicationScope),applicationMounted=useRef(false),applicationController=useRef(null),applicationInFlight=useRef(false),applicationSaveController=useRef(null),applicationSaveInFlight=useRef(false),applicationScopeEpoch=useRef(0),applicationSaveAttempt=useRef(0),applicationRefreshQueued=useRef(null);
  useEffect(()=>{applicationMounted.current=true;activeApplicationScope.current=applicationScope;applicationScopeEpoch.current++;applicationRefreshQueued.current=null;return()=>{applicationMounted.current=false;applicationController.current?.abort();applicationSaveController.current?.abort();applicationController.current=null;applicationSaveController.current=null;applicationInFlight.current=false;applicationSaveInFlight.current=false;};},[applicationScope]);
  async function loadRemote(next=false) {
    if(requestBusy.current) {setNotice('자동 확인이 끝난 뒤 다시 시도하세요.');return;}
    const id=++seq.current; setBusy(true); setNotice('');
    const owner=`manual:${id}`;requestBusy.current=true;requestOwner.current=owner;
    try {
      periodBounds(from,to);
      const period=`${from}/${to}`;
      const data=await readSalesFeedPage({from,to,afterKey:next&&period===loadedPeriod?cursor:''});
      if(id!==seq.current)return;
      const incoming=data.messages.map(r=>({...r,identity:messageIdentity(r)}));
      setRows(prev=>mergeMessages(period===loadedPeriod?prev:[],incoming).rows);
      if(period!==loadedPeriod) {setSelected({});setPendingRows([]);setRefreshStatus({lastSuccess:'',error:'',incomplete:false,newCount:0});}
      setCursor(data.nextAfterKey??'');setMore(data.hasMore);setLoadedPeriod(period);
      setNotice(`${incoming.length}건 확인 · 수신은 주문 등록 완료를 뜻하지 않습니다.`);
    } catch(e) {if(id===seq.current)setNotice(e.message);}
    finally {if(requestOwner.current===owner) {requestBusy.current=false;requestOwner.current='';}if(id===seq.current)setBusy(false);}
  }
  async function upload(e) {
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    const id=++seq.current;setBusy(true);setNotice('');
    try {
      if(!/\.txt$/i.test(file.name)||file.size>MAX_TEXT_BYTES)throw new Error('2MB 이하 카카오 내보내기 .txt 파일을 선택하세요.');
      const parsed=parseSalesExport(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
      const identified=await Promise.all(parsed.map(async r=>{
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode([r.source,r.chatroom,r.sender,r.created_at,r.message].join('\u001f')));
        return {...r,identity:`upload|${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`};
      }));
      if(id!==seq.current)return;
      setRows(previous=>mergeMessages(previous,identified).rows);
      setNotice(`${identified.length}건 읽음 · 같은 메시지 식별값은 중복 제외합니다. 서버 수신과 업로드 사이의 중복은 원문 확인이 필요합니다.`);
    } catch(e) {if(id===seq.current)setNotice(e.message||'파일을 읽지 못했습니다.');}
    finally {if(id===seq.current)setBusy(false);}
  }
  function changePeriod(set,value){seq.current++;set(value);setBusy(false);setMore(false);setCursor('');setPendingRows([]);setRefreshStatus({lastSuccess:'',error:'',incomplete:false,newCount:0,autoShown:0,loading:false});}
  function revealPending() {
    setRows(previous=>mergeMessages(previous,pendingRowsRef.current).rows);
    setPendingRows([]);setRefreshStatus(previous=>({...previous,newCount:0}));
  }
  async function refreshApplicationStatus(scope=applicationScope,{force=false}={}) {
    if(applicationSaveInFlight.current){applicationRefreshQueued.current={scope,force:true};return;}
    if(applicationInFlight.current&&!force)return;
    if(applicationInFlight.current&&force)applicationController.current?.abort();
    const sequence=++applicationSequence.current,epoch=applicationScopeEpoch.current;
    if(!applicationWeek) {
      setManualApplications({});setAuditApplications({});setApplicationStatus({loading:false,error:'선택 연도와 전체 차수가 일치해야 적용 표시를 읽을 수 있습니다.',limit:20,asOf:'',loaded:false});
      return;
    }
    const controller=new AbortController();let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},8000);applicationController.current=controller;applicationInFlight.current=true;
    setApplicationStatus(previous=>({...previous,loading:true,error:''}));
    try {
      const query=new URLSearchParams({year:String(year),week:applicationWeek});
      const [manualResponse,auditResponse]=await Promise.all([
        fetch(`/api/orders/distribution-manual-applications?${query}`,{signal:controller.signal}),
        fetch(`/api/orders/distribution-change-audits?${new URLSearchParams({year:String(year),week:applicationWeek,mode:'message-status'})}`,{signal:controller.signal}),
      ]);
      const [manualData,auditData]=await Promise.all([manualResponse.json().catch(()=>({})),auditResponse.json().catch(()=>({}))]);
      if(!applicationMounted.current||activeApplicationScope.current!==scope||epoch!==applicationScopeEpoch.current||sequence!==applicationSequence.current)return;
      const validManual=application=>application&&application.year===String(year)&&application.week===applicationWeek&&typeof application.sourceIdentity==='string'&&application.sourceIdentity.length>0&&typeof application.eventId==='string'&&/^[a-f0-9]{64}$/i.test(application.eventId)&&MANUAL_APPLICATION_STATUSES.includes(application.status)&&application.advisoryOnly===true&&application.erpAction==='NONE';
      const uniqueManual=new Set(Array.isArray(manualData.applications)?manualData.applications.map(application=>application?.sourceIdentity):[]);
      if(!manualResponse.ok||!Array.isArray(manualData.applications)||!manualData.applications.every(validManual)||uniqueManual.size!==manualData.applications.length) throw new Error(applicationError(manualData,'수동 적용 표시 응답 형식이 올바르지 않습니다.'));
      if(!auditResponse.ok||!Array.isArray(auditData.items)||!auditData.items.every(item=>item&&typeof item.sourceIdentity==='string'&&item.sourceIdentity.length>0&&item.advisoryOnly===true&&item.erpAction==='NONE')||auditData.advisoryOnly!==true||auditData.erpAction!=='NONE') throw new Error(applicationError(auditData,'저장된 비교 이력을 읽지 못했습니다.'));
      setManualApplications(byIdentity(manualData.applications));setAuditApplications(byIdentity(auditData.items));
      setApplicationStatus({loading:false,error:'',limit:Number.isInteger(auditData.limit)?auditData.limit:20,asOf:typeof auditData.asOf==='string'?auditData.asOf:'',loaded:true});
    } catch(error) { if(applicationMounted.current&&activeApplicationScope.current===scope&&epoch===applicationScopeEpoch.current&&sequence===applicationSequence.current&&(error?.name!=='AbortError'||timedOut))setApplicationStatus(previous=>({...previous,loading:false,error:timedOut?'적용 상태 조회가 8초 안에 끝나지 않았습니다. 기존 표시는 유지됩니다.':error.message||'적용 표시를 읽지 못했습니다. 기존 표시는 유지합니다.'})); }
    finally {clearTimeout(timeout);if(applicationController.current===controller){applicationController.current=null;applicationInFlight.current=false;}if(applicationMounted.current&&activeApplicationScope.current===scope&&epoch===applicationScopeEpoch.current&&sequence===applicationSequence.current)setApplicationStatus(previous=>({...previous,loading:false}));}
  }
  useEffect(()=>{setManualApplications({});setAuditApplications({});setApplicationDrafts({});setApplicationSaving({});setApplicationErrors({});setApplicationStatus({loading:false,error:'',limit:20,asOf:'',loaded:false});},[applicationScope]);
  useEffect(()=>{if(!open||!autoRefresh||disabled)return()=>{};const eligible=()=>document.visibilityState==='visible'&&navigator.onLine!==false;const run=()=>{if(eligible())refreshApplicationStatus(applicationScope);};run();const timer=setInterval(run,15000);return()=>{const controller=applicationController.current;clearInterval(timer);applicationSequence.current++;controller?.abort();if(applicationController.current===controller){applicationController.current=null;applicationInFlight.current=false;setApplicationStatus(previous=>({...previous,loading:false}));}};},[applicationScope,open,autoRefresh,disabled]);
  function updateApplicationDraft(identity,memo) {
    setApplicationDrafts(previous=>({...previous,[identity]:{memo:String(memo||'').slice(0,1000)}}));
    setApplicationErrors(previous=>({...previous,[identity]:''}));
  }
  async function saveManualApplication(identity,status) {
    if(!MANUAL_APPLICATION_STATUSES.includes(status)||!applicationWeek)return;
    if(applicationSaveInFlight.current){setApplicationErrors(previous=>({...previous,[identity]:'다른 수동 적용 저장이 끝난 뒤 다시 시도하세요.'}));return;}
    const previous=applicationDrafts[identity]||{};const statusChanged=previous.status&&previous.status!==status;
    const draft=statusChanged?{memo:previous.memo}:previous;
    const requestId=draft.requestId||(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function'?globalThis.crypto.randomUUID():'');
    if(!requestId) {setApplicationErrors(previous=>({...previous,[identity]:'저장 요청 ID를 만들 수 없습니다. 메모를 유지한 채 다시 시도할 수 있습니다.'}));return;}
    const retrying=typeof draft.requestId==='string'&&draft.requestId.length>0;
    const expectedCurrentEventId=retrying&&Object.prototype.hasOwnProperty.call(draft,'expectedCurrentEventId')?draft.expectedCurrentEventId:manualApplications[identity]?.eventId??null;
    const saveScope=applicationScope,saveEpoch=applicationScopeEpoch.current,attempt=++applicationSaveAttempt.current;
    const payload={year:String(year),week:applicationWeek,sourceIdentity:identity,status,memo:String(draft.memo??manualApplications[identity]?.memo??'').slice(0,1000),requestId,expectedCurrentEventId};
    setApplicationDrafts(previousDrafts=>({...previousDrafts,[identity]:{memo:payload.memo,requestId,status,expectedCurrentEventId}}));setApplicationSaving(previous=>({...previous,[identity]:true}));setApplicationErrors(previous=>({...previous,[identity]:''}));
    applicationSequence.current++;const priorApplicationController=applicationController.current;priorApplicationController?.abort();if(applicationController.current===priorApplicationController){applicationController.current=null;applicationInFlight.current=false;setApplicationStatus(previous=>({...previous,loading:false}));}applicationSaveInFlight.current=true;
    const controller=new AbortController();let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},18000);applicationSaveController.current=controller;let refreshAfterSave=false;
    try {
      const response=await fetch('/api/orders/distribution-manual-applications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      const data=await response.json().catch(()=>({}));
      if(!applicationMounted.current||activeApplicationScope.current!==saveScope||saveEpoch!==applicationScopeEpoch.current||attempt!==applicationSaveAttempt.current)return;
      if(!response.ok) {if(response.status===409&&data?.error?.code==='CURRENT_EVENT_CONFLICT'){setApplicationDrafts(previousDrafts=>({...previousDrafts,[identity]:{memo:payload.memo}}));setApplicationErrors(previous=>({...previous,[identity]:'다른 수동 표시가 먼저 저장되었습니다. 최신 상태를 확인한 뒤 다시 눌러 저장하세요.'}));refreshAfterSave=true;return;}if(response.status===409&&data?.error?.code==='REQUEST_ID_CONFLICT'){setApplicationDrafts(previousDrafts=>({...previousDrafts,[identity]:{memo:payload.memo,status}}));setApplicationErrors(previous=>({...previous,[identity]:'같은 요청 ID가 다른 내용으로 처리되었습니다. 메모와 상태는 유지했으며, 다시 누르면 새 요청 ID로 저장합니다.'}));return;}setApplicationErrors(previous=>({...previous,[identity]:applicationError(data,'저장하지 못했습니다. 메모와 재시도 ID는 유지됩니다.')}));return;}
      const application=data.application;
      if(!application||application.year!==String(year)||application.week!==applicationWeek||application.sourceIdentity!==identity||application.status!==status||application.advisoryOnly!==true||application.erpAction!=='NONE') {setApplicationErrors(previous=>({...previous,[identity]:'저장 응답 형식이 올바르지 않습니다. 메모와 재시도 ID는 유지됩니다.'}));return;}
      setManualApplications(previous=>({...previous,[identity]:application}));setApplicationDrafts(previous=>{const next={...previous};delete next[identity];return next;});refreshAfterSave=true;
    } catch(error) {if(applicationMounted.current&&activeApplicationScope.current===saveScope&&saveEpoch===applicationScopeEpoch.current&&attempt===applicationSaveAttempt.current)setApplicationErrors(previous=>({...previous,[identity]:timedOut?'수동 적용 저장이 18초 안에 끝나지 않았습니다. 메모와 재시도 ID는 유지됩니다. 다시 시도하세요.':'저장하지 못했습니다. 메모와 재시도 ID는 유지됩니다. 다시 시도하세요.'}));}
    finally {clearTimeout(timeout);let queued=null;if(applicationSaveController.current===controller){applicationSaveController.current=null;applicationSaveInFlight.current=false;queued=applicationRefreshQueued.current;applicationRefreshQueued.current=null;}if(applicationMounted.current&&activeApplicationScope.current===saveScope&&saveEpoch===applicationScopeEpoch.current&&attempt===applicationSaveAttempt.current){setApplicationSaving(previous=>({...previous,[identity]:false}));if(refreshAfterSave||queued?.scope===saveScope)refreshApplicationStatus(saveScope,{force:true});}}
  }
  function applicationPanel(row) {
    const manual=manualApplications[row.identity];
    const audit=auditApplications[row.identity];
    const draft=applicationDrafts[row.identity]||{};
    const saving=!!applicationSaving[row.identity];
    return <div className="application-panel" aria-label="원문 적용 상태와 이력">
      <div className="application-line"><strong>적용 상태</strong><span className={`application-status status-${manual?.status||'UNSET'}`}>{manual?MANUAL_APPLICATION_LABELS[manual.status]||'적용 미확인':'적용 미확인'}</span>{manual&&<small>{manual.author?.userName||manual.author?.userId||'사용자'} · {shortKstTime(manual.createdAt)}{manual.memo?` · ${manual.memo}`:''}</small>}</div>
      <small className="application-note">표시는 실제 등록·분배·취소를 실행하거나 확인하지 않습니다.</small>
      <div className="application-actions"><label>수동 메모 <input value={draft.memo??manual?.memo??''} maxLength={1000} disabled={disabled||saving} onChange={event=>updateApplicationDraft(row.identity,event.target.value)}/></label><button type="button" disabled={disabled||saving||!applicationWeek} onClick={()=>saveManualApplication(row.identity,'MANUALLY_APPLIED')}>{saving?'저장 중…':'수동 적용함'}</button><button type="button" disabled={disabled||saving||!applicationWeek} onClick={()=>saveManualApplication(row.identity,'MANUALLY_NOT_APPLIED')}>미적용 표시</button><button type="button" disabled={disabled||saving||!applicationWeek} onClick={()=>saveManualApplication(row.identity,'CLEAR')}>표시 해제</button></div>
      {applicationErrors[row.identity]&&<p className="application-error" role="status">{applicationErrors[row.identity]}</p>}
      <div className="application-line audit-line"><strong>자동 비교 이력</strong>{audit?<><span>{audit.allMatchingHistory?'전체 동일 이력(자문)':audit.partialRequestCount>0?'일부 이력(자문)':audit.requestCount>0?'확인 필요(자문)':'원문 요청 없음'}</span><small>기준 {shortKstTime(audit.asOf||audit.archiveCreatedAt)} · 요청 {audit.requestCount} · 미해결 {audit.unresolvedCount}</small></>:<span>{applicationStatus.loaded?'최근 비교 결과 없음':'아직 확인하지 못함'}</span>}</div>
      {audit&&<details className="application-history"><summary>비교 이력 {audit.entries.length}건 보기 — 수동 적용과 별개</summary>{audit.entries.map(entry=><div className="application-entry" key={`${entry.requestId||'missing'}:${entry.sourceIdentity}`}><strong>{entry.customerText||'업체 확인 필요'} · {entry.productText||'품목 확인 필요'} · {entry.inputQty??'?'} {entry.inputUnit||''}</strong><span>{entry.status==='MATCHING_HISTORY'?'동일 변동 이력':entry.status==='PARTIAL_HISTORY'?'일부 이력':'확인 필요'} · {entry.reasonKorean}</span>{entry.quote&&<blockquote>{entry.quote}</blockquote>}{entry.candidateEvents.map((event,index)=><small key={`${event.changeAt||'time'}:${index}`}>{event.before??'?'} → {event.after??'?'} {event.unit||''} · {event.week||'차수 확인 필요'} · {event.shipmentDate||'출고일 확인 필요'} · {event.changeAt||'변경 시각 확인 필요'}</small>)}{entry.candidateEventsTruncated&&<small>이력 근거는 최대 3건만 표시합니다.</small>}</div>)}{audit.entriesTruncated&&<p>원문 요청은 최대 5건만 표시합니다.</p>}{audit.unresolved.map((item,index)=><p className="application-unresolved" key={`unresolved:${index}`}>{item.quote?`“${item.quote}” · `:''}{item.reason||'추가 확인 필요'}</p>)}{audit.unresolvedTruncated&&<p>미해결 항목은 최대 5건만 표시합니다.</p>}</details>}
    </div>;
  }
  useEffect(()=>{
    const period=`${from}/${to}`;
    const eligible=isAutoRefreshEligible({open,autoRefresh,disabled,visible:true,online:true,year,week,period,loadedPeriod});
    if(!eligible)return undefined;
    const initialLoad=loadedPeriod==='';
    const sequence=++refreshSeq.current,scope=period;
    activeRefreshScope.current=scope;
    const stop=startBoundedAutoRefresh({
      immediate:initialLoad,
      isEligible:()=>!requestBusy.current&&isAutoRefreshEligible({open,autoRefresh,disabled,visible:document.visibilityState==='visible',online:navigator.onLine!==false,year,week,period,loadedPeriod}),
      run:async()=>{
        const owner=`auto:${sequence}`;let controller=null;requestBusy.current=true;requestOwner.current=owner;setRefreshStatus(previous=>({...previous,error:'',loading:true}));
        try {
          periodBounds(from,to);
          controller=new AbortController();refreshController.current=controller;
          const result=await refreshSalesFeed({from,to,maxPages:DEFAULT_MAX_PAGES,signal:controller.signal});
          if(!isCurrentRefresh({sequence,currentSequence:refreshSeq.current,scope,currentScope:activeRefreshScope.current}))return;
          const known=new Set([...rowsRef.current,...pendingRowsRef.current].map(row=>row.identity));
          const incoming=result.messages.filter(row=>!known.has(row.identity));
          const now=new Date().toISOString();
          if(initialLoad) {
            setRows(previous=>mergeMessages(previous,result.messages).rows);setCursor(result.nextAfterKey??'');setMore(!result.complete);setLoadedPeriod(period);
            setNotice(`${result.messages.length}건 자동 확인 · 수신은 주문 등록 완료를 뜻하지 않습니다.`);
            setRefreshStatus({lastSuccess:now,error:'',incomplete:!result.complete,newCount:0,autoShown:result.messages.length,loading:false});
          } else if(shouldBufferIncoming({selectedCount:rowsRef.current.filter(row=>selectedRef.current[row.identity]).length,reviewOpen:reviewOpenRef.current})) {
            if(incoming.length)setPendingRows(previous=>mergeMessages(previous,incoming).rows);
            setRefreshStatus({lastSuccess:now,error:'',incomplete:!result.complete,newCount:pendingRowsRef.current.length+incoming.length,autoShown:0,loading:false});
          } else {
            if(incoming.length)setRows(previous=>mergeMessages(previous,incoming).rows);
            setRefreshStatus({lastSuccess:now,error:'',incomplete:!result.complete,newCount:0,autoShown:incoming.length,loading:false});
          }
        } catch(error) {if(error?.name==='AbortError')return;if(isCurrentRefresh({sequence,currentSequence:refreshSeq.current,scope,currentScope:activeRefreshScope.current}))setRefreshStatus(previous=>({...previous,error:error.message||'영업방 자동 확인에 실패했습니다. 기존 목록은 유지됩니다.',loading:false}));throw error;}
        finally {if(refreshController.current===controller)refreshController.current=null;if(requestOwner.current===owner) {requestBusy.current=false;requestOwner.current='';}}
      }
    });
    return ()=>{refreshSeq.current++;if(activeRefreshScope.current===scope)activeRefreshScope.current='';refreshController.current?.abort();stop();};
  },[open,autoRefresh,disabled,from,to,loadedPeriod,year,week]);
  return <section className="sales-inbox" aria-label="영업방 대화 수신함">
    <div className="bar"><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'▾':'▸'} 영업방 대화</button><span>선택 차수 {week||'미선택'} · 원문 선택 후 입력칸으로</span></div>
    <div hidden={!open}>
      <div className="bar inbox-controls"><label>시작일 <input type="date" value={from} onChange={e=>changePeriod(setFrom,e.target.value)}/></label><label>종료일 <input type="date" value={to} onChange={e=>changePeriod(setTo,e.target.value)}/></label>
        <button type="button" disabled={busy||disabled||!from||!to} onClick={()=>loadRemote()}>영업방 불러오기</button>
        <label><input type="checkbox" checked={autoRefresh} disabled={disabled} onChange={event=>setAutoRefresh(event.target.checked)}/> 15초마다 자동 확인</label>
        <button type="button" data-manual-application-refresh disabled={disabled||applicationStatus.loading||!applicationWeek} onClick={()=>refreshApplicationStatus(applicationScope,{force:true})}>상태 새로고침</button>
        <button type="button" disabled={disabled} onClick={()=>{setReviewMounted(true);setReviewOpen(value=>!value);}}>검토·비교 {reviewOpen?'닫기':'열기'}</button>
        <label className="upload">대화 파일 올리기<input type="file" accept=".txt" disabled={busy||disabled} onChange={upload} aria-label="영업방 대화 파일 올리기"/></label>
        <button type="button" disabled={busy||disabled||!count} onClick={()=>onLoadText({text:selectedText(rows,selected),messages:rows.filter(r=>selected[r.identity])})}>선택 {count}건을 입력칸으로</button>
      </div>
      {autoRefresh&&loadedPeriod!==`${from}/${to}`&&loadedPeriod!==''&&<p role="status">입력한 새 기간은 수동 불러오기 전까지 자동 조회하지 않습니다.</p>}
      {loadedPeriod&&loadedPeriod!==`${from}/${to}`&&<p role="status">현재 표시 원문 기간: {loadedPeriod.replace('/',' ~ ')} · 입력한 조회 기간: {from||'미입력'} ~ {to||'미입력'}. 새 기간은 불러오기 전까지 바뀌지 않습니다.</p>}
      {notice&&<p role="status">{notice}</p>}
      {pendingRows.length>0&&<p role="status">새 대화 {pendingRows.length}건을 확인했습니다. <button type="button" disabled={busy||disabled} onClick={revealPending}>새 대화 {pendingRows.length}건 보기</button></p>}
      {refreshStatus.autoShown>0&&<p role="status">새 대화 {refreshStatus.autoShown}건을 바로 표시했습니다.</p>}
      {refreshStatus.incomplete&&<p role="status">자동 확인은 최대 {DEFAULT_MAX_PAGES}페이지(600건)까지만 읽었습니다. 최신 여부를 확정하려면 날짜를 좁히거나 이 기간의 다음 대화를 더 불러오세요.</p>}
      {refreshStatus.error&&<p role="status">{refreshStatus.error}</p>}
      {refreshStatus.lastSuccess&&<p role="status">자동 확인 {new Date(refreshStatus.lastSuccess).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})} · 새 대화 {refreshStatus.newCount}건 대기</p>}
      <p className="application-batch-status" role="status">{applicationStatus.loading?'적용 상태·비교 이력을 확인하는 중입니다.':applicationStatus.loaded?`수동 적용 표시는 현재 선택 범위의 원장을, 자동 비교 이력은 최근 ${applicationStatus.limit}개 저장 보고서 범위를 표시합니다.${applicationStatus.asOf?` 최신 기준 ${shortKstTime(applicationStatus.asOf)}`:''}`:'적용 상태·자동 비교 이력을 아직 확인하지 못했습니다.'} {applicationStatus.error&&` ${applicationStatus.error}`}</p>
      <div className="list">{displayRows.map(r=><article className="message" key={r.identity}><label><input type="checkbox" disabled={busy||disabled} checked={!!selected[r.identity]} onChange={e=>setSelected(v=>({...v,[r.identity]:e.target.checked}))}/> 선택</label><span><small>{r.chatroom} · {r.sender} · {r.created_at?new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'날짜 확인 필요'}{r.timestamp_approximate?' · 원문 시각 확인 필요':''}</small><pre>{r.message}</pre>{applicationPanel(r)}<div className="message-actions"><button type="button" disabled={busy||disabled} onClick={()=>onLoadText({text:r.message,messages:[r]})}>입력칸으로</button><button type="button" disabled={busy||disabled} onClick={()=>{setSelected(previous=>({...previous,[r.identity]:true}));setReviewMounted(true);setReviewOpen(true);}}>비교 선택</button></div></span></article>)}{!rows.length&&<p>{refreshStatus.loading?'영업방 대화를 확인하는 중입니다.':refreshStatus.error?'영업방 자동 확인에 실패했습니다. 다시 확인할 수 있습니다.':!loadedPeriod?'영업방 자동 확인을 기다리는 중입니다.':'현재 기간에 영업방 대화가 없습니다.'}</p>}</div>
      {more&&<button type="button" disabled={busy||disabled} onClick={()=>loadRemote(true)}>이 기간의 다음 대화 더 보기</button>}
      {rows.length>200&&<div className="bar"><button type="button" disabled={currentReviewPage===0} onClick={()=>setReviewPage(currentReviewPage-1)}>이전 검토 목록</button><span>{currentReviewPage*200+1}–{Math.min(rows.length,(currentReviewPage+1)*200)} / {rows.length}건</span><button type="button" disabled={currentReviewPage===lastReviewPage} onClick={()=>setReviewPage(currentReviewPage+1)}>다음 검토 목록</button></div>}
      <details className="review-details" open={reviewOpen} onToggle={event=>{setReviewOpen(event.currentTarget.open);if(event.currentTarget.open)setReviewMounted(true);}}><summary>원문 수동 확인 및 전산 이력 비교 — 명시 실행만</summary>{reviewMounted&&<div><p>체크리스트 저장과 전산 이력 비교는 아래의 명시 버튼을 눌러야 실행됩니다.</p><DistributionChecklistReview key={`review:${year||''}:${week||''}`} year={year} week={week} messages={rows.slice(currentReviewPage*200,(currentReviewPage+1)*200)} disabled={disabled} onReviewSaved={()=>refreshApplicationStatus(applicationScope,{force:true})}/><DistributionChangeAudit key={`audit:${year||''}:${week||''}`} year={year} week={week} messages={rows.filter(row=>selected[row.identity])} disabled={disabled||busy} onAuditSaved={()=>refreshApplicationStatus(applicationScope,{force:true})}/></div>}</details>
    </div>
    <style jsx>{`.sales-inbox{border:1px solid #bdcddd;background:#f7faff;margin-bottom:8px;font-size:12px}.bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 7px}.inbox-controls{position:sticky;top:0;z-index:2;background:#f7faff;border-block:1px solid #d9e4ef}button,.upload{font:inherit;background:white;border:1px solid #9db2ca;padding:3px 7px;color:#245b93;cursor:pointer;min-height:25px}button:disabled{opacity:.5;cursor:not-allowed}.upload{position:relative;overflow:hidden}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}input{font:inherit}p{margin:3px 7px;color:#526b82}.list{max-height:420px;overflow:auto;background:white}.message{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;border-top:1px solid #dae2ed;padding:5px 7px}.message label{white-space:nowrap}.message span{min-width:0}.message input{vertical-align:middle}small{color:#62798f}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:2px 0}.message-actions,.application-actions{display:flex;gap:5px;flex-wrap:wrap;align-items:center}.application-panel{min-width:0;border:1px solid #d7e2ec;background:#f8fbfd;padding:4px 5px;margin:3px 0}.application-line{min-width:0;display:flex;gap:5px;align-items:center;flex-wrap:wrap}.application-line strong{color:#385f7d}.application-panel small{min-width:0;overflow-wrap:anywhere}.application-note{display:block;margin-top:2px}.application-status{padding:1px 5px;border-radius:8px;background:#f0f3f6;color:#526779}.status-MANUALLY_APPLIED{background:#e6f5e9;color:#25613d}.status-MANUALLY_NOT_APPLIED{background:#f5eeee;color:#823c35}.application-actions{margin-top:3px}.application-actions label{min-width:0;display:flex;gap:3px;align-items:center}.application-actions input{max-width:150px;min-width:0}.audit-line{margin-top:4px}.application-history{margin-top:3px}.application-history summary{cursor:pointer;color:#245b93}.application-entry{display:grid;gap:2px;padding:3px 0;border-top:1px dashed #d7e2ec}.application-entry blockquote{margin:0;padding:2px 4px;border-left:2px solid #bfd1e0;white-space:pre-wrap;overflow-wrap:anywhere}.application-entry small{overflow-wrap:anywhere}.application-unresolved,.application-error{margin:3px 0;color:#a33b28}.application-batch-status{font-size:11px}.review-details{margin:6px 7px;border:1px solid #c8d9e7;background:#fbfdff}.review-details summary{padding:5px 8px;color:#245b93;cursor:pointer;font-weight:600}.review-details>div>p{padding-top:3px}@media(max-width:900px){.message{grid-template-columns:1fr}.message label{white-space:normal}.inbox-controls{position:static}.list{max-height:360px}.application-actions input{max-width:100%}}`}</style>
    <style jsx global>{`.sales-inbox .application-panel{min-width:0;border:1px solid #d7e2ec;background:#f8fbfd;padding:4px 5px;margin:3px 0}.sales-inbox .application-line{min-width:0;display:flex;gap:5px;align-items:center;flex-wrap:wrap}.sales-inbox .application-line strong{color:#385f7d}.sales-inbox .application-panel small{min-width:0;overflow-wrap:anywhere;color:#62798f}.sales-inbox .application-note{display:block;margin-top:2px}.sales-inbox .application-status{padding:1px 5px;border-radius:8px;background:#f0f3f6;color:#526779}.sales-inbox .status-MANUALLY_APPLIED{background:#e6f5e9;color:#25613d}.sales-inbox .status-MANUALLY_NOT_APPLIED{background:#f5eeee;color:#823c35}.sales-inbox .application-actions{display:flex;gap:5px;flex-wrap:wrap;align-items:center;margin-top:3px}.sales-inbox .application-actions label{min-width:0;display:flex;gap:3px;align-items:center}.sales-inbox .application-actions input{max-width:150px;min-width:0}.sales-inbox .application-panel button{font:inherit;background:white;border:1px solid #9db2ca;padding:3px 7px;color:#245b93;cursor:pointer;min-height:25px}.sales-inbox .application-panel button:disabled{opacity:.5;cursor:not-allowed}.sales-inbox .audit-line{margin-top:4px}.sales-inbox .application-history{margin-top:3px}.sales-inbox .application-history summary{cursor:pointer;color:#245b93}.sales-inbox .application-entry{display:grid;gap:2px;padding:3px 0;border-top:1px dashed #d7e2ec}.sales-inbox .application-entry blockquote{margin:0;padding:2px 4px;border-left:2px solid #bfd1e0;white-space:pre-wrap;overflow-wrap:anywhere}.sales-inbox .application-entry small{overflow-wrap:anywhere}.sales-inbox .application-unresolved,.sales-inbox .application-error{margin:3px 0;color:#a33b28}@media(max-width:900px){.sales-inbox .application-actions input{max-width:100%}}`}</style>
  </section>;
}
