import {useEffect,useRef,useState} from 'react';
import {recentSalesPeriod,refreshSalesFeed} from '../../lib/distributionSalesInboxRefresh';
import {requestRows} from '../../lib/distributionKakaoRequests';

export default function DistributionKakaoFeed() {
  const [blocks,setBlocks]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
  const [kind,setKind]=useState('전체'),[checked,setChecked]=useState('');
  const reader=useRef({period:'',cursor:'',messages:[],busy:false,controller:null,active:true,sequence:0});
  async function load(){
    const state=reader.current;if(state.busy)return;
    state.busy=true;const sequence=++state.sequence,controller=new AbortController();state.controller=controller;
    setLoading(true);setError('');
    const period=recentSalesPeriod(),key=period.from+'/'+period.to;
    const reset=state.period!==key;
    try{
      const data=await refreshSalesFeed({...period,afterKey:reset?'':state.cursor,maxPages:3,signal:controller.signal});
      if(!state.active||controller.signal.aborted||state.sequence!==sequence)return;
      const map=new Map((reset?[]:state.messages).map(m=>[`${m.source}|${m.chat_id}|${m.external_message_id}`,m]));
      for(const m of data.messages)map.set(`${m.source}|${m.chat_id}|${m.external_message_id}`,m);
      // IDs are stable identities, not a clock. Rescan the bounded recent period
      // after completing pagination so late imports with lower keys are included.
      state.messages=[...map.values()];state.period=key;state.cursor=data.complete?'':(data.nextAfterKey||(!reset?state.cursor:''));
      setBlocks(requestRows(state.messages));
      setChecked(data.complete?new Date().toLocaleTimeString('ko-KR',{hour12:false}):'');
      if(!data.complete)setError('최근 대화를 더 읽는 중입니다. 다음 자동 확인에서 이어서 불러옵니다.');
    }catch(e){if(state.active&&!controller.signal.aborted&&state.sequence===sequence)setError(e.message);}
    finally{if(state.sequence===sequence){state.busy=false;if(state.active)setLoading(false);}}
  }
  useEffect(()=>{
    const state=reader.current;state.active=true;void load();
    const refresh=()=>{if(document.visibilityState==='visible'&&navigator.onLine!==false)void load();};
    const timer=setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);
    return()=>{state.active=false;state.sequence++;state.busy=false;state.controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('online',refresh);};
  },[]);
  const visible=blocks.filter(b=>(kind==='전체'||b.kinds.includes(kind))&&`${b.room} ${b.sender} ${b.text}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <aside className="distribution-kakao-feed" aria-label="카톡 추가·취소 요청" style={{position:'sticky',top:4,maxHeight:'calc(100dvh - 100px)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}><strong>카톡 추가·취소 요청</strong><button type="button" className="btn btn-sm" disabled={loading} onClick={load}>{loading?'최신 확인 중…':'추가·취소 불러오기'}</button></div>
    <p style={{fontSize:11,margin:'5px 0'}}>최근 3일 영업방 · 15초 자동 확인 · 잔량 보고와 출고일 변경 제외</p>
    <input className="filter-input" aria-label="카톡 원문 검색" placeholder="방·보낸 사람·내용 검색" value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%'}} />
    <div style={{display:'flex',gap:4,padding:'5px 0',alignItems:'center',flexWrap:'wrap'}}>{['전체','추가','취소'].map(k=><button type="button" className="btn btn-sm" key={k} aria-pressed={kind===k} onClick={()=>setKind(k)}>{k}</button>)}<span style={{fontSize:11}}>최신순 · {visible.length}건{checked?` · ${checked} 확인`:''}</span></div>
    {error&&<p role="status" style={{fontSize:11}}>{error}</p>}
    <div role="region" aria-label="카톡 요청 목록" tabIndex={0} style={{overflowY:'auto',overscrollBehavior:'contain',minHeight:0,maxHeight:'65dvh',paddingRight:4}}>
    {!loading&&!blocks.length&&!error&&<p style={{fontSize:12}}>최근 3일에 표시할 추가·취소 요청이 없습니다.</p>}
    {blocks.length>0&&!visible.length&&<p>검색 결과가 없습니다.</p>}
    {visible.map(b=><article key={b.id} style={{padding:'8px 0',borderBottom:'1px solid var(--border)'}}><div style={{fontSize:11,color:'var(--text3)'}}>{b.room} · {b.sender} · {b.time}</div><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit',fontSize:12,margin:'5px 0'}}>{b.text}</pre></article>)}
    </div>
  </aside>;
}
