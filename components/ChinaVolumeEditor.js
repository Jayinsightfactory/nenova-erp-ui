import { useEffect, useId, useRef, useState } from 'react';
import { chinaSearchCandidates } from '../lib/chinaSearchCandidates';

export function ChinaDialog({ title, onClose, children, busy = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    (ref.current?.querySelector('input,select') || ref.current?.querySelector('button'))?.focus();
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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef(null);
  const filtered = chinaSearchCandidates(options, search);
  const shown = filtered.slice(0, 40);
  const selected = options.find(item => String(item.value) === String(value));
  const choose = item => { onChange(String(item.value)); setSearch(''); setOpen(false); setActive(0); };
  useEffect(() => { listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' }); }, [active]);
  return <div className="china-search-select">
    <label htmlFor={`${listId}-input`}>{label}</label>
    <input id={`${listId}-input`} role="combobox" aria-label={`${label} 검색`} aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
      placeholder="이름 또는 코드 입력 → 후보 선택" value={open ? search : (selected?.label || search)}
      onFocus={() => setOpen(true)} onChange={event => { setSearch(event.target.value); setActive(0); setOpen(true); onChange(''); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(previous => Math.max(0, Math.min(shown.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1)))); }
        if (event.key === 'Enter' && open && shown[active]) { event.preventDefault(); choose(shown[active]); }
      }} />
    {open && <><span role="status">{filtered.length ? `${filtered.length}건 · 클릭 또는 방향키·Enter로 선택` : '일치하는 DB 항목이 없습니다.'}{filtered.length > 40 ? ' · 상위 40건 표시, 검색어를 더 입력하세요.' : ''}</span>
      <div id={listId} role="listbox" aria-label={`${label} 검색 결과`} ref={listRef}>{shown.map((item,index) => <button type="button" role="option" id={`${listId}-${index}`} aria-selected={index === active} key={item.value} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>{item.label}</button>)}</div></>}
    {!open && selected && <span role="status">선택됨: {selected.label}</span>}
    <style jsx>{`.china-search-select{display:flex;flex-direction:column;gap:5px;font-size:13px;min-width:0}.china-search-select input{width:100%;padding:8px;border:1px solid #aeb9c8;border-radius:4px;min-height:36px}.china-search-select [role=listbox]{max-height:240px;overflow:auto;border:1px solid #aeb9c8;border-radius:4px}.china-search-select [role=option]{display:block;width:100%;text-align:left;border:0;border-radius:0;padding:9px;white-space:normal}.china-search-select [role=option][aria-selected=true]{background:#e6f0ff;color:#113f83}.china-search-select [role=status]{color:#526276}`}</style>
  </div>;
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
