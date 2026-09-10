import {useRef,useState} from 'react';
import {MAX_TEXT_BYTES,periodBounds,parseSalesExport,mergeMessages,selectedText} from '../../lib/distributionSalesInbox';
import DistributionChecklistReview from './DistributionChecklistReview';
import DistributionChangeAudit from './DistributionChangeAudit';

export default function DistributionSalesInbox({year,week,disabled,onLoadText}) {
  const [open,setOpen]=useState(false),[from,setFrom]=useState(''),[to,setTo]=useState('');
  const [rows,setRows]=useState([]),[selected,setSelected]=useState({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const [cursor,setCursor]=useState('0'),[more,setMore]=useState(false),[loadedPeriod,setLoadedPeriod]=useState('');
  const seq=useRef(0);
  const [reviewPage,setReviewPage]=useState(0);
  const lastReviewPage=Math.max(0,Math.ceil(rows.length/200)-1);
  const currentReviewPage=Math.min(reviewPage,lastReviewPage);
  const count=rows.filter(r=>selected[r.identity]).length;
  async function readResponse(response) {
    let data; try {data=await response.json();} catch {throw new Error('서버 응답을 읽지 못했습니다. 입력 내용은 유지됩니다.');}
    if(!response.ok) throw new Error(data.error||'대화를 불러오지 못했습니다.');return data;
  }
  async function loadRemote(next=false) {
    const id=++seq.current; setBusy(true); setNotice('');
    try {
      periodBounds(from,to);
      const period=`${from}/${to}`;
      const data=await readResponse(await fetch(`/api/kakao/sales-feed?${new URLSearchParams({from,to,afterId:next&&period===loadedPeriod?cursor:'0'})}`));
      if(id!==seq.current)return;
      const incoming=data.messages.map(r=>({...r,identity:`${r.source}|${r.chat_id}|${r.external_message_id}`}));
      setRows(prev=>mergeMessages(period===loadedPeriod?prev:[],incoming).rows);
      if(period!==loadedPeriod)setSelected({});
      setCursor(String(data.nextAfterId));setMore(data.hasMore);setLoadedPeriod(period);
      setNotice(`${incoming.length}건 확인 · 수신은 주문 등록 완료를 뜻하지 않습니다.`);
    } catch(e) {if(id===seq.current)setNotice(e.message);}
    finally {if(id===seq.current)setBusy(false);}
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
  function changePeriod(set,value){seq.current++;set(value);setBusy(false);setMore(false);}
  return <section className="sales-inbox" aria-label="영업방 대화 수신함">
    <div className="bar"><button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{open?'▾':'▸'} 영업방 대화 가져오기</button><span>선택 차수 {week||'미선택'} · 대화 선택 후 기존 분석으로 연결</span></div>
    {open&&<>
      <div className="bar"><label>시작일 <input type="date" value={from} onChange={e=>changePeriod(setFrom,e.target.value)}/></label><label>종료일 <input type="date" value={to} onChange={e=>changePeriod(setTo,e.target.value)}/></label>
        <button type="button" disabled={busy||disabled||!from||!to} onClick={()=>loadRemote()}>영업방 불러오기</button>
        <label className="upload">대화 파일 올리기<input type="file" accept=".txt" disabled={busy||disabled} onChange={upload} aria-label="영업방 대화 파일 올리기"/></label>
        <button type="button" disabled={busy||disabled||!count} onClick={()=>onLoadText({text:selectedText(rows,selected),messages:rows.filter(r=>selected[r.identity])})}>선택 {count}건을 입력칸으로</button>
      </div>
      <p>원문은 아래에서 선택하세요. 자동 분석·등록하지 않으며 기존 입력이 있으면 교체 여부를 확인합니다. 업로드 목록은 현재 화면에서만 유지됩니다.</p>
      {notice&&<p role="status">{notice}</p>}
      <div className="list">{rows.map(r=><label className="message" key={r.identity}><input type="checkbox" disabled={busy||disabled} checked={!!selected[r.identity]} onChange={e=>setSelected(v=>({...v,[r.identity]:e.target.checked}))}/><span><small>{r.chatroom} · {r.sender} · {r.created_at?new Date(r.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'날짜 확인 필요'}{r.timestamp_approximate?' · 원문 시각 확인 필요':''}</small><pre>{r.message}</pre></span></label>)}{!rows.length&&<p>불러온 대화가 없습니다.</p>}</div>
      {more&&<button type="button" disabled={busy||disabled} onClick={()=>loadRemote(true)}>이 기간의 다음 대화 더 보기</button>}
      {rows.length>200&&<div className="bar"><button type="button" disabled={currentReviewPage===0} onClick={()=>setReviewPage(currentReviewPage-1)}>이전 검토 목록</button><span>{currentReviewPage*200+1}–{Math.min(rows.length,(currentReviewPage+1)*200)} / {rows.length}건</span><button type="button" disabled={currentReviewPage===lastReviewPage} onClick={()=>setReviewPage(currentReviewPage+1)}>다음 검토 목록</button></div>}
      <DistributionChecklistReview key={`review:${year||''}:${week||''}`} year={year} week={week} messages={rows.slice(currentReviewPage*200,(currentReviewPage+1)*200)} disabled={disabled}/>
      <DistributionChangeAudit key={`audit:${year||''}:${week||''}`} year={year} week={week} messages={rows.filter(row=>selected[row.identity])} disabled={disabled||busy}/>
    </>}
    <style jsx>{`.sales-inbox{border:1px solid #bdcddd;background:#f7faff;margin-bottom:8px;font-size:12px}.bar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:5px 7px}button,.upload{font:inherit;background:white;border:1px solid #9db2ca;padding:4px 8px;color:#245b93;cursor:pointer;min-height:27px}button:disabled{opacity:.5;cursor:not-allowed}.upload{position:relative;overflow:hidden}.upload input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}input{font:inherit}p{margin:4px 7px;color:#526b82}.list{max-height:230px;overflow:auto;background:white}.message{display:flex;gap:8px;border-top:1px solid #dae2ed;padding:5px 7px}.message span{min-width:0}.message input{align-self:flex-start}small{color:#62798f}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:3px 0}`}</style>
  </section>;
}
