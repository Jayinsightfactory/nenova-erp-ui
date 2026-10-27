import React, { useState } from 'react';
import { receiptProductLabel, searchReceiptProducts } from '../../lib/invoiceReceiptProductSearch.js';

// Search text must not erase a selected ERP key on every keystroke.
export default function InvoiceReceiptProductPicker({ products, product, label, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const candidates = searchReceiptProducts(products, query);
  return <div style={{ minWidth: 230 }}>
    {product && <strong style={{ display: 'block', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{receiptProductLabel(product)}</strong>}
    <input type="search" aria-label={label} placeholder="한글·영문 품목명 또는 코드 검색" value={query}
      style={{width:'100%',boxSizing:'border-box',padding:'5px 7px',border:'1px solid #b9cbe1',borderRadius:4,fontSize:14}}
      onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }} />
    {open && <div role="group" aria-label={`${label} 후보`} style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #ccd6e5', background: '#fff' }}>
      {candidates.map(candidate => <button type="button" key={candidate.ProdKey}
        style={{ display: 'block', width: '100%', textAlign: 'left', whiteSpace: 'normal', margin: '2px 0',padding:'5px 7px',background:'#eff6ff',color:'#163a65',border:'1px solid #d2dfef',borderRadius:4 }}
        onClick={() => { onSelect(candidate); setQuery(''); setOpen(false); }}>{receiptProductLabel(candidate)}</button>)}
      {!candidates.length && <p role="status">일치하는 품목이 없습니다. 영문명·한글명 일부로 다시 검색하세요.</p>}
      <button type="button" onClick={() => setOpen(false)}>검색 닫기</button>
    </div>}
    {!product && <small>후보 버튼을 눌러 전산 품목을 선택하세요.</small>}
  </div>;
}
