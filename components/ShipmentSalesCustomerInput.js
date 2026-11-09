import { useEffect, useId, useRef, useState } from 'react';
import { customerMatchesSearch } from '../lib/customerSearch';
import styles from './EstimateShipmentDateSales.module.css';

export default function ShipmentSalesCustomerInput({ customers, value, onSelect, onEdit, disabled }) {
  const [text,setText] = useState(null), [open,setOpen] = useState(false), [active,setActive] = useState(0);
  const listId=useId(), input=useRef(null);
  const selected=customers.find(c=>String(c.CustKey)===String(value));
  useEffect(()=>{if(value){setText(null);setOpen(false);}},[value]);
  useEffect(()=>{if(open)input.current?.ownerDocument.getElementById(listId+'-'+active)?.scrollIntoView({block:'nearest'});},[active,open,listId]);
  const query=text ?? selected?.CustName ?? '';
  const options=customers.filter(c=>customerMatchesSearch(c,query)).slice(0,30);
  function choose(customer){setText(null);setOpen(false);setActive(0);onSelect(customer);input.current?.focus();}
  return <div className={styles.customer}>
    <label htmlFor={listId+'-input'}>업체</label>
    <input id={listId+'-input'} ref={input} aria-label="출고 매출 업체 검색" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open&&options[active]?listId+'-'+active:undefined}
      autoComplete="off" value={query} disabled={disabled} placeholder="업체명 입력 후 선택" onFocus={()=>{setOpen(true);setActive(0);}}
      onChange={e=>{setText(e.target.value);setActive(0);setOpen(true);onEdit();}}
      onBlur={()=>setOpen(false)} onKeyDown={e=>{
        if(e.nativeEvent.isComposing)return;
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(i=>Math.max(0,Math.min(options.length-1,i+(e.key==='ArrowDown'?1:-1))));}
        else if(e.key==='Enter'&&open){e.preventDefault();if(options[active])choose(options[active]);}
        else if(e.key==='Escape'){e.preventDefault();setOpen(false);setText(null);}
        else if(e.key==='Tab')setOpen(false);
      }} />
    {open&&<ul id={listId} role="listbox" aria-label="업체 검색 후보" className={styles.suggestions}>
      {options.map((c,i)=><li key={c.CustKey} id={listId+'-'+i} role="option" aria-selected={i===active} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(i)} onClick={()=>choose(c)}>{c.CustName}</li>)}
      {!options.length&&<li role="presentation">검색된 업체가 없습니다.</li>}
    </ul>}
  </div>;
}
