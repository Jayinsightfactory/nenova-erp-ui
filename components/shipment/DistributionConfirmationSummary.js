import {useEffect,useRef,useState} from 'react';
export default function DistributionConfirmationSummary({week,refreshKey}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[open,setOpen]=useState(false);
 const sequence=useRef(0);
 async function load(){const seq=++sequence.current;setLoading(true);setError('');try{const r=await fetch('/api/shipment/distribution-confirmation?'+new URLSearchParams({week,year:String(week).split('-')[0]}),{cache:'no-store'});const d=await r.json();if(!r.ok||!d.ok||d.week!==week)throw Error(d.error||'선택 차수의 확정현황을 확인하지 못했습니다.');if(seq===sequence.current)setData(d);}catch(e){if(seq===sequence.current){setData(null);setError(e.message);}}finally{if(seq===sequence.current)setLoading(false);}}
 useEffect(()=>{setData(null);setOpen(false);if(week)void load();return()=>{sequence.current++;};},[week,refreshKey]);
 const rows=data?.week===week?data.rows:[];
 return <div style={{display:'flex',alignItems:'center',gap:3,flexWrap:'wrap',position:'relative'}} data-testid="distribution-confirmation-summary">
  <button type="button" className="btn btn-sm btn-secondary" disabled={!week} onClick={()=>{setOpen(v=>!v);void load();}}>확정현황 확인</button>
  {loading?<span style={{fontSize:11}}>확정현황 조회 중…</span>:error?<span role="status" style={{fontSize:11,color:'#b91c1c'}}>{error}</span>:rows.filter(r=>r.fixedCount>0).map(r=><button type="button" key={r.category} onClick={()=>setOpen(true)} title={`${week} · ${r.fixedCount}/${r.detailCount}건 확정`} style={{fontSize:11,padding:'3px 6px',border:'1px solid #dc2626',borderRadius:4,background:r.status==='FIXED'?'#dc2626':'#fee2e2',color:r.status==='FIXED'?'white':'#991b1b'}}>{r.category}{r.status==='PARTIAL'?' (일부)':''}</button>)}
  {!loading&&!error&&data&&!rows.some(r=>r.fixedCount>0)&&<span style={{fontSize:11}}>확정 카테고리 없음</span>}
  {open&&<section role="dialog" aria-label={`${week} 확정현황`} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);}}} style={{position:'absolute',top:'100%',left:0,zIndex:100,width:330,maxWidth:'90vw',maxHeight:'60vh',overflow:'auto',padding:8,border:'1px solid var(--border)',background:'var(--surface)',boxShadow:'0 4px 16px #0003'}}><strong>{week} 확정현황</strong><button autoFocus type="button" className="btn btn-sm" onClick={()=>setOpen(false)} style={{float:'right'}}>닫기</button>{loading?<p>조회 중…</p>:error?<p role="alert">{error}</p>:<table className="tbl" style={{fontSize:11}}><thead><tr><th>카테고리</th><th>상태</th><th>확정/전체</th></tr></thead><tbody>{rows.map(r=><tr key={r.category}><td>{r.category}</td><td>{r.status==='FIXED'?'확정':r.status==='PARTIAL'?'일부 확정':'미확정'}</td><td>{r.fixedCount}/{r.detailCount}</td></tr>)}</tbody></table>}</section>}
 </div>;
}
