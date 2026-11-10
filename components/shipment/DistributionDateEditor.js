import {dateQuantityUnits,dateDisplayQuantity,dateInputQuantity,datePackingSignature} from '../../lib/shipmentDateDisplayUnits.js';
import {inlineDateSignature} from '../../lib/shipmentInlineDates.js';
import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../../lib/useApi';
const qty=n=>Number(n||0).toLocaleString();
const day=['일','월','화','수','목','금','토'];
export default function DistributionDateEditor({scope,label,onClose,onSaved,inlineDraft}){
  const [chosenUnit,setChosenUnit]=useState(''),[displayInputs,setDisplayInputs]=useState({}),[unitInputErrors,setUnitInputErrors]=useState({});
  const [data,setData]=useState(null),[inputs,setInputs]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(null);
  const box=useRef(null),returnFocus=useRef(null),dirtyRef=useRef(false),busyRef=useRef(false);
  const baseline=Object.fromEntries((data?.context?.dates||[]).map(r=>[r.Timestamp,r.ShipmentQuantity]));
  const units=data?dateQuantityUnits(data.context.detail,[data.context.detail.OutQuantity,...data.context.dates.map(r=>r.ShipmentQuantity)]):[];
  const presentation=units.find(p=>p.unit===(chosenUnit||inlineDraft?.unit))??units[0];
  const unitError=!!data&&!presentation?'단·송이 입수 또는 기존 수량을 확인하세요.':'';
  const inputError=Object.values(unitInputErrors).find(Boolean)||'';
  const dirty=!!data&&data.context.calendar.some(r=>inputs[r.Timestamp]===''||!Number.isFinite(Number(inputs[r.Timestamp]??0))||Number(inputs[r.Timestamp]??0)!==Number(baseline[r.Timestamp]??0));
  dirtyRef.current=dirty;busyRef.current=busy;
  const close=()=>{if(!busyRef.current&&(!dirtyRef.current||window.confirm('미저장 출고일 분배를 버리고 닫을까요?')))onClose();};
  useEffect(()=>{
    returnFocus.current=document.activeElement;let active=true;
    apiGet('/api/shipment/distribution-dates',scope).then(d=>{if(!active)return;if(!d.success)throw new Error(d.error);if(inlineDraft&&inlineDraft.signature!==inlineDateSignature(d.context.calendar,d.context.dates,d.context.detail.OutQuantity))throw new Error('날짜 또는 출고수량이 변경되었습니다. 행의 날짜 입력을 취소하고 다시 조회하세요.');if(inlineDraft?.packingSignature&&inlineDraft.packingSignature!==datePackingSignature(d.context.detail))throw new Error('품목의 단위·입수가 변경되었습니다. 날짜 입력을 취소하고 다시 조회하세요.');setData(d);setInputs(inlineDraft?Object.fromEntries(inlineDraft.allocations.map(r=>[r.timestamp,r.quantity])):Object.fromEntries(d.context.dates.map(r=>[r.Timestamp,r.ShipmentQuantity])));}).catch(e=>{if(active)setError(e.message);});
    box.current?.focus();
    const unload=e=>{if(dirtyRef.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',unload);
    return()=>{active=false;window.removeEventListener('beforeunload',unload);returnFocus.current?.focus();};
  },[]);
  const total=Object.values(inputs).reduce((s,v)=>s+(Number(v)||0),0);
  const allocations=()=>data.context.calendar.map(r=>({timestamp:r.Timestamp,quantity:inputs[r.Timestamp]??0}));
  const submit=async confirm=>{
    setBusy(true);setError('');
    try{
      const result=await apiPost('/api/shipment/distribution-dates',{...scope,snapshot:data.snapshot,allocations:allocations(),preview:!confirm,confirm});
      if(!result.success)throw new Error(result.error||'출고일 저장 실패');
      if(!confirm)setPreview(result.plan);
      else {dirtyRef.current=false;await onSaved();onClose();}
    }catch(e){setError(e.message);setPreview(null);}finally{setBusy(false);}
  };
  return <div className="modal-overlay" style={{zIndex:2200}} onClick={e=>{if(e.target===e.currentTarget)close();}}>
    <section ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="출고일 수량 분배" className="modal" style={{width:'min(720px,calc(100vw - 12px))',maxHeight:'92vh',overflowY:'auto'}}
      onKeyDownCapture={e=>{
        e.stopPropagation();
        if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();return;}
        if(e.key==='Escape'){e.preventDefault();close();}
        if(e.key==='Tab'){const nodes=[...box.current.querySelectorAll('button:not(:disabled),input:not(:disabled)')];if(!nodes.length){e.preventDefault();return;}const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===box.current)){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
      }}>
      <div className="modal-header"><h3 style={{margin:0}}>출고일 수량 분배</h3><button type="button" disabled={busy} onClick={close} aria-label="출고일 분배 닫기">✕</button></div>
      <div className="modal-body" style={{padding:12}}>
        <p style={{marginTop:0}}>{scope.orderYear}년 {scope.orderWeek} · {label}</p>
        <p style={{fontSize:12}}>총 출고수량을 유지하며 날짜별로 나눕니다. 날짜는 전산의 해당 차수 달력입니다.</p>
        {error&&<p role="alert" style={{color:'var(--red)'}}>{error}</p>}
        {!data&&!error&&<p>저장된 출고일 조회 중…</p>}
        {data&&<>
          <p>현재 출고 <b>{dateDisplayQuantity(data.context.detail.OutQuantity,presentation)} {presentation?.unit??'환산 확인'}</b> · {data.context.detail.DetailFix?'확정 상태 유지':'미확정 상태 유지'}</p>
          <label>날짜 수량 단위 <select aria-label="날짜 수량 단위" disabled={busy||dirty||!!inputError||!units.length} value={presentation?.unit??''} onChange={e=>{setChosenUnit(e.target.value);setDisplayInputs({});}}>{!units.length&&<option value="">환산 확인</option>}{units.map(p=><option key={p.unit} value={p.unit}>{p.unit}</option>)}</select></label>
          {(unitError||inputError)&&<p role="alert">{unitError||inputError}</p>}
          {data.blocked&&<p role="alert" style={{color:'var(--red)'}}>{data.blocked}</p>}
          <table className="tbl" style={{width:'100%'}}><thead><tr><th>출고일</th><th>저장 수량</th><th>분배 수량 ({presentation?.unit??'환산 확인'})</th></tr></thead><tbody>
            {[...data.context.calendar].sort((a,b)=>a.Timestamp.localeCompare(b.Timestamp)).map(r=><tr key={r.Timestamp}>
              <td>{r.Timestamp.slice(0,10)} ({day[r.WeekDay-1]})</td><td className="num">{dateDisplayQuantity(baseline[r.Timestamp]??0,presentation)}</td>
              <td><input type="number" min="0" step="1" aria-label={`${r.Timestamp.slice(0,10)} 분배수량`} value={displayInputs[r.Timestamp]??dateDisplayQuantity(inputs[r.Timestamp]??0,presentation)} disabled={busy||!!data.blocked||!!unitError}
                onChange={e=>{const value=e.target.value,result=dateInputQuantity(value,presentation);setDisplayInputs(v=>({...v,[r.Timestamp]:value}));setUnitInputErrors(v=>({...v,[r.Timestamp]:result.error}));setInputs(v=>({...v,[r.Timestamp]:result.quantity}));setPreview(null);}} style={{width:100,maxWidth:'100%',textAlign:'right'}} /></td>
            </tr>)}
          </tbody></table>
          <p role="status">분배 합계 <b>{dateDisplayQuantity(total,presentation)} {presentation?.unit}</b> / 현재 출고 {dateDisplayQuantity(data.context.detail.OutQuantity,presentation)} {presentation?.unit} · 차이 {dateDisplayQuantity(Math.abs(data.context.detail.OutQuantity-total),presentation)}</p>
          {preview&&<div data-testid="date-save-preview" style={{padding:10,background:'var(--blue-bg)'}}>
            <b>저장 전 확인</b><p>총 출고 {dateDisplayQuantity(preview.total,presentation)} {presentation?.unit} · 견적 {qty(preview.estimateTotal)} {data.context.detail.EstUnit} · 매출 {qty(preview.gross)}원 유지</p>
            <p>날짜별 견적·이카운트 출력일이 변경됩니다. 날짜별 공급가 분할 반올림 차이: {qty(preview.amountDelta)}원 (부가세 반대, 총매출 동일).</p>
            {[...preview.dates].sort((a,b)=>a.Timestamp.localeCompare(b.Timestamp)).map(r=><div key={r.Timestamp}>{r.Timestamp.slice(0,10)} → {dateDisplayQuantity(r.ShipmentQuantity,presentation)} {presentation?.unit}</div>)}
          </div>}
        </>}
      </div>
      <div className="modal-footer" style={{flexWrap:'wrap'}}>
        <button type="button" className="btn" disabled={busy} onClick={close}>닫기</button>
        {data&&<button type="button" className="btn btn-primary" disabled={busy||!dirty||!!data.blocked||!!unitError||!!inputError||Math.abs(total-data.context.detail.OutQuantity)>.000001} onClick={()=>submit(!!preview)}>{busy?'처리 중…':preview?'확인한 출고일 저장':'변경 미리보기'}</button>}
      </div>
    </section>
  </div>;
}
