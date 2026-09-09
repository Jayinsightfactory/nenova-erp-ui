import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/useApi';
import { normalizeOrderHistorySearch } from '../../lib/orderHistorySearch';

const field = { padding: 8, border: '1px solid #b0bec5', borderRadius: 5, minWidth: 0 };
const labels = { committed: '저장 완료', failed: '실패 · 저장 성공 아님', unknown: '처리 결과 확인 필요' };
export default function PasteOperationHistory({ initial = {} }) {
  const [filters, setFilters] = useState({ year: initial.year || String(new Date().getFullYear()), week: initial.week || '', custName: initial.custName || '', prodName: initial.prodName || '', who: 'mine' });
  const [data, setData] = useState({ operations: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0); const applied = useRef(null);
  async function load(cursor) {
    const id = ++seq.current; setLoading(true); setError('');
    try {
      normalizeOrderHistorySearch(filters);
      const changed = JSON.stringify(filters) !== JSON.stringify(applied.current);
      const request = { ...filters, ...(!changed && cursor ? { cursor } : {}) };
      applied.current = { ...filters };
      const result = await apiGet('/api/orders/paste-history', request);
      if (id !== seq.current) return;
      if (!result.success) throw new Error(result.error || '조회 실패');
      setData(result);
    } catch (err) { if (id === seq.current) { setError(err.message); setData({ operations: [] }); } }
    finally { if (id === seq.current) setLoading(false); }
  }
  useEffect(() => { load(); return () => { seq.current += 1; }; }, []);
  return <section>
    <p style={{ color: '#546e7a', fontSize: 13 }}>붙여넣기 실행 한 번을 한 건으로 묶습니다. 검색에 맞는 항목이 있으면 같은 작업의 취소·추가를 함께 표시합니다.</p>
    <form onSubmit={event => { event.preventDefault(); load(); }} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
      {[['year', '연도'], ['week', '차수'], ['custName', '거래처'], ['prodName', '품목/꽃/국가']].map(([key, label]) => <label key={key} style={{ display: 'grid', gap: 5 }}>{label}<input aria-label={label} required={key === 'year'} value={filters[key]} placeholder={key === 'week' ? '전체 · 36 · 36-1' : ''} onChange={event => setFilters({ ...filters, [key]: event.target.value })} style={{ ...field, width: key === 'year' ? 90 : 180 }} /></label>)}
      <label style={{ display: 'grid', gap: 5 }}>작업자<select value={filters.who} onChange={event => setFilters({ ...filters, who: event.target.value })} style={field}><option value="mine">내 작업</option><option value="all">전체 작업</option></select></label>
      <button disabled={loading} style={field}>{loading ? '조회 중…' : '조회'}</button>
    </form>
    {error && <p role="alert" style={{ color: '#c62828' }}>{error}</p>}
    <p style={{ fontSize: 12, color: '#546e7a' }}>{data.notice} {data.excludedScopeCount > 0 && `연도/원문 확인 불가 ${data.excludedScopeCount}건 제외`}</p>
    {!loading && !error && data.operations.length === 0 && <p>이번 검색 구간에 해당하는 작업이 없습니다.{data.hasMore && ' 다음 기록을 조회하세요.'}</p>}
    {data.operations.map(operation => <article key={operation.key} style={{ border: '1px solid #c5cfe0', borderRadius: 8, background: '#fff', padding: 12, marginBottom: 12 }}>
      <header style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontWeight: 700 }}><span>작업 #{operation.key}</span><span>{operation.year}년 {operation.week}</span><span>{operation.actor} · {operation.at}</span><span>{operation.undo ? '되돌리기 · ' : ''}{labels[operation.status]} {operation.committedCount != null && `(${operation.committedCount}건)`}</span></header>
      {operation.incomplete && <p role="status" style={{ color: '#a65b00' }}>과거 상세 기록이 잘려 전체 항목을 복원할 수 없습니다. 아래 내용은 전체 작업 내역으로 간주하지 마세요.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 350px), 1fr))', gap: 12, marginTop: 10 }}>
        {['CANCEL', 'ADD', ...(operation.entries.some(entry => entry.type === 'UNKNOWN') ? ['UNKNOWN'] : [])].map(type => <div key={type} style={{ background: type === 'CANCEL' ? '#fff3f3' : '#f1faf3', borderRadius: 6, padding: 10 }}><strong>{type === 'CANCEL' ? '취소' : type === 'ADD' ? '추가' : '유형 확인 필요'} {operation.entries.filter(entry => entry.type === type).length}건</strong>
          {operation.entries.filter(entry => entry.type === type).map((entry, index) => <div key={index} style={{ padding: '9px 0', borderBottom: '1px solid #dfe5e9', display: 'flex', flexWrap: 'wrap', gap: 10 }}><span style={{ minWidth: 130, fontWeight: 700 }}>{entry.custName}</span><span style={{ flex: '1 1 180px', overflowWrap: 'anywhere' }}>{entry.prodName}</span><strong>{entry.qty ?? '?'} {entry.unit}</strong></div>)}
        </div>)}
      </div>
    </article>)}
    <button type="button" disabled={loading || !data.hasMore} onClick={() => load(data.nextCursor)} style={field}>다음 기록 검색</button>
  </section>;
}
