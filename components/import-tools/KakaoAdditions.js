import { useEffect, useState } from 'react';
import { validItem, farmTotals } from '../../lib/importKakaoAdditions';

const fields = [['group','품목군'],['product','품종'],['quantity','수량'],['unit','단위'],['customer','업체 / CL']];
function RecentReview() {
  const [feed, setFeed] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [edits, setEdits] = useState({});
  const [notice, setNotice] = useState('');
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
  const view = row=>({...row,...edits[row.key]});
  const update=(key,patch)=>{setNotice('');setEdits(prev=>({...prev,[key]:{...prev[key],...patch}}));};
  const rows=(messages||[]).flatMap(m=>m.items.map(view));
  const invalid=rows.some(r=>r.checked&&!validItem(r));
  const totals=farmTotals(rows);
  async function copy() {
    const lines=totals.map(r=>(r.group?r.group+' · ':'')+r.product+' '+r.quantity+r.unit+(r.notes?' ('+r.notes+')':''));
    try { await navigator.clipboard.writeText(lines.join('\n')); setNotice('전달용 합계를 복사했습니다.'); }
    catch {setNotice('복사할 수 없습니다. 합계 표를 선택해 복사하세요.');}
  }
  return <>
    <p>최근 2일 · 오늘과 어제 · 최신 카톡순 · 1분마다 갱신</p>
    <button type="button" onClick={() => setRetry(value => value + 1)}>새로 조회</button>
    {error && <p role="alert">{error}</p>}
    {!feed && !error && <p role="status">수입방 카톡을 불러오는 중…</p>}
    {feed && <p>{feed.from} ~ {feed.to}{feed.latest && ' · 최근 수집 원문 ' + feed.latest}</p>}
    {feed && messages.length === 0 && <p role="status">최근 2일 동안 동기화된 원문이 없습니다.</p>}
    <p>원문에서 이번에 추가할 항목을 체크하세요. 업체가 없으면 비워 두세요.</p>
    <h4>농장 전달용 합계</h4>
    {invalid && <p role="alert">체크한 행의 품종과 양수 수량을 확인하세요.</p>}
    {totals.length>0 && !invalid ? <><div className="kakao-table"><table><thead><tr>{['품목군','품종','수량','비고 (업체·수량)'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>
      {totals.map(r=><tr key={r.key}><td>{r.group||'미분류'}</td><td>{r.product}</td><td>{r.quantity} {r.unit}</td><td>{r.notes}</td></tr>)}
    </tbody></table></div><button type="button" onClick={copy}>농장 전달용 복사</button></> : !invalid && <p>항목을 선택하면 품종별 합계가 표시됩니다.</p>}
    <span role="status">{notice}</span>
    <h4>수입방 원문 · {messages.length}건</h4>
    {messages.map(m=><details key={m.id} open><summary>{m.time} {m.week && ' · '+m.week+'차'} · {m.text.split('\n')[0].slice(0,48)}</summary>
      <blockquote>{m.text}</blockquote>
      {m.items.map(base=>{const row=view(base);return <fieldset key={row.key}><legend><label><input type="checkbox" checked={!!row.checked} onChange={e=>update(row.key,{checked:e.target.checked})}/> 합산 · {row.product||'품종 직접 입력'}</label></legend>
        {fields.map(([key,label])=><label key={key}>{label}<input value={row[key]} placeholder={key==='group'?'예: 콜롬비아수국':undefined} onChange={e=>update(row.key,{[key]:e.target.value})}/></label>)}
        <small>{row.status}</small>
      </fieldset>;})}</details>)}
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
