import {useEffect,useRef,useState} from 'react';
import {deliveryRequestBatches,validatedDeliveryItems,createDeliveryEvidenceCache} from '../../lib/distributionDeliveryClient';
import {startBoundedAutoRefresh,HISTORY_REFRESH_INTERVAL_MS} from '../../lib/distributionSalesInboxRefresh';

// Delivery evidence is read-only and refreshed independently of ERP processing.
export default function useDistributionDeliveryStatus({rows,year,week,enabled,actorId}) {
  const scope=JSON.stringify([actorId,year,week,rows.map(row=>[row.identity,row.message,row.created_at,row.timestamp_approximate,row.source,row.chatroom,row.chat_id,row.external_message_id,row.truncated,row.is_truncated])]);
  const [state,setState]=useState({scope:'',items:{},loading:false,error:''});
  const cache=useRef(null);
  if(!cache.current)cache.current=createDeliveryEvidenceCache();
  useEffect(()=>{
    if(!enabled||!rows.length)return undefined;
    let active=true;
    let controller;
    const stop=startBoundedAutoRefresh({intervalMs:HISTORY_REFRESH_INTERVAL_MS,
      isEligible:()=>document.visibilityState==='visible'&&navigator.onLine!==false,
      run:async()=>{
        controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),45000);
        setState(previous=>({scope,items:{...(previous.scope===scope?previous.items:{}),...cache.current.read(actorId,year,rows)},loading:true,error:''}));
        try {
          const items={};let warning='',targetCount=null,qualifiedSourceCount=0;
          // Duplicate original texts remain unconfirmed across batch boundaries too.
          const counts=new Map();
          for(const row of rows){const text=String(row.message||'').normalize('NFC').replace(/\s+/g,' ').trim();counts.set(text,(counts.get(text)||0)+1);}
          const {batches,oversized}=deliveryRequestBatches(rows.map(row=>({...row,duplicateOriginal:counts.get(String(row.message||'').normalize('NFC').replace(/\s+/g,' ').trim())>1})),year,week);
          for(const row of oversized)items[row.identity]={identity:row.identity,status:'UNCONFIRMED',reason:'incomplete'};
          for(const sources of batches){
            const response=await fetch('/api/kakao/delivery-status',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({year,week,sources})});
            const data=await response.json();
            if(!response.ok||data.ok!==true||!Array.isArray(data.items))throw new Error(data.error||'추가취소방 전송 여부를 확인하지 못했습니다.');
            if(typeof data.warning==='string'&&data.warning)warning=data.warning;
            if(Number.isSafeInteger(data.diagnostics?.targetCount)&&data.diagnostics.targetCount>=0){targetCount=Math.max(targetCount??0,data.diagnostics.targetCount);qualifiedSourceCount+=data.diagnostics.qualifiedSourceCount||0;}
            for(const item of validatedDeliveryItems(data,sources,year,week)){
              const original=sources.find(row=>row.identity===item.identity);
              const duplicated=counts.get(String(original.message||'').normalize('NFC').replace(/\s+/g,' ').trim())>1;
              items[item.identity]=duplicated&&item.persisted!==true?{identity:item.identity,status:'AMBIGUOUS',reason:'ambiguous'}:item;
            }
            if(active){const confirmed=cache.current.accept(actorId,year,rows,items);setState({scope,items:{...items,...confirmed},loading:true,error:warning});}
          }
          if(active)setState({scope,items:{...items,...cache.current.read(actorId,year,rows)},loading:false,error:warning,...(targetCount!==null?{diagnostics:{targetCount,qualifiedSourceCount}}:{})});
        } catch(error){
          // Refresh failure is separate from a previously verified fact.
          if(active)setState({scope,items:cache.current.read(actorId,year,rows),loading:false,error:error.name==='AbortError'?'전달 확인 시간이 초과되었습니다.':String(error.message)});
          throw error;
        } finally {clearTimeout(timeout);}
      },
    });
    return()=>{active=false;stop();controller?.abort();};
  },[scope,enabled]);
  return state.scope===scope?state:{items:cache.current.read(actorId,year,rows),loading:enabled&&rows.length>0,error:''};
}
