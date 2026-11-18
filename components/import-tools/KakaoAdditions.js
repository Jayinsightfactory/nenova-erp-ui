import { useEffect, useState } from 'react';
import { validItem, farmTotals, importItemView, importTotalsText } from '../../lib/importKakaoAdditions';

const fields = [['country','국가'],['group','품목군'],['week','차수'],['product','품종'],['quantity','수량'],['unit','단위'],['customer','업체 / CL']];
function RecentReview() {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [edits, setEdits] = useState({});
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [showReview,setShowReview]=useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch('/api/import/tools/kakao-additions', {
          signal: controller.signal,
          cache: 'no-store',
        });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.messages)) throw Error(body.error || '조회하지 못했습니다.');
        if (!controller.signal.aborted) {
          setFeed(body);
          setError('');
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure.message);
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [retry]);
  const messages = feed?.messages || [];
  const reviews = feed?.review || [];
  const groupKey=row=>[row.country||'국가 미상',row.group||'품목군 미상'].join(' · ');
  const groups=[...new Set([...messages,...reviews].flatMap(m=>m.items.map(groupKey)))].sort();
  const activeFilter=groups.includes(filter)?filter:'';
  const view = row => importItemView(row, edits[row.key]);
  const update=(key,patch)=>{setNotice('');setEdits(prev=>({...prev,[key]:{...prev[key],...patch}}));};
  const rows=[...messages,...reviews].flatMap(m=>m.items.filter(r=>!activeFilter||groupKey(r)===activeFilter).map(view));
  const invalid=rows.some(r=>r.checked&&(!validItem(r)||!r.unit||!/^\d{1,2}(?:-\d{1,2})?$/.test(r.week)));
  const totals=farmTotals(rows);
  async function copy() {
    try { await navigator.clipboard.writeText(importTotalsText(totals)); setNotice('전달용 합계를 복사했습니다.'); }
    catch {setNotice('복사할 수 없습니다. 합계 표를 선택해 복사하세요.');}
  }
  function renderMessage(m) {
    const visible=m.items.filter(r=>!activeFilter||groupKey(r)===activeFilter);
    if(activeFilter&&!visible.length)return null;
    return <details key={m.id} open className="kakao-order-message"><summary>{m.time} · {m.kind==='review'?'검토 필요':'추가 발주'} · {m.text.split('\n')[0].slice(0,48)}</summary>
      {m.reason&&<p className="kakao-review-reason">{m.reason} · 확인 전 합계 제외</p>}
      <blockquote>{m.text}</blockquote>
      {m.retained?.map((r,i)=><p key={i}>기존 주문 유지: {r.product} {r.quantity} {r.unit} · 새 추가 수량이 아니므로 합산하지 않습니다.</p>)}
      {visible.map(base=>{const row=view(base);return <fieldset key={row.key}><legend><label><input type="checkbox" checked={!!row.checked} onChange={e=>update(row.key,{checked:e.target.checked})}/> {m.kind==='review'?'검토 후 합산':'합산'} · {row.product||'품종 확인'}</label></legend>
        {fields.map(([key,label])=><label key={key}>{label}<input value={row[key]||''} onChange={e=>update(row.key,{[key]:e.target.value})}/></label>)}
        <small>{row.checked?'합계에 포함':row.reviewReason||'합계에서 제외'}{row.note&&' · 요청: '+row.note}</small>
      </fieldset>;})}
      {m.unparsed?.length>0&&<p>해석하지 못한 수량 행: {m.unparsed.join(' / ')}</p>}
    </details>;
  }
  return <>
    <p>발주가 있는 최근 2일 · 최신 카톡순 · 1분마다 갱신</p>
    <button type="button" onClick={() => setRetry(value => value + 1)}>새로 조회</button>
    {error && <p role="alert">{error}</p>}
    {!feed && !error && <p role="status">수입방 카톡을 불러오는 중…</p>}
    {feed && <p>{feed.orderDays ? (feed.orderDays.length ? '발주일: '+feed.orderDays.join(' · ') : '수집된 원문에 합산 가능한 발주가 없습니다.') : `${feed.from} ~ ${feed.to}`}{feed.latest && ' · 최근 수집 원문 ' + feed.latest}</p>}
    {feed?.reviewThrough&&<p>선택된 발주일 이후 {feed.reviewThrough}까지의 취소·변경도 함께 확인합니다.</p>}
    {feed?.stats&&<p className="kakao-counts">카톡 {feed.stats.scanned}건 분석 · 추가 발주 {feed.stats.selected}건 · 검토 {feed.stats.review}건 · 일반 대화 제외 {feed.stats.excluded}건 · 중복 제외 {feed.stats.duplicates}건</p>}
    <p>발주에 해당하는 카톡만 선별해 원문의 품목·수량을 합산합니다. 업체 없는 수량도 포함하며, 취소·변경·조건부 요청은 검토로 분리합니다.</p>
    {groups.length>0&&<label>국가 · 품목군 <select aria-label="카톡 국가·품목군" value={activeFilter} onChange={e=>{setFilter(e.target.value);setNotice('');}}><option value="">전체 발주</option>{groups.map(g=><option key={g}>{g}</option>)}</select></label>}
    <h4>농장 전달용 자동 합계</h4>
    {invalid && <p role="alert">합산할 행의 차수(예: 46-01), 품종, 양수 수량과 단위를 확인하세요.</p>}
    {totals.length>0 && !invalid ? <><div className="kakao-table"><table><thead><tr>{['국가·품목군 / 차수','품종','수량','비고 (업체·수량)'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>
      {totals.map(r=><tr key={r.key}><td>{groupKey(r)}<br/>{r.year}/{r.week}차</td><td>{r.product}</td><td>{r.quantity} {r.unit}</td><td>{r.notes||'업체 미기재'}{r.requests&&<small><br/>요청: {r.requests}</small>}</td></tr>)}
    </tbody></table></div><button type="button" disabled={!!error} onClick={copy}>농장 전달용 복사</button></> : !invalid && feed && <p role="status">현재 범위에 자동 합산할 추가 발주가 없습니다.{reviews.length>0?' 검토 필요 목록을 확인하세요.':''}</p>}
    <span role="status">{notice}</span>
    <h4>선별된 추가 발주 원문 · {messages.filter(m=>!activeFilter||m.items.some(r=>groupKey(r)===activeFilter)).length}건</h4>
    {messages.map(renderMessage)}
    {reviews.length>0&&<><button type="button" aria-expanded={showReview} onClick={()=>setShowReview(v=>!v)}>검토 필요 {reviews.length}건 {showReview?'접기':'보기'}</button>
      {showReview&&<section aria-label="카톡 발주 검토"><p>취소·대체·조건부 요청은 자동 합산하지 않습니다. 원문과 연결되는 발주를 확인한 뒤 필요한 행만 수정·체크하세요.</p>{reviews.map(renderMessage)}</section>}</>}
  </>;
}
export default function KakaoAdditions() {
  return <aside className="kakao-additions" aria-label="수입방 추가 발주"><h3>수입방 카톡 추가 발주</h3>
    <RecentReview/>
    <style jsx global>{`
      .kakao-additions{min-width:0;padding:16px;background:#f6f9ff;border:1px solid #cddbf0;border-radius:10px;align-self:start;color:#193558}
      .kakao-additions h3{margin-top:0}.kakao-additions h4{margin:18px 0 8px}.kakao-additions p{line-height:1.55}
      .kakao-additions details{background:white;padding:10px;margin-top:6px;border-radius:5px}.kakao-additions summary{cursor:pointer;overflow-wrap:anywhere}
      .kakao-additions blockquote{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #9eb7df;padding-left:10px;margin:12px 0}
      .kakao-additions fieldset{display:flex;flex-wrap:wrap;gap:6px;min-width:0;border:1px solid #cddbf0;margin:8px 0}.kakao-additions fieldset>label{display:grid;flex:1 1 95px}.kakao-additions fieldset>label input{width:100%;min-width:0;box-sizing:border-box}
      .kakao-table{overflow-x:auto}.kakao-table table{width:100%;border-collapse:collapse;background:white}.kakao-table th,.kakao-table td{text-align:left;padding:6px;border-bottom:1px solid #cddbf0}
    `}</style>
  </aside>;
}
