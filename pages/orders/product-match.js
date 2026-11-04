import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IMPORT_MATCH_MESSAGE, isTrustedInitMessage, mergeMatchCandidates, pickProductPayload } from '../../lib/orderImportMatchPopup';

const SOURCE_LABEL = { server: '서버 후보', search: '검색', contains: '포함' };

export default function ImportProductMatchPopup() {
  const router = useRouter();
  const token = String(router.query.token || '');
  const [init, setInit] = useState(null);
  const [allProducts, setAllProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const optionRefs = useRef([]);

  const options = useMemo(() => mergeMatchCandidates({
    suggestions: init?.suggestedProducts || [], allProducts, query, limit: 50,
  }), [init, allProducts, query]);

  const send = useCallback((type, extra = {}) => {
    if (typeof window === 'undefined' || !window.opener || window.opener.closed) return false;
    window.opener.postMessage({ type, token, ...extra }, window.location.origin);
    return true;
  }, [token]);
  const cancel = useCallback(() => { send(IMPORT_MATCH_MESSAGE.cancel); window.close(); }, [send]);
  const choose = useCallback((item) => {
    const prod = pickProductPayload(item);
    if (!prod) return;
    if (send(IMPORT_MATCH_MESSAGE.selected, { prod })) window.close();
    else setError('원본 주문등록 창과 연결이 끊겼습니다. 이 창을 닫고 다시 「변경」을 눌러 주세요.');
  }, [send]);
  const clear = useCallback(() => {
    if (send(IMPORT_MATCH_MESSAGE.cleared)) window.close();
    else setError('원본 주문등록 창과 연결이 끊겼습니다. 이 창을 닫고 다시 「변경」을 눌러 주세요.');
  }, [send]);

  const initialized = Boolean(init);
  useEffect(() => {
    if (!router.isReady) return undefined;
    const onMessage = (event) => {
      if (!isTrustedInitMessage(event, window.opener, window.location.origin, token)) return;
      setInit(event.data);
      setQuery((prev) => prev || event.data.matchName || event.data.inputName || '');
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    };
    window.addEventListener('message', onMessage);
    // init 을 받을 때까지만 ready 를 반복 전송한다(opener 가 늦게 리스너를 붙여도 받도록).
    const timer = initialized ? null : window.setInterval(() => send(IMPORT_MATCH_MESSAGE.ready), 250);
    return () => { window.removeEventListener('message', onMessage); if (timer) window.clearInterval(timer); };
  }, [router.isReady, token, send, initialized]);

  useEffect(() => {
    if (!router.isReady) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch('/api/products/search', { credentials: 'same-origin', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '품목 목록을 불러오지 못했습니다.');
        setAllProducts(data.products || []);
      } catch (cause) { if (cause.name !== 'AbortError') setError(cause.message || '품목 목록을 불러오지 못했습니다.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [router.isReady]);

  useEffect(() => { setActiveIndex(0); optionRefs.current = []; }, [query, options.length]);

  const move = (delta) => {
    if (!options.length) return;
    const next = Math.max(0, Math.min(options.length - 1, activeIndex + delta));
    setActiveIndex(next);
    requestAnimationFrame(() => optionRefs.current[next]?.scrollIntoView?.({ block: 'nearest' }));
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && event.target === inputRef.current && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]); }
  };

  return <>
    <Head><title>품목 매칭 선택 - 업로드 주문등록</title></Head>
    <main className="pm" onKeyDown={onKeyDown}>
      <header>
        <div>
          <h1>ERP 품목 매칭 선택</h1>
          <p>입력 품목: <b>{init?.inputName || '연결 중…'}</b>{init?.custName ? ` · 업체: ${init.custName}` : ''}</p>
          <p>현재 매칭: {init ? (init.currentName || '미매칭') : ''}</p>
        </div>
        <button type="button" onClick={cancel} aria-label="품목 매칭 창 닫기">닫기 ×</button>
      </header>
      <label htmlFor="pm-search">ERP 품목 검색</label>
      <input ref={inputRef} id="pm-search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="품목명 (한글·영문)" role="combobox" aria-expanded="true" aria-controls="pm-results" aria-activedescendant={options[activeIndex] ? `pm-opt-${options[activeIndex].ProdKey}` : undefined} />
      <p className="help">키보드: ↑/↓ 후보 이동 · Enter 선택 · Esc 취소 · 더블클릭 또는 「선택」으로 확정</p>
      {error && <div className="err" role="alert">{error}</div>}
      {!init && <p role="status">원본 주문등록 화면과 연결 중…</p>}
      {loading && <p role="status">전체 품목 불러오는 중…</p>}
      <div id="pm-results" className="results" role="listbox" aria-label="ERP 품목 후보">
        {options.map((item, index) => (
          <div key={item.ProdKey} id={`pm-opt-${item.ProdKey}`} ref={(node) => { optionRefs.current[index] = node; }} role="option" aria-selected={index === activeIndex}
            className={index === activeIndex ? 'opt active' : 'opt'} onMouseEnter={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)} onDoubleClick={() => choose(item)}>
            <div className="main">
              <b>{item.DisplayName || item.ProdName}</b>
              <small>#{item.ProdKey} · {item.CounName || '국가 없음'} · {item.FlowerName || '꽃종류 없음'}{item.OutUnit ? ` · ${item.OutUnit}` : ''}</small>
            </div>
            <div className="meta">
              {item.score != null && <span className="score">{item.score}%</span>}
              <span className="src">{SOURCE_LABEL[item.source]}</span>
              {item.usageCount > 0 && <span className="hist">업체이력 {item.usageCount}</span>}
              {init?.currentProdKey === item.ProdKey && <span className="cur">현재</span>}
              <button type="button" onClick={(e) => { e.stopPropagation(); choose(item); }}>선택</button>
            </div>
          </div>
        ))}
        {!loading && init && !options.length && <p className="empty" role="status">후보가 없습니다. 검색어를 바꾸어 보세요.</p>}
      </div>
      <footer>
        <span>{options.length}개 후보 (최대 50)</span>
        <span>
          {init?.currentProdKey ? <button type="button" onClick={clear}>매칭 해제</button> : null}
          <button type="button" onClick={cancel}>취소</button>
        </span>
      </footer>
    </main>
    <style jsx>{`.pm{box-sizing:border-box;padding:18px;background:#f5f8fc;color:#14243c;min-height:100vh}header{display:flex;justify-content:space-between;align-items:flex-start;background:#e8f1ff;border:1px solid #b6ccec;border-radius:6px;padding:12px 16px}h1{margin:0;font-size:22px}header p{margin:5px 0 0;color:#52647c;font-size:15px}button{min-height:36px;padding:5px 14px;border:1px solid #8ba9cf;border-radius:4px;background:#fff;color:#164c94;font-size:14px;font-weight:800;cursor:pointer}label{display:block;margin:16px 0 6px;font-weight:800}input{box-sizing:border-box;width:100%;height:46px;padding:8px 12px;border:2px solid #91acd0;border-radius:5px;font-size:18px}input:focus-visible,button:focus-visible{outline:3px solid #65a4ff;outline-offset:2px}.help{margin:8px 0;color:#52647c;font-size:13px}.results{max-height:calc(100vh - 330px);min-height:200px;overflow:auto;border:1px solid #c7d6e8;border-radius:5px;background:#fff}.opt{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid #e1e8f1;cursor:pointer}.opt.active{background:#dbeafe}.main b{display:block;font-size:16px}.main small{color:#52647c;font-size:13px}.meta{display:flex;align-items:center;gap:6px;flex:none}.meta span{font-size:12px;border-radius:8px;padding:1px 6px;background:#eef2f7;color:#475569}.meta .score{background:#fef3c7;color:#92400e;font-weight:800}.meta .hist{background:#dcfce7;color:#166534}.meta .cur{background:#1d4ed8;color:#fff}footer{display:flex;justify-content:space-between;align-items:center;margin-top:12px;color:#52647c;font-size:14px}footer button{margin-left:8px}.err{margin:10px 0;padding:10px;background:#fff1ef;color:#a61b14}.empty{padding:16px;color:#64748b}`}</style>
  </>;
}
