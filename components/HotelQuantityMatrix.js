import { useEffect, useRef, useState } from 'react';

export default function HotelQuantityMatrix({matrix,side,blocked,onEdit,renderSource}) {
  const numbers=Array.from({length:Math.max(4,...matrix.batches.map(b=>b.number))},(_,i)=>i+1);
  return <section className="quantity-matrix" aria-label={`${side==='request'?'요청':'발주'} 차별 수량표`}>
    <h3>{side==='request'?'요청':'발주'}수량 · 차별 합계</h3><p>저장자료 순서입니다. 수량 수정 후 Enter 또는 다른 칸을 누르면 반영됩니다.</p>
    <div className="matrix-scroll"><table><thead><tr><th>품목 / 단위</th>{numbers.map(n=>{const batch=matrix.batches.find(b=>b.number===n);return <th key={n}>{n}차{batch && <SourcePopover label={`${n}차 원본`}>{renderSource(batch)}</SourcePopover>}</th>;})}<th>총수량</th></tr></thead><tbody>
      {matrix.rows.map(row=><tr key={row.key}><th title={row.name}>{row.name}<small>{row.unit}{row.error && ' · 원본 확인 필요'}</small></th>{numbers.map(n=>{const batch=matrix.batches.find(b=>b.number===n),cell=batch && row.cells[batch.id];return <td key={n}>{cell ? <Quantity value={cell.qty} disabled={blocked || !!cell.error} label={`${side==='request'?'요청':'발주'} ${n}차 ${row.name} 수량`} onCommit={value=>onEdit(batch.id,row.key,value)}/> : <span>—</span>}</td>;})}<td className="total">{row.error ? '확인 필요' : row.total.toLocaleString('ko-KR',{maximumFractionDigits:6})}</td></tr>)}
      {!matrix.rows.length && <tr><td colSpan={numbers.length+2}>매칭 결과를 저장하면 이곳에 표시됩니다.</td></tr>}
    </tbody></table></div>
    <style jsx>{`
      .quantity-matrix {min-width:0;border:1px solid #bbd4d0;border-radius:8px;padding:12px;background:#f8fcfb} h3 {margin:0 0 8px} p {font-size:12px;color:#586982;margin:0 0 10px}
      .matrix-scroll {overflow:auto} table {border-collapse:separate;border-spacing:0;min-width:640px;width:100%;font-size:13px} th,td {padding:7px 5px;border-bottom:1px solid #dfe5ed;text-align:center;vertical-align:middle} thead th {background:#e7f4f0;white-space:nowrap} th:first-child {text-align:left;min-width:150px;max-width:220px} tbody th {font-weight:500;background:#fff} small {display:block;color:#586982;margin-top:3px} .total {font-weight:700;color:#115e59;background:#eef8f5;white-space:nowrap}
    `}</style>
  </section>;
}
function Quantity({value,disabled,label,onCommit}) {
  const [draft,setDraft]=useState(String(value));useEffect(()=>setDraft(String(value)),[value]);
  const commit=()=>{if(draft!==String(value)){if(draft!=='' && Number.isFinite(Number(draft)) && Number(draft)>=0)onCommit(draft);else setDraft(String(value));}};
  return <><input aria-label={label} type="number" min="0" step="any" value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setDraft(String(value));}}}/><style jsx>{`input {width:76px;box-sizing:border-box;font:inherit;border:1px solid #bac8db;border-radius:6px;padding:6px;background:white;color:#17243c;text-align:right}`}</style></>;
}
function SourcePopover({label,children}) {
  const [open,setOpen]=useState(false),timer=useRef(),trigger=useRef(),pinned=useRef(false),root=useRef();
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  const show=()=>{clearTimeout(timer.current);setOpen(true);};
  const close=()=>{pinned.current=false;trigger.current?.focus();setOpen(false);};
  return <span className="source-popover" ref={root} onMouseEnter={show} onMouseLeave={()=>{if(!pinned.current)timer.current=setTimeout(()=>{if(!root.current?.contains(document.activeElement))setOpen(false);},250);}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close();}}}>
    <button type="button" ref={trigger} data-tone="load" aria-label={label} aria-expanded={open} onFocus={show} onClick={()=>{pinned.current=true;show();}}>원본</button>
    {open && <div className="source-panel" role="dialog" aria-label={`${label} 비교`} onMouseEnter={show} onPointerDown={()=>{pinned.current=true;}}>
      <div className="source-heading"><strong>{label} · 매칭 비교</strong><button type="button" aria-label={`${label} 비교 닫기`} onClick={close}>닫기</button></div>{children}
    </div>}
    <style jsx>{`.source-popover {display:block}.source-panel {position:fixed;z-index:1200;inset:8vh 3vw;background:white;border:1px solid #b9c7d8;border-radius:10px;box-shadow:0 8px 45px #0004;padding:16px;overflow:auto;text-align:left;white-space:normal;font-weight:400;color:#17243c}.source-heading {display:flex;justify-content:space-between;align-items:center;margin-bottom:8px} button {margin:3px 0}`}</style>
  </span>;
}
