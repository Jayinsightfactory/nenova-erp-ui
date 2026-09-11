import {useEffect,useRef,useState} from 'react';
import {MAX_TEXT_BYTES,periodBounds,parseSalesExport,mergeMessages,selectedText} from '../../lib/distributionSalesInbox';
import {DEFAULT_MAX_PAGES,isAutoRefreshEligible,isCurrentRefresh,kstCalendarDate,messageIdentity,readSalesFeedPage,refreshSalesFeed,shouldBufferIncoming,startBoundedAutoRefresh} from '../../lib/distributionSalesInboxRefresh';
import DistributionChecklistReview from './DistributionChecklistReview';
import DistributionChangeAudit from './DistributionChangeAudit';

export default function DistributionSalesInbox({year,week,disabled,onLoadText}) {
  const [open,setOpen]=useState(true),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [rows,setRows]=useState([]),[selected,setSelected]=useState({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [cursor,setCursor]=useState(''),[more,setMore]=useState(false),[loadedPeriod,setLoadedPeriod]=useState('');
  const seq=useRef(0);
  const [reviewPage,setReviewPage]=useState(0),[reviewOpen,setReviewOpen]=useState(false),[reviewMounted,setReviewMounted]=useState(false);
  const [autoRefresh,setAutoRefresh]=useState(true),[pendingRows,setPendingRows]=useState([]),[refreshStatus,setRefreshStatus]=useState({lastSuccess:'',error:'',incomplete:false,newCount:0,autoShown:0,loading:false});
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
      <div className="list">{displayRows.map(r=><article className="message" key={r.identity}><label><input type="checkbox" disabled={busy||disabled} checked={!!selected[r.identity]} onChange={e=>setSelected(v=>({...v,[r.identity]:e.target.checked}))}/> 선택</label><span><small>{r.chatroom} · {r.sender} · {r.created_at?new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'날짜 확인 필요'}{r.timestamp_approximate?' · 원문 시각 확인 필요':''}</small><pre>{r.message}</pre><div className="message-actions"><button type="button" disabled={busy||disabled} onClick={()=>onLoadText({text:r.message,messages:[r]})}>입력칸으로</button><button type="button" disabled={busy||disabled} onClick={()=>{setSelected(previous=>({...previous,[r.identity]:true}));setReviewMounted(true);setReviewOpen(true);}}>비교 선택</button></div></span></article>)}{!rows.length&&<p>{refreshStatus.loading?'영업방 대화를 확인하는 중입니다.':refreshStatus.error?'영업방 자동 확인에 실패했습니다. 다시 확인할 수 있습니다.':!loadedPeriod?'영업방 자동 확인을 기다리는 중입니다.':'현재 기간에 영업방 대화가 없습니다.'}</p>}</div>
      {more&&<button type="button" disabled={busy||disabled} onClick={()=>loadRemote(true)}>이 기간의 다음 대화 더 보기</button>}
      {rows.length>200&&<div className="bar"><button type="button" disabled={currentReviewPage===0} onClick={()=>setReviewPage(currentReviewPage-1)}>이전 검토 목록</button><span>{currentReviewPage*200+1}–{Math.min(rows.length,(currentReviewPage+1)*200)} / {rows.length}건</span><button type="button" disabled={currentReviewPage===lastReviewPage} onClick={()=>setReviewPage(currentReviewPage+1)}>다음 검토 목록</button></div>}
      <details className="review-details" open={reviewOpen} onToggle={event=>{setReviewOpen(event.currentTarget.open);if(event.currentTarget.open)setReviewMounted(true);}}><summary>원문 수동 확인 및 전산 이력 비교 — 명시 실행만</summary>{reviewMounted&&<div><p>체크리스트 저장과 전산 이력 비교는 아래의 명시 버튼을 눌러야 실행됩니다.</p><DistributionChecklistReview key={`review:${year||''}:${week||''}`} year={year} week={week} messages={rows.slice(currentReviewPage*200,(currentReviewPage+1)*200)} disabled={disabled}/><DistributionChangeAudit key={`audit:${year||''}:${week||''}`} year={year} week={week} messages={rows.filter(row=>selected[row.identity])} disabled={disabled||busy}/></div>}</details>
    </div>
    <style jsx>{`.sales-inbox{border:1px solid #bdcddd;background:#f7faff;margin-bottom:8px;font-size:12px}.bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 7px}.inbox-controls{position:sticky;top:0;z-index:2;background:#f7faff;border-block:1px solid #d9e4ef}button,.upload{font:inherit;background:white;border:1px solid #9db2ca;padding:3px 7px;color:#245b93;cursor:pointer;min-height:25px}button:disabled{opacity:.5;cursor:not-allowed}.upload{position:relative;overflow:hidden}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}input{font:inherit}p{margin:3px 7px;color:#526b82}.list{max-height:400px;overflow:auto;background:white}.message{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;border-top:1px solid #dae2ed;padding:5px 7px}.message label{white-space:nowrap}.message span{min-width:0}.message input{vertical-align:middle}small{color:#62798f}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:2px 0}.message-actions{display:flex;gap:5px;flex-wrap:wrap}.review-details{margin:6px 7px;border:1px solid #c8d9e7;background:#fbfdff}.review-details summary{padding:5px 8px;color:#245b93;cursor:pointer;font-weight:600}.review-details>div>p{padding-top:3px}@media(max-width:900px){.message{grid-template-columns:1fr}.message label{white-space:normal}.inbox-controls{position:static}.list{max-height:360px}}`}</style>
  </section>;
}
