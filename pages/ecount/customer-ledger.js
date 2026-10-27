import { useEffect, useRef, useState } from 'react';
const money=n=>n==null?'—':n.toLocaleString('ko-KR');
const time=s=>s?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 수집되지 않음';
const messages={CUSTOMER_FORBIDDEN:'현재 담당하는 거래처만 조회할 수 있습니다. 거래처 목록을 다시 불러와 주세요.',CUSTOMER_LINK_REQUIRED:'거래처 식별값이 없거나 중복되어 연결을 확인해야 합니다.',LOGIN_REQUIRED:'로그인 후 이용해 주세요.',LEDGER_UNAVAILABLE:'채권 자료를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.'};
export default function CustomerLedger(){
  const [customers,setCustomers]=useState([]),[selected,setSelected]=useState(''),[data,setData]=useState(null),[meta,setMeta]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[listError,setListError]=useState('');
  const requestId=useRef(0);
  async function loadCustomers(){
    setListError('');
    try{const res=await fetch('/api/ecount/customer-ledger',{cache:'no-store'});const d=await res.json();if(!res.ok||!d.success)throw new Error(messages[d.error]||'담당 거래처를 불러오지 못했습니다.');setCustomers(d.customers);setMeta(d);}
    catch(e){setCustomers([]);setListError(e.message);}
  }
  async function load(key){
    const id=++requestId.current;setLoading(true);setError('');
    try{const res=await fetch(`/api/ecount/customer-ledger?custKey=${encodeURIComponent(key)}`,{cache:'no-store'});const d=await res.json();if(!res.ok||!d.success)throw new Error(messages[d.error]||'자료를 불러오지 못했습니다.');if(id===requestId.current)setData(d);}
    catch(e){if(id===requestId.current){setData(null);setError(e.message);}}
    finally{if(id===requestId.current)setLoading(false);}
  }
  useEffect(()=>{loadCustomers();return()=>{requestId.current++;};},[]);
  useEffect(()=>{
    setData(null);setError('');requestId.current++;
    if(!selected){setLoading(false);return;}
    load(selected);
    // Read the cached snapshot only. Opening this page never triggers an ECOUNT search.
    const timer=setInterval(()=>{if(document.visibilityState==='visible')load(selected);},60000);
    const focus=()=>load(selected);window.addEventListener('focus',focus);
    return()=>{clearInterval(timer);window.removeEventListener('focus',focus);requestId.current++;};
  },[selected]);
  useEffect(()=>{const back=e=>{if(selected){e.preventDefault();setSelected('');}};window.addEventListener('nenova:menu-back-request',back);return()=>window.removeEventListener('nenova:menu-back-request',back);},[selected]);
  const ledger=data?.ledger,period=data?.period||meta?.period,schedule=data?.schedule||meta?.schedule;
  return <section className="ledger-page">
    <h1 data-ui-page-title>거래처관리대장1(채권)</h1>
    <p className="muted">담당 거래처의 최근 1개월 전표별 채권 · 마지막 수집일 기준 · 이카운트 개별거래처 기준</p>
    <div className="controls"><label htmlFor="ledger-customer">내 거래처</label>
      <select id="ledger-customer" value={selected} onChange={e=>{requestId.current++;setData(null);setSelected(e.target.value);}}>
        <option value="">거래처를 선택하세요</option>
        {customers.map(c=><option key={c.custKey} value={c.custKey} disabled={!c.linked}>{c.name}{!c.linked?' · 연결 확인 필요':''}</option>)}
      </select><button onClick={()=>selected?load(selected):loadCustomers()} disabled={loading}>{loading?'조회 중…':'다시 조회'}</button>
    </div>
    <div className="info"><span>조회기간: {period?`${period.from} ~ ${period.to}`:'확인 중'}</span><span>{schedule?.label||'평일 09:00~18:00 매 정시 (한국시간)'}</span></div>
    <p className="muted">마지막 수집: {time(data?.takenAt)}{schedule?.nextAt&&` · 다음 예정: ${time(schedule.nextAt)}`}</p>
    {listError&&<p role="alert" className="error">{listError} <button onClick={loadCustomers}>목록 다시 불러오기</button></p>}
    {error&&<p role="alert" className="error">{error}</p>}
    {!listError&&meta&&customers.length===0&&<p className="notice">배정된 거래처가 없습니다. 전산의 거래처 담당자 배정을 확인해 주세요.</p>}
    {customers.some(c=>!c.linked)&&<p className="notice">‘연결 확인 필요’ 거래처는 식별값이 없거나 중복되어 조회할 수 없습니다.</p>}
    {!selected&&<p className="empty">거래처를 선택하면 전표별 판매·수금·잔액을 바로 확인할 수 있습니다.</p>}
    {loading&&<p role="status">자료를 확인하고 있습니다.</p>}
    {selected&&data&&!ledger&&<p className="notice">이 거래처의 최근 1개월 자료가 아직 수집되지 않았습니다. 수집 PC의 로그인과 거래처 연결을 확인해야 합니다. 자료가 없는 상태를 채권 0원으로 표시하지 않습니다.</p>}
    {ledger&&<>
      {schedule?.stale&&<p role="status" className="notice">예정된 갱신 시각이 지났습니다. 아래 자료는 마지막으로 검증된 수집본입니다.</p>}
      <div className="totals">{[['이월잔액',ledger.opening],['판매 합계',ledger.totals?.sales],['수금 합계',ledger.totals?.receipt],['최종잔액',ledger.totals?.balance]].map(([label,value])=><div key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div>
      <p>{ledger.rows.length.toLocaleString()}건 · 원본 합계 및 잔액 검증 완료</p>
      <div className="ledger-table-scroll"><table><caption className="sr-only">선택 거래처의 최근 1개월 전표별 채권</caption><colgroup><col style={{width:70}}/><col style={{width:140}}/><col style={{width:170}}/><col style={{width:170}}/><col style={{width:180}}/></colgroup>
        <thead><tr><th scope="col">순번</th><th scope="col">일자</th><th scope="col">판매</th><th scope="col">수금</th><th scope="col">잔액</th></tr></thead>
        <tbody>{ledger.rows.length?ledger.rows.map(r=><tr key={r.sequence}><td>{r.sequence}</td><td>{r.date}</td><td>{money(r.sales)}</td><td>{money(r.receipt)}</td><td>{money(r.balance)}</td></tr>):<tr><td colSpan={5}>해당 기간에 조회된 전표가 없습니다.</td></tr>}</tbody>
      </table></div>
    </>}
    <style jsx>{`
      @media(max-width:600px){:global([data-ui-popupbar]>[data-ui-page-title]){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}:global([data-ui-popupbar]>span:last-child){flex-shrink:0}:global([data-ui-popupbar]>span:last-child>span){display:none}:global([data-ui-popupbar] button){white-space:nowrap;flex-shrink:0}}
      .ledger-page{padding:24px;max-width:1200px;margin:0 auto;color:#172c40}.ledger-page h1{font-size:23px;margin:0 0 8px}.muted{color:#607286;font-size:13px;line-height:1.7}.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:24px 0 16px}.controls label{font-weight:700}select{min-width:250px;max-width:100%;padding:11px;border:1px solid #b7c8d8;border-radius:8px;background:#fff}button{padding:10px 16px;border:1px solid #b7c8d8;border-radius:8px;background:#fff;cursor:pointer}button:disabled{opacity:.55;cursor:wait}button:focus-visible,select:focus-visible{outline:3px solid #1985d0;outline-offset:2px}.info{display:flex;gap:24px;flex-wrap:wrap;font-size:14px}.notice,.error,.empty{padding:16px;border-radius:8px;line-height:1.7}.notice{background:#fff5d9;color:#795514}.error{background:#fff0f0;color:#a02020}.empty{background:#f0f5fa;margin-top:24px}.totals{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.totals>div{min-width:180px;padding:18px;border:1px solid #d7e2eb;border-radius:10px;background:white}.totals span{display:block;font-size:13px;color:#607286}.totals strong{display:block;margin-top:8px;font-size:22px;font-variant-numeric:tabular-nums}.ledger-table-scroll{overflow-x:auto}table{width:auto;border-collapse:collapse;table-layout:fixed;background:white}th,td{padding:11px 16px;border-bottom:1px solid #e2eaf1;text-align:right;font-variant-numeric:tabular-nums}th{background:#eef4f8}th:nth-child(2),td:nth-child(2){text-align:left}td[colspan]{text-align:center}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){.ledger-page{padding:16px}.totals>div{min-width:140px;flex:1}.info{gap:8px}select{width:100%}}
    `}</style>
  </section>;
}
