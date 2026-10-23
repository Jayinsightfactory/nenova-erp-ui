import { useEffect, useState } from 'react';

export const latestReferenceKey = item => `${Number(item.prodKey ?? item.ProdKey)}|${String(item.unit ?? item.Unit ?? '').trim()}`;
export function useLatestArrivalReferences(orderYear, items = []) {
  const normalized = [...new Map(items.filter(item=>Number(item.prodKey ?? item.ProdKey)>0).map(item=>{
    const row={prodKey:Number(item.prodKey ?? item.ProdKey),unit:String(item.unit ?? item.Unit ?? '').trim()};
    return [latestReferenceKey(row),row];
  })).values()].sort((a,b)=>latestReferenceKey(a).localeCompare(latestReferenceKey(b)));
  const scope=JSON.stringify([String(orderYear ?? ''),normalized]);
  const [state,setState]=useState({scope:'',references:{},error:'',loading:false});
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const onFocus=()=>setRefresh(value=>value+1);
    window.addEventListener('focus',onFocus);
    return ()=>window.removeEventListener('focus',onFocus);
  },[]);
  useEffect(()=>{
    const [year,rows]=JSON.parse(scope), controller=new AbortController();
    if (!/^\d{4}$/.test(year) || !rows.length) return;
    async function load(){
      setState({scope,references:{},error:'',loading:true});
      try {
        const references={};
        for(let i=0;i<rows.length;i+=40){
          const params=new URLSearchParams({orderYear:year,items:JSON.stringify(rows.slice(i,i+40))});
          const response=await fetch(`/api/arrival-cost/latest?${params}`,{signal:controller.signal,credentials:'same-origin',cache:'no-store'});
          const data=await response.json();
          if(!response.ok || !data.success) throw new Error(data.error || '최신 원가 조회 실패');
          Object.assign(references,data.references);
        }
        if(!controller.signal.aborted) setState({scope,references,error:'',loading:false});
      } catch(error){if(!controller.signal.aborted) setState({scope,references:{},error:error.message,loading:false});}
    }
    load();
    return ()=>controller.abort();
  },[scope,refresh]);
  if(normalized.length && !/^\d{4}$/.test(String(orderYear ?? ''))) return {references:{},error:'원가 조회 연도 확인 필요',loading:false};
  return state.scope===scope ? state : {references:{},error:'',loading:normalized.length>0};
}
