import { Fragment, useEffect, useRef, useState } from 'react';
import { validItem, farmTotals, groupImportTotals, importItemView, importTotalsText, importTotalKey, manualImportReviews, messageOrder } from '../../lib/importKakaoAdditions';

const fields = [['country','국가'],['group','품목군'],['week','차수'],['product','품종'],['quantity','수량'],['unit','단위'],['customer','업체 / CL']];
const groupKey = row => [row.country||'국가 미상',row.group||'품목군 미상'].join(' · ');
const weekKey = row => row.year+'/'+(row.week||'차수 미상');
const importRoom = '수입방';
const requestFilters = ['전체','추가','취소'];
const sourceType = m => m.kind === 'addition' ? '추가' : /취소|삭제되었습니다/.test(m.text) ? '취소' : '검토';
const sourceRef = id => '원문 ' + id.replace(/^archive:/,'').slice(0,10).toUpperCase();
const validForFarm = row => validItem(row) && row.unit && /^\d{1,2}(?:-\d{1,2})?$/.test(row.week);
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
function RecentReview() {
  const [feed,setFeed]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [edits,setEdits]=useState({}),[notice,setNotice]=useState('');
  const [week,setWeek]=useState(''),[group,setGroup]=useState(''),[focus,setFocus]=useState(null);
  const [showAudit,setShowAudit]=useState(false),[auditQuery,setAuditQuery]=useState('');
  const [sourceQuery,setSourceQuery]=useState(''),[sourceFilter,setSourceFilter]=useState('전체');
  const [manual,setManual]=useState({});
  const [editingRow,setEditingRow]=useState('');
  const originalHeading=useRef(null),detailHeading=useRef(null),sourceList=useRef(null);
  useEffect(()=>{
    if(!focus)return;
    const heading=focus.type==='total'?originalHeading.current:detailHeading.current;
    heading?.scrollIntoView({block:'start'});heading?.focus({preventScroll:true});
    const list=sourceList.current;
    if(!list)return;
    if(focus.type==='total')list.scrollTop=0;
    else {
      const original=[...list.querySelectorAll('[data-source-id]')].find(node=>node.dataset.sourceId===focus.id);
      if(original){
        const offset=original.getBoundingClientRect().top-list.getBoundingClientRect().top;
        if(offset<0||offset>=list.clientHeight)list.scrollTop+=offset;
      }
    }
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
  const allRows=allMessages.filter(m=>sourceType(m)!=='취소').flatMap(m=>m.items.map(view));
  const weeks=[...new Set(allRows.map(weekKey))].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const activeWeek=weeks.includes(week)?week:'';
  const groups=[...new Set(allRows.filter(r=>!activeWeek||weekKey(r)===activeWeek).map(groupKey))].sort();
  const activeGroup=groups.includes(group)?group:'';
  const inScope=row=>(!activeWeek||weekKey(row)===activeWeek)&&(!activeGroup||groupKey(row)===activeGroup);
  const rows=allRows.filter(inScope),totals=farmTotals(rows);
  const invalid=rows.some(r=>r.checked&&!validForFarm(r));
  const selectedTotal=focus?.type==='total'?totals.find(t=>t.key===focus.key):null;
  const selectedMessage=focus?.type==='message'?allMessages.find(m=>m.id===focus.id):null;
  const sourceKeys=new Set(selectedTotal?.sourceKeys||[]);
  const messageKeys=new Set(selectedMessage?.items.map(i=>i.key)||[]);
  const shownTotals=selectedMessage?totals.filter(t=>t.sourceKeys.some(k=>messageKeys.has(k))):totals;
  const ledger=groupImportTotals(shownTotals);
  const contributions=selectedTotal?allMessages.flatMap(message=>message.items
    .filter(item=>sourceKeys.has(item.key)).map(item=>({message,row:view(item)}))):[];
  const query=sourceQuery.normalize('NFKC').trim().toLowerCase();
  const shownMessages=allMessages
    .filter(m=>(m.id===selectedMessage?.id||m.kind==='review'||m.items.some(i=>inScope(view(i))))
      && (!selectedTotal||m.items.some(i=>sourceKeys.has(i.key)))
      && (sourceFilter==='전체'||sourceType(m)===sourceFilter)
      && (!query||[sourceRef(m.id),importRoom,m.time,m.text].some(value=>String(value||'').normalize('NFKC').toLowerCase().includes(query))))
    .sort((a,b)=>messageOrder(b.time).localeCompare(messageOrder(a.time)));
  function matchTotal(key) {
    setSourceQuery('');setSourceFilter('전체');
    setFocus({type:'total',key});
  }
  function matchMessage(id) {
    setEditingRow('');
    setFocus({type:'message',id});
  }
  const update=(key,patch)=>{setNotice('');setEdits(prev=>({...prev,[key]:{...prev[key],...patch}}));};
  function addManual(m){
    const key=JSON.stringify(['manual',m.id,m.text]);
    setManual(prev=>({...prev,[m.id]:{...m,kind:'review',reason:'제외 원문에서 수동 검토',items:[{key,year:m.time.match(/^\d{4}/)?.[0]||'',product:'',quantity:'',unit:'',week:'',reviewReason:'원문과 대조 후 포함'}]}}));
    setEditingRow(key);
    setSourceFilter('전체');setSourceQuery('');setWeek('');setGroup('');setFocus({type:'message',id:m.id});setNotice('검토 목록에 가져왔습니다. 품목·수량·단위·차수를 확인한 뒤 합산을 체크하세요.');
  }
  async function copy(){try{await navigator.clipboard.writeText(importTotalsText(totals));setNotice('전달용 합계를 복사했습니다.');}catch{setNotice('복사할 수 없습니다. 합계 표를 선택해 복사하세요.');}}
  function renderMessage(m){
    const linked=selectedMessage?.id===m.id||m.items.some(i=>sourceKeys.has(i.key));
    const type=sourceType(m);
    return <article key={m.id} data-source-id={m.id} data-source-kind={m.kind} className={'kakao-order-message '+(linked?'kakao-linked':'')}>
      <div className="kakao-source-meta"><strong>{sourceRef(m.id)}</strong><span>{importRoom}</span><span>{m.time}</span><span>{type==='추가'?'추가 발주':type==='취소'?'취소 요청':'검토 필요'}</span></div>
      <pre className="kakao-source-body">{m.text}</pre>
      <div className="kakao-source-actions">
        <button type="button" className="kakao-match-source" aria-pressed={selectedMessage?.id===m.id} onClick={()=>matchMessage(m.id)}>품목·수량 보기{m.items.length?' · '+m.items.length+'행':''}</button>
      </div>
    </article>;
  }
  function renderDetails(message) {
    const cancelled=sourceType(message)==='취소';
    function rowStatus(row) {
      if (cancelled) return '취소 · 합계 제외';
      if (!row.checked) return row.reviewReason || '합계 제외';
      if (!validForFarm(row)) return '품목·수량·단위·차수 확인';
      return inScope(row)?'합산 대상':'선택 범위 밖';
    }
    return <section className="kakao-parsed kakao-linked" aria-label="원문별 품목·수량">
      <div className="kakao-details-header"><h5 ref={detailHeading} tabIndex={-1}>{sourceRef(message.id)} · 품목 {message.items.length}행</h5><button type="button" onClick={()=>setFocus(null)}>원문 선택 해제</button></div>
      <small>{message.time}</small>
      {message.reason&&<p>{message.reason}{cancelled?' · 취소 수량은 합계 제외':''}</p>}
      {message.items.length>0&&<table className="kakao-parsed-table"><thead><tr>
        <th scope="col">품종 · 업체</th><th scope="col">원문별 수량</th><th scope="col">반영 상태</th>
      </tr></thead><tbody>{message.items.map(base=>{
        const row=view(base);
        return <Fragment key={row.key}><tr data-parsed-item><th scope="row">{row.product||'품종 미기재'}
          <small>{groupKey(row)} · {weekKey(row)}</small>{row.customer&&<small>{row.customer}</small>}
          {row.note&&<small>요청 · {row.note}</small>}</th>
          <td className="kakao-quantity">{row.quantity||'—'} {row.unit}
            {(row.quantity!==base.quantity||row.unit!==base.unit)&&<small>추출 {base.quantity||'—'} {base.unit}</small>}</td>
          <td>{rowStatus(row)}{!cancelled&&<button type="button" className="kakao-edit-line" aria-expanded={editingRow===row.key} onClick={()=>setEditingRow(editingRow===row.key?'':row.key)}>{editingRow===row.key?'편집 닫기':'편집'}</button>}</td></tr>
          {!cancelled&&editingRow===row.key&&<tr><td colSpan={3}><fieldset className="kakao-edit-fields"><legend><label><input type="checkbox" checked={!!row.checked} onChange={e=>update(row.key,{checked:e.target.checked})}/> {message.kind==='review'?'검토 후 합산':'합산'} · {row.product||'품종 확인'}</label></legend>
            {fields.map(([key,label])=><label key={key}>{label}<input value={row[key]||''} onChange={e=>update(row.key,{[key]:e.target.value})}/></label>)}
            {row.checked&&validForFarm(row)&&inScope(row)&&<button type="button" onClick={()=>matchTotal(importTotalKey(row))}>이 품종 원문 모아보기</button>}
          </fieldset></td></tr>}
        </Fragment>;
      })}</tbody></table>}
      {!message.items.length&&<p>추출된 품목이 없습니다. 오른쪽 원문을 확인하세요.</p>}
      {message.retained?.map((r,i)=><p key={i}>기존 주문 유지 · {r.product} {r.quantity} {r.unit}</p>)}
      {message.unparsed?.length>0&&<p>해석하지 못한 수량 행 · {message.unparsed.join(' / ')}</p>}
      {manual[message.id]&&!cancelled&&<button type="button" onClick={()=>{
        const key=JSON.stringify(['manual',message.id,message.text,message.items.length]);
        setManual(prev=>({...prev,[message.id]:{...prev[message.id],items:[...prev[message.id].items,{key,year:message.time.match(/^\d{4}/)?.[0]||'',product:'',quantity:'',unit:'',week:'',reviewReason:'원문과 대조 후 포함'}]}}));
        setEditingRow(key);
      }}>품목 행 추가</button>}
    </section>;
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
      <section className="kakao-totals" aria-label="농장 전달용 자동 합계"><h4>농장 전달용 자동 합계</h4>
        <ChoiceButtons label="차수" all="전체 차수" values={weeks} value={activeWeek} onChange={v=>{setWeek(v);setGroup('');setFocus(current=>current?.type==='message'?current:null);}}/>
        <ChoiceButtons label="품목군" all="전체 품목군" values={groups} value={activeGroup} onChange={v=>{setGroup(v);setFocus(current=>current?.type==='message'?current:null);}}/>
        {selectedMessage&&renderDetails(selectedMessage)}
        {selectedTotal&&<section className="kakao-contributions kakao-linked" aria-label="합계에 포함된 원문별 수량">
          <h5>{selectedTotal.product} · 전체 합계 {selectedTotal.quantity} {selectedTotal.unit}</h5>
          <ul>{contributions.map(({message,row})=><li key={row.key}>
            <button type="button" onClick={()=>matchMessage(message.id)}>{sourceRef(message.id)}</button>
            <span>{row.customer||'업체 미기재'}</span><strong className="kakao-quantity">{row.quantity} {row.unit}</strong>
          </li>)}</ul>
        </section>}
        {invalid&&<p role="alert">합산할 행의 차수, 품종, 양수 수량과 단위를 확인하세요.</p>}
        {totals.length>0&&!invalid?<><div className="kakao-table">
          {selectedMessage&&<h5>연결된 품목의 전체 합계 · {shownTotals.length}행</h5>}
          {ledger.map(cycle=><table key={cycle.key}>
            <caption>{cycle.label}</caption>
            <thead><tr><th scope="col">품종 · 원문 대조</th><th scope="col" className="kakao-quantity">합계 수량</th><th scope="col">비고 (업체·수량)</th></tr></thead>
            {cycle.groups.map(section=><tbody key={section.key}>
              <tr className={section.complete?'kakao-group-heading':'kakao-group-heading kakao-group-unknown'}><th scope="rowgroup" colSpan={3}>{section.label}</th></tr>
              {section.rows.map(r=><tr key={r.key} data-total-item className={selectedTotal?.key===r.key||selectedMessage?'kakao-linked':''}>
                <th scope="row"><button type="button" className="kakao-match-total" aria-pressed={selectedTotal?.key===r.key} onClick={()=>matchTotal(r.key)}>{r.product}<small>원문 {r.sourceKeys.length}행 보기</small></button></th>
                <td className="kakao-quantity">{r.quantity} {r.unit}</td><td>{r.notes||'업체 미기재'}{r.requests&&<small>요청 · {r.requests}</small>}</td>
              </tr>)}
            </tbody>)}
          </table>)}
          {selectedMessage&&!shownTotals.length&&<p>선택 원문이 반영된 합계가 없습니다.</p>}
        </div><button type="button" disabled={!!error} onClick={copy}>농장 전달용 복사</button><small>선택한 차수·품목군 전체 합계를 복사합니다.</small></>:!invalid&&feed&&<p role="status">현재 범위에 자동 합산할 추가 발주가 없습니다. 검토 필요 원문을 확인하세요.</p>}
      </section>
      <section className="kakao-originals" aria-label="선별된 카톡 원문"><h4 ref={originalHeading} tabIndex={-1}>카톡 추가·취소 요청</h4>
        <p className="kakao-source-period">{feed?.orderDays?.length?feed.orderDays.join(' · '):'최근 발주일'} · 수입방</p>
        <input type="search" aria-label="카톡 원문 검색" placeholder="원문 번호·방·시각·내용 검색" value={sourceQuery} onChange={e=>setSourceQuery(e.target.value)}/>
        <div className="kakao-source-controls" role="group" aria-label="카톡 요청 유형">
          {requestFilters.map(type=><button key={type} type="button" aria-pressed={sourceFilter===type} onClick={()=>setSourceFilter(type)}>{type}</button>)}
          <span role="status">최신순 · {shownMessages.length}건</span>
        </div>
        {selectedTotal&&<p className="kakao-match-notice">{selectedTotal.product} {selectedTotal.quantity} {selectedTotal.unit}의 근거 원문 <button type="button" onClick={()=>setFocus(null)}>매칭 해제</button></p>}
        <div className="kakao-source-list" role="region" aria-label="카톡 요청 목록" tabIndex={0} ref={sourceList}>
          {shownMessages.map(renderMessage)}
          {feed&&!shownMessages.length&&<p>표시할 카톡 요청이 없습니다.</p>}
        </div>
        <details className="kakao-audit" onToggle={e=>setShowAudit(e.currentTarget.open)}><summary>누락 확인 · 제외 원문 대조</summary>
          <p>{stats?`수집 ${stats.scanned}건 = 발주·검토·제외·중복 ${accounted}건 (${stats.scanned===accounted?'분류 건수 일치':'분류 건수 불일치'})`:''}</p>
          <p>이 대조는 nenovakakao가 보관한 수입방 원문 기준입니다. 카톡방 전체의 수집 누락 여부는 확인되지 않았습니다. 카톡방의 최근 메시지 시각·본문을 위 수집 시각과 대조하고, 사진 속 주문은 별도로 확인하세요.</p>
          <label>제외 원문 검색<input value={auditQuery} onChange={e=>setAuditQuery(e.target.value)} placeholder="품목명 또는 수량"/></label>
          {showAudit&&!feed?.audit&&!error&&<p>제외 원문을 불러오는 중…</p>}
          {auditRows.map(m=><details key={m.id} data-audit-id={m.id}><summary>{m.time} · {m.quantityCandidate?'수량 포함 · ':''}{m.reason}</summary><blockquote>{m.text}</blockquote>{m.duplicateOf?<p>중복 원본 요청: {m.duplicateOf}</p>:<button type="button" disabled={!!manual[m.id]} onClick={()=>addManual(m)}>{manual[m.id]?'검토로 가져옴':'발주로 검토'}</button>}</details>)}
        </details>
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
.kakao-table{overflow-x:auto}.kakao-table table{width:100%;border-collapse:collapse;background:white}.kakao-table th,.kakao-table td{text-align:left;padding:7px;border-bottom:1px solid #cddbf0;overflow-wrap:anywhere}.kakao-additions small{display:block;font-size:12.5px}.kakao-linked{background:#fff4d6!important;box-shadow:inset 3px 0 #e8a623}.kakao-match-notice{padding:8px;background:#fff4d6}.kakao-match-total{width:100%;text-align:left}.kakao-audit{margin-top:16px!important}
.kakao-additions h4,.kakao-additions h5{scroll-margin-top:90px}
.kakao-table caption{padding:8px;text-align:left;font-weight:700;color:#17365f;background:#dce7f9;font-variant-numeric:tabular-nums}
.kakao-table table+table{margin-top:12px}
.kakao-table .kakao-group-heading th{background:#edf3fb;font-size:13.5px;color:#334155}
.kakao-table .kakao-group-unknown th{background:#fff5dd}
.kakao-table [data-total-item]>th{min-width:100px}
.kakao-table [data-total-item]>td:last-child{width:44%}
.kakao-parsed,.kakao-contributions{margin:0 0 12px;padding:10px;border:1px solid #e3c370;overflow-wrap:anywhere}
.kakao-details-header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.kakao-additions h5{margin:0;font-size:14px}
.kakao-parsed-table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13.5px}
.kakao-parsed-table th,.kakao-parsed-table td{padding:6px;text-align:left;vertical-align:top;border-bottom:1px solid #e7d9b7}
.kakao-parsed-table tbody th{font-weight:600}
.kakao-parsed-table small{font-weight:400}
.kakao-parsed-table .kakao-edit-line{display:block;margin-top:4px;padding:3px 6px}
.kakao-contributions ul{list-style:none;margin:6px 0 0;padding:0}
.kakao-contributions li{display:grid;grid-template-columns:minmax(0,auto) minmax(0,1fr) auto;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid #e7d9b7}
.kakao-originals,.kakao-totals{font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕','Segoe UI',sans-serif;font-size:14px}
.kakao-originals{background:white}
.kakao-source-period,.kakao-source-meta,.kakao-source-controls span{color:#334155;font-size:12.5px;font-variant-numeric:tabular-nums}
.kakao-source-controls,.kakao-source-actions,.kakao-source-meta{display:flex;flex-wrap:wrap;align-items:center;gap:5px 8px}
.kakao-source-controls{margin:8px 0}
.kakao-source-controls button,.kakao-source-actions button{font-size:13.5px;padding:4px 7px}
.kakao-source-list{max-height:65dvh;overflow:auto;overscroll-behavior:contain;border-block:1px solid #cddbf0}
.kakao-order-message{padding:10px 8px;border-bottom:1px solid #e0e8f5}
.kakao-order-message:last-child{border-bottom:0}
.kakao-source-body{margin:5px 0 7px;font:inherit;color:#0f172a;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere}
.kakao-choices button{font-size:13.5px;padding:5px 8px;line-height:1.3}
.kakao-choices .kakao-more{border-style:dashed}
.kakao-additions .kakao-quantity{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
.kakao-table th,.kakao-table td{vertical-align:top}
.kakao-match-total small{margin-top:3px}
@media(max-width:1200px){.kakao-columns{grid-template-columns:minmax(0,1fr)}}
`}</style></aside>;}
