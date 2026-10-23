import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {composeWeekdayBoxParts,splitWeekdayBoxParts} from '../lib/weekdayBoxParts.js';

export default function WeekdayBoxPartsDialog({label,quantity,pack,onApply,onClose}) {
  const initial=splitWeekdayBoxParts(quantity,pack);
  const [boxes,setBoxes]=useState(initial?String(initial.boxes):'');
  const [loose,setLoose]=useState(initial?String(initial.loose):'');
  const [failure,setFailure]=useState(''),[busy,setBusy]=useState(false);
  const dialog=useRef(null),returnFocus=useRef(null);
  useEffect(()=>{
    returnFocus.current=document.activeElement;
    dialog.current?.querySelector('input:not(:disabled),button:not(:disabled)')?.focus();
    return ()=>returnFocus.current?.isConnected && returnFocus.current.focus({preventScroll:true});
  },[]);
  let result=null,error='';
  try {result=composeWeekdayBoxParts(boxes,loose,pack);} catch(e){error=e.message;}
  async function submit(event) {
    event.preventDefault(); if(!result || busy)return;
    setBusy(true);setFailure('');
    try {if(await onApply(String(result.quantity))===false)throw new Error('초안 반영 실패 · 입력값을 확인하세요.');onClose();}
    catch(e){setFailure(e.message);}finally{setBusy(false);}
  }
  return createPortal(<div onClick={event=>event.stopPropagation()} style={{position:'fixed',inset:0,zIndex:2500,background:'#172b4233',display:'grid',placeItems:'center'}}>
    <form ref={dialog} role="dialog" aria-modal="true" aria-label={`${label} 박스·낱개 수량`} onSubmit={submit}
      style={{background:'white',border:'1px solid #8aa8ce',borderRadius:8,padding:16,boxSizing:'border-box',width:'min(392px,calc(100vw - 32px))',maxHeight:'calc(100vh - 32px)',overflow:'auto',boxShadow:'0 4px 20px #172b4244'}}
      onKeyDown={event=>{
        if(event.key==='Escape'&&!busy&&!event.nativeEvent?.isComposing){event.preventDefault();event.stopPropagation();onClose();}
        if(event.key==='Tab'){
          const controls=[...dialog.current.querySelectorAll('input:not(:disabled),button:not(:disabled)')];
          if(event.shiftKey&&document.activeElement===controls[0]){event.preventDefault();controls.at(-1)?.focus();}
          else if(!event.shiftKey&&document.activeElement===controls.at(-1)){event.preventDefault();controls[0]?.focus();}
        }
      }}>
      <strong>{label}</strong>
      <p>1박스 = {pack.count ?? '?'}{pack.unit}</p>
      {!initial&&Number(quantity)>0&&<p>기존 {Number(quantity)}박스 · 박스와 낱개를 새로 입력하세요.</p>}
      <div style={{display:'flex',gap:12}}>
        <label>박스 ({pack.count ?? '?'}{pack.unit})<input aria-label="박스 수량" inputMode="numeric" value={boxes} disabled={busy||!pack.count} onChange={e=>setBoxes(e.target.value)} style={{width:100,display:'block'}}/></label>
        <label>+ {pack.unit}<input aria-label={`낱개 ${pack.unit} 수량`} inputMode="numeric" value={loose} disabled={busy||!pack.count} onChange={e=>setLoose(e.target.value)} style={{width:100,display:'block'}}/></label>
      </div>
      <p aria-live="polite">{result?`합계 ${result.total}${pack.unit} · 전산 표시 ${result.quantity.toFixed(2)}박스`:error}</p>
      <small>초안 반영 후 ‘분배 적용 · 변경 확인’에서 저장합니다.</small>
      {failure&&<p role="alert">{failure}</p>}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:12}}>
        <button type="button" disabled={busy} onClick={onClose}>취소</button><button type="submit" disabled={!result||busy}>초안 반영</button>
      </div>
    </form>
  </div>,document.body);
}
