// pages/orders/history.js — 주문 변경이력 상세 조회
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiGet } from '../../lib/useApi';
import { normalizeOrderHistorySearch } from '../../lib/orderHistorySearch';
import PasteOperationHistory from '../../components/orders/PasteOperationHistory';

const currentYear = String(new Date().getFullYear());
const fmtValue = (value) => String(value ?? '').trim() || '0';
const queryValue = (value) => Array.isArray(value) ? String(value[0] || '') : String(value || '');
const yearFromWeek = (value) => { const m = String(value || '').match(/^(\d{4})-/); return m ? m[1] : ''; };

export default function OrderHistoryPage() {
  const router = useRouter();
  const requestSeq = useRef(0);
  const mounted = useRef(true);
  const appliedFilters = useRef(null);
  const [year, setYear] = useState(currentYear);
  const [week, setWeek] = useState('');
  const [custName, setCustName] = useState('');
  const [prodName, setProdName] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [responseYear, setResponseYear] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestSeq.current += 1; }; }, []);
  const load = useCallback(async (filters) => {
    const seq = ++requestSeq.current;
    setLoading(true); setErr('');
    try {
      normalizeOrderHistorySearch(filters); // Validate before apiGet can omit an empty year.
      appliedFilters.current = { ...filters };
      const data = await apiGet('/api/orders/history', { year: filters.year, week: filters.week, custName: filters.custName, prodName: filters.prodName, page: filters.page });
      if (!mounted.current || seq !== requestSeq.current) return;
      if (!data.success) throw new Error(data.error || '조회 실패');
      setRows(Array.isArray(data.history) ? data.history : []); setHasMore(Boolean(data.hasMore)); setResponseYear(String(data.orderYear || filters.year || ''));
    } catch (error) {
      if (!mounted.current || seq !== requestSeq.current) return;
      setErr(error.message || '조회 실패'); setRows([]); setHasMore(false);
    } finally { if (mounted.current && seq === requestSeq.current) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!router.isReady) return;
    if (router.query.mode === 'paste') return;
    const qWeek = queryValue(router.query.week);
    const initial = { year: queryValue(router.query.year) || yearFromWeek(qWeek) || currentYear, week: qWeek, custName: queryValue(router.query.custName), prodName: queryValue(router.query.prodName), page: Math.max(1, Number(queryValue(router.query.page)) || 1) };
    setYear(initial.year); setWeek(initial.week); setCustName(initial.custName); setProdName(initial.prodName); setPage(initial.page); load(initial);
  }, [router.isReady, router.query.mode, router.query.year, router.query.week, router.query.custName, router.query.prodName, router.query.page, load]);

  const submit = (event) => { event.preventDefault(); setPage(1); load({ year, week, custName, prodName, page: 1 }); };
  const movePage = (nextPage) => {
    if (nextPage < 1 || (nextPage > page && !hasMore) || loading) return;
    const filters = { year, week, custName, prodName };
    const changed = Object.entries(filters).some(([key, value]) => value !== appliedFilters.current?.[key]);
    const target = changed ? 1 : nextPage;
    setPage(target); load({ ...filters, page: target });
  };
  const reset = () => { setWeek(''); setCustName(''); setProdName(''); setPage(1); load({ year, week: '', custName: '', prodName: '', page: 1 }); };
  const filterCustomer = (name) => { setCustName(name); setPage(1); load({ year, week, custName: name, prodName, page: 1 }); };
  const customerCounts = rows.reduce((acc, row) => { const name = row.거래처명 || '기타'; acc[name] = (acc[name] || 0) + 1; return acc; }, {});

  const tabs = <nav aria-label="이력 종류" style={{ display: 'flex', gap: 8, padding: 12 }}><button onClick={() => router.replace({ pathname: router.pathname, query: { ...router.query, mode: 'paste' } })} style={button}>붙여넣기 작업별 이력</button><button onClick={() => router.replace({ pathname: router.pathname, query: { ...router.query, mode: 'rows' } })} style={button}>주문 행별 변경이력</button></nav>;
  if (router.isReady && router.query.mode === 'paste') return <main style={{ padding: 16, background: '#f7f9fc', minHeight: '100vh' }}><Head><title>붙여넣기 작업이력 - nenova ERP</title></Head>{tabs}<h2>붙여넣기 작업이력</h2><PasteOperationHistory key={[router.query.year, router.query.week, router.query.custName, router.query.prodName].join('|')} initial={{ year: queryValue(router.query.year) || yearFromWeek(queryValue(router.query.week)), week: queryValue(router.query.week), custName: queryValue(router.query.custName), prodName: queryValue(router.query.prodName) }} /></main>;

  return (<>
    <Head><title>주문 변경이력 - nenova ERP</title></Head>
    <main style={{ padding: 16, minHeight: '100vh', boxSizing: 'border-box', background: '#f7f9fc' }}>
      {tabs}
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}><h2 style={{ margin: 0, fontSize: 20, color: '#1a237e' }}>주문 변경이력</h2><span style={{ fontSize: 12, color: '#455a64' }}>연도 {responseYear || year} · 페이지당 500건</span><button type="button" onClick={() => window.opener ? window.close() : history.back()} style={{ ...button, marginLeft: 'auto' }}>닫기</button></header>
      <div style={{ marginBottom: 12, color: '#546e7a', fontSize: 12 }}>주문 변경이력입니다. 분배만 변경한 작업·실패·롤백은 포함하지 않습니다.</div>
      <form onSubmit={submit} style={{ display: 'flex', alignItems: 'end', gap: 10, flexWrap: 'wrap', padding: 12, border: '1px solid #cfd8dc', borderRadius: 8, background: '#fff', marginBottom: 10 }}>
        <label style={label}>연도<input type="number" min="1000" max="9999" required inputMode="numeric" value={year} onChange={e => setYear(e.target.value)} style={{ ...input, width: 88 }} /></label>
        <label style={label}>차수<input value={week} onChange={e => setWeek(e.target.value)} placeholder="전체 · 36 · 36-1 · 2026-36-01" style={{ ...input, width: 220 }} /></label>
        <label style={label}>거래처<input value={custName} onChange={e => setCustName(e.target.value)} placeholder="거래처명" style={{ ...input, width: 170 }} /></label>
        <label style={label}>품목<input value={prodName} onChange={e => setProdName(e.target.value)} placeholder="품목/꽃/국가" style={{ ...input, width: 170 }} /></label>
        <button type="submit" disabled={loading} style={{ ...primaryButton, opacity: loading ? .65 : 1 }}>{loading ? '조회중…' : '조회'}</button><button type="button" onClick={reset} disabled={loading} style={button}>초기화</button>
      </form>
      {Object.keys(customerCounts).length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>{Object.entries(customerCounts).slice(0, 18).map(([name, count]) => <button type="button" key={name} onClick={() => filterCustomer(name === '기타' ? '' : name)} style={chip}>{name} {count}</button>)}</div>}
      {err && <div role="alert" style={{ padding: 10, marginBottom: 10, border: '1px solid #ffcdd2', borderRadius: 6, background: '#ffebee', color: '#c62828' }}>{err}</div>}
      <div style={{ border: '1px solid #cfd8dc', borderRadius: 8, overflow: 'auto', background: '#fff', maxHeight: 'calc(100vh - 245px)' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1250 }}>
        <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}><tr style={{ background: '#dfe6f2', color: '#263238' }}><th style={th}>연도</th><th style={th}>차수</th><th style={th}>변경일시</th><th style={th}>거래처명</th><th style={th}>국가</th><th style={th}>꽃</th><th style={{ ...th, textAlign: 'left' }}>품목명</th><th style={th}>변경항목</th><th style={th}>변경 전</th><th style={th}>변경 후</th><th style={{ ...th, textAlign: 'left' }}>비고</th><th style={th}>사용자</th></tr></thead>
        <tbody>{loading && <tr><td colSpan={12} style={empty}>변경이력을 불러오는 중입니다.</td></tr>}{!loading && rows.length === 0 && <tr><td colSpan={12} style={empty}>표시할 주문 변경이력이 없습니다.</td></tr>}{!loading && rows.map((row, idx) => <tr key={row.historyKey || `${row.변경일자}-${row.거래처명}-${row.품목명}-${idx}`} style={{ background: idx % 2 ? '#fbfcff' : '#fff', borderTop: '1px solid #edf1f5' }}><td style={tdCenter}>{row.연도 || row.orderYear || responseYear || year}</td><td style={tdCenter}>{row.차수 || '-'}</td><td style={tdCenter}>{row.변경일시 || row.변경일자 || '-'}</td><td style={{ ...tdCenter, fontWeight: 800, color: '#1a237e' }}>{row.거래처명 || '-'}</td><td style={tdCenter}>{row.국가 || '-'}</td><td style={tdCenter}>{row.꽃 || '-'}</td><td style={tdLeft}>{row.품목명 || '-'}</td><td style={tdCenter}>{row.변경항목 || row.변경유형 || '-'}</td><td style={{ ...tdCenter, color: '#999', textDecoration: 'line-through' }}>{fmtValue(row.기준값)}</td><td style={{ ...tdCenter, color: '#2e7d32', fontWeight: 900 }}>{fmtValue(row.변경값)}</td><td style={tdLeft}>{row.비고 || ''}</td><td style={tdCenter}>{row.변경사용자 || '-'}</td></tr>)}</tbody>
      </table></div>
      <nav aria-label="주문 변경이력 페이지" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: 12 }}><button type="button" onClick={() => movePage(page - 1)} disabled={loading || page <= 1} style={button}>이전</button><span style={{ fontSize: 13, fontWeight: 800 }}>페이지 {page}{hasMore ? ' · 다음 있음' : ''}</span><button type="button" onClick={() => movePage(page + 1)} disabled={loading || !hasMore} style={button}>다음</button></nav>
    </main>
  </>);
}

const label = { display: 'grid', gap: 4, fontSize: 12, fontWeight: 800, color: '#455a64' };
const input = { padding: '7px 8px', border: '1px solid #b0bec5', borderRadius: 5, minHeight: 34, boxSizing: 'border-box' };
const button = { padding: '7px 14px', border: '1px solid #b0bec5', borderRadius: 5, background: '#fff', cursor: 'pointer', minHeight: 34 };
const primaryButton = { ...button, border: 'none', background: '#1565c0', color: '#fff', fontWeight: 800 };
const chip = { padding: '4px 9px', border: '1px solid #c5cae9', borderRadius: 12, background: '#fff', color: '#1a237e', cursor: 'pointer', fontSize: 12 };
const th = { padding: '9px', borderRight: '1px solid #c8d3df', textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 800 };
const tdCenter = { padding: '7px 9px', borderRight: '1px solid #edf1f5', textAlign: 'center', whiteSpace: 'nowrap' };
const tdLeft = { padding: '7px 9px', borderRight: '1px solid #edf1f5', textAlign: 'left', whiteSpace: 'nowrap' };
const empty = { padding: 24, textAlign: 'center', color: '#78909c' };
