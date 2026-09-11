import {useEffect,useRef,useState} from 'react';
import {MAX_TEXT_BYTES,periodBounds,parseSalesExport,mergeMessages,selectedText} from '../../lib/distributionSalesInbox';
import {DEFAULT_MAX_PAGES,kstCalendarDate,messageIdentity,readSalesFeedPage,refreshSalesFeed,startBoundedAutoRefresh} from '../../lib/distributionSalesInboxRefresh';
import DistributionChecklistReview from './DistributionChecklistReview';
import DistributionChangeAudit from './DistributionChangeAudit';

export default function DistributionSalesInbox({year,week,disabled,onLoadText}) {
  const [open,setOpen]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [rows,setRows]=useState([]),[selected,setSelected]=useState({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [cursor,setCursor]=useState(''),[more,setMore]=useState(false),[loadedPeriod,setLoadedPeriod]=useState('');
  const seq=useRef(0);
  const [reviewPage,setReviewPage]=useState(0);
  const [autoRefresh,setAutoRefresh]=useState(true),[pendingRows,setPendingRows]=useState([]),[refreshStatus,setRefreshStatus]=useState({lastSuccess:'',error:'',incomplete:false,newCount:0});
  const requestBusy=useRef(false),requestOwner=useRef(''),refreshSeq=useRef(0),activeRefreshScope=useRef(''),refreshController=useRef(null),rowsRef=useRef(rows),pendingRowsRef=useRef(pendingRows);
  useEffect(()=>{rowsRef.current=rows;},[rows]);
  useEffect(()=>{pendingRowsRef.current=pendingRows;},[pendingRows]);
  useEffect(()=>{const today=kstCalendarDate();setFrom(previous=>previous||today);setTo(previous=>previous||today);},[]);
  const lastReviewPage=Math.max(0,Math.ceil(rows.length/200)-1);
  const currentReviewPage=Math.min(reviewPage,lastReviewPage);
  const count=rows.filter(r=>selected[r.identity]).length;
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
      const result=mergeMessages(rows,identified);setRows(result.rows);
      setNotice(`${identified.length}건 읽음 · 이 목록의 중복 ${result.duplicateCount}건 제외. 서버 수신과 업로드 사이의 중복은 원문 확인이 필요합니다.`);
    } catch(e) {if(id===seq.current)setNotice(e.message||'파일을 읽지 못했습니다.');}
    finally {if(id===seq.current)setBusy(false);}
  }
  function changePeriod(set,value){seq.current++;set(value);setBusy(false);setMore(false);setCursor('');setPendingRows([]);setRefreshStatus({lastSuccess:'',error:'',incomplete:false,newCount:0});}
  function revealPending() {
    setRows(previous=>mergeMessages(previous,pendingRowsRef.current).rows);
    setPendingRows([]);setRefreshStatus(previous=>({...previous,newCount:0}));
  }
  useEffect(()=>{
    const period=`${from}/${to}`;
    if(!open||!autoRefresh||disabled||!from||!to||loadedPeriod!==period)return undefined;
    const sequence=++refreshSeq.current,scope=period;
    activeRefreshScope.current=scope;
    const stop=startBoundedAutoRefresh({
      isEligible:()=>!requestBusy.current&&document.visibilityState==='visible'&&navigator.onLine!==false,
      run:async()=>{
        const owner=`auto:${sequence}`;let controller=null;requestBusy.current=true;requestOwner.current=owner;setRefreshStatus(previous=>({...previous,error:''}));
        try {
          periodBounds(from,to);
          controller=new AbortController();refreshController.current=controller;
          const result=await refreshSalesFeed({from,to,maxPages:DEFAULT_MAX_PAGES,signal:controller.signal});
          if(sequence!==refreshSeq.current||activeRefreshScope.current!==scope)return;
          const known=new Set([...rowsRef.current,...pendingRowsRef.current].map(row=>row.identity));
          const incoming=result.messages.filter(row=>!known.has(row.identity));
          if(incoming.length)setPendingRows(previous=>mergeMessages(previous,incoming).rows);
          setRefreshStatus({lastSuccess:new Date().toISOString(),error:'',incomplete:!result.complete,newCount:pendingRowsRef.current.length+incoming.length});
        } catch(error) {if(error?.name==='AbortError')return;if(sequence===refreshSeq.current&&activeRefreshScope.current===scope)setRefreshStatus(previous=>({...previous,error:error.message||'영업방 자동 확인에 실패했습니다. 기존 목록은 유지됩니다.'}));throw error;}
        finally {if(refreshController.current===controller)refreshController.current=null;if(requestOwner.current===owner) {requestBusy.current=false;requestOwner.current='';}}
      }
    });
    return ()=>{refreshSeq.current++;if(activeRefreshScope.current===scope)activeRefreshScope.current='';refreshController.current?.abort();stop();};
  },[open,autoRefresh,disabled,from,to,loadedPeriod]);
  return <section className="sales-inbox" aria-label="영업방 대화 수신함">
    <div className="bar"><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'▾':'▸'} 영업방 대화 가져오기</button><span>선택 차수 {week||'미선택'} · 대화 선택 후 기존 분석으로 연결</span></div>
    {open&&<>
      <div className="bar"><label>시작일 <input type="date" value={from} onChange={e=>changePeriod(setFrom,e.target.value)}/></label><label>종료일 <input type="date" value={to} onChange={e=>changePeriod(setTo,e.target.value)}/></label>
        <button type="button" disabled={busy||disabled||!from||!to} onClick={()=>loadRemote()}>영업방 불러오기</button>
        <label><input type="checkbox" checked={autoRefresh} disabled={disabled} onChange={event=>setAutoRefresh(event.target.checked)}/> 15초마다 자동 확인</label>
        <label className="upload">대화 파일 올리기<input type="file" accept=".txt" disabled={busy||disabled} onChange={upload} aria-label="영업방 대화 파일 올리기"/></label>
        <button type="button" disabled={busy||disabled||!count} onClick={()=>onLoadText({text:selectedText(rows,selected),messages:rows.filter(r=>selected[r.identity])})}>선택 {count}건을 입력칸으로</button>
      </div>
      <p>원문은 아래에서 선택하세요. 자동 분석·등록하지 않으며 기존 입력이 있으면 교체 여부를 확인합니다. 업로드 목록은 현재 화면에서만 유지됩니다.</p>
      {autoRefresh&&loadedPeriod!==`${from}/${to}`&&<p role="status">먼저 영업방 불러오기를 누르면 이 기간을 15초마다 자동 확인합니다.</p>}
      {loadedPeriod&&loadedPeriod!==`${from}/${to}`&&<p role="status">현재 표시 원문 기간: {loadedPeriod.replace('/',' ~ ')} · 입력한 조회 기간: {from||'미입력'} ~ {to||'미입력'}. 새 기간은 불러오기 전까지 바뀌지 않습니다.</p>}
      {notice&&<p role="status">{notice}</p>}
      {pendingRows.length>0&&<p role="status">새 대화 {pendingRows.length}건을 확인했습니다. <button type="button" disabled={busy||disabled} onClick={revealPending}>새 대화 {pendingRows.length}건 보기</button></p>}
      {refreshStatus.incomplete&&<p role="status">자동 확인은 최대 {DEFAULT_MAX_PAGES}페이지(600건)까지만 읽었습니다. 최신 여부를 확정하려면 날짜를 좁히거나 이 기간의 다음 대화를 더 불러오세요.</p>}
      {refreshStatus.error&&<p role="status">{refreshStatus.error}</p>}
      {refreshStatus.lastSuccess&&<p role="status">자동 확인 {new Date(refreshStatus.lastSuccess).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})} · 새 대화 {refreshStatus.newCount}건 대기</p>}
      <div className="list">{rows.map(r=><label className="message" key={r.identity}><input type="checkbox" disabled={busy||disabled} checked={!!selected[r.identity]} onChange={e=>setSelected(v=>({...v,[r.identity]:e.target.checked}))}/><span><small>{r.chatroom} · {r.sender} · {r.created_at?new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'날짜 확인 필요'}{r.timestamp_approximate?' · 원문 시각 확인 필요':''}</small><pre>{r.message}</pre></span></label>)}{!rows.length&&<p>불러온 대화가 없습니다.</p>}</div>
      {more&&<button type="button" disabled={busy||disabled} onClick={()=>loadRemote(true)}>이 기간의 다음 대화 더 보기</button>}
      {rows.length>200&&<div className="bar"><button type="button" disabled={currentReviewPage===0} onClick={()=>setReviewPage(currentReviewPage-1)}>이전 검토 목록</button><span>{currentReviewPage*200+1}–{Math.min(rows.length,(currentReviewPage+1)*200)} / {rows.length}건</span><button type="button" disabled={currentReviewPage===lastReviewPage} onClick={()=>setReviewPage(currentReviewPage+1)}>다음 검토 목록</button></div>}
      <DistributionChecklistReview key={`review:${year||''}:${week||''}`} year={year} week={week} messages={rows.slice(currentReviewPage*200,(currentReviewPage+1)*200)} disabled={disabled}/>
      <DistributionChangeAudit key={`audit:${year||''}:${week||''}`} year={year} week={week} messages={rows.filter(row=>selected[row.identity])} disabled={disabled||busy}/>
    </>}
    <style jsx>{`.sales-inbox{border:1px solid #bdcddd;background:#f7faff;margin-bottom:8px;font-size:12px}.bar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:5px 7px}button,.upload{font:inherit;background:white;border:1px solid #9db2ca;padding:4px 8px;color:#245b93;cursor:pointer;min-height:27px}button:disabled{opacity:.5;cursor:not-allowed}.upload{position:relative;overflow:hidden}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}input{font:inherit}p{margin:4px 7px;color:#526b82}.list{max-height:230px;overflow:auto;background:white}.message{display:flex;gap:8px;border-top:1px solid #dae2ed;padding:5px 7px}.message span{min-width:0}.message input{align-self:flex-start}small{color:#62798f}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:3px 0}`}</style>
  </section>;
}
