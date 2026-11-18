import { useEffect, useRef, useState } from 'react';
import { validItem, farmTotals, importItemView, importTotalsText, importTotalKey, manualImportReviews } from '../../lib/importKakaoAdditions';

const fields = [['country','국가'],['group','품목군'],['week','차수'],['product','품종'],['quantity','수량'],['unit','단위'],['customer','업체 / CL']];
const groupKey = row => [row.country||'국가 미상',row.group||'품목군 미상'].join(' · ');
const weekKey = row => row.year+'/'+(row.week||'차수 미상');
function ChoiceButtons({label, values, value, onChange, all}) {
  return <div className="kakao-choices" role="group" aria-label={label} onKeyDown={e=>{
    if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    const buttons=[...e.currentTarget.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
    if(index<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+buttons.length)%buttons.length;buttons[next].focus();
  }}><strong>{label}</strong>{['',...values].map(v=><button key={v} type="button" aria-pressed={value===v} onClick={()=>onChange(v)}>{v||all}</button>)}</div>;
}
function RecentReview() {
  const [feed,setFeed]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [edits,setEdits]=useState({}),[notice,setNotice]=useState('');
  const [week,setWeek]=useState(''),[group,setGroup]=useState(''),[focus,setFocus]=useState(null);
  const [showReview,setShowReview]=useState(false),[showAudit,setShowAudit]=useState(false),[auditQuery,setAuditQuery]=useState('');
  const [manual,setManual]=useState({});
  const originalHeading=useRef(null),totalHeading=useRef(null);
  useEffect(()=>{
    if(!focus)return;
    const heading=focus.type==='total'?originalHeading.current:totalHeading.current;
    heading?.scrollIntoView({block:'start'});heading?.focus({preventScroll:true});
  },[focus]);
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function refresh(){if(pending)return;pending=true;try{
      const response=await fetch('/api/import/tools/kakao-additions'+(showAudit?'?audit=1':''),{signal:controller.signal,cache:'no-store'});
      const body=await response.json();if(!response.ok||!Array.isArray(body.messages))throw Error(body.error||'조회하지 못했습니다.');
      if(!controller.signal.aborted){setFeed(body);setError('');}
    }catch(failure){if(!controller.signal.aborted)setError(failure.message);}finally{pending=false;}}
    refresh();const timer=setInterval(refresh,60000);return()=>{clearInterval(timer);controller.abort();};
  },[retry,showAudit]);
  const messages=feed?.messages||[];
  const recovered=manualImportReviews(manual,feed);
  const reviews=[...(feed?.review||[]),...recovered];
  const allMessages=[...messages,...reviews];
  const view=row=>importItemView(row,edits[row.key]);
  const allRows=allMessages.flatMap(m=>m.items.map(view));
  const weeks=[...new Set(allRows.map(weekKey))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const activeWeek=weeks.includes(week)?week:'';
  const groups=[...new Set(allRows.filter(r=>!activeWeek||weekKey(r)===activeWeek).map(groupKey))].sort();
  const activeGroup=groups.includes(group)?group:'';
  const inScope=row=>(!activeWeek||weekKey(row)===activeWeek)&&(!activeGroup||groupKey(row)===activeGroup);
  const rows=allRows.filter(inScope),totals=farmTotals(rows);
  const invalid=rows.some(r=>r.checked&&(!validItem(r)||!r.unit||!/^\d{1,2}(?:-\d{1,2})?$/.test(r.week)));
  const selectedTotal=focus?.type==='total'?totals.find(t=>t.key===focus.key):null;
  const selectedMessage=focus?.type==='message'?allMessages.find(m=>m.id===focus.id):null;
  const sourceKeys=new Set(selectedTotal?.sourceKeys||[]);
  const messageKeys=new Set(selectedMessage?.items.map(i=>i.key)||[]);
  const shownTotals=selectedMessage?totals.filter(t=>t.sourceKeys.some(k=>messageKeys.has(k))):totals;
  const scopedMessages=messages.filter(m=>m.items.some(i=>inScope(view(i))));
  const shownMessages=selectedTotal?scopedMessages.filter(m=>m.items.some(i=>sourceKeys.has(i.key))):scopedMessages;
  const update=(key,patch)=>{setNotice('');setFocus(null);setEdits(prev=>({...prev,[key]:{...prev[key],...patch}}));};
  function addManual(m){
    const key=JSON.stringify(['manual',m.id,m.text]);
    setManual(prev=>({...prev,[m.id]:{...m,kind:'review',reason:'제외 원문에서 수동 검토',items:[{key,year:m.time.match(/^\d{4}/)?.[0]||'',product:'',quantity:'',unit:'',week:'',reviewReason:'원문과 대조 후 포함'}]}}));
    setShowReview(true);setWeek('');setGroup('');setFocus(null);setNotice('검토 목록에 가져왔습니다. 품목·수량·단위·차수를 확인한 뒤 합산을 체크하세요.');
  }
  async function copy(){try{await navigator.clipboard.writeText(importTotalsText(totals));setNotice('전달용 합계를 복사했습니다.');}catch{setNotice('복사할 수 없습니다. 합계 표를 선택해 복사하세요.');}}
  function renderMessage(m){
    const visible=m.items.filter(i=>inScope(view(i)));
    if(selectedTotal&&!m.items.some(i=>sourceKeys.has(i.key)))return null;
    return <details key={m.id} open className={'kakao-order-message '+(selectedMessage?.id===m.id||m.items.some(i=>sourceKeys.has(i.key))?'kakao-linked':'')}>
      <summary>{m.time} · {m.kind==='review'?'검토 필요':'추가 발주'} · {m.text.split('\n')[0].slice(0,48)}</summary>
      <button type="button" className="kakao-match-source" aria-pressed={selectedMessage?.id===m.id} onClick={()=>setFocus({type:'message',id:m.id})}>이 원문의 합계 보기</button>
      {m.reason&&<p className="kakao-review-reason">{m.reason} · 확인 전 합계 제외</p>}
      <blockquote>{m.text}</blockquote>
      {m.retained?.map((r,i)=><p key={i}>기존 주문 유지: {r.product} {r.quantity} {r.unit} · 새 추가 수량이 아니므로 합산하지 않습니다.</p>)}
      {visible.map(base=>{const row=view(base);return <fieldset key={row.key} className={sourceKeys.has(row.key)?'kakao-linked':''}><legend><label><input type="checkbox" checked={!!row.checked} onChange={e=>update(row.key,{checked:e.target.checked})}/> {m.kind==='review'?'검토 후 합산':'합산'} · {row.product||'품종 확인'}</label></legend>
        {fields.map(([key,label])=><label key={key}>{label}<input value={row[key]||''} onChange={e=>update(row.key,{[key]:e.target.value})}/></label>)}
        <small>{row.checked?'합계에 포함':row.reviewReason||'합계에서 제외'}{row.note&&' · 요청: '+row.note}</small>
        {row.checked&&validItem(row)&&<button type="button" onClick={()=>setFocus({type:'total',key:importTotalKey(row)})}>이 품종 원문 모아보기</button>}
      </fieldset>;})}
      {m.unparsed?.length>0&&<p>해석하지 못한 수량 행: {m.unparsed.join(' / ')}</p>}
      {manual[m.id]&&<button type="button" onClick={()=>setManual(prev=>({...prev,[m.id]:{...prev[m.id],items:[...prev[m.id].items,{key:JSON.stringify(['manual',m.id,m.text,prev[m.id].items.length]),year:m.time.match(/^\d{4}/)?.[0]||'',product:'',quantity:'',unit:'',week:'',reviewReason:'원문과 대조 후 포함'}]}}))}>품목 행 추가</button>}
    </details>;
  }
  const stats=feed?.stats;
  const accounted=stats&&stats.selected+stats.review+stats.excluded+stats.duplicates;
  const auditRows=(feed?.audit||[]).filter(m=>!auditQuery||m.text.toLowerCase().includes(auditQuery.toLowerCase()));
  return <>
    <header className="kakao-toolbar"><h3>수입방 카톡 추가 발주</h3>
      <p>발주가 있는 최근 2일 · 최신 카톡순 · 1분마다 갱신</p>
      <button type="button" className="kakao-refresh" onClick={()=>setRetry(v=>v+1)}>새로 조회</button>
      {error&&<p role="alert">{error}</p>}{!feed&&!error&&<p role="status">수입방 카톡을 불러오는 중…</p>}
      {feed&&<p>{feed.orderDays?.length?'발주일: '+feed.orderDays.join(' · '):'합산 가능한 발주일 없음'}{feed.latest&&' · 최근 수집 원문 '+feed.latest}</p>}
      {feed?.reviewThrough&&<p>선택 발주일 이후 {feed.reviewThrough}까지의 취소·변경도 확인합니다.</p>}
      {stats&&<p className="kakao-counts">카톡 {stats.scanned}건 분석 · 추가 발주 {stats.selected}건 · 검토 {stats.review}건 · 일반 대화 제외 {stats.excluded}건 · 중복 제외 {stats.duplicates}건</p>}
      <p>차수·품목군 버튼으로 범위를 선택하고 원문과 합계를 서로 대조하세요. 수정 내용은 이 화면에서만 유지됩니다.</p>
      {(week&&!activeWeek||group&&!activeGroup)&&<p role="status">선택한 차수·품목군이 현재 자료에 없어 전체 범위를 표시합니다. 버튼에서 다시 선택하세요.</p>}
      <span role="status">{notice}</span>
    </header>
    <div className="kakao-columns">
      <section className="kakao-originals" aria-label="선별된 카톡 원문"><h4 ref={originalHeading} tabIndex={-1}>선별된 추가 발주 원문 · {shownMessages.length}건</h4>
        {selectedTotal&&<p className="kakao-match-notice">{selectedTotal.product} {selectedTotal.quantity} {selectedTotal.unit}의 근거 원문 <button type="button" onClick={()=>setFocus(null)}>매칭 해제</button></p>}
        {shownMessages.map(renderMessage)}
        {feed&&!shownMessages.length&&<p>선택 범위의 추가 발주 원문이 없습니다.</p>}
        {reviews.length>0&&<><button type="button" aria-expanded={showReview} onClick={()=>{setShowReview(v=>!v);setWeek('');setGroup('');setFocus(null);}}>검토 필요 {reviews.length}건 {showReview?'접기':'보기'}</button>
        {showReview&&<section aria-label="카톡 발주 검토"><p>검토 목록은 차수·품목군 필터 밖의 요청도 원문으로 확인할 수 있습니다. 합산 전 필요한 값을 확인하세요.</p>{reviews.map(renderMessage)}</section>}</>}
        <details className="kakao-audit" onToggle={e=>setShowAudit(e.currentTarget.open)}><summary>누락 확인 · 제외 원문 대조</summary>
          <p>{stats?`수집 ${stats.scanned}건 = 발주·검토·제외·중복 ${accounted}건 (${stats.scanned===accounted?'분류 건수 일치':'분류 건수 불일치'})`:''}</p>
          <p>이 대조는 nenovakakao가 보관한 수입방 원문 기준입니다. 카톡방 전체의 수집 누락 여부는 확인되지 않았습니다. 카톡방의 최근 메시지 시각·본문을 위 수집 시각과 대조하고, 사진 속 주문은 별도로 확인하세요.</p>
          <label>제외 원문 검색<input value={auditQuery} onChange={e=>setAuditQuery(e.target.value)} placeholder="품목명 또는 수량"/></label>
          {showAudit&&!feed?.audit&&!error&&<p>제외 원문을 불러오는 중…</p>}
          {auditRows.map(m=><details key={m.id} data-audit-id={m.id}><summary>{m.time} · {m.quantityCandidate?'수량 포함 · ':''}{m.reason}</summary><blockquote>{m.text}</blockquote>{m.duplicateOf?<p>중복 원본 요청: {m.duplicateOf}</p>:<button type="button" disabled={!!manual[m.id]} onClick={()=>addManual(m)}>{manual[m.id]?'검토로 가져옴':'발주로 검토'}</button>}</details>)}
        </details>
      </section>
      <section className="kakao-totals" aria-label="농장 전달용 자동 합계"><h4 ref={totalHeading} tabIndex={-1}>농장 전달용 자동 합계</h4>
        <ChoiceButtons label="차수" all="전체 차수" values={weeks} value={activeWeek} onChange={v=>{setWeek(v);setGroup('');setFocus(null);}}/>
        <ChoiceButtons label="품목군" all="전체 품목군" values={groups} value={activeGroup} onChange={v=>{setGroup(v);setFocus(null);}}/>
        {selectedMessage&&<p className="kakao-match-notice">선택 원문이 포함된 합계 {shownTotals.length}행 <button type="button" onClick={()=>setFocus(null)}>매칭 해제</button></p>}
        {invalid&&<p role="alert">합산할 행의 차수, 품종, 양수 수량과 단위를 확인하세요.</p>}
        {totals.length>0&&!invalid?<><div className="kakao-table"><table><thead><tr>{['차수 · 품목군','품종 / 원문 대조','수량','비고 (업체·수량)'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>
          {shownTotals.map(r=><tr key={r.key} className={selectedTotal?.key===r.key||selectedMessage?'kakao-linked':''}><td>{r.year}/{r.week}차<br/>{groupKey(r)}</td><td><button type="button" className="kakao-match-total" aria-pressed={selectedTotal?.key===r.key} onClick={()=>setFocus({type:'total',key:r.key})}>{r.product}<small>원문 {r.sourceKeys.length}행 보기</small></button></td><td>{r.quantity} {r.unit}</td><td>{r.notes||'업체 미기재'}{r.requests&&<small><br/>요청: {r.requests}</small>}</td></tr>)}
        </tbody></table></div><button type="button" disabled={!!error} onClick={copy}>농장 전달용 복사</button><small>선택한 차수·품목군 전체 합계를 복사합니다.</small></>:!invalid&&feed&&<p role="status">현재 범위에 자동 합산할 추가 발주가 없습니다. 검토 필요 목록을 확인하세요.</p>}
      </section>
    </div>
  </>;
}
export default function KakaoAdditions(){return <aside className="kakao-additions" aria-label="수입방 추가 발주"><RecentReview/><style jsx global>{`
.kakao-additions{min-width:0;color:#193558;align-self:start}.kakao-toolbar,.kakao-originals,.kakao-totals{padding:14px;border:1px solid #cddbf0;border-radius:10px;background:#f6f9ff;min-width:0}
.kakao-toolbar{margin-bottom:12px}.kakao-columns{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:12px;align-items:start}.kakao-additions h3,.kakao-additions h4{margin:0 0 12px}.kakao-additions p{line-height:1.5;margin:8px 0}
.kakao-additions button{font:inherit;color:#193558;background:white;border:1px solid #b9cbed;border-radius:6px;padding:7px 9px;cursor:pointer}.kakao-additions button:disabled{opacity:.5;cursor:default}.kakao-additions button[aria-pressed=true]{background:#2056bd;color:white}.kakao-additions :focus-visible{outline:3px solid #eaa52c;outline-offset:2px}
.kakao-choices{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.kakao-choices strong{flex-basis:100%}.kakao-additions details{background:white;padding:10px;margin-top:8px;border:1px solid #e0e8f5;border-radius:6px}.kakao-additions summary{cursor:pointer;overflow-wrap:anywhere}.kakao-additions blockquote{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #9eb7df;padding-left:10px;margin:12px 0}
.kakao-additions fieldset{display:flex;flex-wrap:wrap;gap:6px;min-width:0;border:1px solid #cddbf0;margin:8px 0}.kakao-additions fieldset>label{display:grid;flex:1 1 90px}.kakao-additions input:not([type=checkbox]){width:100%;min-width:0;box-sizing:border-box;padding:6px;border:1px solid #bdcce4;border-radius:4px;font:inherit}
.kakao-table{overflow-x:auto}.kakao-table table{width:100%;border-collapse:collapse;background:white}.kakao-table th,.kakao-table td{text-align:left;padding:7px;border-bottom:1px solid #cddbf0;overflow-wrap:anywhere}.kakao-additions small{display:block}.kakao-linked{background:#fff4d6!important;box-shadow:inset 3px 0 #e8a623}.kakao-match-notice{padding:8px;background:#fff4d6}.kakao-match-total{width:100%;text-align:left}.kakao-audit{margin-top:16px!important}
.kakao-additions h4{scroll-margin-top:90px}
@media(max-width:1200px){.kakao-columns{grid-template-columns:minmax(0,1fr)}}
`}</style></aside>;}
