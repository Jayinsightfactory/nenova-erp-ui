import { useEffect, useId, useRef, useState } from 'react';

export default function DistributionPicker({ label, value, options = [], onSelect, disabled = false,
  triggerRef, shortcut, placeholder = '검색', testId }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [popup, setPopup] = useState({ top: 0, left: 0, width: 320, maxHeight: 320 });
  const localTrigger = useRef(null);
  const searchRef = useRef(null);
  const itemRefs = useRef([]);
  const id = useId();
  const visible = options.filter(option => String(option.label || '').toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase()));
  const close = () => {
    setOpen(false);
    setSearch('');
    (triggerRef?.current || localTrigger.current)?.focus();
  };
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const rect = (triggerRef?.current || localTrigger.current)?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(460, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const maxHeight = Math.max(90, Math.min(320, Math.max(below, above) - 74));
      const top = below >= Math.min(210, above) ? rect.bottom + 3 : Math.max(8, rect.top - maxHeight - 74);
      setPopup({ top, left, width, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, triggerRef]);
  const focusItem = index => itemRefs.current[Math.max(0, Math.min(index, visible.length - 1))]?.focus();
  const onListKeyDown = (event, index) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); focusItem(index + 1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); focusItem(index - 1); }
    if (event.key === 'Home') { event.preventDefault(); focusItem(0); }
    if (event.key === 'End') { event.preventDefault(); focusItem(visible.length - 1); }
  };
  return <div style={{ position: 'relative', minWidth: 135 }} data-testid={testId}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setSearch(''); }
    }}>
    <button type="button" ref={node => { localTrigger.current = node; if (triggerRef) triggerRef.current = node; }}
      className="btn btn-secondary btn-sm" disabled={disabled} aria-expanded={open} aria-controls={id}
      title={shortcut ? `${label} 선택 (${shortcut})` : `${label} 선택`}
      onClick={() => setOpen(previous => !previous)}
      style={{ width: '100%', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {label}: {value || '선택'} ▾
    </button>
    {open && <div id={id} role="group" aria-label={`${label} 선택`}
      style={{ position: 'fixed', top: popup.top, left: popup.left, zIndex: 40, width: popup.width,
        padding: 8, marginTop: 3, border: '1px solid var(--border)', borderRadius: 8,
        background: 'var(--surface)', boxShadow: '0 12px 28px #0003' }}>
      <input ref={searchRef} className="filter-input" aria-label={`${label} 검색`}
        placeholder={placeholder} value={search} onChange={event => setSearch(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); close(); }
          if (event.key === 'ArrowDown' || event.key === 'Enter') { event.preventDefault(); focusItem(0); }
        }} style={{ width: '100%', marginBottom: 6 }} />
      <div style={{ maxHeight: popup.maxHeight, overflowY: 'auto' }}>
        {visible.length === 0 && <div style={{ padding: 10, color: 'var(--text3)' }}>검색 결과가 없습니다.</div>}
        {visible.map((option, index) => <button key={String(option.key)} type="button"
          ref={node => { itemRefs.current[index] = node; }}
          onKeyDown={event => onListKeyDown(event, index)}
          onClick={() => { onSelect(option); close(); }}
          style={{ display: 'block', width: '100%', padding: '7px 9px', textAlign: 'left', border: 0,
            borderRadius: 4, background: option.selected ? 'var(--blue-bg)' : 'transparent',
            color: 'var(--text1)', cursor: 'pointer', fontSize: 13 }}>
          {option.label}{option.hint ? <span style={{ color: 'var(--text3)', marginLeft: 7 }}>{option.hint}</span> : null}
        </button>)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text3)', padding: '5px 2px 0' }}>
        ↑↓ / Home / End 이동 · Enter / Space 선택 · Esc 닫기
      </div>
    </div>}
  </div>;
}
