import { useEffect, useRef, useState } from 'react';

export function ChinaDialog({ title, onClose, children, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('input,select,button')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
      else document.querySelector('.product-change, .toolbar button')?.focus();
    };
  }, []);
  return <div className="modal-shade" onKeyDown={event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const nodes = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
    }
  }}><section className="china-editor-dialog" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
    <header><b>{title}</b><button disabled={busy} onClick={onClose} aria-label="닫기">×</button></header>{children}
    <style jsx global>{`
      .china-editor-dialog{width:min(960px,96vw);max-height:90vh;overflow:auto;background:white;border-radius:8px;padding:16px;box-shadow:0 10px 50px #0005}
      .china-editor-dialog header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;font-size:17px}
      .china-editor-dialog button,.china-editor-dialog input,.china-editor-dialog select{padding:7px;border:1px solid #acb9ca;border-radius:4px;background:white}
      .china-editor-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}.china-editor-dialog table{width:100%;border-collapse:collapse}.china-editor-dialog td,.china-editor-dialog th{padding:6px;border:1px solid #ddd;text-align:left}
      .china-editor-dialog .primary{background:#155bd7;color:white}.china-editor-dialog button:disabled{opacity:.5}
      :focus-visible{outline:3px solid #2169d6;outline-offset:2px}
    `}</style>
  </section></div>;
}

export function ChinaSearchSelect({ label, options, value, onChange }) {
  const [search, setSearch] = useState('');
  const filtered = options.filter(item => String(item.label).toLowerCase().includes(search.trim().toLowerCase()) || String(item.value) === String(value));
  return <label className="china-search-select">{label}<input aria-label={`${label} 검색`} placeholder="DB 이름 검색" value={search} onChange={event => setSearch(event.target.value)} />
    <select aria-label={label} value={value || ''} onChange={event => onChange(event.target.value)}><option value="">선택하세요</option>{filtered.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
    <style jsx>{`.china-search-select{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:0}.china-search-select input,.china-search-select select{width:100%;padding:6px;border:1px solid #aeb9c8;border-radius:4px;min-height:32px}`}</style>
  </label>;
}

export function ChinaLookupDialog({ kind, products, customers, onSelect, onClose }) {
  const [value, setValue] = useState('');
  const options = kind === 'customer' ? customers.map(c => ({ value: c.custKey, label: `${c.custName} · ${c.area || '기타'} · ${c.orderCode || ''}` }))
    : products.map(p => ({ value: p.prodKey, label: `${p.prodName} · ${p.unit || '단위 없음'}` }));
  return <ChinaDialog title={kind === 'customer' ? 'DB 업체 추가' : 'DB 품목 선택'} onClose={onClose}>
    <ChinaSearchSelect label={kind === 'customer' ? '업체' : '품목'} options={options} value={value} onChange={setValue} />
    <footer><button onClick={onClose}>취소</button><button className="primary" disabled={!value} onClick={() => onSelect(Number(value))}>선택</button></footer>
  </ChinaDialog>;
}
