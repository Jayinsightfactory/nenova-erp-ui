import { useState } from 'react';

const button = {font:'inherit',color:'#1e3a8a',background:'#fff',border:'1px solid #94a3b8',borderRadius:5,padding:'3px 8px'};
const input = {font:'inherit',color:'#0f172a',border:'1px solid #94a3b8',borderRadius:5,padding:'4px 6px'};

export default function ReceiptBunchConfirmation({ issue, onConfirm, disabled, actionLabel = '확인하고 입고 계속' }) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const number = Number(quantity);
  return <div style={{fontSize:14,color:'#0f172a',fontVariantNumeric:'tabular-nums',borderLeft:'3px solid #94a3b8',padding:'6px 10px',background:'#f8fafc'}}>
    <p style={{margin:'0 0 5px'}}>{issue.message || issue.error}</p>
    {issue.candidates?.map(({label, quantity: candidate, formula}, index) =>
      <div key={index} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:4}}>
        <span>{label} · {formula} = {candidate}단</span>
        {Number.isSafeInteger(candidate) && <button type="button" style={button} disabled={disabled}
          onClick={() => setQuantity(String(candidate))}>수량 선택</button>}
      </div>)}
    <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,marginTop:6}}>
    <label>확인한 단 수량 <input type="number" min="1" step="1" value={quantity} disabled={disabled} style={{...input,width:75}}
      onChange={event => setQuantity(event.target.value)} /></label>
    <label>확인 근거 <input value={reason} maxLength={500} disabled={disabled} style={{...input,width:138}}
      onChange={event => setReason(event.target.value)} /></label>
    <button type="button" style={button} disabled={disabled || !Number.isSafeInteger(number) || number <= 0 || !reason.trim()}
      onClick={() => onConfirm({quantity:number,reason:reason.trim(),snapshot:issue.snapshot})}>{actionLabel}</button>
    </div>
  </div>;
}
