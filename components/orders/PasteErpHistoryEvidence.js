import {useEffect,useState} from 'react';
import {matchingSummary} from '../../lib/distributionCompactMatchUi';

export default function PasteErpHistoryEvidence({week,text,messages=[],revision='',disabled=false}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
  const sourceKey=JSON.stringify(messages.map(row=>({identity:row.identity,message:row.message,created_at:row.created_at,timestamp_approximate:row.timestamp_approximate})));
  useEffect(()=>{
    setData(null);setError('');setLoading(false);
    const scope=String(week||'').match(/^(\d{4})-(\d{2}-\d{2})$/);
    if(!text.trim()||!scope||disabled)return;
    const source=JSON.parse(sourceKey);
    if(!source.length||source.map(row=>row.message).join('\n\n')!==text) {setError('원문 작성 시각이 연결되지 않았습니다. 영업방의 전체 변경 AI 분석 버튼으로 불러오면 전산 처리 이력을 자동 대조합니다.');return;}
    const dates=source.map(row=>row.created_at?new Date(row.created_at):null);
    if(dates.some(date=>!date||!Number.isFinite(date.getTime()))) {setError('원문 작성 시각이 없어 처리 여부를 확정할 수 없습니다.');return;}
    const day=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
    const from=dates.map(day).sort()[0],today=day(new Date());
    const limit=day(new Date(Date.parse(from+'T00:00:00+09:00')+6*86400000));
    const to=today<limit?today:limit;
    const controller=new AbortController();let active=true,running=false;
    const run=async()=>{
      if(running||document.visibilityState!=='visible')return;
      running=true;
      setLoading(true);
      try {
        const response=await fetch('/api/orders/distribution-live-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({year:scope[1],week:scope[2],from,to,messages:source}),signal:controller.signal});
        const value=await response.json();
        if(!response.ok||!value.success)throw Error(typeof value.error==='string'?value.error:'전산 이력 조회 실패');
        if(value.scope?.year!==scope[1]||value.scope?.weeks?.[0]!==scope[2]||value.erpAction!=='NONE'||!Array.isArray(value.items))throw Error('전산 이력 조회 범위를 확인할 수 없습니다.');
        if(active){setData(value);setError('');}
      } catch(e) {if(active&&e.name!=='AbortError')setError(e.message);}
      finally {running=false;if(active)setLoading(false);}
    };
    void run();const timer=setInterval(run,10000);
    return()=>{active=false;controller.abort();clearInterval(timer);};
  },[week,text,sourceKey,revision,disabled,refresh]);
  if(!text.trim())return null;
  return <section className="paste-erp-evidence" aria-label="전산 수량 변동 처리 확인">
    <div className="head"><strong>전산 수량 변동 · 기존 처리 확인</strong><button type="button" disabled={loading||disabled} onClick={()=>setRefresh(value=>value+1)}>{loading?'조회 중…':'최신 이력 조회'}</button></div>
    {error&&<p role="status">{error}</p>}
    {data&&<><small>조회 {data.scope.from} ~ {data.scope.to} · 기준 {new Date(data.asOf).toLocaleTimeString('ko-KR')}</small>{data.items.map(item=>{
      const match=matchingSummary(data.balanceComparison,item.sourceIdentity,item);
      return <div className="evidence-item" key={item.sourceIdentity}><b>{match.status==='MATCHED'?'동일 처리 이력 확인':match.status==='PARTIAL'?'일부 처리 이력 확인':'처리 여부 확인 필요'} ({match.matchedCount}/{match.totalCount})</b>
        {(item.requests||[]).map(request=><div className="evidence-request" key={request.id}><strong>{request.customerText||'업체 확인 필요'} · {request.productText||request.quote||'품목 확인 필요'}</strong><span>{request.reason}</span>{[['주문',request.orderEvents],['분배',request.shipmentEvents]].flatMap(([label,events])=>(events||[]).map(event=><div key={`${label}:${event.eventId}`}>{label} {event.before} → {event.after} {event.unit} · {event.changeAt}</div>))}</div>)}
      </div>;
    })}<p>대응 이력이 없다는 것만으로 미처리로 확정하지 않습니다. 동일 처리 이력이 확인되면 중복 분배 전에 확인하세요.</p></>}
    <style jsx>{`.paste-erp-evidence{padding:8px;margin:8px 0;border:1px solid #a9c5de;border-radius:7px;background:#fff;font-size:12px}.head{display:flex;justify-content:space-between;gap:8px;align-items:center}.head button{padding:4px 8px}.evidence-item{margin-top:7px;border-top:1px solid #ddd;padding-top:6px}.evidence-request{display:grid;gap:3px;padding:5px 0;overflow-wrap:anywhere}.evidence-request span,small,p{color:#526b82}p{margin:6px 0}`}</style>
  </section>;
}
