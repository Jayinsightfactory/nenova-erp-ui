import { useEffect, useRef, useState } from 'react';
import { fetchRaumPnlJson } from '../../lib/raumPnlHttp';

export default function HotelCustomerMapping({ partner, disabled, orderYear, major }) {
 const [mapping,setMapping]=useState(null), [open,setOpen]=useState(false), [term,setTerm]=useState('');
 const [customers,setCustomers]=useState([]), [busy,setBusy]=useState(false), [error,setError]=useState('');
 const [reference,setReference]=useState(null);
 const generation=useRef(0), referenceGeneration=useRef(0);
 const button={padding:'7px 10px',border:'1px solid #cbd5e1',borderRadius:5,background:'#fff',cursor:'pointer'};
 useEffect(()=>{
  const token=++generation.current; setOpen(false); setMapping(null); setError(''); setBusy(false); setCustomers([]); setReference(null);
  fetchRaumPnlJson(`/api/raum/hotel-customer-mapping?partner=${encodeURIComponent(partner.code)}`)
   .then(result=>{if(token===generation.current)setMapping(result.mapping);})
   .catch(cause=>{if(token===generation.current)setError(cause.message);});
  return ()=>{generation.current++;};
 },[partner.code]);
 useEffect(()=>{referenceGeneration.current++;setReference(null);},[orderYear,major]);
 const readReference=async()=>{
  const token=generation.current, referenceToken=++referenceGeneration.current; setBusy(true);setError('');
  try {const result=await fetchRaumPnlJson(`/api/raum/hotel-customer-mapping?reference=1&partner=${encodeURIComponent(partner.code)}&year=${encodeURIComponent(orderYear)}&major=${encodeURIComponent(major)}`);if(token===generation.current && referenceToken===referenceGeneration.current){setMapping(result.mapping);setReference(result.rows);}}
  catch(cause){if(token===generation.current)setError(cause.message);}
  finally{if(token===generation.current)setBusy(false);}
 };
 const retry=async()=>{
  const token=generation.current; setBusy(true); setError('');
  try { const result=await fetchRaumPnlJson(`/api/raum/hotel-customer-mapping?partner=${encodeURIComponent(partner.code)}`); if(token===generation.current)setMapping(result.mapping); }
  catch(cause){if(token===generation.current)setError(cause.message);}
  finally{if(token===generation.current)setBusy(false);}
 };
 const search=async()=>{
  const token=generation.current; setBusy(true); setError('');
  try { const result=await fetchRaumPnlJson(`/api/customers/search?q=${encodeURIComponent(term.trim())}&refresh=1`);
   if(token===generation.current)setCustomers(result.customers || []);
  }catch(cause){if(token===generation.current)setError(cause.message);}
  finally{if(token===generation.current)setBusy(false);}
 };
 const save=async(custKey)=>{
  const token=generation.current; setBusy(true);setError('');
  try { const result=await fetchRaumPnlJson('/api/raum/hotel-customer-mapping',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({partnerCode:partner.code,custKey,revision:mapping.revision})});
   if(token===generation.current){setMapping(result.mapping);setReference(null);setOpen(false);}
  }catch(cause){if(token===generation.current){setError(cause.message); const result=await fetchRaumPnlJson(`/api/raum/hotel-customer-mapping?partner=${encodeURIComponent(partner.code)}`).catch(()=>null);if(result && token===generation.current)setMapping(result.mapping);}}
  finally{if(token===generation.current)setBusy(false);}
 };
 return <div style={{marginBottom:10,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
  <button type="button" style={button} disabled={disabled || busy} onClick={()=>{setOpen(true);setTerm(partner.label);setCustomers([]);}}>전산 업체 매칭</button>
  <span style={{fontSize:13}}>연결 업체: {mapping?.active ? `${mapping.custName} (#${mapping.custKey})` : mapping?.custKey ? '비활성 업체 — 다시 연결하세요' : '미매칭'}</span>
  {mapping?.active && orderYear && major ? <button type="button" style={button} disabled={busy || disabled} onClick={readReference}>연결 업체 전산 출고 참조</button> : null}
  {reference ? <div style={{flexBasis:'100%',maxHeight:220,overflow:'auto',fontSize:12,border:'1px solid #cbd5e1',padding:8}}><b>{mapping?.custName} · {orderYear}년 {Number(major)}차 전산 출고 (전산 단위)</b>{reference.length ? reference.map(row=><div key={`${row.OrderWeek}|${row.ProdKey}`} style={{padding:'4px 0'}}>{row.OrderWeek} · {row.ProdName} · {Number(row.OutQuantity).toLocaleString()} {row.OutUnit}</div>):<div>해당 업체·연도·차수의 출고 자료가 없습니다.</div>}</div> : null}
  {!mapping ? <button type="button" style={button} disabled={busy || disabled} onClick={retry}>업체 연결 다시 조회</button> : null}
  {error && !open ? <span role="alert" style={{color:'#b91c1c'}}>{error}</span>:null}
  {open ? <div role="dialog" aria-modal="true" aria-label="전산 업체 매칭" style={{position:'fixed',inset:0,zIndex:1100,background:'rgba(15,23,42,.45)',display:'grid',placeItems:'center',padding:16}}>
   <section style={{boxSizing:'border-box',width:'min(640px,100%)',maxHeight:'calc(100dvh - 32px)',overflowY:'auto',background:'#fff',borderRadius:8,padding:20}}>
    <h2 style={{fontSize:18,marginTop:0}}>{partner.label} 전산 업체 매칭</h2>
    <p style={{fontSize:13}}>호텔에 연결할 전산 업체를 검색하세요. 연결은 호텔 설정에 저장됩니다.</p>
    <div style={{display:'flex',gap:6}}><input aria-label="전산 업체 검색" value={term} onChange={event=>setTerm(event.target.value)} disabled={busy} onKeyDown={event=>{if(event.key==='Enter')search();}} style={{minWidth:0,flex:1,padding:8}}/><button style={button} disabled={busy || !term.trim()} onClick={search}>{busy ? '처리 중…':'검색'}</button></div>
    {!mapping ? <button type="button" style={button} disabled={busy} onClick={retry}>업체 연결 다시 조회</button> : null}
    {error ? <p role="alert" style={{color:'#b91c1c'}}>{error}</p>:null}
    <div style={{marginTop:10}}>{customers.map(customer=><div key={customer.CustKey} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid #e2e8f0'}}><span>{customer.CustName} · {customer.CustArea} (#{customer.CustKey})</span><button style={button} disabled={busy || !mapping} onClick={()=>save(customer.CustKey)}>연결</button></div>)}</div>
    <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginTop:15}}><button style={button} disabled={busy || !mapping?.custKey} onClick={()=>save(null)}>연결 해제</button><button style={button} disabled={busy} onClick={()=>setOpen(false)}>닫기</button></div>
   </section>
  </div>:null}
 </div>;
}
