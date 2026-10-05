import { useEffect, useRef, useState } from 'react';

const keyOf = item => Number(item?.prodKey ?? item?.ProdKey ?? item?.custKey ?? item?.CustKey ?? 0);
const productLabel = item => String(item?.displayName ?? item?.DisplayName ?? item?.prodName ?? item?.ProdName ?? '').trim();
const customerLabel = item => String(item?.custName ?? item?.CustName ?? '').trim();

export default function ErpMatchPicker({ kind, value, label, options = [], onPick, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remote, setRemote] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const isProduct = kind === 'product';
  useEffect(() => {
    if (!open || !isProduct || !query.trim()) { setRemote([]); return undefined; }
    const request = ++requestRef.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const response = await fetch(`/api/products/search?q=${encodeURIComponent(query.trim())}`, { credentials: 'same-origin' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '품목 검색 실패');
        if (request === requestRef.current) setRemote((data.products || []).slice(0, 30));
      } catch (cause) { if (request === requestRef.current) setError(cause.message || '검색 실패'); }
      finally { if (request === requestRef.current) setLoading(false); }
    }, 250);
    return () => { clearTimeout(timer); requestRef.current += 1; };
  }, [open, isProduct, query]);

  const labelOf = isProduct ? productLabel : customerLabel;
  const source = isProduct ? remote : options;
  const filtered = isProduct ? source : source.filter(item => `${labelOf(item)} ${item.orderCode || ''} ${item.area || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  return <div className="picker">
    <button type="button" className="selected" disabled={disabled} onClick={() => { setOpen(!open); setQuery(''); }}>{value ? `${label || 'ERP 연결'} #${value}` : 'ERP에서 선택'}</button>
    {open && <div className="menu"><input autoFocus aria-label={`ERP ${isProduct ? '품목' : '업체'} 검색`} value={query} onChange={event => setQuery(event.target.value)} placeholder={isProduct ? '품목명 검색' : '업체명 검색'} />
      {loading && <small>검색 중…</small>}{error && <small className="error">{error}</small>}
      {!isProduct && !options.length && <small>검증 후 업체 후보를 선택할 수 있습니다.</small>}
      {filtered.map(item => <button type="button" className="option" key={keyOf(item)} onClick={() => { onPick(item); setOpen(false); setQuery(''); }}>{labelOf(item)} <small>#{keyOf(item)} {isProduct ? (item.OutUnit || item.outUnit || '') : (item.area || '')}</small></button>)}
      <button type="button" className="close" onClick={() => setOpen(false)}>닫기</button></div>}
    <style jsx>{`.picker{position:relative;min-width:170px}.selected{width:100%;text-align:left;background:#fff;border:1px solid #aebbd0;border-radius:4px;padding:5px 7px;min-height:30px;color:#164c94}.menu{position:absolute;z-index:8;left:0;top:100%;width:max(270px,100%);max-width:80vw;max-height:310px;overflow:auto;background:white;border:1px solid #8da9cf;box-shadow:0 7px 22px #17345b33;padding:5px}.menu input{width:100%;height:30px;border:1px solid #aebbd0;padding:4px}.option,.close{width:100%;display:block;text-align:left;background:#fff;border:0;border-bottom:1px solid #e3e9f0;padding:7px;cursor:pointer}.option:hover{background:#e8f1ff}.option small{display:block;color:#64748b}.close{text-align:center;color:#164c94}.error{color:#a61b14}`}</style>
  </div>;
}
