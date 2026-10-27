import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import ProfitCustomerMarginView from '../../components/ProfitCustomerMarginView';
import { loadCustomerMargin, marginQuery } from '../../lib/profitCustomerMarginPresentation.mjs';

const empty = { year: '', week: '', compareYear: '', compareWeek: '' };
export default function ProfitCustomerMarginPage() {
  const router = useRouter();
  const [selection, setSelection] = useState(empty);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(null);
  const queryKey = JSON.stringify([router.query.year, router.query.week, router.query.compareYear, router.query.compareWeek]);

  async function load(input) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setData(null); setError('');
    try {
      const result = await loadCustomerMargin(input, { signal: controller.signal });
      if (request.current === controller && !controller.signal.aborted) setData(result);
    } catch (e) {
      if (request.current === controller && !controller.signal.aborted) setError(e.message);
    } finally { if (request.current === controller) setBusy(false); }
  }
  useEffect(() => {
    if (!router.isReady) return undefined;
    request.current?.abort(); setData(null); setError(''); setBusy(false);
    if (router.query.year !== undefined || router.query.week !== undefined) {
      try {
        const params = marginQuery(router.query);
        const next = { ...empty, ...Object.fromEntries(params) };
        setSelection(next); load(next);
      } catch (e) { setSelection(empty); setError(e.message); }
    } else setSelection(empty);
    return () => request.current?.abort();
  }, [router.isReady, queryKey]);
  function edit(key, value) {
    request.current?.abort(); request.current = null;
    setBusy(false); setData(null); setError(''); setSelection(s => ({ ...s, [key]: value }));
  }
  return <>
    <Head><title>업체비중·판매마진 | 네노바웹</title></Head>
    <main className="customer-margin-page">
      <header><h1>업체비중·판매마진</h1><p>기존 보고서 수익률은 유지합니다. 이 화면은 조회·비교 전용이며 DB·확정본·계산 저장본을 변경하지 않습니다.</p></header>
      <form onSubmit={e => { e.preventDefault(); load(selection); }} aria-label="분석 차수 선택">
        <fieldset><legend>조회 차수</legend>
          <label>연도 <input aria-label="조회 연도" inputMode="numeric" maxLength={4} value={selection.year} onChange={e => edit('year', e.target.value)} required /></label>
          <label>차수 <input aria-label="조회 차수" inputMode="numeric" maxLength={2} value={selection.week} onChange={e => edit('week', e.target.value)} required /></label>
        </fieldset>
        <fieldset><legend>비교 차수 · 빈칸이면 실제 직전 차수</legend>
          <label>연도 <input aria-label="비교 연도" inputMode="numeric" maxLength={4} value={selection.compareYear} onChange={e => edit('compareYear', e.target.value)} /></label>
          <label>차수 <input aria-label="비교 차수" inputMode="numeric" maxLength={2} value={selection.compareWeek} onChange={e => edit('compareWeek', e.target.value)} /></label>
        </fieldset>
        <button type="submit" disabled={busy}>{busy ? '조회 중…' : '비교 조회'}</button>
        {busy && <button type="button" onClick={() => { request.current?.abort(); request.current = null; setBusy(false); setError('조회가 취소되었습니다.'); }}>조회 취소</button>}
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      <div role="status" aria-live="polite">{busy ? 'SQL 근거와 두 차수의 판매비중·원가를 확인하고 있습니다.' : data ? '조회 완료 · 아래 수치는 응답에 표시된 차수 기준입니다.' : '연도와 차수를 선택해 조회하세요.'}</div>
      {data && <ProfitCustomerMarginView key={`${data.current.year}-${data.current.major}-${data.previous?.year}-${data.previous?.major}`} data={data} />}
    </main>
    <style jsx>{`
      .customer-margin-page { padding: 18px; min-width: 0; color: #17324d; font-size: 14px; line-height: 1.55; }
      h1 { margin: 0 0 6px; font-size: 24px; } p { margin: 6px 0 16px; }
      form { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 16px 0; }
      fieldset { display: flex; flex-wrap: wrap; gap: 12px; border: 1px solid #b8c9da; border-radius: 6px; padding: 8px 12px; }
      legend { font-weight: 600; } input { width: 72px; margin-left: 6px; padding: 7px; border: 1px solid #94a3b8; border-radius: 4px; }
      button { padding: 9px 14px; border: 1px solid #1d4ed8; border-radius: 5px; background: #eff6ff; color: #163c8c; cursor: pointer; }
      button:disabled { cursor: wait; opacity: .6; } input:focus-visible, button:focus-visible { outline: 3px solid #2563eb; outline-offset: 3px; }
      .error { color: #9f1239; background: #fff1f2; padding: 10px; }
      @media(max-width: 600px) { .customer-margin-page { padding: 10px; } fieldset { width: 100%; } }
    `}</style>
  </>;
}
