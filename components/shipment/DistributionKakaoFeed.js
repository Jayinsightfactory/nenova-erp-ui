import {useEffect,useRef,useState} from 'react';
import {recentSalesPeriod,refreshSalesFeed} from '../../lib/distributionSalesInboxRefresh';
import {requestRows} from '../../lib/distributionKakaoRequests';
import {requestDoneKey,readRequestDone} from '../../lib/distributionKakaoDoneClient';

export default function DistributionKakaoFeed() {
  const [blocks,setBlocks]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState('');
  const [kind,setKind]=useState('전체'),[checked,setChecked]=useState('');
  const [doneStates,setDoneStates]=useState({}),[donePending,setDonePending]=useState({}),[doneError,setDoneError]=useState('');
  const doneBusy=useRef(new Set()),doneGeneration=useRef(0);
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
      const rows=await Promise.all(requestRows(state.messages).map(async row=>({...row,doneKey:await requestDoneKey(row)})));
      if(!state.active||state.sequence!==sequence)return;
      setBlocks(rows);
      const generation=doneGeneration.current;
      try{const states=await readRequestDone(rows,controller.signal);if(state.active&&state.sequence===sequence&&generation===doneGeneration.current){setDoneStates(states);setDoneError('');}}
      catch(e){if(!controller.signal.aborted&&state.active)setDoneError(e.message);}
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
  async function toggleDone(row,done){
    const key=row.doneKey;if(doneBusy.current.has(key)||!doneStates[key])return;
    doneBusy.current.add(key);doneGeneration.current++;setDonePending(p=>({...p,[key]:true}));setDoneError('');
    try{
      const response=await fetch('/api/kakao/request-done',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key,done,expectedRevision:doneStates[key].revision,requestId:crypto.randomUUID()})});const data=await response.json();
      if(!response.ok||!data.ok){if(data.current)setDoneStates(p=>({...p,[key]:data.current}));throw Error(data.error||'작업완료 표시를 저장하지 못했습니다.');}
      if(reader.current.active)setDoneStates(p=>({...p,[key]:data.state}));
    }catch(e){if(reader.current.active)setDoneError(e.message);}
    finally{doneGeneration.current++;doneBusy.current.delete(key);if(reader.current.active)setDonePending(p=>({...p,[key]:false}));}
  }
  const visible=blocks.filter(b=>(kind==='전체'||b.kinds.includes(kind))&&`${b.room} ${b.sender} ${b.text}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <aside className="distribution-kakao-feed" aria-label="카톡 추가·취소 요청" style={{position:'sticky',top:4,maxHeight:'calc(100dvh - 100px)',display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}><strong>카톡 추가·취소 요청</strong><button type="button" className="btn btn-sm" disabled={loading} onClick={load}>{loading?'최신 확인 중…':'추가·취소 불러오기'}</button></div>
    <p style={{fontSize:11,margin:'5px 0'}}>최근 3일 영업방 · 15초 자동 확인 · 잔량 보고와 출고일 변경 제외</p>
    <input className="filter-input" aria-label="카톡 원문 검색" placeholder="방·보낸 사람·내용 검색" value={search} onChange={e=>setSearch(e.target.value)} style={{width:'100%'}} />
    <div style={{display:'flex',gap:4,padding:'5px 0',alignItems:'center',flexWrap:'wrap'}}>{['전체','추가','취소'].map(k=><button type="button" className="btn btn-sm" key={k} aria-pressed={kind===k} onClick={()=>setKind(k)}>{k}</button>)}<span style={{fontSize:11}}>최신순 · {visible.length}건{checked?` · ${checked} 확인`:''}</span></div>
    {error&&<p role="status" style={{fontSize:11}}>{error}</p>}
    {doneError&&<p role="alert" style={{fontSize:11}}>{doneError}</p>}
    <div role="region" aria-label="카톡 요청 목록" tabIndex={0} style={{overflowY:'auto',overscrollBehavior:'contain',minHeight:0,maxHeight:'65dvh',paddingRight:4}}>
    {!loading&&!blocks.length&&!error&&<p style={{fontSize:12}}>최근 3일에 표시할 추가·취소 요청이 없습니다.</p>}
    {blocks.length>0&&!visible.length&&<p>검색 결과가 없습니다.</p>}
    {visible.map(b=><article key={b.id} data-request-done={doneStates[b.doneKey]?.done?'true':'false'} style={{padding:'8px 4px',color:doneStates[b.doneKey]?.done?'#14532d':undefined,borderBottom:'1px solid var(--border)',background:doneStates[b.doneKey]?.done?'#dcfce7':undefined,borderLeft:doneStates[b.doneKey]?.done?'3px solid #16a34a':'3px solid transparent'}}><div style={{fontSize:11,color:doneStates[b.doneKey]?.done?'#166534':'var(--text3)'}}>{b.room} · {b.sender} · {b.time}</div><label style={{fontSize:11,color:'#166534',display:'flex',gap:4,alignItems:'center'}}><input type="checkbox" aria-label={`${b.text.split('\n')[0]} 작업완료`} checked={!!doneStates[b.doneKey]?.done} disabled={!doneStates[b.doneKey]||donePending[b.doneKey]} onChange={e=>toggleDone(b,e.target.checked)}/>{donePending[b.doneKey]?'저장 중…':'작업완료'}</label><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'inherit',fontSize:12,margin:'5px 0'}}>{b.text}</pre></article>)}
    </div>
  </aside>;
}
