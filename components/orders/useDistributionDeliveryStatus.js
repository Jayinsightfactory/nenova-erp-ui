import {useEffect,useState} from 'react';
import {deliveryRequestBatches,validatedDeliveryItems} from '../../lib/distributionDeliveryClient';
import {startBoundedAutoRefresh,HISTORY_REFRESH_INTERVAL_MS} from '../../lib/distributionSalesInboxRefresh';

// Delivery evidence is read-only and refreshed independently of ERP processing.
export default function useDistributionDeliveryStatus({rows,year,week,enabled,actorId}) {
  const ownerScope=JSON.stringify([actorId,year,week]);
  const fingerprints=Object.fromEntries(rows.map(row=>[row.identity,JSON.stringify([row.message,row.created_at,row.timestamp_approximate,row.source,row.chatroom,row.chat_id,row.external_message_id,row.truncated,row.is_truncated])]));
  const scope=JSON.stringify([ownerScope,fingerprints]);
  const currentTextCounts=new Map();
  for(const row of rows){const text=String(row.message||'').normalize('NFC').replace(/\s+/gu,' ').trim();currentTextCounts.set(text,(currentTextCounts.get(text)||0)+1);}
  const currentTextByIdentity=new Map(rows.map(row=>[row.identity,String(row.message||'').normalize('NFC').replace(/\s+/gu,' ').trim()]));
  function retainedItems(previous) {
    if(previous.ownerScope!==ownerScope)return {};
    return Object.fromEntries(Object.entries(previous.items).filter(([identity])=>previous.fingerprints?.[identity]===fingerprints[identity]&&currentTextCounts.get(currentTextByIdentity.get(identity))===1));
  }
  const [state,setState]=useState({scope:'',items:{},loading:false,error:''});
  useEffect(()=>{
    if(!enabled||!rows.length)return undefined;
    let active=true;
    let controller;
    const stop=startBoundedAutoRefresh({intervalMs:HISTORY_REFRESH_INTERVAL_MS,
      isEligible:()=>document.visibilityState==='visible'&&navigator.onLine!==false,
      run:async()=>{
        controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),45000);
        setState(previous=>({scope,ownerScope,fingerprints,items:retainedItems(previous),loading:true,error:''}));
        try {
          const items={};let targetCount=0,qualifiedSourceCount=0;
          // Duplicate original texts remain unconfirmed across batch boundaries too.
          const counts=new Map();
          for(const row of rows){const text=String(row.message||'').normalize('NFC').replace(/\s+/g,' ').trim();counts.set(text,(counts.get(text)||0)+1);}
          const {batches,oversized}=deliveryRequestBatches(rows,year,week);
          for(const row of oversized)items[row.identity]={identity:row.identity,status:'UNCONFIRMED',reason:'incomplete'};
          for(const sources of batches){
            const response=await fetch('/api/kakao/delivery-status',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({year,week,sources})});
            const data=await response.json();
            if(!response.ok||data.ok!==true||!Array.isArray(data.items))throw new Error(data.error||'추가취소방 전송 여부를 확인하지 못했습니다.');
            if(Number.isSafeInteger(data.diagnostics?.targetCount)&&data.diagnostics.targetCount>=0)targetCount=Math.max(targetCount,data.diagnostics.targetCount);
            if(Number.isSafeInteger(data.diagnostics?.qualifiedSourceCount)&&data.diagnostics.qualifiedSourceCount>=0)qualifiedSourceCount+=data.diagnostics.qualifiedSourceCount;
            for(const item of validatedDeliveryItems(data,sources,year,week)){
              const original=sources.find(row=>row.identity===item.identity);
              const duplicated=counts.get(String(original.message||'').normalize('NFC').replace(/\s+/g,' ').trim())>1;
              items[item.identity]=duplicated?{identity:item.identity,status:'AMBIGUOUS',reason:'ambiguous'}:item;
            }
          }
          if(active)setState({scope,ownerScope,fingerprints,items,loading:false,error:'',diagnostics:{targetCount,qualifiedSourceCount}});
        } catch(error){
          // A failed read never keeps an old green light as fresh confirmation.
          if(active)setState({scope,ownerScope,fingerprints,items:{},loading:false,error:error.name==='AbortError'?'전달 확인 시간이 초과되었습니다.':String(error.message)});
          throw error;
        } finally {clearTimeout(timeout);}
      },
    });
    return()=>{active=false;stop();controller?.abort();};
  },[scope,enabled]);
  return state.scope===scope?state:{items:enabled?retainedItems(state):{},loading:false,pending:enabled&&rows.length>0,error:''};
}
