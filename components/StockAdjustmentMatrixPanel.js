import { useEffect, useRef, useState } from 'react';

const quantityText = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return '확인 필요';
  const number = Number(value);
  if (number === 0) return '0';
  // Tiny changes must stay distinguishable from an actual zero adjustment.
  const text = Math.abs(number) < 0.000001
    ? number.toExponential()
    : number.toLocaleString('ko-KR', { maximumSignificantDigits: 17 });
  return `${number > 0 ? '+' : ''}${text}`;
};

export default function StockAdjustmentMatrixPanel({ year }) {
  const [major, setMajor] = useState('');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [exportError, setExportError] = useState('');
  const [reload, setReload] = useState(0);
  const requestId = useRef(0);
  const exportController = useRef(null);
  const params = new URLSearchParams({ year: String(year) });
  if (major) params.set('major', major);
  if (appliedSearch) params.set('search', appliedSearch);
  const query = params.toString();
  const currentQuery = useRef(query);
  currentQuery.current = query;
  const current = result?.query === query ? result.data : null;

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    exportController.current?.abort();
    setExporting(false); setExportError('');
    setLoading(true); setResult(null); setError('');
    (async () => {
      try {
        const response = await fetch(`/api/sales/stock-adjustment-matrix?${query}`, {
          credentials: 'same-origin', signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.message || '실제 재고조정 조회에 실패했습니다.');
        if (String(data.orderYear) !== String(year)) throw new Error('요청한 연도와 조회 결과가 다릅니다. 다시 조회하세요.');
        if (controller.signal.aborted || id !== requestId.current || currentQuery.current !== query) return;
        setResult({ query, data });
      } catch (e) {
        if (!controller.signal.aborted && id === requestId.current && currentQuery.current === query) setError(e.message);
      } finally {
        if (!controller.signal.aborted && id === requestId.current && currentQuery.current === query) setLoading(false);
      }
    })();
    return () => { controller.abort(); exportController.current?.abort(); };
  }, [query, reload]);

  const download = async () => {
    if (loading || exporting || !current || search.trim() !== appliedSearch) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`/api/sales/stock-adjustment-matrix?${query}&format=xlsx`, {
        credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok || response.headers.get('content-type')?.includes('application/json')) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.message || 'Excel 다운로드에 실패했습니다.');
      }
      const blob = await response.blob();
      if (controller.signal.aborted || currentQuery.current !== query) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeSearch = appliedSearch.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 60);
      anchor.href = url;
      anchor.download = `재고조정_${year}년_${major ? `${major}차` : '전체'}${safeSearch ? `_${safeSearch}` : ''}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!controller.signal.aborted && currentQuery.current === query) setExportError(e.message);
    } finally {
      if (!controller.signal.aborted && currentQuery.current === query) setExporting(false);
    }
  };

  return (
    <section className="stock-adjustment-matrix" aria-label="세부차수별 실제 재고조정" aria-busy={loading}>
      <h3>{year}년 세부차수별 실제 재고조정</h3>
      <p>실제 조정은 재고 이력(StockHistory)의 변경 후 − 변경 전 합계입니다. 아래 기존 대차수 흐름차이(기말 − 계산잔량)와 계산 기준이 다릅니다.</p>
      <form onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim()); setReload((value) => value + 1); }}>
        <label>대차수 <select value={major} onChange={(event) => setMajor(event.target.value)}>
          <option value="">전체</option>
          {Array.from({ length: 53 }, (_, index) => String(index + 1)).map((value) => <option key={value} value={value}>{value}차</option>)}
        </select></label>
        <label className="search-label">품목 검색 <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="품명 · 국가 · 품종 · 품목번호" /></label>
        <button type="submit" disabled={loading || exporting}>{loading ? '조회 중…' : '조회'}</button>
        <button type="button" onClick={download} disabled={loading || exporting || !current || search.trim() !== appliedSearch}>{exporting ? 'Excel 준비 중…' : 'Excel 다운로드'}</button>
      </form>
      <p>Excel: 실제 조정표·원이력은 현재 필터를 적용하며, 기존 대차수 흐름차이 시트는 선택 연도 전체 참고 자료입니다.</p>
      {search.trim() !== appliedSearch && <p role="status">입력한 검색어를 적용하려면 Enter 또는 조회를 누르세요.</p>}
      {loading && <p role="status">{year}년 실제 재고조정을 조회하고 있습니다.</p>}
      {error && <p className="matrix-error" role="alert">{error} 조회 버튼으로 다시 시도하세요.</p>}
      {exportError && <p className="matrix-error" role="alert">{exportError} Excel 다운로드 버튼으로 다시 시도하세요.</p>}
      {current && <>
        <p role="status">품목 {current.rows.length.toLocaleString()}개 · 원이력 {current.eventCount.toLocaleString()}건{current.invalidCount > 0 ? ` · 확인 필요 ${current.invalidCount.toLocaleString()}건` : ''}. 단위가 다른 품목의 전체 수량은 합산하지 않습니다.</p>
        {current.rows.length === 0 ? <p>선택한 연도·대차수·검색 조건의 실제 조정 이력이 없습니다.</p> : <div className="matrix-scroll" tabIndex={0} role="region" aria-label="실제 재고조정 표, 가로 스크롤 가능">
          <table>
            <caption>세부차수별 실제 조정 수량 · 빈칸은 이력 없음, 0은 실제 순조정 0, 확인 필요는 값 누락 포함</caption>
            <thead><tr><th scope="col">품목번호</th><th scope="col">품명</th><th scope="col">국가</th><th scope="col">품종</th><th scope="col">단위</th>{current.weeks.map((week) => <th scope="col" key={week.key}>{week.label}</th>)}<th scope="col">품목 순조정</th></tr></thead>
            <tbody>{current.rows.map((row) => <tr key={row.key}>
              <td>{row.prodKey}</td><th scope="row" className="product-name">{row.productName || '(품명 없음)'}</th><td>{row.country || '—'}</td><td>{row.flower || '—'}</td><td>{row.unit || '—'}</td>
              {current.weeks.map((week) => {
                const cell = row.cells?.[week.key];
                return <td className="quantity" key={week.key} title={cell ? `원이력 ${cell.eventCount}건${cell.invalidCount ? ` · 확인 필요 ${cell.invalidCount}건` : ''}` : '이력 없음'}>{cell ? <>{quantityText(cell.quantity)}{cell.invalidCount > 0 && cell.quantity != null && <span className="invalid"> (확인 필요)</span>}</> : ''}</td>;
              })}
              <td className="quantity">{quantityText(row.net)}{row.invalidCount > 0 && row.net != null && <span className="invalid"> (확인 필요)</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </>}
      <style jsx>{`
        .stock-adjustment-matrix { min-width: 0; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 18px; color: #1e293b; }
        h3 { font-size: 16px; margin: 0 0 8px; } p { line-height: 1.6; margin: 8px 0; }
        form { display: flex; flex-wrap: wrap; align-items: end; gap: 8px 12px; }
        label { display: flex; flex-direction: column; gap: 4px; } .search-label { flex: 1 1 240px; }
        input, select, button { font: inherit; padding: 7px 10px; border: 1px solid #94a3b8; border-radius: 6px; background: #fff; min-height: 36px; }
        input { min-width: 0; width: 100%; box-sizing: border-box; } button { cursor: pointer; color: #0f172a; } button:disabled { cursor: default; opacity: .55; }
        input:focus-visible, select:focus-visible, button:focus-visible, .matrix-scroll:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
        .matrix-error, .invalid { color: #b91c1c; } .matrix-scroll { max-width: 100%; overflow-x: auto; }
        table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 14px; } caption { text-align: left; padding: 8px 0; }
        th, td { padding: 7px 9px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
        thead th { background: #f1f5f9; white-space: nowrap; } .product-name { min-width: 160px; max-width: 280px; white-space: normal; overflow-wrap: anywhere; font-weight: 500; }
        .quantity { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; } tbody tr:nth-child(even) { background: #f8fafc; }
      `}</style>
    </section>
  );
}
