import {useEffect,useRef,useState} from 'react';
import {analysisKey,analysisGroups,usablePreparedAnalysis} from '../../lib/pasteInboxPreanalysis';

export default function DistributionMessagePreanalysis({text,week,disabled,prepare,onOpen,children}) {
  const root=useRef(null),current=useRef(null),attempted=useRef(''),mounted=useRef(false),requestId=useRef(0);
  const [visible,setVisible]=useState(false),[enabled,setEnabled]=useState(true);
  const [pageEligible,setPageEligible]=useState(true);
  const [state,setState]=useState({status:'waiting'});
  const key=analysisKey(text,week);
  current.current={key,disabled,visible,enabled};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{const update=()=>setPageEligible(document.visibilityState==='visible'&&navigator.onLine!==false);update();document.addEventListener('visibilitychange',update);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{document.removeEventListener('visibilitychange',update);window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>setVisible(entries.some(entry=>entry.isIntersecting)),{root:null,rootMargin:'200px'});
    if(root.current)observer.observe(root.current);
    return()=>observer.disconnect();
  },[]);
  async function run(automatic=false,force=false,lookupOnly=false) {
    const requestKey=key,id=++requestId.current;
    if(!lookupOnly)attempted.current=requestKey;
    const isCurrent=()=>mounted.current&&current.current.key===requestKey&&requestId.current===id;
    const update=status=>{if(isCurrent())setState(previous=>({key:requestKey,status,result:previous.key===requestKey?previous.result:null}));};
    update(lookupOnly?'restoring':'queued');
    try {
      const result=await prepare(text,week,{automatic,force,lookupOnly,onStatus:update,eligible:()=>mounted.current&&current.current.key===requestKey&&(!automatic||(!current.current.disabled&&current.current.visible&&current.current.enabled&&document.visibilityState==='visible'&&navigator.onLine!==false))});
      if(isCurrent())setState({key:requestKey,status:result?'ready':'waiting',result});
      return result;
    } catch(error) {
      if(isCurrent()){
        if(error.code==='PREANALYSIS_DEFERRED')attempted.current='';
        setState(previous=>({key:requestKey,status:error.code==='PREANALYSIS_DEFERRED'?'waiting':'error',result:previous.key===requestKey?previous.result:null,error:error.message}));
      }
      return null;
    }
  }
  // Re-entering, disabling automatic analysis or scrolling must not hide saved
  // work. Restore first; only actual misses can schedule a new Claude call.
  useEffect(()=>{attempted.current='';void run(false,false,true);return()=>{requestId.current++;};},[key]);
  const result=state.key===key&&usablePreparedAnalysis(state.result,text,week)?state.result:null;
  const loading=state.key===key&&['restoring','queued','analyzing'].includes(state.status);
  useEffect(()=>{
    if(state.key===key&&!result&&!loading&&visible&&enabled&&!disabled&&pageEligible&&attempted.current!==key&&state.status!=='error')void run(true);
  },[visible,enabled,disabled,pageEligible,key,state.status,result,loading]);
  const groups=result?analysisGroups(result.data):[];
  const items=groups.flatMap(group=>group.items),matched=items.filter(item=>item.matched).length;
  async function openResult(){const ready=result||await run(false);if(ready&&mounted.current&&current.current.key===key)onOpen(ready);}
  return <section ref={root} className="preanalysis" aria-label="Claude 사전 매칭">
    <header><strong>Claude 사전 매칭</strong><label><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/>자동</label></header>
    <div className="analysis-actions"><button type="button" disabled={disabled||(!result&&loading)} title="매칭 결과를 등록·분배 검토 화면으로 엽니다. 실제 저장은 검토 후 별도로 실행합니다." onClick={openResult}>{result?'등록분배하기':loading?({restoring:'저장본 확인 중',queued:'분석 대기',analyzing:'분석 중'})[state.status]:'지금 분석'}</button>{result&&<button type="button" disabled={disabled||loading} onClick={()=>run(false,true)}>재분석</button>}</div>
    <small role="status">{state.key===key&&state.error?state.error:loading?({restoring:'저장된 분석을 불러오는 중…',queued:'다른 원문 분석 완료 후 시작합니다.',analyzing:'새 원문 분석 중…'})[state.status]:result?`${result.data.analysisStorage?.shared?(result.data.analysisStorage?.cacheHit?'공유 분석':'공유 분석 저장 완료'):(result.data.analysisStorage?.cacheHit?'저장된 분석':'분석 저장 완료')} · 매칭 ${matched}/${items.length} · ${new Date(result.data.analysisStorage?.savedAt||result.at).toLocaleString('ko-KR')} · 적용 여부 별도` :state.key===key&&state.error?state.error:'저장된 분석을 불러오고, 새 원문만 자동 분석합니다.'}</small>
    {result?<><div className="analysis-groups">{groups.map((group,index)=><section key={index} className="analysis-group"><header><strong>{group.customer}</strong><span>{group.items.length}항목</span></header>{group.sourceCustomer!==group.customer&&<small>원문 업체: {group.sourceCustomer} → 매칭 확인</small>}{group.items.map((item,itemIndex)=><div key={itemIndex} className={`analysis-item ${item.matched?'matched':'review'}`} title={`${item.source}${item.reason?` · ${item.reason}`:''}`}><span>{item.product}</span><span>{item.action}{item.quantity}</span><b>{item.matched?'매칭':'확인 필요'}</b></div>)}</section>)}</div>{!items.length&&<p role="alert">분석 품목 없음 · 원문을 확인하고 재분석하세요.</p>}<details><summary>전산 적용 여부 · 별도 근거</summary>{children}</details></>:children}
    <style jsx>{`.preanalysis{min-width:0;border:1px solid #c6d8ef;border-radius:4px;background:#f6faff;padding:4px;font-size:11px}.preanalysis>header,.analysis-group>header{display:flex;justify-content:space-between;gap:6px;align-items:center;color:#245b93}.preanalysis small{display:block;color:#66798d;overflow-wrap:anywhere;margin:3px 0}.analysis-actions{display:flex;gap:4px;margin:3px 0}.analysis-actions button{font:inherit;border:1px solid #9fbddd;border-radius:3px;background:white;color:#245b93;padding:3px 5px;cursor:pointer}.analysis-actions button:disabled{opacity:.55}.analysis-groups{display:grid;gap:4px}.analysis-group{min-width:0;background:white;border:1px solid #d3dfed;border-radius:3px;padding:3px}.analysis-item{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:4px;padding:3px;border-top:1px solid #e4edf5;line-height:1.2}.analysis-item>span:first-child{overflow-wrap:anywhere}.matched{background:#edf5ff;color:#174c86}.review{background:#fff4dd;color:#8a5a00}.analysis-item b{font-size:10px;white-space:nowrap}.preanalysis summary{cursor:pointer;color:#596e85;margin-top:4px}.preanalysis label{white-space:nowrap;font-weight:normal}.preanalysis input{vertical-align:middle}`}</style>
  </section>;
}
