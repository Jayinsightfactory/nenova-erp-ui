import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const keyOf = item => Number(item?.prodKey ?? item?.ProdKey ?? item?.custKey ?? item?.CustKey ?? 0);
const productLabel = item => String(item?.displayName || item?.DisplayName || item?.prodName || item?.ProdName || '').trim();
const customerLabel = item => String(item?.custName || item?.CustName || '').trim();
const countryOf = item => String(item?.CounName || item?.counName || item?.country || '').trim();
const flowerOf = item => String(item?.FlowerName || item?.flowerName || item?.flower || '').trim();

export default function ErpMatchPicker({ kind, value, label, options = [], onPick, disabled = false, initialQuery = '', country = '', flower = '', entryId = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [anchor, setAnchor] = useState(null);
  const requestRef = useRef(0);
  const buttonRef = useRef(null);
  const inputRef = useRef(null);
  const isProduct = kind === 'product';

  useEffect(() => { requestRef.current += 1; setOpen(false); setRemote([]); }, [entryId, kind]);
  useEffect(() => {
    if (!open) return undefined;
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(390, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const above = window.innerHeight - rect.bottom < 270 && rect.top > 270;
      const maxHeight = Math.max(170, Math.min(330, above ? rect.top - 16 : window.innerHeight - rect.bottom - 16));
      setAnchor({ left, top: above ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4, width, maxHeight });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open || !isProduct || !query.trim()) { setRemote([]); setLoading(false); return undefined; }
    const request = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams({ q: query.trim() });
        if (country) params.set('country', country);
        if (flower) params.set('flower', flower);
        const response = await fetch(`/api/products/search?${params.toString()}`, { credentials: 'same-origin' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '품목 검색 실패');
        if (request === requestRef.current) setRemote((data.products || []).filter(item => !country || countryOf(item) === country).slice(0, 30));
      } catch (cause) { if (request === requestRef.current) setError(cause.message || '검색 실패'); }
      finally { if (request === requestRef.current) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); requestRef.current += 1; };
  }, [open, isProduct, query, country, flower, entryId]);

  const close = () => { requestRef.current += 1; setOpen(false); setRemote([]); setLoading(false); setError(''); };
  const toggle = () => {
    if (open) { close(); return; }
    setQuery(String(initialQuery || ''));
    setError(''); setOpen(true);
  };
  const labelOf = isProduct ? productLabel : customerLabel;
  const source = isProduct ? remote : options;
  const filtered = isProduct ? source : source.filter(item => `${labelOf(item)} ${item.orderCode || ''} ${item.area || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  const menu = open && anchor && <div className="erp-match-menu" style={{ left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: anchor.maxHeight }} role="dialog" aria-label={`ERP ${isProduct ? '품목' : '업체'} 선택`}>
    <input ref={inputRef} aria-label={`ERP ${isProduct ? '품목' : '업체'} 검색`} value={query} onChange={event => setQuery(event.target.value)} placeholder={isProduct ? '원본 품목명으로 검색' : '업체명 검색'} />
    {loading && <small>검색 중…</small>}{error && <small className="picker-error">{error}</small>}
    {!isProduct && !options.length && <small>검증 후 업체 후보를 선택할 수 있습니다.</small>}
    {isProduct && !loading && !!query.trim() && !filtered.length && <small>네덜란드 품목 후보가 없습니다. 검색어를 수정해 주세요.</small>}
    {filtered.map(item => <button type="button" className="option" key={keyOf(item)} onClick={() => { onPick(item); close(); }}>{labelOf(item) || '품명 없음'} <small>#{keyOf(item)} {isProduct ? `${countryOf(item)} · ${flowerOf(item)} · ${item.OutUnit || item.outUnit || ''}` : (item.area || '')}</small></button>)}
    <button type="button" className="close" onClick={close}>닫기</button>
  </div>;
  return <div className="picker">
    <button ref={buttonRef} type="button" className="selected" disabled={disabled} onClick={toggle}>{value ? `${label || 'ERP 연결'} #${value}` : 'ERP에서 선택'}</button>
    {typeof document !== 'undefined' && menu && createPortal(menu, document.body)}
    <style jsx>{`.picker{position:relative;min-width:170px}.selected{width:100%;text-align:left;background:#fff;border:1px solid #aebbd0;border-radius:4px;padding:5px 7px;min-height:30px;color:#164c94}`}</style>
    <style jsx global>{`.erp-match-menu{position:fixed;z-index:2000;overflow:auto;background:white;border:1px solid #8da9cf;box-shadow:0 7px 22px #17345b33;padding:6px;border-radius:4px;box-sizing:border-box}.erp-match-menu input{width:100%;box-sizing:border-box;height:32px;border:1px solid #aebbd0;padding:4px}.erp-match-menu small{display:block;color:#64748b}.erp-match-menu .picker-error{color:#a61b14}.erp-match-menu .option,.erp-match-menu .close{width:100%;display:block;text-align:left;background:#fff;border:0;border-bottom:1px solid #e3e9f0;padding:7px;cursor:pointer}.erp-match-menu .option:hover{background:#e8f1ff}.erp-match-menu .option small{margin-top:2px}.erp-match-menu .close{text-align:center;color:#164c94}`}</style>
  </div>;
}
