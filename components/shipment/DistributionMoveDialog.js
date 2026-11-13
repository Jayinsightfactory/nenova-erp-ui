import {useState} from 'react';
import {distributionUnitFactor} from '../../lib/shipmentDistributionWorkspace.js';
import {distributeProductName} from '../../lib/distributeProductDisplay';

export default function DistributionMoveDialog({rows,sides,onMove,onClose}){
 const [key,setKey]=useState(rows[0]?.ProdKey||0),[from,setFrom]=useState(0),[to,setTo]=useState(1),[quantity,setQuantity]=useState(''),[unit,setUnit]=useState(''),[message,setMessage]=useState('');
 const row=rows.find(r=>Number(r.ProdKey)===Number(key))||rows[0];
 const selectedUnit=unit||row?.OutUnit||'박스',factor=row?distributionUnitFactor(row,selectedUnit):null;
 const qty=index=>{const side=sides[index],item=side?.items.find(i=>Number(i.ProdKey)===Number(row?.ProdKey));return Number(side?.inputs[row?.ProdKey]?.outQty??item?.출고수량??0)||0;};
 return <div className="modal-overlay" onClick={onClose}>
  <section className="modal" role="dialog" aria-modal="true" aria-label="업체 간 수량 이동" data-testid="distribution-move-dialog" style={{maxWidth:580}} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}}}>
   <div className="modal-header"><strong>업체 간 수량 이동</strong><button type="button" className="btn btn-sm" onClick={onClose}>닫기</button></div>
   <div className="modal-body" style={{display:'grid',gap:10,padding:16}}>
    <label>품목 <select autoFocus aria-label="이동 품목" data-ai-verify="move-dialog-product" value={row?.ProdKey||''} onChange={e=>{setKey(Number(e.target.value));setUnit('');setQuantity('');setMessage('');}}>{rows.map(r=><option key={r.ProdKey} value={r.ProdKey}>{distributeProductName(r,r.FlowerName)}</option>)}</select></label>
    <label>보내는 업체 <select aria-label="보내는 업체" data-ai-verify="move-dialog-from" value={from} onChange={e=>setFrom(Number(e.target.value))}>{sides.map((side,i)=><option key={side.cust.CustKey} value={i}>{i+1}. {side.cust.CustName}</option>)}</select></label>
    <label>받는 업체 <select aria-label="받는 업체" data-ai-verify="move-dialog-to" value={to} onChange={e=>setTo(Number(e.target.value))}>{sides.map((side,i)=><option key={side.cust.CustKey} value={i}>{i+1}. {side.cust.CustName}</option>)}</select></label>
    <div>화면 수량: 보내는 곳 {qty(from)} / 받는 곳 {qty(to)} {row?.OutUnit}</div>
    <div style={{display:'flex',gap:8}}><input type="number" min={0} step="any" aria-label="이동 수량" data-ai-verify="move-dialog-quantity" placeholder="비우면 전부" value={quantity} onChange={e=>setQuantity(e.target.value)} /><select aria-label="이동 수량 단위" data-ai-verify="move-dialog-unit" value={selectedUnit} onChange={e=>setUnit(e.target.value)}>{['박스','단','송이'].map(u=><option key={u} disabled={!row||!distributionUnitFactor(row,u)}>{u}</option>)}</select></div>
    <p style={{fontSize:12,margin:0}}>화면 입력값만 옮깁니다. 실제 반영은 이 창을 닫고 상단 저장 버튼으로 합니다.</p>
    {message&&<p role="status">{message}</p>}
   </div>
   <div className="modal-footer"><button type="button" className="btn btn-primary" data-ai-verify="move-dialog-apply" disabled={!row||!factor||from===to||qty(from)<=0} onClick={()=>{const changed=onMove(row.ProdKey,from,to,factor,quantity);setMessage(changed?'화면 수량을 이동했습니다. 상단 저장으로 반영하세요.':'이동할 수량을 확인하세요.');}}>화면 수량 이동</button></div>
  </section>
 </div>;
}
