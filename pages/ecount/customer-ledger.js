import { useEffect, useRef, useState } from 'react';
import { getReceivablesManagers, filterReceivablesRows } from '../../lib/ecountReceivablesPolicy.cjs';
const money=n=>n==null?'—':n.toLocaleString('ko-KR');
const time=s=>s?new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 수집되지 않음';
const messages={CUSTOMER_FORBIDDEN:'현재 담당하는 거래처만 조회할 수 있습니다. 거래처 목록을 다시 불러와 주세요.',CUSTOMER_LINK_REQUIRED:'거래처 식별값이 없거나 중복되어 연결을 확인해야 합니다.',LOGIN_REQUIRED:'로그인 후 이용해 주세요.',LEDGER_UNAVAILABLE:'채권 자료를 불러오지 못했습니다. 잠시 후 다시 조회해 주세요.',REQUEST_WINDOW_CLOSED:'최신화 요청은 평일 오전 8시부터 오후 6시까지 할 수 있습니다.',REQUEST_RATE_LIMIT:'이 거래처는 잠시 전에 조회를 요청했습니다. 10분 후 다시 요청해 주세요.',REFRESH_REQUEST_UNAVAILABLE:'최신화 요청을 접수하지 못했습니다. 잠시 후 다시 시도해 주세요.'};
export default function CustomerLedger(){
  const [customers,setCustomers]=useState([]),[selected,setSelected]=useState(''),[data,setData]=useState(null),[meta,setMeta]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[listError,setListError]=useState(''),[requesting,setRequesting]=useState(false);
  const requestId=useRef(0);
  const [search,setSearch]=useState(''),[manager,setManager]=useState('');
  const managers=getReceivablesManagers(customers);
  const filteredCustomers=filterReceivablesRows(customers,{search,manager});
  function selectManager(name){
    if(name===manager)return;
    requestId.current++;setData(null);setError('');setSelected('');setManager(name);
  }
  function selectCustomer(key){
    requestId.current++;setData(null);setError('');setSelected(selected===key?'':key);
  }
  function navigateButtons(event){
    const keys=['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End'];
    if(!keys.includes(event.key))return;
    const buttons=Array.from(event.currentTarget.querySelectorAll('button:not(:disabled)'));
    const index=buttons.indexOf(document.activeElement);
    if(index<0||!buttons.length)return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'||event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;
    buttons[next].focus();
  }
  async function loadCustomers(){
    setListError('');
    try{const res=await fetch('/api/ecount/customer-ledger',{cache:'no-store'});const d=await res.json();if(!res.ok||!d.success)throw new Error(messages[d.error]||'거래처 목록을 불러오지 못했습니다.');setCustomers(d.customers);setMeta(d);}
    catch(e){setCustomers([]);setListError(e.message);}
  }
  async function load(key){
    const id=++requestId.current;setLoading(true);setError('');
    try{const res=await fetch(`/api/ecount/customer-ledger?custKey=${encodeURIComponent(key)}`,{cache:'no-store'});const d=await res.json();if(!res.ok||!d.success)throw new Error(messages[d.error]||'자료를 불러오지 못했습니다.');if(id===requestId.current)setData(d);}
    catch(e){if(id===requestId.current){setData(null);setError(e.message);}}
    finally{if(id===requestId.current)setLoading(false);}
  }
  async function requestRefresh(){
    if(!selected)return;
    setRequesting(true);setError('');
    try{
      const res=await fetch('/api/ecount/customer-ledger-refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({custKey:selected}),cache:'no-store'});
      const d=await res.json();if(!res.ok||!d.success)throw new Error(messages[d.error]||'최신화 요청을 접수하지 못했습니다.');
      setData(current=>current?{...current,refreshRequest:d.request}:current);
      await load(selected);
    }catch(e){setError(e.message);}
    finally{setRequesting(false);}
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
  useEffect(()=>{
    if(!selected||!['PENDING','RUNNING'].includes(data?.refreshRequest?.status))return;
    const timer=setInterval(()=>{if(document.visibilityState==='visible')load(selected);},15000);
    return()=>clearInterval(timer);
  },[selected,data?.refreshRequest?.status]);
  useEffect(()=>{const back=e=>{if(selected){e.preventDefault();setSelected('');}};window.addEventListener('nenova:menu-back-request',back);return()=>window.removeEventListener('nenova:menu-back-request',back);},[selected]);
  const ledger=data?.ledger,period=data?.period||meta?.period,schedule=data?.schedule||meta?.schedule,refreshStatus=data?.refreshRequest?.status,refreshPending=['PENDING','RUNNING'].includes(refreshStatus),selectedCustomer=customers.find(c=>String(c.custKey)===selected);
  return <section className="ledger-page">
    <h1 data-ui-page-title>거래처관리대장1(채권)</h1>
    <p className="muted">{meta?.scope==='all'?'전체 거래처':'담당 거래처'}의 최근 1개월 전표별 채권 · 마지막 수집일 기준 · 이카운트 거래처관계기준</p>
    <div className="controls"><label htmlFor="ledger-search">거래처 검색</label><input id="ledger-search" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="업체명 또는 담당자" /></div>
    <h2 className="selection-title">1. 담당자 선택</h2>
    <div className="managers" role="group" aria-label="담당자 선택" onKeyDown={navigateButtons}><button aria-pressed={!manager} onClick={()=>selectManager('')}>전체 담당자</button>{managers.map(name=><button key={name} aria-pressed={manager===name} onClick={()=>selectManager(manager===name?'':name)}>{name}</button>)}</div>
    <p className="muted" role="status">검색 결과 {filteredCustomers.length}개 / 조회 가능한 거래처 {customers.length}개{selected&&!filteredCustomers.some(c=>String(c.custKey)===selected)?' · 선택한 거래처는 현재 검색 범위 밖입니다. 아래 조회 내용은 유지됩니다.':''}</p>
    <h2 className="selection-title">2. {manager||'전체 담당자'} 거래처 선택</h2>
    <p className="muted">파란색은 선택된 항목입니다. 업체 버튼을 다시 누르면 선택이 해제됩니다. 방향키로 이동하고 Enter 또는 Space로 선택할 수 있습니다.</p>
    <div className="customer-buttons" role="group" aria-label="거래처 선택" onKeyDown={navigateButtons}>
      {filteredCustomers.map(c=><button type="button" key={c.custKey} aria-pressed={selected===String(c.custKey)} disabled={!c.linked} onClick={()=>selectCustomer(String(c.custKey))}>
        <strong>{c.name}</strong><span>{c.managerName||'담당자 미확인'}{!c.linked?' · 연결 확인 필요':c.sharedLedgerName?` · ${c.sharedLedgerName} 원장 공유`:''}</span>
      </button>)}
    </div>
    {meta&&!listError&&filteredCustomers.length===0&&<p className="empty">조건에 맞는 거래처가 없습니다. 검색어나 담당자를 변경해 주세요.</p>}
    <div className="controls"><button onClick={()=>selected?load(selected):loadCustomers()} disabled={loading}>{loading?'조회 중…':'화면 새로고침'}</button><button onClick={requestRefresh} disabled={!selectedCustomer?.linked||!selectedCustomer?.refreshable||requesting||refreshPending}>{requesting?'요청 접수 중…':refreshPending?'최신화 대기 중':'최신화 요청'}</button></div>
    {selectedCustomer&&<p><strong>{selectedCustomer.name}</strong> · 담당자 {selectedCustomer.managerName}{selectedCustomer.sharedLedgerName&&` · ${selectedCustomer.sharedLedgerName} 원장 공유 (중복 집계 없음)`}</p>}
    <div className="info"><span>조회기간: {period?`${period.from} ~ ${period.to}`:'확인 중'}</span><span>{schedule?.label||'평일 08:00·11:00·14:00 자동 수집 (한국시간)'}</span></div>
    <p className="muted">마지막 수집: {time(data?.takenAt)}{schedule?.nextAt&&` · 다음 예정: ${time(schedule.nextAt)}`}</p>
    {listError&&<p role="alert" className="error">{listError} <button onClick={loadCustomers}>목록 다시 불러오기</button></p>}
    {error&&<p role="alert" className="error">{error}</p>}
    {refreshStatus&&<p role="status" className={refreshStatus==='FAILED'?'notice':'refresh-status'}>{refreshStatus==='PENDING'?'최신화 요청이 접수되었습니다. 원본 PC에서 진행 중인 수집이 끝나면 순서대로 조회합니다.':refreshStatus==='RUNNING'?'이카운트 원본에서 선택한 거래처를 조회하고 있습니다.':refreshStatus==='COMPLETE'?'요청한 최신화가 완료되었습니다. 최신 수집 시각을 확인해 주세요.':data.refreshRequest?.error==='SOURCE_UNAVAILABLE'?'이카운트 조회를 완료하지 못했습니다. 연결과 원본 PC 상태를 확인한 뒤 다시 요청해 주세요.':'이카운트 조회를 완료하지 못했습니다. 잠시 후 다시 요청해 주세요.'}</p>}
    {!listError&&meta&&customers.length===0&&<p className="notice">배정된 거래처가 없습니다. 전산의 거래처 담당자 배정을 확인해 주세요.</p>}
    {customers.some(c=>!c.linked)&&<p className="notice">‘연결 확인 필요’ 거래처는 식별값이 없거나 중복되어 조회할 수 없습니다.</p>}
    {meta?.scope==='all'&&selectedCustomer&&!selectedCustomer.refreshable&&<p className="muted">담당자 배정이 확인되지 않은 거래처는 최신화 요청을 할 수 없습니다.</p>}
    {!selected&&<p className="empty">거래처를 선택하면 전표별 판매·수금·잔액을 바로 확인할 수 있습니다.</p>}
    {loading&&<p role="status">자료를 확인하고 있습니다.</p>}
    {data?.basisChanged&&<p role="status" className="notice">이카운트와 동일한 거래처관계기준으로 다시 확인해야 합니다. 최신화 요청을 눌러 주세요.</p>}
    {data?.failure&&<p role="status" className="notice">{data.failure.reason==='LINK_CHECK_REQUIRED'?'이카운트에서 이 거래처의 식별정보가 일치하는지 확인하지 못했습니다. 거래처 연결 확인이 필요합니다.':'최근 자동 조회를 완료하지 못했습니다. 다음 자동 수집 시각에 다시 조회합니다.'} 확인 시각: {time(data.failure.at)}{ledger?' 아래는 마지막으로 검증된 수집본입니다.':' 미확인 자료를 채권 0원으로 표시하지 않습니다.'}</p>}
    {selected&&data&&!ledger&&!data.failure&&<p className="notice">이 거래처의 최근 1개월 자료가 아직 수집되지 않았습니다. 수집 PC의 로그인과 거래처 연결을 확인해야 합니다. 자료가 없는 상태를 채권 0원으로 표시하지 않습니다.</p>}
    {ledger&&<>
      {schedule?.stale&&!data?.failure&&<p role="status" className="notice">예정된 갱신 시각이 지났습니다. 아래 자료는 마지막으로 검증된 수집본입니다.</p>}
      <div className="totals">{[['이월잔액',ledger.opening],['판매 합계',ledger.totals?.sales],['수금 합계',ledger.totals?.receipt],['최종잔액',ledger.totals?.balance]].map(([label,value])=><div key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div>
      <h2>입금 확인 후 계산 잔액</h2>
      {data.receipts?.status==='VERIFIED'?<>
        <div className="totals">{[['이카운트 공식잔액',ledger.totals?.balance],['확인된 미반영 입금',data.receipts.pendingAmount],['계산 잔액 (참고)',data.receipts.calculatedBalance]].map(([label,value])=><div key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div>
        <p className="muted">입금 확인: {time(data.receipts.checkedAt)} · 위 조회기간 내 입금만 비교합니다. 회계반영 건은 다시 차감하지 않습니다. 미매칭 입금과 조회기간 이전 입금은 계산에서 제외됩니다. 실시간 은행 잔액이 아닌 수집 시점의 참고 금액입니다.</p>
        {data.receipts.heldCount>0&&<p className="notice">{data.receipts.heldCount}건은 중복 반영 가능성 또는 수금·매칭 불일치로 확인이 필요합니다. 계산 잔액은 확인 전까지 표시하지 않습니다.</p>}
        {data.receipts.rows.length>0&&<div className="ledger-table-scroll"><table><caption>거래처에 연결된 미반영 입금</caption><thead><tr><th>입금일</th><th>입금액</th><th>연결 근거</th><th>계산 적용</th></tr></thead><tbody>{data.receipts.rows.map((r,i)=><tr key={`${r.id}-${i}`}><td>{r.date}</td><td>{money(r.amount)}</td><td>{r.matchedBy==='SOURCE_CODE'?'이카운트 거래처코드':'회계반영 이력 일치'}</td><td>{r.deduct?'차감':r.reason==='POSSIBLE_POSTED_RECEIPT'?'동일 금액 수금 확인 필요':r.reason==='ALREADY_REFLECTED'?'회계반영 확인됨':r.reason==='ACCOUNTING_RECONCILIATION'?'수금합계 대조 필요':'확인 필요 · 차감 보류'}</td></tr>)}</tbody></table></div>}
      </>:<p className="notice">미반영 입금 비교가 아직 완료되지 않아 계산 잔액을 표시하지 않습니다. 최신화를 요청하면 입금 내역과 채권을 함께 확인합니다. 조회 중 반영 상태가 바뀌거나 은행 조회에 실패하면 기존 공식잔액만 표시합니다.</p>}
      <h2>차수별 입금 − 판매</h2>
      <p className="muted">입금일과 판매일을 전산 달력의 연도·대차수로 묶습니다. 회계반영 입금 + 확인된 미반영 입금 − 판매금액입니다. +는 초과입금, −는 미수이며, 이월잔액을 제외한 해당 기간의 흐름 비교입니다. 실제 전표별 미수 배정이나 누적 잔액과 다릅니다.</p>
      {data.weekComparison?.status==='READY'?<>
        {!data.weekComparison.bankReady&&<p className="notice">입금 내역과 회계 수금의 대조가 완료되지 않아 차수별 입금·차액은 표시하지 않습니다.</p>}
        <div className="ledger-table-scroll"><table><caption className="sr-only">입금일 기준 차수별 판매 대비 입금</caption><thead><tr><th>연도·차수</th><th>비교기간</th><th>판매</th><th>반영 입금</th><th>미반영 입금</th><th>입금 − 판매</th></tr></thead><tbody>
          {data.weekComparison.rows.map(w=><tr key={w.key}><td>{w.key.slice(0,4)}년 {Number(w.key.slice(4))}차</td><td>{w.from} ~ {w.to}{w.partial?' (일부 기간)':''}</td><td>{money(w.sales)}</td><td>{money(w.posted)}</td><td>{money(w.pending)}</td><td className={w.difference>0?'surplus':w.difference<0?'shortfall':''}>{w.difference==null?'확인 필요':`${w.difference>0?'+':''}${money(w.difference)} · ${w.difference>0?'초과입금':w.difference<0?'미수':'일치'}`}</td></tr>)}
        </tbody></table></div>
      </>:<p className="notice">전산 차수 달력을 확인하지 못해 차수별 비교를 표시하지 않습니다.</p>}
      <p>{ledger.rows.length.toLocaleString()}건 · {ledger.balanceOnly?'해당 기간 전표 없음 · 원본 이월잔액 확인':ledger.totals?'원본 합계 및 잔액 검증 완료':'원본에서 전표 없음 확인 · 잔액 미제공'}</p>
      <div className="ledger-table-scroll"><table><caption className="sr-only">선택 거래처의 최근 1개월 전표별 채권</caption><colgroup><col style={{width:70}}/><col style={{width:140}}/><col style={{width:170}}/><col style={{width:170}}/><col style={{width:180}}/></colgroup>
        <thead><tr><th scope="col">순번</th><th scope="col">일자</th><th scope="col">판매</th><th scope="col">수금</th><th scope="col">잔액</th></tr></thead>
        <tbody>{ledger.rows.length?ledger.rows.map(r=><tr key={r.sequence}><td>{r.sequence}</td><td>{r.date}</td><td>{money(r.sales)}</td><td>{money(r.receipt)}</td><td>{money(r.balance)}</td></tr>):<tr><td colSpan={5}>해당 기간에 조회된 전표가 없습니다.</td></tr>}</tbody>
      </table></div>
    </>}
    <style jsx>{`
      .surplus{color:#1769aa;font-weight:700}.shortfall{color:#b42318;font-weight:700}.selection-title{font-size:16px;margin:20px 0 10px}.customer-buttons{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr));gap:8px}.customer-buttons button{text-align:left;min-width:0;overflow-wrap:anywhere}.customer-buttons strong,.customer-buttons span{display:block}.customer-buttons span{font-size:12px;margin-top:5px;opacity:.85}.customer-buttons button[aria-pressed=true]{background:#1769aa;color:white;border-color:#1769aa;box-shadow:inset 0 0 0 1px #1769aa}.customer-buttons button:disabled{cursor:not-allowed;background:#edf0f3}.managers{display:flex;gap:8px;flex-wrap:wrap}.managers button[aria-pressed=true]{background:#1769aa;color:white;border-color:#1769aa}input[type=search]{padding:11px;border:1px solid #b7c8d8;border-radius:8px;min-width:250px;max-width:100%}input:focus-visible{outline:3px solid #1985d0;outline-offset:2px}
      @media(max-width:600px){:global([data-ui-popupbar]>[data-ui-page-title]){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}:global([data-ui-popupbar]>span:last-child){flex-shrink:0}:global([data-ui-popupbar]>span:last-child>span){display:none}:global([data-ui-popupbar] button){white-space:nowrap;flex-shrink:0}}
      .ledger-page{padding:24px;max-width:1200px;margin:0 auto;color:#172c40}.ledger-page h1{font-size:23px;margin:0 0 8px}.muted{color:#607286;font-size:13px;line-height:1.7}.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:24px 0 16px}.controls label{font-weight:700}select{min-width:250px;max-width:100%;padding:11px;border:1px solid #b7c8d8;border-radius:8px;background:#fff}button{padding:10px 16px;border:1px solid #b7c8d8;border-radius:8px;background:#fff;cursor:pointer}button:disabled{opacity:.55;cursor:wait}button:focus-visible,select:focus-visible{outline:3px solid #1985d0;outline-offset:2px}.info{display:flex;gap:24px;flex-wrap:wrap;font-size:14px}.notice,.error,.empty,.refresh-status{padding:16px;border-radius:8px;line-height:1.7}.notice{background:#fff5d9;color:#795514}.refresh-status{background:#e9f5ff;color:#194b74}.error{background:#fff0f0;color:#a02020}.empty{background:#f0f5fa;margin-top:24px}.totals{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.totals>div{min-width:180px;padding:18px;border:1px solid #d7e2eb;border-radius:10px;background:white}.totals span{display:block;font-size:13px;color:#607286}.totals strong{display:block;margin-top:8px;font-size:22px;font-variant-numeric:tabular-nums}.ledger-table-scroll{overflow-x:auto}table{width:auto;border-collapse:collapse;table-layout:fixed;background:white}th,td{padding:11px 16px;border-bottom:1px solid #e2eaf1;text-align:right;font-variant-numeric:tabular-nums}th{background:#eef4f8}th:nth-child(2),td:nth-child(2){text-align:left}td[colspan]{text-align:center}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@media(max-width:600px){.ledger-page{padding:16px}.totals>div{min-width:140px;flex:1}.info{gap:8px}select{width:100%}}
    `}</style>
  </section>;
}
