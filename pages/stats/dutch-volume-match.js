import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const itemKey = (item, kind) => Number(kind === 'product' ? item?.prodKey ?? item?.ProdKey : item?.custKey ?? item?.CustKey) || 0;
const itemLabel = (item, kind) => String(kind === 'product'
  ? item?.displayName || item?.DisplayName || item?.prodName || item?.ProdName || ''
  : item?.custName || item?.CustName || '').trim();
const countryOf = item => String(item?.CounName || item?.counName || item?.country || '').trim();
const flowerOf = item => String(item?.FlowerName || item?.flowerName || item?.flower || '').trim();

export default function DutchVolumeMatchPopup() {
  const router = useRouter();
  const { token = '', kind = '', query: initialQuery = '', country = '', flower = '' } = router.query;
  const [query, setQuery] = useState('');
  const [customerOptions, setCustomerOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const optionRefs = useRef([]);
  const isProduct = kind === 'product';
  const options = useMemo(() => {
    const source = isProduct ? productOptions : customerOptions;
    const needle = query.trim().toLocaleLowerCase();
    return (source || []).filter(item => !needle || `${itemLabel(item, kind)} ${item?.orderCode || ''} ${item?.area || ''}`.toLocaleLowerCase().includes(needle)).slice(0, 50);
  }, [customerOptions, isProduct, kind, productOptions, query]);

  const cancel = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'dutch-match-popup-cancel', token, kind }, window.location.origin);
    window.close();
  }, [kind, token]);

  const choose = useCallback(item => {
    if (!itemKey(item, kind) || !itemLabel(item, kind) || typeof window === 'undefined') return;
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'dutch-match-popup-selected', token, kind, item }, window.location.origin);
      window.close();
    } else setError('원본 물량표 창과 연결이 끊겼습니다. 이 창을 닫고 미매칭 항목을 다시 여세요.');
  }, [kind, token]);

  useEffect(() => {
    if (!router.isReady) return undefined;
    setQuery(String(initialQuery || ''));
    const handleMessage = event => {
      if (event.origin !== window.location.origin || event.source !== window.opener) return;
      const data = event.data || {};
      if (data.type !== 'dutch-match-popup-init' || data.token !== token || data.kind !== kind) return;
      setCustomerOptions(Array.isArray(data.options) ? data.options : []);
      setInitialized(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener('message', handleMessage);
    const readyTimer = window.setInterval(() => {
      if (window.opener && !window.opener.closed) window.opener.postMessage({ type: 'dutch-match-popup-ready', token, kind }, window.location.origin);
    }, 250);
    return () => { window.removeEventListener('message', handleMessage); window.clearInterval(readyTimer); };
  }, [initialQuery, kind, router.isReady, token]);

  useEffect(() => {
    if (!router.isReady || !isProduct || !query.trim()) { setProductOptions([]); setLoading(false); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams({ q: query.trim() });
        if (country) params.set('country', country);
        if (flower) params.set('flower', flower);
        const response = await fetch(`/api/products/search?${params.toString()}`, { credentials: 'same-origin', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '품목 검색에 실패했습니다.');
        setProductOptions((data.products || []).filter(item => !country || countryOf(item) === country));
      } catch (cause) { if (cause.name !== 'AbortError') setError(cause.message || '품목 검색에 실패했습니다.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [country, flower, isProduct, query, router.isReady]);

  useEffect(() => { setActiveIndex(-1); optionRefs.current = []; }, [query, options.length]);

  const move = delta => {
    if (!options.length) return;
    const next = Math.max(0, Math.min(options.length - 1, (activeIndex < 0 && delta > 0 ? -1 : activeIndex) + delta));
    setActiveIndex(next);
    requestAnimationFrame(() => optionRefs.current[next]?.focus());
  };
  const handleKeyDown = event => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    if (event.key === 'Enter' && event.target === inputRef.current && options[activeIndex >= 0 ? activeIndex : 0]) { event.preventDefault(); choose(options[activeIndex >= 0 ? activeIndex : 0]); }
  };

  return <><Head><title>ERP {isProduct ? '품목' : '업체'} 매칭 - 네덜란드 물량표</title></Head>
    <main className="match-popup" onKeyDown={handleKeyDown}>
      <header><div><h1>ERP {isProduct ? '품목' : '업체'} 매칭</h1><p>원본 {isProduct ? '품목' : '업체'}: {String(initialQuery || '미지정')}</p></div><button type="button" onClick={cancel} aria-label="매칭 창 닫기">닫기 ×</button></header>
      <label className="search-label" htmlFor="erp-match-search">{isProduct ? 'ERP 품목 검색' : 'ERP 업체 검색'}</label>
      <input ref={inputRef} id="erp-match-search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder={isProduct ? '품목명 입력' : '업체명 입력'} aria-controls="erp-match-results" aria-expanded="true" aria-activedescendant={options[activeIndex] ? `erp-match-option-${itemKey(options[activeIndex], kind)}` : undefined}/>
      <p className="keyboard-help">키보드: ↑/↓ 후보 이동 · Enter 선택 · Tab으로 이동 · Esc 닫기</p>
      {error && <div className="error" role="alert">{error}</div>}
      {loading && <p role="status">검색 중…</p>}
      {!isProduct && !initialized && <p role="status">원본 표와 연결 중…</p>}
      {initialized && !isProduct && !customerOptions.length && <p role="status">업체 후보가 없습니다. 원본 화면에서 ERP 검증을 먼저 실행하세요.</p>}
      {!loading && isProduct && query.trim() && !options.length && <p role="status">검색 결과가 없습니다. 검색어를 바꾸어 보세요.</p>}
      <div id="erp-match-results" className="results" role="listbox" aria-label={`ERP ${isProduct ? '품목' : '업체'} 후보`}>
        {options.map((item, index) => <button ref={node => { optionRefs.current[index] = node; }} id={`erp-match-option-${itemKey(item, kind)}`} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? 'option active' : 'option'} key={itemKey(item, kind)} onFocus={() => setActiveIndex(index)} onClick={() => choose(item)}>
          <b>{itemLabel(item, kind) || '이름 없음'}</b><small>#{itemKey(item, kind)}{isProduct ? ` · ${countryOf(item)} · ${flowerOf(item)} · ${item.EstUnit || item.estUnit || item.OutUnit || item.outUnit || ''}` : ` · ${item.area || ''}`}</small>
        </button>)}
      </div>
      <footer><span>{options.length}개 후보</span><button type="button" onClick={cancel}>취소</button></footer>
    </main>
    <style jsx>{`.match-popup{box-sizing:border-box;min-height:calc(100vh - 52px);padding:18px;background:#f5f8fc;color:#14243c}.match-popup header{display:flex;align-items:center;justify-content:space-between;background:#e8f1ff;border:1px solid #b6ccec;border-radius:6px;padding:12px 16px}.match-popup h1{margin:0;font-size:22px}.match-popup header p{margin:5px 0 0;color:#52647c;font-size:15px}.match-popup header button,.match-popup footer button{min-height:38px;padding:6px 14px;border:1px solid #8ba9cf;border-radius:4px;background:white;color:#164c94;font-size:15px;font-weight:800;cursor:pointer}.search-label{display:block;margin:18px 0 6px;font-size:16px;font-weight:800}.match-popup input{box-sizing:border-box;width:100%;height:48px;padding:8px 12px;border:2px solid #91acd0;border-radius:5px;font-size:18px}.match-popup input:focus-visible,.match-popup button:focus-visible{outline:3px solid #65a4ff;outline-offset:2px}.keyboard-help{margin:8px 0;color:#52647c;font-size:14px}.results{max-height:calc(100vh - 260px);overflow:auto;border:1px solid #c7d6e8;border-radius:5px;background:white}.option{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:9px 12px;border:0;border-bottom:1px solid #e1e8f1;background:white;text-align:left;cursor:pointer}.option b{font-size:16px}.option small{font-size:13px;color:#52647c}.option.active,.option:hover{background:#eaf3ff}.match-popup footer{display:flex;align-items:center;justify-content:space-between;margin-top:12px;color:#52647c;font-size:14px}.error{margin:10px 0;padding:10px;background:#fff1ef;color:#a61b14}@media(max-width:760px){.match-popup{padding:10px}.match-popup header{align-items:flex-start;gap:8px}.option{align-items:flex-start;flex-direction:column;gap:4px}.results{max-height:60vh}}`}</style>
  </>;
}
