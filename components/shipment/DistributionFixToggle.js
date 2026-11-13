import {useEffect,useRef,useState} from 'react';
import {postShipmentFix} from '../../lib/fixCycleClient';

export default function DistributionFixToggle({week,prodGroup,prodKey,refreshKey,disabled,onFixed,onBusy,onError,onComplete}){
 const selection={prodGroup:prodGroup||'',prodKey:prodKey||null};
 const key=JSON.stringify([week,selection]);
 const current=useRef(key);current.current=key;
 const callbacks=useRef();callbacks.current={onFixed,onBusy,onError,onComplete};
 const seq=useRef(0),busy=useRef(false);
 const [state,setState]=useState(null),[loading,setLoading]=useState(false);
 async function read(){
  const r=await fetch('/api/shipment/distribution-confirmation?'+new URLSearchParams({week,year:String(week).split('-')[0],prodGroup:selection.prodGroup,...(selection.prodKey?{prodKey:selection.prodKey}:{})}),{cache:'no-store'});
  const d=await r.json();
  if(!r.ok||!d.ok||d.week!==week||!Array.isArray(d.categories))throw Error(d.error||'확정현황을 확인하지 못했습니다. 다시 조회하세요.');
  const rows=d.rows.filter(r=>d.categories.includes(r.category));
  const fixed=rows.some(r=>r.fixedCount>0),partial=fixed&&rows.some(r=>r.fixedCount<r.detailCount);
  return {key,categories:d.categories,fixed,partial};
 }
 function publish(s){if(current.current===key){setState(s);callbacks.current.onFixed?.(s?.fixed??true);}}
 useEffect(()=>{
  const id=++seq.current;publish(null);
  if(week)read().then(s=>{if(id===seq.current)publish(s);}).catch(()=>{if(id===seq.current)publish(null);});
  return()=>{seq.current++;};
 },[key,refreshKey]);
 async function act(){
  if(busy.current||disabled)return;busy.current=true;setLoading(true);callbacks.current.onBusy?.(true);callbacks.current.onError?.('');
  const shown=state;
  try{
   const fresh=await read();if(current.current!==key)throw Error('선택 범위가 바뀌었습니다. 다시 확인하세요.');publish(fresh);
   if(!fresh.categories.length)throw Error('선택 범위에 출고 내역이 없습니다.');
   if(!shown||shown.key!==key||shown.fixed!==fresh.fixed||JSON.stringify(shown.categories)!==JSON.stringify(fresh.categories))throw Error('확정현황이 바뀌었습니다. 바뀐 버튼을 확인한 뒤 다시 누르세요.');
   const action=fresh.fixed?'unfix':'fix';
   let issues='';
   if(action==='fix'){
    const r=await fetch('/api/shipment/fix?'+new URLSearchParams({week,orderYear:String(week).split('-')[0]}));const d=await r.json();
    if(!r.ok||d.error)throw Error(d.error||'확정 전 검증에 실패했습니다.');
    if(d.issueCount>0)issues=`\n차수 전체 사전검증: 음수재고 ${d.negative?.length||0}건, 중복 ${d.duplicate?.length||0}건, 주문 없는 출고 ${d.ghost?.length||0}건. 서버 보호조건을 통과한 경우에만 처리됩니다.\n`;
   }
   if(current.current!==key)throw Error('선택 범위가 바뀌었습니다. 다시 확인하세요.');
   const label=action==='unfix'?'확정취소':'확정';
   if(!confirm(`[${week}] ${fresh.categories.join(', ')}\n\n위 카테고리를 ${label}하시겠습니까?\n품목을 선택해도 EXE 기준 같은 카테고리 전체가 처리됩니다.${issues}`))return;
   const {data}=await postShipmentFix({week,orderYear:String(week).split('-')[0],action,force:false,countryFlowers:fresh.categories,cycleSource:'distribute-toolbar',confirmationSelection:selection});
   if(!data.success)throw Error(data.error||data.message||`${label}에 실패했습니다.`);
   callbacks.current.onComplete?.(data);
  }catch(e){callbacks.current.onError?.(e.message);}
  finally{
   // Also read back on partial failure or ambiguous responses; never optimistically flip the state.
   if(current.current===key)try{publish(await read());}catch{publish(null);}
   busy.current=false;setLoading(false);callbacks.current.onBusy?.(false);
  }
 }
 const valid=state?.key===key,ready=valid&&state.categories.length>0,fixed=valid&&state.fixed;
 return <button type="button" data-testid="distribution-fix-toggle" className={`btn btn-sm ${fixed?'btn-danger':'btn-success'}`} style={fixed?{background:'#dc2626',borderColor:'#dc2626',color:'#fff'}:undefined}
  disabled={disabled||loading||!ready} onClick={act} title={ready?`${week} · ${state.categories.join(', ')}`:'확정현황을 조회 중이거나 선택 범위에 출고가 없습니다. 조회 버튼으로 다시 확인하세요.'}>
  {loading?'처리 중…':!valid?'확정현황 확인 중…':!ready?'확정 대상 없음':fixed?`↩️ 확정취소${state.partial?' (일부 확정)':''}`:'✅ 확정 / Confirmar'}
 </button>;
}
