import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { validItem, farmTotals, importItemView, importTotalsText, importCategoryLabel, importTotalKey, manualImportReviews, messageOrder, groupFarmTotalsByCycle, matchesCountryOrderScope, visibleKakaoMessages, kakaoMessagePageSize } from '../../lib/importKakaoAdditions';

import { importCountryLabel } from '../../lib/importToolsDisplay';

const fields = [['country','국가'],['group','품목군'],['week','차수'],['product','품종'],['quantity','수량'],['unit','단위'],['customer','업체 / CL']];
const groupKey = row => importCategoryLabel(row, {showMissing:true});
const weekKey = row => row.year+'/'+(row.week||'차수 미상');
const importRoom = '수입방';
const requestFilters = ['전체','추가','취소','합계 반영'];
const sourceType = m => m.kind === 'addition' ? '추가' : /취소|삭제되었습니다/.test(m.text) ? '취소' : '검토';
const sourceReference = id => '원문 ' + id.replace(/^archive:/,'').slice(0,10).toUpperCase();
function ChoiceButtons({label, values, value, onChange, all}) {
  const [expanded, setExpanded] = useState(false);
  const limit = label === '차수' ? 5 : 6;
  const choices = ['', ...values];
  const compact = choices.slice(0, limit);
  if (value && !compact.includes(value)) compact[compact.length - 1] = value;
  const visible = expanded ? choices : compact;
  return <div className="kakao-choices" role="group" aria-label={label} onKeyDown={e=>{
    if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(e.key))return;
    const buttons=[...e.currentTarget.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
    if(index<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)+buttons.length)%buttons.length;buttons[next].focus();
  }}><strong>{label}</strong>{visible.map(v=><button key={v} type="button" aria-pressed={value===v} onClick={()=>onChange(v)}>{v||all}</button>)}
    {choices.length > limit && <button type="button" className="kakao-more" aria-expanded={expanded}
      onClick={()=>setExpanded(v=>!v)}>{expanded ? label+' 접기' : label+' 더 보기 ('+(choices.length-limit)+')'}</button>}
  </div>;
}
const noHiddenMessages = new Set();
function readHiddenMessages(key) {
  const saved=JSON.parse(localStorage.getItem(key)||'[]');
  return new Set(Array.isArray(saved)?saved.filter(id=>typeof id==='string'):[]);
}
function useHiddenMessages(userId) {
  const [hidden,setHidden]=useState(null);
  useEffect(()=>{
    if(!userId)return;
    let disposed=false, storageKey='';
    function onStorage(event) {
      if(event.key!==storageKey)return;
      try{setHidden({userId,key:storageKey,ids:readHiddenMessages(storageKey)});}catch{}
    }
    async function load() {
      let ids=noHiddenMessages;
      try{
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(userId));
        storageKey='nenova.kakao-visibility.v1.'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
        ids=readHiddenMessages(storageKey);
      }catch{}
      if(disposed)return;
      setHidden({userId,key:storageKey,ids});
      if(storageKey)window.addEventListener('storage',onStorage);
    }
    load();
    return()=>{disposed=true;window.removeEventListener('storage',onStorage);};
  },[userId]);
  const current=hidden?.userId===userId?hidden:null;
  function change(id,hide) {
    if(!current)return false;
    const ids=new Set(current.ids);
    let saved=false;
    if(hide)ids.add(id);
    else ids.delete(id);
    try{
      if(current.key){localStorage.setItem(current.key,JSON.stringify([...ids]));saved=true;}
    }catch{}
    setHidden({...current,ids});
    return saved;
  }
  return {ids:current?.ids||noHiddenMessages,ready:!!current,change};
}
function RecentReview({orderScope,userId}) {
  const [feed,setFeed]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [loading,setLoading]=useState(true);
  const [edits,setEdits]=useState({}),[notice,setNotice]=useState('');
  const [week,setWeek]=useState(''),[group,setGroup]=useState(''),[focus,setFocus]=useState(null);
  const scopeKey = JSON.stringify(orderScope);
  const [lastScopeKey,setLastScopeKey] = useState(scopeKey);
  const [messageLimit,setMessageLimit] = useState(kakaoMessagePageSize);
  const [showAudit,setShowAudit]=useState(false),[auditQuery,setAuditQuery]=useState('');
  const [sourceQuery,setSourceQuery]=useState(''),[sourceFilter,setSourceFilter]=useState('전체');
  const [manual,setManual]=useState({});
  const [openEditors,setOpenEditors]=useState({});
  const [toolbarOpen,setToolbarOpen]=useState(false),[showHidden,setShowHidden]=useState(false);
  const toolbarDetailsId=useId();
  const hiddenMessages=useHiddenMessages(userId);
  const visibilityButton=useRef(null);
  const originalHeading=useRef(null),totalHeading=useRef(null),sourceList=useRef(null);
  if (scopeKey !== lastScopeKey) {
    setLastScopeKey(scopeKey);
    setWeek('');setGroup('');setFocus(null);
    setSourceFilter('전체');setSourceQuery('');setShowHidden(false);setMessageLimit(kakaoMessagePageSize);
  }
  useEffect(()=>{
    if(!focus)return;
    const heading=focus.type==='total'?originalHeading.current:totalHeading.current;
    heading?.scrollIntoView({block:'start'});heading?.focus({preventScroll:true});
    if(focus.type==='total'){
      const list=sourceList.current;
      const first=list?.querySelector('.kakao-order-message.kakao-linked');
      if(first)list.scrollTop+=first.getBoundingClientRect().top-list.getBoundingClientRect().top;
    }
  },[focus]);
  useEffect(()=>{
    const controller=new AbortController();let pending=false;
    async function refresh(foreground=false){
      if(pending)return;
      pending=true;
      if(foreground){setLoading(true);setError('');}
      try{
        const response=await fetch('/api/import/tools/kakao-additions'+(showAudit?'?audit=1':''),{signal:controller.signal,cache:'no-store'});
        const body=await response.json();
        if(!response.ok||!Array.isArray(body.messages))throw Error(body.error||'조회하지 못했습니다.');
        if(!controller.signal.aborted){setFeed(body);setError('');}
      }catch(failure){
        if(!controller.signal.aborted)setError(failure.message);
      }finally{
        pending=false;
        if(foreground&&!controller.signal.aborted)setLoading(false);
      }
    }
    refresh(true);
    const timer=setInterval(refresh,60000);
    return()=>{clearInterval(timer);controller.abort();};
  },[retry,showAudit]);
  const messages=feed?.messages||[];
  const recovered=manualImportReviews(manual,feed);
  const reviews=[...(feed?.review||[]),...recovered];
  const allMessages=[...messages,...reviews];
  const view=row=>importItemView(row,edits[row.key]);
  const inOrderScope=row=>matchesCountryOrderScope(row,orderScope);
  const allRows=allMessages.filter(m=>sourceType(m)!=='취소').flatMap(m=>m.items.map(view)).filter(inOrderScope);
  const weeks=[...new Set(allRows.map(weekKey))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const activeWeek=weeks.includes(week)?week:'';
  const groups=[...new Set(allRows.filter(r=>!activeWeek||weekKey(r)===activeWeek).map(groupKey))].sort();
  const activeGroup=groups.includes(group)?group:'';
  const inScope=row=>inOrderScope(row)&&(!activeWeek||weekKey(row)===activeWeek)&&(!activeGroup||groupKey(row)===activeGroup);
  const rows=allRows.filter(inScope),totals=farmTotals(rows);
  const invalid=rows.some(r=>r.checked&&(!validItem(r)||!r.unit||!/^\d{1,2}(?:-\d{1,2})?$/.test(r.week)));
  const includedSourceKeys=new Set(invalid?[]:totals.flatMap(total=>total.sourceKeys));
  const includedRows=new Map(rows.filter(row=>includedSourceKeys.has(row.key)).map(row=>[row.key,row]));
  const selectedTotal=focus?.type==='total'?totals.find(t=>t.key===focus.key):null;
  const selectedMessage=focus?.type==='message'?allMessages.find(m=>m.id===focus.id):null;
  const sourceKeys=new Set(selectedTotal?.sourceKeys||[]);
  const messageKeys=new Set(selectedMessage?.items.map(i=>i.key)||[]);
  const shownTotals=selectedMessage?totals.filter(t=>t.sourceKeys.some(k=>messageKeys.has(k))):totals;
  const cycleTotals=groupFarmTotalsByCycle(shownTotals);
  const linkedSources=selectedTotal?allMessages.filter(m=>m.items.some(i=>sourceKeys.has(i.key))):[];
  const query=sourceQuery.normalize('NFKC').trim().toLowerCase();
  const matchesCurrentScope=m=>(m.kind==='review'&&(!orderScope||manual[m.id]||m.items.some(i=>inOrderScope(view(i))))||m.items.some(i=>inScope(view(i))));
  const scopedMessages=allMessages.filter(matchesCurrentScope);
  const hiddenCount=scopedMessages.filter(m=>hiddenMessages.ids.has(m.id)).length;
  const linkedIds=new Set(linkedSources.map(m=>m.id));
  if(selectedMessage)linkedIds.add(selectedMessage.id);
  const shownMessages=scopedMessages
    .filter(m=>linkedIds.has(m.id)||(
      hiddenMessages.ids.has(m.id)===showHidden
      && (sourceFilter==='전체'||(sourceFilter==='합계 반영'
        ?m.items.some(item=>includedSourceKeys.has(item.key))
        :sourceType(m)===sourceFilter))
      && (!query||[importRoom,m.time,m.text].some(value=>String(value||'').normalize('NFKC').toLowerCase().includes(query)))))
    .sort((a,b)=>messageOrder(b.time).localeCompare(messageOrder(a.time)));
  const visibleMessages=visibleKakaoMessages(shownMessages,messageLimit,linkedIds);
  const scopeLabel=orderScope&&[importCountryLabel(orderScope.country),
    orderScope.year&&orderScope.majorWeek ? orderScope.year+'/'+(orderScope.orderWeek||orderScope.majorWeek)+'차' : '',
  ].filter(Boolean).join(' · ');
  function changeVisibility(message,hide) {
    const persisted=hiddenMessages.change(message.id,hide);
    if(hide&&linkedIds.has(message.id))setFocus(null);
    setNotice((hide?'원문을 목록에서 숨겼습니다.':'원문을 다시 표시했습니다.')+(persisted?'':' 이 화면에서만 적용됩니다.'));
    visibilityButton.current?.focus({preventScroll:true});
  }
  function matchTotal(key) {
    setFocus({type:'total',key});
  }
  const update=(key,patch)=>{setNotice('');setFocus(null);setEdits(prev=>({...prev,[key]:{...prev[key],...patch}}));};
  function addManual(m){
    const key=JSON.stringify(['manual',m.id,m.text]);
    setManual(prev=>({...prev,[m.id]:{...m,kind:'review',reason:'제외 원문에서 수동 검토',items:[{key,year:m.time.match(/^\d{4}/)?.[0]||'',product:'',quantity:'',unit:'',week:'',reviewReason:'원문과 대조 후 포함'}]}}));
    setOpenEditors(previous => ({...previous,[m.id]:true}));
    setSourceFilter('전체');setSourceQuery('');setShowHidden(false);setWeek('');setGroup('');setFocus(null);setNotice('검토 목록에 가져왔습니다. 품목·수량·단위·차수를 확인한 뒤 합산을 체크하세요.');
  }
  async function copy(){try{await navigator.clipboard.writeText(importTotalsText(groupFarmTotalsByCycle(totals).flatMap(cycle=>cycle.rows)));setNotice('전달용 합계를 복사했습니다.');}catch{setNotice('복사할 수 없습니다. 합계 표를 선택해 복사하세요.');}}
  function renderTotal(r){
    const picked=selectedTotal?.key===r.key;
    const selectedKeys=selectedMessage&&new Set(r.sourceKeys);
    const sourceAmounts=selectedMessage?.items.filter(i=>selectedKeys.has(i.key)).map(i=>{
      const row=view(i);
      return row.quantity+' '+row.unit;
    });
    return <tr key={r.key} className={picked||selectedMessage?'kakao-linked':''}><td className="kakao-row-scope">{groupKey(r)}</td><td><button type="button" className="kakao-match-total" aria-pressed={picked} onClick={()=>matchTotal(r.key)}>{r.product} <small>원문 {r.sourceKeys.length}행 보기</small></button>
      {picked&&<small className="kakao-source-reference">{linkedSources.map(m=>sourceReference(m.id)).join(' · ')}</small>}</td>
      <td className="kakao-quantity">{r.quantity} {r.unit}{sourceAmounts?.length>0&&<small className="kakao-source-reference">이 원문 {sourceAmounts.join(' + ')}</small>}</td>
      <td>{r.notes||(!r.requests&&<span className="kakao-no-notes" role="img" aria-label="업체 미기재">–</span>)}{r.requests&&<small>요청: {r.requests}</small>}</td></tr>;
  }
  function renderMessage(m){
    const visible=m.kind==='review'?m.items.filter(i=>manual[m.id]||inOrderScope(view(i))):m.items.filter(i=>inScope(view(i)));
    const linked=selectedMessage?.id===m.id||m.items.some(i=>sourceKeys.has(i.key));
    const contributions=m.items.map(item=>includedRows.get(item.key)).filter(Boolean);
    const type=sourceType(m);
    const open=!!openEditors[m.id];
    const hidden=hiddenMessages.ids.has(m.id);
    return <article key={m.id} data-source-id={m.id} data-source-kind={m.kind} className={'kakao-order-message '+(linked?'kakao-linked':'')}>
      <div className="kakao-source-meta"><strong>{importRoom}</strong><span>{m.time}</span><span>{type==='추가'?'추가 발주':type==='취소'?'취소 요청':'검토 필요'}</span>
        {contributions.length>0&&<span className="kakao-source-included"><span aria-hidden="true">✓ </span>합계 반영</span>}
        {linked&&hidden&&!showHidden&&<span className="kakao-temporary-source">숨긴 원문 · 매칭으로 표시</span>}
        {linked&&<strong className="kakao-source-reference">{sourceReference(m.id)}</strong>}
      </div>
      {contributions.length>0&&<div className="kakao-source-contributions" aria-label="이 원문에서 합산한 품목">
        <ul>{contributions.slice(0,3).map(row=><li key={row.key}>{row.product} {row.quantity} {row.unit}{row.customer&&' · '+row.customer}</li>)}</ul>
        {contributions.length>3&&<details><summary>반영 품목 {contributions.length-3}개 더 보기</summary>
          <ul>{contributions.slice(3).map(row=><li key={row.key}>{row.product} {row.quantity} {row.unit}{row.customer&&' · '+row.customer}</li>)}</ul>
        </details>}
      </div>}
      <pre className="kakao-source-body">{m.text}</pre>
      <div className="kakao-source-actions">
        {visible.length>0&&type!=='취소'&&<button type="button" className="kakao-match-source" aria-pressed={selectedMessage?.id===m.id} onClick={()=>setFocus({type:'message',id:m.id})}>이 원문의 합계 보기</button>}
        {(visible.length>0||m.reason)&&<button type="button" className="kakao-edit-source" aria-expanded={open} onClick={()=>setOpenEditors(previous=>({...previous,[m.id]:!open}))}>{open?'품목·수량 접기':m.kind==='review'?'발주 내용 검토':'품목·수량 확인'}</button>}
        {hiddenMessages.ready&&<button type="button" className="kakao-visibility-action" aria-label={hidden?'숨긴 원문 다시 표시':'정리: 원문 숨기기'} onClick={()=>changeVisibility(m,!hidden)}>{hidden?'다시 표시':'정리'}</button>}
      </div>
      {open&&<div>
      {m.reason&&<p className="kakao-review-reason">{m.reason} · {type==='취소'?'취소 수량은 합산 제외':'확인 전 합계 제외'}</p>}
      {m.retained?.map((r,i)=><p key={i}>기존 주문 유지: {r.product} {r.quantity} {r.unit} · 새 추가 수량이 아니므로 합산하지 않습니다.</p>)}
      {visible.map(base=>{const row=view(base);return <fieldset key={row.key} disabled={type==='취소'} className={sourceKeys.has(row.key)?'kakao-linked':''}><legend><label><input type="checkbox" disabled={type==='취소'} checked={type!=='취소'&&!!row.checked} onChange={e=>update(row.key,{checked:e.target.checked})}/> {type==='취소'?'취소 품종':m.kind==='review'?'검토 후 합산':'합산'} · {row.product||'품종 확인'}</label></legend>
        {fields.map(([key,label])=><label key={key}>{label}<input value={row[key]||''} onChange={e=>update(row.key,{[key]:e.target.value})}/></label>)}
        <small>{row.checked?'합계에 포함':row.reviewReason||'합계에서 제외'}{row.note&&' · 요청: '+row.note}</small>
        {row.checked&&validItem(row)&&<button type="button" onClick={()=>matchTotal(importTotalKey(row))}>이 품종 원문 모아보기</button>}
      </fieldset>;})}
      {m.unparsed?.length>0&&<p>해석하지 못한 수량 행: {m.unparsed.join(' / ')}</p>}
      {manual[m.id]&&<button type="button" onClick={()=>setManual(prev=>({...prev,[m.id]:{...prev[m.id],items:[...prev[m.id].items,{key:JSON.stringify(['manual',m.id,m.text,prev[m.id].items.length]),year:m.time.match(/^\d{4}/)?.[0]||'',product:'',quantity:'',unit:'',week:'',reviewReason:'원문과 대조 후 포함'}]}}))}>품목 행 추가</button>}
      </div>}
    </article>;
  }
  const stats=feed?.stats;
  const accounted=stats&&stats.selected+stats.review+stats.excluded+stats.duplicates;
  const auditRows=(feed?.audit||[]).filter(m=>!auditQuery||m.text.toLowerCase().includes(auditQuery.toLowerCase()));
  return <>
    <header className="kakao-toolbar">
      <div className="kakao-toolbar-main">
        <h3><button type="button" className="kakao-toolbar-toggle" aria-expanded={toolbarOpen} aria-controls={toolbarDetailsId} onClick={()=>setToolbarOpen(open=>!open)}>수입방 카톡 추가 발주 <span aria-hidden="true">{toolbarOpen?'▴':'▾'}</span></button></h3>
        <button type="button" className="kakao-refresh" disabled={loading} onClick={()=>{setLoading(true);setRetry(v=>v+1);}}>{loading?'조회 중…':'새로 조회'}</button>
      </div>
      {scopeLabel&&<p className="kakao-order-scope">왼쪽 선택 반영 · {scopeLabel}</p>}
      <div id={toolbarDetailsId} hidden={!toolbarOpen}>
        <p>발주가 있는 최근 2일 · 최신 카톡순 · 1분마다 갱신</p>
        {feed&&<p>{feed.orderDays?.length?'발주일: '+feed.orderDays.join(' · '):'합산 가능한 발주일 없음'}{feed.latest&&' · 최근 수집 원문 '+feed.latest}</p>}
        {feed?.reviewThrough&&<p>선택 발주일 이후 {feed.reviewThrough}까지의 취소·변경도 확인합니다.</p>}
        {stats&&<p className="kakao-counts">카톡 {stats.scanned}건 분석 · 추가 발주 {stats.selected}건 · 검토 {stats.review}건 · 일반 대화 제외 {stats.excluded}건 · 중복 제외 {stats.duplicates}건</p>}
        <p>차수·품목군 버튼으로 범위를 선택하고 원문과 합계를 서로 대조하세요. 품목 수정은 이 화면에서만 유지됩니다.</p>
      </div>
      {(week&&!activeWeek||group&&!activeGroup)&&<p role="status">선택한 차수·품목군이 현재 자료에 없어 전체 범위를 표시합니다. 버튼에서 다시 선택하세요.</p>}
      <span role="status">{notice}</span>
    </header>
    <div className="kakao-columns">
      <section className="kakao-totals" aria-label="농장 전달용 자동 합계"><h4 ref={totalHeading} tabIndex={-1}>농장 전달용 자동 합계</h4>
        {loading&&<p className="kakao-feed-status" role="status">{feed?'자동 합계를 갱신하는 중…':'농장 전달용 합계를 불러오는 중…'}</p>}
        {error&&!loading&&<p className="kakao-feed-status" role="alert">{feed?'자동 합계 갱신 실패 · 이전 합계 표시 중':'자동 합계를 불러오지 못했습니다.'} {error}</p>}
        {feed&&<><ChoiceButtons label="차수" all="전체 차수" values={weeks} value={activeWeek} onChange={v=>{setWeek(v);setGroup('');setFocus(null);setMessageLimit(kakaoMessagePageSize);}}/>
        <ChoiceButtons label="품목군" all="전체 품목군" values={groups} value={activeGroup} onChange={v=>{setGroup(v);setFocus(null);setMessageLimit(kakaoMessagePageSize);}}/>
        </>}
        {selectedMessage&&<p className="kakao-match-notice">{sourceReference(selectedMessage.id)} · 선택 원문이 포함된 전체 합계 {shownTotals.length}행 <button type="button" onClick={()=>setFocus(null)}>매칭 해제</button></p>}
        {invalid&&<p role="alert">합산할 행의 차수, 품종, 양수 수량과 단위를 확인하세요.</p>}
        {totals.length>0&&!invalid?<><div className="kakao-table"><table><thead><tr>{['국가 · 품목군','품종 / 원문 대조','수량','비고 (업체·수량)'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>
          {cycleTotals.map(cycle=><Fragment key={cycle.key}>
            <tr className="kakao-cycle-heading"><td colSpan={4}><h5>{cycle.label}</h5></td></tr>
            {cycle.rows.map(renderTotal)}
          </Fragment>)}
        </tbody></table></div><button type="button" disabled={loading||!!error} onClick={copy}>농장 전달용 복사</button><small>선택한 차수·품목군 전체 합계를 복사합니다.</small></>:!invalid&&feed&&!loading&&!error&&<p role="status">현재 범위에 자동 합산할 추가 발주가 없습니다. 검토 필요 목록을 확인하세요.</p>}
      </section>
      <section className="kakao-originals" aria-label="선별된 카톡 원문"><h4 ref={originalHeading} tabIndex={-1}>카톡 추가·취소 요청</h4>
        {loading&&<p className="kakao-feed-status" role="status">{feed?'카톡 원문을 갱신하는 중…':'수입방 카톡 원문을 불러오는 중…'}</p>}
        {error&&!loading&&<p className="kakao-feed-status" role="alert">{feed?'카톡 원문 갱신 실패 · 이전 원문 표시 중':'수입방 카톡 원문을 불러오지 못했습니다.'} {error}</p>}
        {feed&&<><p className="kakao-source-period">{feed?.orderDays?.length?feed.orderDays.join(' · '):'최근 발주일'} · 수입방</p>
        <input type="search" aria-label="카톡 원문 검색" placeholder="방·시각·내용 검색" value={sourceQuery} onChange={e=>{setSourceQuery(e.target.value);setMessageLimit(kakaoMessagePageSize);}}/>
        <div className="kakao-source-controls" role="group" aria-label="카톡 요청 유형">
          {requestFilters.map(type=><button key={type} type="button" aria-pressed={sourceFilter===type} onClick={()=>{setSourceFilter(type);setMessageLimit(kakaoMessagePageSize);}}>{type}</button>)}
          <span role="status">최신순 · {visibleMessages.length} / {shownMessages.length}건</span>
        </div>
        {hiddenMessages.ready&&<button ref={visibilityButton} type="button" className="kakao-hidden-toggle" aria-pressed={showHidden}
          onClick={()=>{setShowHidden(show=>!show);setFocus(null);setSourceQuery('');setSourceFilter('전체');setMessageLimit(kakaoMessagePageSize);}}>숨긴 원문 {hiddenCount}건</button>}
        {showHidden&&<p className="kakao-hidden-note">이 브라우저의 현재 계정에서만 목록을 정리합니다. 숨긴 원문도 합계에 반영됩니다.</p>}
        {selectedTotal&&<p className="kakao-match-notice">{selectedTotal.product} {selectedTotal.quantity} {selectedTotal.unit}의 근거 원문 <button type="button" onClick={()=>setFocus(null)}>매칭 해제</button></p>}
        <div className="kakao-source-list" role="region" aria-label="카톡 요청 목록" tabIndex={0} ref={sourceList}>
          {visibleMessages.map(renderMessage)}
          {visibleMessages.length<shownMessages.length&&<button type="button" className="kakao-more-sources" onClick={()=>setMessageLimit(n=>n+kakaoMessagePageSize)}>카톡 원문 {Math.min(kakaoMessagePageSize,shownMessages.length-visibleMessages.length)}건 더 보기</button>}
          {feed&&!shownMessages.length&&!loading&&!error&&<p>{showHidden?'조건에 맞는 숨긴 카톡 원문이 없습니다.':'표시할 카톡 요청이 없습니다.'}</p>}
        </div>
        <details className="kakao-audit" onToggle={e=>setShowAudit(e.currentTarget.open)}><summary>누락 확인 · 제외 원문 대조</summary>
          <p>{stats?`수집 ${stats.scanned}건 = 발주·검토·제외·중복 ${accounted}건 (${stats.scanned===accounted?'분류 건수 일치':'분류 건수 불일치'})`:''}</p>
          <p>이 대조는 nenovakakao가 보관한 수입방 원문 기준입니다. 카톡방 전체의 수집 누락 여부는 확인되지 않았습니다. 카톡방의 최근 메시지 시각·본문을 위 수집 시각과 대조하고, 사진 속 주문은 별도로 확인하세요.</p>
          <label>제외 원문 검색<input value={auditQuery} onChange={e=>setAuditQuery(e.target.value)} placeholder="품목명 또는 수량"/></label>
          {showAudit&&!feed?.audit&&!error&&<p>제외 원문을 불러오는 중…</p>}
          {auditRows.map(m=><details key={m.id} data-audit-id={m.id}><summary>{m.time} · {m.quantityCandidate?'수량 포함 · ':''}{m.reason}</summary><blockquote>{m.text}</blockquote>{m.duplicateOf?<p>중복 원본 요청: {m.duplicateOf}</p>:<button type="button" disabled={!!manual[m.id]} onClick={()=>addManual(m)}>{manual[m.id]?'검토로 가져옴':'발주로 검토'}</button>}</details>)}
        </details></>}
      </section>
    </div>
  </>;
}
export default function KakaoAdditions({orderScope,userId}){return <aside className="kakao-additions" aria-label="수입방 추가 발주"><RecentReview orderScope={orderScope} userId={userId}/><style jsx global>{`
.kakao-additions{min-width:0;color:#193558;align-self:start}.kakao-toolbar,.kakao-originals,.kakao-totals{padding:14px;border:1px solid #cddbf0;border-radius:10px;background:#f6f9ff;min-width:0}
.kakao-toolbar{margin-bottom:8px;padding:6px 10px}.kakao-toolbar-main{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between}.kakao-additions .kakao-toolbar-main h3{margin:0}.kakao-additions .kakao-toolbar-main button{padding:4px 8px;font-size:13.5px}.kakao-toolbar-main .kakao-toolbar-toggle{background:transparent;border-color:transparent;font-weight:700}.kakao-toolbar .kakao-order-scope{margin:4px 0;font-size:12.5px}.kakao-columns{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:12px;align-items:start}.kakao-additions h3,.kakao-additions h4{margin:0 0 12px}.kakao-additions p{line-height:1.5;margin:8px 0}
.kakao-additions button{font:inherit;color:#193558;background:white;border:1px solid #b9cbed;border-radius:6px;padding:7px 9px;cursor:pointer}.kakao-additions button:disabled{opacity:.5;cursor:default}.kakao-additions button[aria-pressed=true]{background:#2056bd;color:white}.kakao-additions :focus-visible{outline:3px solid #eaa52c;outline-offset:2px}
.kakao-choices{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}.kakao-choices strong{flex-basis:100%}.kakao-additions details{background:white;padding:10px;margin-top:8px;border:1px solid #e0e8f5;border-radius:6px}.kakao-additions summary{cursor:pointer;overflow-wrap:anywhere}.kakao-additions blockquote{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #9eb7df;padding-left:10px;margin:12px 0}
.kakao-additions fieldset{display:flex;flex-wrap:wrap;gap:6px;min-width:0;border:1px solid #cddbf0;margin:8px 0}.kakao-additions fieldset>label{display:grid;flex:1 1 90px}.kakao-additions input:not([type=checkbox]){width:100%;min-width:0;box-sizing:border-box;padding:6px;border:1px solid #bdcce4;border-radius:4px;font:inherit}
.kakao-table{overflow-x:auto}.kakao-table table{width:100%;border-collapse:collapse;background:white}.kakao-table th,.kakao-table td{text-align:left;padding:3px 6px;border-bottom:1px solid #cddbf0;overflow-wrap:anywhere}.kakao-additions small{display:block;font-size:12.5px}.kakao-linked{background:#fff4d6!important;box-shadow:inset 3px 0 #e8a623}.kakao-match-notice{padding:8px;background:#fff4d6}.kakao-table .kakao-match-total{width:100%;text-align:left;padding:2px 5px;min-height:25px;font-size:13.5px}.kakao-no-notes{color:#475569}.kakao-audit{margin-top:16px!important}
.kakao-additions h4{scroll-margin-top:90px}
.kakao-originals{background:white;font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕','Segoe UI',sans-serif;font-size:14px}
.kakao-source-period,.kakao-source-meta,.kakao-source-controls span{color:#334155;font-size:12.5px;font-variant-numeric:tabular-nums}
.kakao-source-controls,.kakao-source-actions,.kakao-source-meta{display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px}
.kakao-source-controls{margin:8px 0}.kakao-originals .kakao-hidden-toggle{padding:4px 7px;font-size:13.5px;margin-bottom:6px}.kakao-hidden-note,.kakao-temporary-source{color:#475569;font-size:12.5px}
.kakao-source-included{display:inline-block;white-space:nowrap;padding:1px 5px;border-radius:4px;background:#dcfce7;color:#14532d;font-weight:700}
.kakao-order-scope{color:#193558;font-weight:700}
.kakao-source-contributions{margin:5px 0;padding:4px 8px;border-left:2px solid #86b69d;color:#14532d;background:#edf8f1;font-size:13.5px;font-variant-numeric:tabular-nums}
.kakao-source-contributions ul{padding-left:17px;margin:0}
.kakao-source-contributions details{margin:3px 0 0;padding:0;border:0;background:transparent}
.kakao-more-sources{margin:8px}
.kakao-source-controls button,.kakao-source-actions button{font-size:13.5px;padding:4px 7px}
.kakao-source-list{max-height:65dvh;overflow:auto;overscroll-behavior:contain;border-block:1px solid #cddbf0}
.kakao-order-message{padding:10px 8px;border-bottom:1px solid #e0e8f5}
.kakao-order-message:last-child{border-bottom:0}
.kakao-source-body{margin:5px 0 7px;font:inherit;color:#0f172a;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.kakao-choices button{font-size:13.5px;padding:5px 8px;line-height:1.3}
.kakao-choices .kakao-more{border-style:dashed}
.kakao-feed-status{padding:8px 10px;border-left:3px solid #6888b7;background:#eef4ff;color:#193558;font-size:13.5px}
.kakao-feed-status[role=alert]{border-color:#b45309;background:#fff4d6;color:#5d4206}
.kakao-table h5{margin:0;font:inherit;font-weight:700}
.kakao-table .kakao-cycle-heading td{background:#dde9fa;color:#193558;font-size:13.5px;font-variant-numeric:tabular-nums}
.kakao-table .kakao-row-scope{width:24%;font-size:12.5px;color:#334155}
.kakao-table .kakao-quantity{white-space:nowrap;font-variant-numeric:tabular-nums}
.kakao-table th,.kakao-table td{vertical-align:top}
.kakao-additions .kakao-match-total small{display:inline-block;margin-left:2px;font-size:12.5px;white-space:nowrap}
.kakao-source-reference{color:#5d4206;font-variant-numeric:tabular-nums}
.kakao-table .kakao-source-reference{white-space:normal}
@media(max-width:1200px){.kakao-columns{grid-template-columns:minmax(0,1fr)}}
`}</style></aside>;}
