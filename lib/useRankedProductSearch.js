import { useEffect, useRef, useState } from 'react';

// Keep the existing full-catalog ranking unchanged, but never run its fuzzy
// comparison on the browser input/render thread. An old query cannot be picked.
export default function useRankedProductSearch(query, products, { enabled = true, limit = 20, fallback = false } = {}) {
  const workerRef = useRef(null);
  const workerError = useRef('');
  const sequence = useRef(0);
  const [state, setState] = useState({});
  const keyword = String(query || '').trim();

  useEffect(() => {
    if (!enabled || !products?.length) return undefined;
    let worker;
    workerError.current = '';
    try {
      worker = new Worker(new URL('./productSearchWorker.js', import.meta.url));
      workerRef.current = worker;
      worker.onerror = worker.onmessageerror = () => { workerError.current = '품목 검색 모듈을 불러오지 못했습니다. 창을 닫았다 다시 열어 주세요.'; };
      worker.postMessage({ type: 'products', products });
    } catch {
      workerRef.current = null;
      worker?.terminate();
    }
    return () => { sequence.current++; worker?.terminate(); workerRef.current = null; };
  }, [products, enabled]);

  useEffect(() => {
    const id = ++sequence.current;
    if (!enabled || !keyword || !products?.length) return undefined;
    const worker = workerRef.current;
    let deadline;
    const finish = (value) => {
      clearTimeout(deadline);
      if (sequence.current === id) setState({ query: keyword, products, limit, fallback, ...value });
    };
    if (!worker || workerError.current) {
      finish({ error: workerError.current || '품목 검색 모듈을 열지 못했습니다. 창을 닫았다 다시 열어 주세요.' });
      return undefined;
    }
    worker.onmessage = ({ data }) => {
      if (data.id !== id) return;
      finish(data.error ? { error: data.error } : { results: data.indices.map(index => products[index]).filter(Boolean) });
    };
    worker.onerror = () => {
      workerError.current = '품목 검색 모듈 오류입니다. 창을 닫았다 다시 열어 주세요.';
      finish({ error: workerError.current });
    };
    worker.onmessageerror = () => finish({ error: '품목 검색 결과를 읽지 못했습니다.' });
    const timer = setTimeout(() => {
      deadline = setTimeout(() => finish({ error: '품목 검색 응답이 지연됩니다. 검색어를 다시 입력하거나 창을 다시 열어 주세요.' }), 15000);
      try { worker.postMessage({ id, query: keyword, limit, fallback }); }
      catch { finish({ error: '품목 검색 요청을 보내지 못했습니다.' }); }
    }, 180);
    return () => { clearTimeout(timer); clearTimeout(deadline); if (sequence.current === id) sequence.current++; };
  }, [keyword, products, enabled, limit, fallback]);

  const active = enabled && !!keyword && !!products?.length;
  const current = active && state.query === keyword && state.products === products && state.limit === limit && state.fallback === fallback;
  return { results: current ? state.results || [] : [], loading: active && !current, error: current ? state.error || '' : '' };
}
