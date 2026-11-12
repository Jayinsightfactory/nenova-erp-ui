import {useState} from 'react';

export default function DistributionKakaoFeed() {
  const [blocks,setBlocks]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
  async function load(){
    setLoading(true);setError('');
    try{
      const response=await fetch('/api/kakao/order-feed?n=60',{credentials:'same-origin'});
      const data=await response.json();
      if(!response.ok||!data.ok)throw new Error(data.error||'카톡 내용을 불러오지 못했습니다.');
      setBlocks((data.blocks||[]).filter(b=>/추가|취소/.test(String(b.text||''))));
    }catch(e){setError(e.message);}finally{setLoading(false);}
  }
  const visible=blocks.filter(b=>`${b.room} ${b.sender} ${b.text}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <aside className="distribution-kakao-feed" aria-label="카톡 추가·취소 요청">
    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}><strong>카톡 추가·취소 요청</strong><button type="button" className="btn btn-sm" disabled={loading} onClick={load}>{loading?'불러오는 중…':'추가·취소 불러오기'}</button></div>
    <p style={{fontSize:11,margin:'5px 0'}}>최근 발주방 원문 중 ‘추가’·‘취소’가 포함된 요청만 표시합니다. 업체·품목 문맥은 원문 그대로 확인하세요.</p>
    <input className="filter-input" aria-label="카톡 원문 검색" placeholder="방·보낸 사람·내용 검색" value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%'}} />
    {error&&<p role="alert">{error}</p>}
    {!loading&&!blocks.length&&<p style={{fontSize:12}}>표시할 추가·취소 요청이 없습니다. 불러오기로 최근 내용을 확인하세요.</p>}
    {blocks.length>0&&!visible.length&&<p>검색 결과가 없습니다.</p>}
    {visible.map((b,i)=><article key={`${b.msgId||i}-${b.time}`} style={{padding:'8px 0',borderBottom:'1px solid var(--border)'}}><div style={{fontSize:11,color:'var(--text3)'}}>{b.room} · {b.sender} · {b.time}</div><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit',fontSize:12,margin:'5px 0'}}>{b.text}</pre></article>)}
  </aside>;
}
