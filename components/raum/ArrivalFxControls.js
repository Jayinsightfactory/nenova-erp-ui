import { useState } from 'react';

export default function ArrivalFxControls({ onApply, currencies = ['USD','EUR','CNY'] }) {
  const [draft,setDraft]=useState({});
  const [error,setError]=useState('');
  const apply=()=>{
    if (Object.values(draft).some(v=>v!=='' && (!Number.isFinite(Number(v)) || Number(v)<=0))) {
      setError('환율은 0보다 큰 숫자로 입력하세요.'); return;
    }
    setError(''); onApply({...draft});
  };
  return <div style={{fontWeight:400,fontSize:12,whiteSpace:'normal',marginTop:5}}>
    <div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'center'}}>
      {currencies.map(currency=><label key={currency}>{currency} <input aria-label={`${currency} 비교 환율`} inputMode="decimal" value={draft[currency] ?? ''} onChange={e=>setDraft({...draft,[currency]:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();apply();}}} style={{width:65}} /></label>)}
      <button type="button" onClick={apply}>적용</button>
      <button type="button" onClick={()=>{setDraft({});setError('');onApply({});}}>원본</button>
    </div>
    {error && <div role="alert" style={{color:'#b91c1c'}}>{error}</div>}
    <div style={{color:'#475569'}}>원/외화 1 · 도착원가 표시만 비교 (매입액·이익 유지)</div>
  </div>;
}
