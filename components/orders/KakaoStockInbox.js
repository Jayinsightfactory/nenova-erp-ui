import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {recentSalesPeriod,refreshSalesFeed,retainRecentSalesRows} from '../../lib/distributionSalesInboxRefresh';
import {stockSourceWeek,stockInboxRows,mergeStockInbox} from '../../lib/kakaoStockInbox';
import PasteErpHistoryEvidence from './PasteErpHistoryEvidence';

const PAGE_SIZE=3;
export default function KakaoStockInbox({week,disabled,canAnalyze,applied=[],onAnalyze}) {
  const [rows,setRows]=useState([]),[selectedId,setSelectedId]=useState('');
  const [search,setSearch]=useState(''),[page,setPage]=useState(0),[cursor,setCursor]=useState('');
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[loadedAt,setLoadedAt]=useState('');
  const active=useRef(false),busy=useRef(false),controller=useRef(null),cursorRef=useRef(''),periodRef=useRef('');
  const refresh=useCallback(async(more=false)=>{
    if(busy.current)return;
    busy.current=true;setLoading(true);setError('');controller.current=new AbortController();
    const period=recentSalesPeriod(),periodKey=`${period.from}/${period.to}`;
    try {
      const result=await refreshSalesFeed({...period,afterKey:more&&periodRef.current===periodKey?cursorRef.current:'',signal:controller.current.signal,maxPages:3});
      if(!active.current)return;
      setRows(previous=>mergeStockInbox(retainRecentSalesRows(previous),result.messages));
      setSelectedId(previous=>previous||stockInboxRows(result.messages)[0]?.identity||'');
      // A first-page refresh must not move the user's older-history cursor backwards.
      if(more||periodRef.current!==periodKey){cursorRef.current=result.complete?'':result.nextAfterKey;setCursor(cursorRef.current);}
      periodRef.current=periodKey;
      setLoadedAt(new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'}));
    }catch(e){if(active.current&&e.name!=='AbortError')setError(e.message);}
    finally{busy.current=false;if(active.current)setLoading(false);}
  },[]);
  useEffect(()=>{active.current=true;void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&navigator.onLine)void refresh();},30000);return()=>{active.current=false;controller.current?.abort();clearInterval(timer);};},[refresh]);
  const filtered=useMemo(()=>stockInboxRows(rows,search),[rows,search]);
  const maxPage=Math.max(0,Math.ceil(filtered.length/PAGE_SIZE)-1),currentPage=Math.min(page,maxPage);
  const shown=filtered.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE);
  const selected=rows.find(r=>r.identity===selectedId),sourceWeek=selected?stockSourceWeek(selected.message,week):null;
  const alreadyApplied=!!selected&&applied.includes(selected.message.trim());
  return <section className="stock-inbox" aria-label="영업방 원문과 최신 전산이력">
    <header><div><h2>영업방 원문 · 최신 전산이력</h2><p>최근 3일 대화 · 원문은 30초마다, 선택한 원문의 전산이력은 10초마다 확인합니다.</p></div><button type="button" disabled={loading||disabled} onClick={()=>refresh()}>{loading?'영업방 조회 중…':'영업방 새로고침'}</button></header>
    <div className="inbox-grid"><div><label className="search">원문 검색<input aria-label="영업방 원문 검색" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}} placeholder="업체·품목·차수로 검색"/></label>
      <p role="status">{error?`조회 실패: ${error} · 기존 목록은 유지합니다.`:loadedAt?`${loadedAt} 확인 · ${filtered.length}건`:'영업방 원문을 불러오는 중입니다.'}</p>
      {!loading&&!filtered.length&&<p>표시할 대화가 없습니다. 검색어를 바꾸거나 아래 원문 입력칸에 직접 붙여넣으세요.</p>}
      <div role="radiogroup" aria-label="분석할 영업방 원문 선택">{shown.map(message=><article key={message.identity} className={message.identity===selectedId?'selected':''}>
        <label><input type="radio" name="stock-source" aria-label={`원문 선택 ${message.identity}`} checked={message.identity===selectedId} onChange={()=>setSelectedId(message.identity)}/><strong>{message.sender||'영업방'} · {Number.isFinite(Date.parse(message.created_at))?new Date(message.created_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'시각 확인 필요'}</strong>{applied.includes(message.message.trim())&&<span>재고장 적용됨</span>}</label>
        <pre>{message.message}</pre>
      </article>)}</div>
      <nav aria-label="영업방 원문 목록 페이지"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>원문 이전</button><span>{currentPage+1} / {maxPage+1}</span><button disabled={currentPage>=maxPage} onClick={()=>setPage(currentPage+1)}>원문 다음</button>{cursor&&<button disabled={loading||disabled} onClick={()=>refresh(true)}>이전 대화 더 불러오기</button>}</nav>
    </div><div className="selected-history"><h3>선택 원문의 최신 전산이력</h3>
      {selected?<><p>원문 차수 {sourceWeek||'복수 차수 · 확인 필요'} · 재고장 {week}</p><pre className="selected-source">{selected.message}</pre>
        <button className="analyze" disabled={disabled||!canAnalyze||sourceWeek!==week||alreadyApplied} onClick={()=>onAnalyze({...selected})}>{alreadyApplied?'이 재고장에 적용한 원문':'선택 원문 분석 → 적용 확인'}</button>
        {!canAnalyze&&<p>왼쪽 기초재고를 먼저 적용하세요. 수정 중인 시작재고도 적용해야 합니다.</p>}{sourceWeek!==week&&<p role="status">원문의 연도·차수와 재고장이 다르거나 여러 차수가 섞였습니다. 맞는 재고장에서 분석하세요.</p>}
        <p>전산 처리이력은 참고 자료입니다. 재고장 적용 여부와 별개이며 주문·분배를 변경하지 않습니다.</p>
        {sourceWeek&&<PasteErpHistoryEvidence key={`${selected.identity}:${sourceWeek}`} week={sourceWeek} text={selected.message} messages={[selected]}/>}
      </>:<p>왼쪽에서 원문을 선택하면 주문·분배의 최신 수량 변동 이력을 나란히 확인할 수 있습니다.</p>}
    </div></div>
    <style jsx>{`.stock-inbox{border:1px solid #b9ccde;border-radius:10px;background:#fff;padding:16px;margin:12px 0 18px}.stock-inbox header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}h2{font-size:18px;margin:0}h3{margin:0;font-size:16px}p{color:#526176;line-height:1.5;margin:8px 0}.inbox-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}.search{display:block;font-weight:600}.search input{display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;border:1px solid #bbc8d8;border-radius:5px;font:inherit}article{border:1px solid #d6e0eb;padding:10px;margin:8px 0;border-radius:6px}article.selected{border:2px solid #3175bd;background:#f2f7fe}article label{display:flex;align-items:center;gap:7px;flex-wrap:wrap;cursor:pointer}article label span{color:#14634f}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5;margin:8px 0}button{font:inherit;border:1px solid #afc3d8;background:#eff6ff;color:#164b7d;border-radius:5px;padding:8px 11px;cursor:pointer}button:disabled{opacity:.5;cursor:default}nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.selected-history{min-width:0;border-left:1px solid #d6e0eb;padding-left:18px}.selected-source{background:#f5f7fa;padding:10px;border-radius:5px}.analyze{background:#155d9c;color:white;font-weight:600}:focus-visible{outline:3px solid #3184de;outline-offset:2px}@media(max-width:800px){.inbox-grid{grid-template-columns:1fr}.selected-history{border-left:0;border-top:1px solid #d6e0eb;padding:14px 0 0}}`}</style>
  </section>;
}
