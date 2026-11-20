import {useEffect,useMemo,useState} from 'react';
const labels={stems:'송이',bunches:'단',boxes:'박스'};
const fold=value=>String(value??'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
const base='/api/import/tools/country-order-history';
const params=scope=>new URLSearchParams({country:scope.country,year:String(scope.year),orderWeek:scope.orderWeek});
export default function CountryOrderEvidenceReview({scope,onChange}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[reload,setReload]=useState(0);
  const [selected,setSelected]=useState({}),[links,setLinks]=useState({}),[decisions,setDecisions]=useState({}),[focus,setFocus]=useState(null);
  const [history,setHistory]=useState([]),[ack,setAck]=useState({}),[saving,setSaving]=useState(null),[notice,setNotice]=useState('');
  const [historyYear,setHistoryYear]=useState(String(scope.year)),[historyWeek,setHistoryWeek]=useState(scope.orderWeek);
  const scopeKey=JSON.stringify(scope);
  useEffect(()=>{const controller=new AbortController();setData(null);setError('');setSelected({});setLinks({});setDecisions({});onChange(null);
    fetch(base+'?'+params(scope),{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error);if(!controller.signal.aborted){setData(body);setHistory(body.history);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  // scope is an exact primitive identity; no polling or automatic retries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scopeKey,reload]);
  const items=useMemo(()=>data?[...data.messages.flatMap(message=>message.items.map(item=>({...item,messageId:message.id,text:message.text,time:message.time}))),...(data.baseline?.pendingSources??[]).filter(item=>!data.messages.some(message=>message.items.some(row=>row.sourceKey===item.sourceKey))).map(item=>({...item,pending:true}))]:[],[data]);
  const currentSelections=useMemo(()=>items.filter(item=>selected[item.sourceKey]===true).map(item=>{
    const customers=data.matrix.customers.filter(customer=>[customer.name,customer.code,customer.label].some(name=>fold(name)===fold(item.rawCustomer)));
    const products=data.matrix.rows.filter(product=>[product.name,product.label].some(name=>fold(name)===fold(item.rawProduct)));
    return {sourceKey:item.sourceKey,custKey:links[item.sourceKey]?.custKey??(customers.length===1?customers[0].key:''),prodKey:links[item.sourceKey]?.prodKey??(products.length===1?products[0].prodKey:'')};
  }),[items,data,selected,links]);
  useEffect(()=>{onChange(data?{fingerprint:data.fingerprint,selections:currentSelections,decisions}:null);},[data,currentSelections,decisions,onChange]);
  function changeLink(key,field,value){setLinks(previous=>({...previous,[key]:{...previous[key],[field]:value}}));setDecisions(previous=>({...previous,[key]:{}}));}
  async function loadHistory(event){event?.preventDefault();setError('');try{const response=await fetch(base+'?'+params({...scope,year:historyYear,orderWeek:historyWeek})+'&historyOnly=1',{cache:'no-store'});const body=await response.json();if(!response.ok)throw Error(body.error);setHistory(body.history);}catch(e){setError(e.message);}}
  async function delivered(record){if(!ack[record.id]||saving)return;setSaving(record.id);setError('');try{
    const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delivered',scope:record.scope,id:record.id,sha256:record.sha256,confirmed:true})});const body=await response.json();if(!response.ok)throw Error(body.error);
    setHistory(previous=>previous.map(row=>row.id===record.id?body.record:row));setNotice('전달 시각을 별도로 기록했습니다. 새 발주 대조 전 원문·전산을 다시 조회하세요.');onChange(null);
  }catch(e){setError(e.message);}finally{setSaving(null);}}
  return <section aria-label="카톡·등록 주문·전달본 대조" className="country-evidence">
    <h3>원문·전산·마지막 전달본 대조</h3>
    <p>전산 주문은 전체 유지합니다. 동일 수량만으로 중복을 지우지 않습니다. 검토 후 [미리보기 생성]을 누르세요.</p>
    <button type="button" onClick={()=>setReload(value=>value+1)}>원문·전산 다시 조회</button>
    {error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">근거 조회 중…</p>}
    {notice&&<p role="status">{notice}</p>}
    {data&&<><p>현재 조회 {data.current.queriedAt} · 마지막 전체 전달본 {data.baseline?`${data.baseline.scope.year}/${data.baseline.scope.orderWeek} · ${data.baseline.deliveredAt}`:'없음 — 첫 원본은 현재 ERP 전체로 생성, 신규 카톡은 기준본 확인 전 검토'}</p>
      <div className="country-evidence-split">
        <section aria-label="카톡 원문"><h4>원문</h4>{data.messages.map(message=><article key={message.id} data-selected={focus===message.id}>
          <button type="button" onClick={()=>setFocus(message.id)}>{message.time} 원문 선택</button><pre>{message.text}</pre>
        </article>)}{!data.messages.length&&<p>이 범위의 보관된 카톡 근거가 없습니다. ERP 등록과 동일 건을 확인했다고 표시하지 않습니다.</p>}</section>
        <section aria-label="선별한 근거 행"><h4>선별·동일 건 확인</h4>{items.map(item=>{
          const key=item.sourceKey,choice=currentSelections.find(row=>row.sourceKey===key)??links[key]??{},decision=decisions[key]??{};
          const events=data.events.filter(event=>String(event.custKey)===String(choice.custKey)&&String(event.prodKey)===String(choice.prodKey)&&event.unit===item.unit);
          return <article key={key} data-selected={focus===item.messageId}>
            <label><input type="checkbox" checked={selected[key]===true} onChange={e=>setSelected(previous=>({...previous,[key]:e.target.checked}))}/>{item.pending?'이전 전달 미등록분 · ':''}{item.rawCustomer??item.customer} · {item.rawProduct??item.product} {item.quantity}{labels[item.unit]??'단위 확인'}</label>
            <button type="button" onClick={()=>setFocus(item.messageId)}>근거 강조</button><p>{item.at} · {item.kind==='addition'?'추가':'정정·취소·확인 필요'}</p>
            <label>ERP 업체<select value={choice.custKey??''} onChange={e=>changeLink(key,'custKey',e.target.value)}><option value="">업체 선택</option>{data.matrix.customers.map(customer=><option key={customer.key} value={customer.key}>{customer.label} [CustKey:{customer.key}]</option>)}</select></label>
            <label>ERP 품목<select value={choice.prodKey??''} onChange={e=>changeLink(key,'prodKey',e.target.value)}><option value="">품목 선택</option>{data.matrix.rows.map(product=><option key={product.key} value={product.prodKey}>{product.name} · {labels[product.unit]} [ProdKey:{product.prodKey}]</option>)}</select></label>
            <label>등록 근거<select value={decision.mode==='new'?'new':decision.eventId??''} onChange={e=>setDecisions(previous=>({...previous,[key]:e.target.value==='new'?{mode:'new',confirmed:true}:{mode:'registered',eventId:e.target.value}}))}>
              <option value="">검토 필요</option><option value="new">현재 ERP·변동과 대조한 미등록 신규</option>{events.map(event=><option key={event.id} value={event.id}>{event.id} 상세{event.orderDetailKey} · {event.at} · {event.before}→{event.after}{labels[event.unit]}</option>)}
            </select></label>
          </article>;
        })}{!items.length&&<p>선별할 카톡 행 없음. 전산 전체 주문 미리보기는 만들 수 있습니다.</p>}</section>
      </div>
      <details><summary>3. 분석 요약</summary><p>원문 {data.messages.length}건 · 선택 {currentSelections.length}행 · ERP 상세 {data.details.length}행. 최종 수량과 검토 상태는 명시 미리보기 생성 결과로 확인합니다.</p></details>
    </>}
    <h3>발주 원본·전달 이력</h3>
    <form onSubmit={loadHistory}><label>이력 연도<input value={historyYear} onChange={e=>setHistoryYear(e.target.value)} inputMode="numeric"/></label><label>세부차수<input value={historyWeek} onChange={e=>setHistoryWeek(e.target.value)} placeholder="47-02"/></label><button type="submit">과거 원본 조회</button></form>
    <p>다운로드 요청과 OS 저장 완료는 다릅니다. 전달 완료는 실제 농장에 전달을 마친 파일만 체크하세요. 농장별·단위별 파일 세트 모두 전달해야 다음 대조의 전체 기준본이 됩니다.</p>
    <div className="country-history"><table><thead><tr><th>원본</th><th>다운로드 요청</th><th>전달 시각</th><th>원본 열기</th><th>전달 완료</th></tr></thead><tbody>{history.map(record=><tr key={record.id}>
      <td>{record.filename}<small>{record.sha256}</small></td><td>{record.downloadedAt}</td><td>{record.deliveredAt??'미전달'}</td>
      <td><a href={base+'?'+params(record.scope)+'&id='+encodeURIComponent(record.id)+'&file=1'}>보관 원본 재다운로드</a><details><summary>보관 행 보기</summary><table><tbody>{record.rows.map((row,index)=><tr key={index}><td>{row.customer??row.custKey}</td><td>{row.product??row.prodKey}</td><td>{row.quantity} {labels[row.unit]}</td></tr>)}</tbody></table></details></td>
      <td>{record.deliveredAt?'완료':<><label><input type="checkbox" checked={ack[record.id]===true} onChange={e=>setAck(previous=>({...previous,[record.id]:e.target.checked}))}/>실제 전달 완료 확인</label><button type="button" disabled={!ack[record.id]||Boolean(saving)} onClick={()=>delivered(record)}>전달 시각 기록</button></>}</td>
    </tr>)}</tbody></table>{!history.length&&<p>이 범위에 보관된 원본 없음</p>}</div>
  </section>;
}
