import {useEffect,useMemo,useState} from 'react';
import {stockCustomerResults,stockSalesPeriod} from '../../lib/kakaoStockCustomers';

let cache=null;
function loadCustomers(period,retry=false){
  const key=`${period.year}-${period.month}`;
  if(!retry&&cache?.key===key&&Date.now()<cache.expires)return cache.promise;
  const read=async url=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(url,{signal:controller.signal});const d=await r.json().catch(()=>null);if(!r.ok||!d||d.success===false)throw Error('업체·매출 조회가 지연되거나 실패했습니다. 다시 조회하세요.');return d;}catch{throw Error('업체·매출 조회가 지연되거나 실패했습니다. 다시 조회하세요.');}finally{clearTimeout(timer);}};
  const monthly=(year,month)=>read(`/api/stats/sales?type=monthly&exeParity=1&year=${year}&month=${month}`);
  const promise=Promise.allSettled([read('/api/customers/search'),monthly(period.year,period.month),monthly(period.previousYear,period.previousMonth)])
    .then(([c,current,previous])=>{if(c.status==='rejected')throw c.reason;const salesReady=current.status==='fulfilled'&&previous.status==='fulfilled';if(!salesReady)cache=null;return {customers:(c.value.customers||[]).map(({CustKey,CustName,CustArea})=>({CustKey,CustName,CustArea})),salesReady,sales:salesReady?[...(current.value.byCustomer||[]),...(previous.value.byCustomer||[])].map(r=>({...r,prevSales:0})):[]};}).catch(e=>{cache=null;throw e;});
  cache={key,expires:Date.now()+5*60*1000,promise};return promise;
}

export default function StockCustomerPicker({value,onChange,onPick,disabled}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[expanded,setExpanded]=useState(true),[attempt,setAttempt]=useState(0);
  const period=useMemo(()=>stockSalesPeriod(),[]);
  useEffect(()=>{let alive=true;setLoading(true);setError('');
    loadCustomers(period,attempt>0).then(d=>{if(alive){setData(d);if(!d.salesReady)setError('매출순을 확인하지 못했습니다. 업체명순으로 표시합니다.');}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[attempt,period]);
  const results=data?stockCustomerResults(data.customers,data.sales,value):[];
  return <div className="picker"><label>업체<input aria-label="업체" autoComplete="off" required disabled={disabled} value={value} onFocus={()=>setExpanded(true)} onChange={e=>{setExpanded(true);onChange(e.target.value);}} aria-controls="stock-customer-results" aria-expanded={expanded}/></label>
    <small>{data&&!data.salesReady?'매출순 미확인 · 업체명순':period.label} · 초성 검색 가능 (예: ㅈ)</small>
    {loading&&<p role="status">업체·매출 조회 중… 직접 업체명을 입력할 수도 있습니다.</p>}
    {error&&<p role="alert">{error} <button type="button" onClick={()=>setAttempt(a=>a+1)}>다시 조회</button></p>}
    {expanded&&data&&<div id="stock-customer-results" role="group" aria-label={data.salesReady?"매출순 업체 검색결과":"업체명순 검색결과"} className="results">{results.slice(0,80).map(c=><button type="button" key={c.CustKey} onClick={()=>{setExpanded(false);onPick(c);}}><strong>{c.CustName}</strong><span>{c.CustArea||'지역 미지정'}</span></button>)}{!results.length&&<p>검색 결과가 없습니다. 업체명을 직접 입력할 수 있습니다.</p>}{results.length>80&&<small>상위 80개 표시 · 검색어를 더 입력하세요.</small>}</div>}
    <style jsx>{`.picker{margin-bottom:12px}label{display:block;font-weight:600}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #bbc8d8;border-radius:5px;font:inherit;margin:5px 0}small{color:#526176}.results{max-height:190px;overflow:auto;border:1px solid #d9e2ed;border-radius:5px;margin-top:6px}.results button{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;padding:8px;border:0;border-bottom:1px solid #edf0f4;background:white;color:#203047;font:inherit;cursor:pointer}.results button:hover,.results button:focus-visible{background:#eaf3ff}.results span{font-size:12px;color:#526176}p{font-size:13px;line-height:1.5}`}</style>
  </div>;
}
